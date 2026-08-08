import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../../../src/auth/org-context";
import { createAdminClient } from "../../../../../src/lib/supabase/admin";
import { recordActualLearningEvidence } from "../../../../../src/learning/learning-service";

export const dynamic = "force-dynamic";

function contractId(request: Request) { return new URL(request.url).pathname.split("/").filter(Boolean).at(-2); }

export async function GET(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = contractId(request);
    const { data, error } = await admin.from("contract_actuals").select("*").eq("organization_id", ctx.organizationId).eq("contract_id", id).order("occurred_on", { ascending: false });
    if (error) return NextResponse.json({ error: "Failed to load actuals" }, { status: 500 });
    return NextResponse.json({ actuals: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load actuals" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    if (!["owner", "admin", "estimator"].includes(ctx.role)) return NextResponse.json({ error: "Only an owner, admin, or estimator can record actual job results" }, { status: 403 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const id = contractId(request);
    const body = await request.json();
    if (!id || !body.actualKind) return NextResponse.json({ error: "Contract and actual type are required" }, { status: 400 });
    let estimateRunId = body.estimateRunId || null;
    if (!estimateRunId) {
      const { data: contract } = await admin.from("contracts").select("tender_id").eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
      if (contract?.tender_id) {
        const { data: estimate } = await admin.from("estimate_runs").select("id").eq("organization_id", ctx.organizationId).eq("tender_id", contract.tender_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        estimateRunId = estimate?.id ?? null;
      }
    }
    const eventClassification = body.eventClassification || (body.actualKind === "change_order" ? "change_order" : body.actualKind === "rework" ? "rework" : "baseline");
    const reconciliationStatus = body.reconciled ? "reconciled" : "partial";
    const qualityScore = Math.max(40, Math.min(100, Number(body.qualityScore ?? (body.taskKey ? 82 : 68))));
    const { data, error } = await admin.from("contract_actuals").insert({ organization_id: ctx.organizationId, contract_id: id, estimate_run_id: estimateRunId, actual_kind: body.actualKind, task_key: body.taskKey || null, resource_key: body.resourceKey || null, quantity: body.quantity === undefined ? null : Number(body.quantity), unit: body.unit || null, hours: body.hours === undefined ? null : Number(body.hours), cost_cents: body.costCents === undefined ? null : Number(body.costCents), occurred_on: body.occurredOn || new Date().toISOString().slice(0, 10), reconciliation_status: reconciliationStatus, event_classification: eventClassification, quality_score: qualityScore, notes: body.notes || null }).select("*").single();
    if (error) return NextResponse.json({ error: "Failed to save actual result" }, { status: 500 });
    const model = await recordActualLearningEvidence(admin, { organizationId: ctx.organizationId, contractId: id, actual: data, createdBy: ctx.authSubject });
    return NextResponse.json({ actual: data, learningModel: model }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save actual result" }, { status: 500 });
  }
}
