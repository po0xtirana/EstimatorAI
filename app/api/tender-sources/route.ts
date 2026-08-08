import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../src/auth/org-context";
import { createAdminClient } from "../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const [sources, connections, runs] = await Promise.all([
      admin.from("tender_sources").select("*").order("enabled", { ascending: false }).order("name"),
      admin.from("organization_tender_source_connections").select("source_key,status,connection_type,forwarding_address,verified_at,last_email_at,processed_email_count,last_success_at,last_error").eq("organization_id", ctx.organizationId),
      admin.from("ingestion_runs").select("source,status,started_at,completed_at,rows_seen,rows_selected,rows_rejected,error_message").order("started_at", { ascending: false }).limit(25)
    ]);
    if (sources.error) return NextResponse.json({ error: "Unable to load tender-source coverage" }, { status: 500 });
    const bySource = new Map((connections.data ?? []).map((connection: any) => [connection.source_key, connection]));
    const latestRuns = new Map<string, any>();
    for (const run of runs.data ?? []) if (!latestRuns.has(run.source)) latestRuns.set(run.source, run);
    const result = (sources.data ?? []).map((source: any) => ({ ...source, organizationConnection: bySource.get(source.source_key) ?? null, latestRun: latestRuns.get(source.source_key) ?? null }));
    return NextResponse.json({ sources: result, canManage: ctx.role === "owner" || ctx.role === "admin", inboundConfigured: Boolean(process.env.TENDER_INBOUND_DOMAIN && process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET), summary: { connected: result.filter((source: any) => source.connection_status === "connected" || source.organizationConnection?.status === "connected").length, available: result.length, healthy: result.filter((source: any) => (source.connection_status === "connected" || source.organizationConnection?.status === "connected") && !(source.organizationConnection?.last_error ?? source.last_error)).length } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load tender sources" }, { status: 401 });
  }
}
