import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../src/auth/org-context";
import { loadCompanyReadiness } from "../../../src/company/readiness";
import { createAdminClient } from "../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const [readiness, tenders, estimates, jobs, exceptions, contracts, sources, allOrgTenders, tenderCount, latestRun] = await Promise.all([
      loadCompanyReadiness(admin, ctx.organizationId),
      admin.from("organization_tenders").select("tender_id, match_score, status, tenders(id, title_en, title_fr, buyer_name, closing_at, estimated_value_cents)").eq("organization_id", ctx.organizationId).in("status", ["reviewing", "bid"]).order("match_score", { ascending: false, nullsFirst: false }).limit(8),
      admin.from("estimate_runs").select("id, status, recommended_price_cents, confidence_score, bid_score, created_at, trade_profiles(name), tenders(title_en, title_fr)").eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(8),
      admin.from("tender_processing_jobs").select("id, tender_id, stage, status, attempt_count, last_error, updated_at").eq("organization_id", ctx.organizationId).in("status", ["queued", "running", "retryable", "failed"]).order("updated_at", { ascending: false }).limit(8),
      admin.from("estimate_exceptions").select("id, estimate_run_id, severity, title, message, resolved").eq("organization_id", ctx.organizationId).eq("resolved", false).order("created_at", { ascending: false }).limit(8),
      admin.from("contracts").select("id, name, status, estimated_price_cents, estimated_cost_cents").eq("organization_id", ctx.organizationId).in("status", ["bid", "active"]).order("created_at", { ascending: false }).limit(8),
      admin.from("tender_sources").select("source_key,connection_status,last_success_at,last_error,enabled"),
      admin.from("organization_tenders").select("status,decision").eq("organization_id", ctx.organizationId),
      admin.from("tenders").select("id", { count: "exact", head: true }),
      admin.from("ingestion_runs").select("source,status,completed_at,rows_seen,rows_selected").eq("status", "succeeded").order("completed_at", { ascending: false }).limit(1).maybeSingle()
    ]);
    const evaluated = (allOrgTenders.data ?? []).filter((row: any) => row.status !== "new");
    const qualified = evaluated.filter((row: any) => ["reviewing", "bid"].includes(row.status)).length;
    const filtered = evaluated.filter((row: any) => row.status === "no_go").length;
    const connectedSources = (sources.data ?? []).filter((source: any) => source.connection_status === "connected");
    const metrics = {
      connectedSources: connectedSources.length,
      availableSources: sources.data?.length ?? 0,
      tendersScanned: tenderCount.count ?? 0,
      qualifiedOpportunities: qualified,
      filteredPercent: evaluated.length ? Math.round(filtered / evaluated.length * 100) : 0,
      screeningHoursSaved: Math.round(filtered * 12 / 60),
      lastScanAt: latestRun.data?.completed_at ?? connectedSources.map((source: any) => source.last_success_at).filter(Boolean).sort().at(-1) ?? null,
      latestScanRows: latestRun.data?.rows_seen ?? 0,
      sourceOutages: (sources.data ?? []).filter((source: any) => source.connection_status === "outage" || source.last_error).length
    };
    return NextResponse.json({ readiness, metrics, opportunities: tenders.data ?? [], estimates: estimates.data ?? [], processingJobs: jobs.data ?? [], exceptions: exceptions.data ?? [], activeJobs: contracts.data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load cockpit" }, { status: 401 });
  }
}
