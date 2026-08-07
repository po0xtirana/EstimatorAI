import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

function tenderId(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-2); }

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = tenderId(request);
    if (!id) return NextResponse.json({ error: "Tender ID is required" }, { status: 400 });
    const [job, analysis, estimate] = await Promise.all([
      admin.from("tender_processing_jobs").select("*").eq("organization_id", ctx.organizationId).eq("tender_id", id).eq("job_type", "analyze_tender").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("tender_analyses").select("*").eq("organization_id", ctx.organizationId).eq("tender_id", id).order("computed_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("estimate_runs").select("*").eq("organization_id", ctx.organizationId).eq("tender_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle()
    ]);
    const analysisView = analysis.data ? {
      status: analysis.data.decision === "viable" && estimate.data ? "estimate_ready" : analysis.data.decision,
      viable: analysis.data.decision === "viable",
      match: {
        score: Number(analysis.data.match_score ?? 0),
        detectedTrades: analysis.data.detected_trades ?? [],
        matchedTrades: analysis.data.matched_trades ?? [],
        explanation: (analysis.data.reasons ?? []).join(" "),
        reasons: analysis.data.reasons ?? []
      },
      tenderAnalysisId: analysis.data.id,
      profileId: analysis.data.trade_profile_id
    } : null;
    return NextResponse.json({ job: job.data ?? null, analysis: analysisView, estimate: estimate.data ?? null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load tender processing status" }, { status: 500 });
  }
}
