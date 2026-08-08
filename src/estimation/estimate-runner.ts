import { generateAccuracyEstimate, type AccuracyEstimateResult } from "./accuracy";
import { loadAccuracyTradeProfile, mapScopeRow } from "./accuracy-server";

export type CreateEstimateRunOptions = {
  admin: any;
  organizationId: string;
  tenderId: string | null;
  tradeProfileId: string;
  scopeRows: any[];
  tenderAnalysisId?: string | null;
  generatedBy?: string;
  authSubject?: string | null;
  matchScore?: number | null;
};

export type CreatedEstimateRun = { estimate: any; result: AccuracyEstimateResult; assumptionVersionId: string | null };

function addConflictingDocumentExceptions(result: AccuracyEstimateResult, scopeRows: any[]) {
  const groups = new Map<string, any[]>();
  for (const row of scopeRows) {
    const key = String(row.task_key ?? row.description ?? "").trim().toLowerCase();
    if (!key || row.quantity === null || row.quantity === undefined) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const [key, rows] of Array.from(groups.entries())) {
    const quantities = Array.from(new Set(rows.map((row) => `${row.quantity}:${row.unit ?? ""}`)));
    const documents = Array.from(new Set(rows.map((row) => row.tender_document_id).filter(Boolean)));
    if (quantities.length > 1 && documents.length > 1) {
      result.exceptions.push({ exceptionType: "conflicting_document", severity: "blocking", title: "Conflicting tender quantities", message: `The tender package contains different quantities for ${key} across ${documents.length} document versions. Review the latest addendum or drawing before approving.` });
    }
  }
}

async function createAssumptionSnapshot(admin: any, options: { organizationId: string; profileId: string; profile: any; authSubject?: string | null }): Promise<string | null> {
  const latest = await admin.from("trade_profile_assumption_versions").select("version_number").eq("organization_id", options.organizationId).eq("trade_profile_id", options.profileId).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const versionNumber = Number(latest.data?.version_number ?? 0) + 1;
  const snapshot = { tradeSlug: options.profile.tradeSlug, targetMarkupPercent: options.profile.targetMarkupPercent, targetMarginPercent: options.profile.targetMarginPercent, contingencyPercent: options.profile.contingencyPercent, mobilizationCents: options.profile.mobilizationCents, travelCostPerKmCents: options.profile.travelCostPerKmCents, shiftHours: options.profile.shiftHours, workingDaysPerWeek: options.profile.workingDaysPerWeek, currentPipelineLoadPercent: options.profile.currentPipelineLoadPercent, calibrationFactors: options.profile.calibrationFactors ?? {}, learningModelVersionId: options.profile.learningModelVersionId ?? null, learningModel: options.profile.learningModel ?? null, resources: options.profile.resources, crews: options.profile.crews, assemblies: options.profile.assemblies };
  const result = await admin.from("trade_profile_assumption_versions").insert({ organization_id: options.organizationId, trade_profile_id: options.profileId, version_number: versionNumber, source: "manual", change_reason: "Estimate baseline snapshot", created_by: options.authSubject ?? "system", snapshot }).select("id").single();
  return result.error || !result.data ? null : result.data.id;
}

