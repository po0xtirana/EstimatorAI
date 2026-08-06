import { NextResponse } from "next/server";
import { requireOrganizationContext } from "../../../src/auth/org-context";
import { generateAccuracyEstimate } from "../../../src/estimation/accuracy";
import { loadAccuracyTradeProfile, mapScopeRow } from "../../../src/estimation/accuracy-server";
import { createAdminClient } from "../../../src/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const { data, error } = await admin.from("estimate_runs").select("*, trade_profiles(name, trade_slug), tenders(title_en, title_fr, closing_at)").eq("organization_id", ctx.organizationId).order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: "Failed to load estimates" }, { status: 500 });
    return NextResponse.json({ estimates: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load estimates" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrganizationContext();
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
    const body = await request.json();
    const tenderId = body.tenderId ? String(body.tenderId) : null;
    const tradeProfileId = String(body.tradeProfileId ?? "");
    if (!tradeProfileId) return NextResponse.json({ error: "Select a trade profile before generating an estimate" }, { status: 400 });
    const profile = await loadAccuracyTradeProfile(admin, ctx.organizationId, tradeProfileId);
    if (!profile) return NextResponse.json({ error: "Trade profile not found" }, { status: 404 });
    let scopeRows: any[] = [];
    if (Array.isArray(body.scopeItems) && body.scopeItems.length) {
      scopeRows = body.scopeItems.map((row: any, index: number) => ({ id: row.id ?? `manual-${index + 1}`, task_key: row.taskKey, description: row.description, quantity: row.quantity, unit: row.unit, confidence: row.confidence ?? 65, evidence_text: row.evidenceText, source_page: row.sourcePage, tender_document_id: row.tenderDocumentId }));
    } else if (tenderId) {
      const scopeResult = await admin.from("tender_scope_items").select("*").eq("organization_id", ctx.organizationId).eq("tender_id", tenderId).neq("review_status", "rejected").order("created_at");
      if (scopeResult.error) return NextResponse.json({ error: "Failed to load tender scope" }, { status: 500 });
      scopeRows = scopeResult.data ?? [];
    }
    if (!scopeRows.length) return NextResponse.json({ error: "Add or extract at least one scope item before generating an estimate" }, { status: 400 });
    const result = generateAccuracyEstimate(profile, scopeRows.map(mapScopeRow));
    if (tenderId) {
      const [tenderResult, capabilityResult, profileResult] = await Promise.all([
        admin.from("tenders").select("estimated_value_cents").eq("id", tenderId).maybeSingle(),
        admin.from("organization_capability_profiles").select("bonding_capacity_cents, available_crew_size, pipeline_load_percent").eq("organization_id", ctx.organizationId).maybeSingle(),
        admin.from("trade_profiles").select("minimum_project_size_cents").eq("id", tradeProfileId).eq("organization_id", ctx.organizationId).maybeSingle()
      ]);
      const tenderValue = tenderResult.data?.estimated_value_cents === null || tenderResult.data?.estimated_value_cents === undefined ? null : Number(tenderResult.data.estimated_value_cents);
      const bondingCapacity = capabilityResult.data?.bonding_capacity_cents === null || capabilityResult.data?.bonding_capacity_cents === undefined ? null : Number(capabilityResult.data.bonding_capacity_cents);
      const availableCrewSize = capabilityResult.data?.available_crew_size === null || capabilityResult.data?.available_crew_size === undefined ? null : Number(capabilityResult.data.available_crew_size);
      const pipelineLoad = capabilityResult.data?.pipeline_load_percent === null || capabilityResult.data?.pipeline_load_percent === undefined ? null : Number(capabilityResult.data.pipeline_load_percent);
      const minimumProjectSize = profileResult.data?.minimum_project_size_cents === null || profileResult.data?.minimum_project_size_cents === undefined ? null : Number(profileResult.data.minimum_project_size_cents);
      if (tenderValue !== null && bondingCapacity !== null && tenderValue > bondingCapacity) result.exceptions.push({ exceptionType: "compliance_risk", severity: "blocking", title: "Bonding capacity exceeded", message: `Tender value of $${(tenderValue / 100).toFixed(2)} exceeds the configured bonding capacity of $${(bondingCapacity / 100).toFixed(2)}.` });
      if (minimumProjectSize !== null && tenderValue !== null && tenderValue < minimumProjectSize) result.exceptions.push({ exceptionType: "manual_review", severity: "warning", title: "Below preferred project size", message: `Tender value is below the configured minimum project size of $${(minimumProjectSize / 100).toFixed(2)}.` });
      if (availableCrewSize !== null && availableCrewSize <= 0) result.exceptions.push({ exceptionType: "capacity_gap", severity: "blocking", title: "No available crew capacity", message: "The company capability profile has no available crew size configured for this bid." });
      if (pipelineLoad !== null && pipelineLoad >= 80) result.exceptions.push({ exceptionType: "capacity_gap", severity: "warning", title: "Pipeline load is high", message: `Current company pipeline load is ${pipelineLoad}%. Confirm start-date capacity before approving this bid.` });
      const capabilityPenalty = result.exceptions.filter((exception) => exception.exceptionType === "compliance_risk" || exception.exceptionType === "capacity_gap").length * 15;
      result.bidScore = Math.max(0, result.bidScore - capabilityPenalty);
    }
    const runResult = await admin.from("estimate_runs").insert({ organization_id: ctx.organizationId, tender_id: tenderId, trade_profile_id: tradeProfileId, status: result.exceptions.some((exception) => exception.severity === "blocking") ? "review" : "draft", assumptions: { tradeSlug: profile.tradeSlug, scopeCount: scopeRows.length, generatedBy: "deterministic-engine", capabilityChecks: Boolean(tenderId) }, labor_subtotal_cents: result.laborSubtotalCents, material_subtotal_cents: result.materialSubtotalCents, equipment_subtotal_cents: result.equipmentSubtotalCents, subcontractor_subtotal_cents: result.subcontractorSubtotalCents, overhead_subtotal_cents: result.overheadSubtotalCents, risk_reserve_cents: result.riskReserveCents, markup_cents: result.markupCents, recommended_price_cents: result.recommendedPriceCents, confidence_score: result.confidenceScore, bid_score: result.bidScore, schedule_days: result.scheduleDays }).select("*").single();
    if (runResult.error || !runResult.data) return NextResponse.json({ error: "Failed to save estimate run" }, { status: 500 });
    const runId = runResult.data.id;
    if (result.lines.length) await admin.from("estimate_lines").insert(result.lines.map((line) => ({ organization_id: ctx.organizationId, estimate_run_id: runId, tender_scope_item_id: line.scopeItemId ?? null, tender_document_id: line.sourceDocumentId ?? null, kind: line.kind, task_key: line.taskKey ?? null, resource_key: line.resourceKey ?? null, label: line.label, quantity: line.quantity, unit: line.unit, unit_cost_cents: line.unitCostCents, amount_cents: line.amountCents, formula: line.formula, confidence: line.confidence, source_type: line.sourceType, source_page: line.sourcePage ?? null, evidence_text: line.evidenceText ?? null })));
    if (result.exceptions.length) await admin.from("estimate_exceptions").insert(result.exceptions.map((exception) => ({ organization_id: ctx.organizationId, estimate_run_id: runId, tender_scope_item_id: exception.scopeItemId ?? null, exception_type: exception.exceptionType, severity: exception.severity, title: exception.title, message: exception.message })));
    if (result.resourceDemand.length) await admin.from("estimate_resource_demand").insert(result.resourceDemand.map((demand) => ({ organization_id: ctx.organizationId, estimate_run_id: runId, resource_kind: demand.resourceKind, resource_key: demand.resourceKey, unit: demand.unit, required_quantity: demand.requiredQuantity, available_quantity: demand.availableQuantity, gap_quantity: demand.gapQuantity, notes: demand.notes ?? null })));
    return NextResponse.json({ estimate: runResult.data, result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate estimate" }, { status: 500 });
  }
}
