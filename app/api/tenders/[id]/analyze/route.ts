import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";
import { tenderSourceFingerprint } from "../../../../../src/tenders/fingerprint";

export const dynamic = "force-dynamic";

function tenderId(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-2); }

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!["owner", "admin", "estimator"].includes(ctx.role)) return NextResponse.json({ error: "Only an owner, admin, or estimator can run tender analysis" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = tenderId(request);
    if (!id) return NextResponse.json({ error: "Tender ID is required" }, { status: 400 });
    const { data: tender, error: tenderError } = await admin.from("tenders").select("*").eq("id", id).maybeSingle();
    if (tenderError || !tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    const fingerprint = tenderSourceFingerprint(tender);
    const existing = await admin.from("tender_processing_jobs").select("*").eq("organization_id", ctx.organizationId).eq("tender_id", id).eq("job_type", "analyze_tender").eq("source_fingerprint", fingerprint).maybeSingle();
    if (existing.data && ["queued", "running"].includes(existing.data.status)) return NextResponse.json({ status: existing.data.status, job: existing.data });
    if (existing.data?.status === "succeeded") return NextResponse.json({ status: "processing_complete", job: existing.data });
    const { data: job, error } = await admin.from("tender_processing_jobs").upsert({
      organization_id: ctx.organizationId,
      tender_id: id,
      job_type: "analyze_tender",
      source_fingerprint: fingerprint,
      status: "queued",
      stage: "queued",
      next_run_at: new Date().toISOString(),
      last_error: null
    }, { onConflict: "organization_id,tender_id,job_type,source_fingerprint" }).select("*").single();
    if (error || !job) return NextResponse.json({ error: "Unable to queue tender analysis" }, { status: 500 });
    return NextResponse.json({ status: job.status === "succeeded" ? "processing_complete" : "queued", job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to queue tender analysis" }, { status: 500 });
  }
}