export async function createEstimateRun(options: CreateEstimateRunOptions): Promise<CreatedEstimateRun> {
  const profile = await loadAccuracyTradeProfile(options.admin, options.organizationId, options.tradeProfileId);
  if (!profile) throw new Error("Trade profile not found");
  if (!options.scopeRows.length) throw new Error("Add or extract at least one scope item before generating an estimate");
  const result = generateAccuracyEstimate(profile, options.scopeRows.map(mapScopeRow));
  addConflictingDocumentExceptions(result, options.scopeRows);
  let tender: any = null;
  if (options.tenderId) {
    const [tenderResult, capabilityResult, profileResult] = await Promise.all([
      options.admin.from("tenders").select("estimated_value_cents").eq("id", options.tenderId).maybeSingle(),
      options.admin.from("organization_capability_profiles").select("bonding_capacity_cents, available_crew_size, pipeline_load_percent").eq("organization_id", options.organizationId).maybeSingle(),
      options.admin.from("trade_profiles").select("minimum_project_size_cents").eq("id", options.tradeProfileId).eq("organization_id", options.organizationId).maybeSingle()
    ]);
    tender = tenderResult.data;
    const tenderValue = tender?.estimated_value_cents == null ? null : Number(tender.estimated_value_cents);
    const bondingCapacity = capabilityResult.data?.bonding_capacity_cents == null ? null : Number(capabilityResult.data.bonding_capacity_cents);
    const availableCrewSize = capabilityResult.data?.available_crew_size == null ? null : Number(capabilityResult.data.available_crew_size);
    const pipelineLoad = capabilityResult.data?.pipeline_load_percent == null ? null : Number(capabilityResult.data.pipeline_load_percent);
    const minimumProjectSize = profileResult.data?.minimum_project_size_cents == null ? null : Number(profileResult.data.minimum_project_size_cents);
    if (tenderValue !== null && bondingCapacity !== null && tenderValue > bondingCapacity) result.exceptions.push({ exceptionType: "compliance_risk", severity: "blocking", title: "Bonding capacity exceeded", message: `Tender value of $${(tenderValue / 100).toFixed(2)} exceeds the configured bonding capacity of $${(bondingCapacity / 100).toFixed(2)}.` });
    if (minimumProjectSize !== null && tenderValue !== null && tenderValue < minimumProjectSize) result.exceptions.push({ exceptionType: "manual_review", severity: "warning", title: "Below preferred project size", message: `Tender value is below the configured minimum project size of $${(minimumProjectSize / 100).toFixed(2)}.` });
    if (availableCrewSize !== null && availableCrewSize <= 0) result.exceptions.push({ exceptionType: "capacity_gap", severity: "blocking", title: "No available crew capacity", message: "The company capability profile has no available crew size configured for this bid." });
    if (pipelineLoad !== null && pipelineLoad >= 80) result.exceptions.push({ exceptionType: "capacity_gap", severity: "warning", title: "Pipeline load is high", message: `Current company pipeline load is ${pipelineLoad}%. Confirm start-date capacity before approving this bid.` });
    result.bidScore = Math.max(0, result.bidScore - result.exceptions.filter((exception) => exception.exceptionType === "compliance_risk" || exception.exceptionType === "capacity_gap").length * 15);
  }
  const assumptionVersionId = await createAssumptionSnapshot(options.admin, { organizationId: options.organizationId, profileId: options.tradeProfileId, profile, authSubject: options.authSubject });
  const runResult = await options.admin.from("estimate_runs").insert({ organization_id: options.organizationId, tender_id: options.tenderId, tender_analysis_id: options.tenderAnalysisId ?? null, trade_profile_id: options.tradeProfileId, assumption_version_id: assumptionVersionId, learning_model_version_id: result.learningModelVersionId, status: result.exceptions.some((exception) => exception.severity === "blocking") ? "review" : "draft", assumptions: { tradeSlug: profile.tradeSlug, scopeCount: options.scopeRows.length, generatedBy: options.generatedBy ?? "deterministic-engine", matchScore: options.matchScore ?? null, assumptionVersionId, calibrationFactors: profile.calibrationFactors ?? {}, learningModelVersionId: result.learningModelVersionId }, labor_subtotal_cents: result.laborSubtotalCents, material_subtotal_cents: result.materialSubtotalCents, equipment_subtotal_cents: result.equipmentSubtotalCents, subcontractor_subtotal_cents: result.subcontractorSubtotalCents, overhead_subtotal_cents: result.overheadSubtotalCents, risk_reserve_cents: result.riskReserveCents, markup_cents: result.markupCents, recommended_price_cents: result.recommendedPriceCents, expected_cost_cents: result.expectedCostCents, p50_cost_cents: result.p50CostCents, p80_cost_cents: result.p80CostCents, accuracy_explanation: { drivers: result.learningDrivers, uncertainty: result.uncertainty, modelVersionId: result.learningModelVersionId }, confidence_score: result.confidenceScore, bid_score: result.bidScore, schedule_days: result.scheduleDays }).select("*").single();
  if (runResult.error || !runResult.data) throw new Error("Failed to save estimate run");
  const runId = runResult.data.id;
  const lineResult = result.lines.length ? await options.admin.from("estimate_lines").insert(result.lines.map((line) => ({ organization_id: options.organizationId, estimate_run_id: runId, tender_scope_item_id: line.scopeItemId ?? null, tender_document_id: line.sourceDocumentId ?? null, kind: line.kind, task_key: line.taskKey ?? null, resource_key: line.resourceKey ?? null, label: line.label, quantity: line.quantity, unit: line.unit, unit_cost_cents: line.unitCostCents, amount_cents: line.amountCents, formula: line.formula, confidence: line.confidence, source_type: line.sourceType, source_page: line.sourcePage ?? null, evidence_text: line.evidenceText ?? null, assumption_version_id: assumptionVersionId }))) : { error: null };
  if (lineResult.error) throw new Error("Failed to save estimate lines");
  const exceptionResult = result.exceptions.length ? await options.admin.from("estimate_exceptions").insert(result.exceptions.map((exception) => ({ organization_id: options.organizationId, estimate_run_id: runId, tender_scope_item_id: exception.scopeItemId ?? null, exception_type: exception.exceptionType, severity: exception.severity, title: exception.title, message: exception.message }))) : { error: null };
  if (exceptionResult.error) throw new Error("Failed to save estimate exceptions");
  const demandResult = result.resourceDemand.length ? await options.admin.from("estimate_resource_demand").insert(result.resourceDemand.map((demand) => ({ organization_id: options.organizationId, estimate_run_id: runId, resource_kind: demand.resourceKind, resource_key: demand.resourceKey, unit: demand.unit, required_quantity: demand.requiredQuantity, available_quantity: demand.availableQuantity, gap_quantity: demand.gapQuantity, notes: demand.notes ?? null }))) : { error: null };
  if (demandResult.error) throw new Error("Failed to save resource demand");
  return { estimate: runResult.data, result, assumptionVersionId };
}
