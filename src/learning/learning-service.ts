import {
  buildHierarchicalLearningModel,
  calculateLearningMetrics,
  type HierarchicalLearningParameters,
  type LearningEvidenceInput,
  type LearningKind,
  type LearningMetric
} from "./hierarchical-model";

type EvidenceInsert = {
  metric: LearningMetric;
  kind: LearningKind;
  taskKey?: string | null;
  resourceKey?: string | null;
  predictedQuantity?: number | null;
  predictedHours?: number | null;
  predictedRateCents?: number | null;
  predictedCostCents?: number | null;
  observedQuantity?: number | null;
  observedHours?: number | null;
  observedRateCents?: number | null;
  observedCostCents?: number | null;
  factor: number;
};

function canonicalKind(value: string): LearningKind | null {
  if (value === "vehicle") return "equipment";
  if (value === "mobilization") return "overhead";
  if (["labor", "material", "equipment", "subcontractor", "overhead", "schedule", "risk"].includes(value)) return value as LearningKind;
  return null;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function factor(observed: number | null, predicted: number | null): number | null {
  return observed !== null && predicted !== null && observed > 0 && predicted > 0 ? observed / predicted : null;
}

function weightedRate(lines: any[]): number | null {
  const quantity = lines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
  const cost = lines.reduce((sum, line) => sum + Number(line.amount_cents ?? 0), 0);
  return quantity > 0 ? cost / quantity : null;
}

function hierarchy(taskKey?: string | null, resourceKey?: string | null) {
  return resourceKey ? "resource" : taskKey ? "task" : "category";
}

function sourceTrust(sourceType: string, reconciliationStatus: string) {
  if (sourceType === "estimator_workbook") return 0.2;
  if (sourceType === "manual_correction") return 0.55;
  return reconciliationStatus === "reconciled" ? 1 : 0.65;
}

export async function loadActiveLearningModel(admin: any, organizationId: string, tradeProfileId: string): Promise<{ id: string; version_number: number; parameters: HierarchicalLearningParameters; accuracy_metrics: any; uncertainty_metrics: any } | null> {
  const result = await admin.from("learning_model_versions").select("id, version_number, parameters, accuracy_metrics, uncertainty_metrics").eq("organization_id", organizationId).eq("trade_profile_id", tradeProfileId).eq("status", "active").maybeSingle();
  if (result.error || !result.data) return null;
  return result.data as any;
}

async function sharedPriorEvidence(admin: any, organizationId: string, tradeProfileId: string): Promise<LearningEvidenceInput[]> {
  const [organization, profile] = await Promise.all([
    admin.from("organizations").select("shared_learning_opt_in").eq("id", organizationId).maybeSingle(),
    admin.from("trade_profiles").select("trade_slug").eq("id", tradeProfileId).eq("organization_id", organizationId).maybeSingle()
  ]);
  if (!organization.data?.shared_learning_opt_in || !profile.data?.trade_slug) return [];
  const priors = await admin.from("learning_shared_priors").select("*").eq("trade_slug", profile.data.trade_slug).gte("contributor_count", 10).gte("completed_job_count", 50);
  if (priors.error) return [];
  return (priors.data ?? []).map((row: any) => ({
    metric: row.metric,
    normalized_kind: row.normalized_kind,
    hierarchy_level: row.task_key ? "task" : "category",
    task_key: row.task_key || null,
    resource_key: null,
    observed_factor: Math.exp(Number(row.mean_log_factor)),
    trust_weight: Math.min(0.2, Number(row.effective_weight ?? 1) / 50),
    confidence: 70,
    quality_score: 80,
    source_type: "shared_prior",
    created_at: row.computed_at
  }));
}

export async function refreshLearningModel(admin: any, organizationId: string, tradeProfileId: string, createdBy = "system") {
  const [evidenceResult, currentResult, shared] = await Promise.all([
    admin.from("learning_evidence").select("*").eq("organization_id", organizationId).eq("trade_profile_id", tradeProfileId).eq("status", "accepted").order("created_at", { ascending: true }),
    admin.from("learning_model_versions").select("id, version_number").eq("organization_id", organizationId).eq("trade_profile_id", tradeProfileId).eq("status", "active").maybeSingle(),
    sharedPriorEvidence(admin, organizationId, tradeProfileId)
  ]);
  if (evidenceResult.error) throw new Error("Failed to load learning evidence");
  const ownEvidence = (evidenceResult.data ?? []) as LearningEvidenceInput[];
  const parameters = buildHierarchicalLearningModel([...ownEvidence, ...shared]);
  const accuracyMetrics = calculateLearningMetrics(ownEvidence);
  const nodes = [...Object.values(parameters.category), ...Object.values(parameters.task), ...Object.values(parameters.resource)];
  const uncertaintyMetrics = {
    targetCoveragePercent: 80,
    averageLogStandardDeviation: nodes.length ? nodes.reduce((sum, node) => sum + node.logStandardDeviation, 0) / nodes.length : 0.18,
    method: "lognormal_residual_p50_p80"
  };
  const latest = await admin.from("learning_model_versions").select("version_number").eq("organization_id", organizationId).eq("trade_profile_id", tradeProfileId).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const versionNumber = Number(latest.data?.version_number ?? 0) + 1;
  const trainingDates = ownEvidence.map((item) => item.created_at).filter(Boolean).sort();
  const inserted = await admin.from("learning_model_versions").insert({
    organization_id: organizationId,
    trade_profile_id: tradeProfileId,
    version_number: versionNumber,
    status: "building",
    methodology: parameters.methodology,
    parameters,
    training_window: { from: trainingDates[0] ?? null, to: trainingDates.at(-1) ?? null, sharedPriorCount: shared.length },
    evidence_count: ownEvidence.length,
    accuracy_metrics: accuracyMetrics,
    uncertainty_metrics: uncertaintyMetrics,
    previous_version_id: currentResult.data?.id ?? null,
    created_by: createdBy
  }).select("*").single();
  if (inserted.error || !inserted.data) throw new Error("Failed to create a learning model version");
  try {
    if (currentResult.data?.id) {
      const retired = await admin.from("learning_model_versions").update({ status: "superseded" }).eq("id", currentResult.data.id).eq("organization_id", organizationId).eq("status", "active");
      if (retired.error) throw new Error("Failed to retire the previous learning model");
    }
    const activated = await admin.from("learning_model_versions").update({ status: "active", activated_at: new Date().toISOString() }).eq("id", inserted.data.id).eq("organization_id", organizationId).select("*").single();
    if (activated.error || !activated.data) throw new Error("Failed to activate the learning model");
    return activated.data;
  } catch (error) {
    await admin.from("learning_model_versions").update({ status: "failed" }).eq("id", inserted.data.id).eq("organization_id", organizationId);
    if (currentResult.data?.id) await admin.from("learning_model_versions").update({ status: "active" }).eq("id", currentResult.data.id).eq("organization_id", organizationId).eq("status", "superseded");
    throw error;
  }
}

export async function recordEstimatorWorkbookEvidence(admin: any, options: {
  organizationId: string;
  tradeProfileId: string;
  estimateRunId: string;
  workbookImportId: string;
  categories: Record<string, { aiCents: number; estimatorCents: number }>;
  confidence: number;
  createdBy?: string;
}) {
  await admin.from("learning_evidence").update({ status: "superseded" }).eq("organization_id", options.organizationId).eq("workbook_import_id", options.workbookImportId).eq("status", "accepted");
  const rows = Object.entries(options.categories).flatMap(([rawKind, values]) => {
    const kind = canonicalKind(rawKind);
    const observedFactor = factor(values.estimatorCents, values.aiCents);
    if (!kind || observedFactor === null || kind === "schedule" || kind === "risk") return [];
    return [{
      organization_id: options.organizationId,
      trade_profile_id: options.tradeProfileId,
      estimate_run_id: options.estimateRunId,
      workbook_import_id: options.workbookImportId,
      source_type: "estimator_workbook",
      metric: "category_cost_factor",
      normalized_kind: kind,
      hierarchy_level: "category",
      predicted_cost_cents: values.aiCents,
      observed_cost_cents: values.estimatorCents,
      observed_factor: observedFactor,
      trust_weight: 0.2,
      confidence: Math.max(40, Math.min(100, options.confidence)),
      quality_score: Math.max(40, Math.min(100, options.confidence)),
      reconciliation_status: "partial",
      event_classification: "baseline",
      status: "accepted"
    }];
  });
  if (rows.length) {
    const insert = await admin.from("learning_evidence").insert(rows);
    if (insert.error) throw new Error("Failed to save unified workbook learning evidence");
  }
  return refreshLearningModel(admin, options.organizationId, options.tradeProfileId, options.createdBy ?? "estimator-workbook");
}

export async function recordActualLearningEvidence(admin: any, options: {
  organizationId: string;
  contractId: string;
  actual: any;
  createdBy?: string;
  deferRefresh?: boolean;
}) {
  const actual = options.actual;
  const estimateRunId = actual.estimate_run_id;
  if (!estimateRunId) return null;
  const estimateResult = await admin.from("estimate_runs").select("id, trade_profile_id, assumption_version_id, schedule_days, risk_reserve_cents").eq("id", estimateRunId).eq("organization_id", options.organizationId).maybeSingle();
  if (estimateResult.error || !estimateResult.data) return null;
  const estimate = estimateResult.data;
  const actualKind = String(actual.actual_kind);
  const kind = actualKind === "change_order" || actualKind === "rework" ? "risk" : canonicalKind(actualKind);
  if (!kind) return null;
  const lineKinds = kind === "equipment" ? ["equipment", "vehicle"] : kind === "overhead" ? ["overhead", "mobilization"] : kind === "risk" ? ["risk"] : [kind];
  let lineQuery = admin.from("estimate_lines").select("kind, task_key, resource_key, quantity, unit_cost_cents, amount_cents").eq("organization_id", options.organizationId).eq("estimate_run_id", estimateRunId).in("kind", lineKinds);
  if (actual.task_key && kind !== "risk") lineQuery = lineQuery.eq("task_key", actual.task_key);
  if (actual.resource_key) lineQuery = lineQuery.eq("resource_key", actual.resource_key);
  const lineResult = await lineQuery;
  if (lineResult.error) throw new Error("Failed to load the original estimate for learning");
  const lines = lineResult.data ?? [];
  const predictedCost = kind === "risk" ? Number(estimate.risk_reserve_cents ?? 0) : lines.reduce((sum: number, line: any) => sum + Number(line.amount_cents ?? 0), 0);
  const predictedQuantity = lines.reduce((sum: number, line: any) => sum + Number(line.quantity ?? 0), 0);
  const predictedRate = weightedRate(lines);
  const observedCost = finite(actual.cost_cents);
  const observedQuantity = finite(actual.quantity);
  const observedHours = finite(actual.hours);
  const observedRate = observedCost !== null && (observedHours ?? observedQuantity ?? 0) > 0 ? observedCost / Number(observedHours ?? observedQuantity) : null;
  const reconciliation = actual.reconciliation_status === "reconciled" ? "reconciled" : "partial";
  const sourceType = reconciliation === "reconciled" ? "completed_job_actual" : "partial_job_actual";
  const quality = Math.max(40, Math.min(100, Number(actual.quality_score ?? (actual.task_key ? 82 : 68))));
  const inserts: EvidenceInsert[] = [];
  const add = (entry: Omit<EvidenceInsert, "factor"> & { factor: number | null }) => { if (entry.factor !== null && Number.isFinite(entry.factor) && entry.factor > 0) inserts.push(entry as EvidenceInsert); };

  if (kind === "labor") {
    add({ metric: "labor_hours_factor", kind, taskKey: actual.task_key, resourceKey: actual.resource_key, predictedHours: predictedQuantity, observedHours, predictedCostCents: predictedCost, observedCostCents: observedCost, factor: factor(observedHours, predictedQuantity) });
    add({ metric: "labor_rate_factor", kind, taskKey: actual.task_key, resourceKey: actual.resource_key, predictedRateCents: predictedRate, observedRateCents: observedRate, predictedCostCents: predictedCost, observedCostCents: observedCost, factor: factor(observedRate, predictedRate) });
  } else if (kind === "material") {
    add({ metric: "material_consumption_factor", kind, taskKey: actual.task_key, resourceKey: actual.resource_key, predictedQuantity, observedQuantity, predictedCostCents: predictedCost, observedCostCents: observedCost, factor: factor(observedQuantity, predictedQuantity) });
    add({ metric: "unit_cost_factor", kind, taskKey: actual.task_key, resourceKey: actual.resource_key, predictedRateCents: predictedRate, observedRateCents: observedRate, predictedCostCents: predictedCost, observedCostCents: observedCost, factor: factor(observedRate, predictedRate) });
  } else if (kind === "equipment") {
    add({ metric: "equipment_duration_factor", kind, taskKey: actual.task_key, resourceKey: actual.resource_key, predictedQuantity, observedQuantity, predictedCostCents: predictedCost, observedCostCents: observedCost, factor: factor(observedQuantity, predictedQuantity) });
    add({ metric: "unit_cost_factor", kind, taskKey: actual.task_key, resourceKey: actual.resource_key, predictedRateCents: predictedRate, observedRateCents: observedRate, predictedCostCents: predictedCost, observedCostCents: observedCost, factor: factor(observedRate, predictedRate) });
  } else if (kind === "schedule") {
    add({ metric: "schedule_factor", kind, taskKey: actual.task_key, predictedQuantity: finite(estimate.schedule_days), observedQuantity, factor: factor(observedQuantity, finite(estimate.schedule_days)) });
  } else if (kind === "risk") {
    add({ metric: "risk_factor", kind, taskKey: actual.task_key, predictedCostCents: predictedCost, observedCostCents: observedCost, factor: factor(observedCost, predictedCost) });
  } else {
    const metric: LearningMetric = kind === "subcontractor" ? "subcontractor_cost_factor" : "overhead_factor";
    add({ metric, kind, taskKey: actual.task_key, resourceKey: actual.resource_key, predictedCostCents: predictedCost, observedCostCents: observedCost, factor: factor(observedCost, predictedCost) });
  }
  if (!inserts.length && observedCost !== null) {
    add({ metric: "category_cost_factor", kind, taskKey: actual.task_key, resourceKey: actual.resource_key, predictedCostCents: predictedCost, observedCostCents: observedCost, factor: factor(observedCost, predictedCost) });
  }
  if (!inserts.length) return null;

  await admin.from("learning_evidence").update({ status: "superseded" }).eq("organization_id", options.organizationId).eq("estimate_run_id", estimateRunId).eq("source_type", "estimator_workbook").eq("normalized_kind", kind).eq("status", "accepted");
  const rows = inserts.map((entry) => ({
    organization_id: options.organizationId,
    trade_profile_id: estimate.trade_profile_id,
    estimate_run_id: estimateRunId,
    contract_id: options.contractId,
    workbook_import_id: actual.workbook_import_id ?? null,
    contract_actual_id: actual.id,
    assumption_version_id: estimate.assumption_version_id,
    source_type: sourceType,
    metric: entry.metric,
    normalized_kind: entry.kind,
    hierarchy_level: hierarchy(entry.taskKey, entry.resourceKey),
    task_key: entry.taskKey ?? null,
    resource_key: entry.resourceKey ?? null,
    predicted_quantity: entry.predictedQuantity ?? null,
    predicted_hours: entry.predictedHours ?? null,
    predicted_rate_cents: entry.predictedRateCents === null || entry.predictedRateCents === undefined ? null : Math.round(entry.predictedRateCents),
    predicted_cost_cents: entry.predictedCostCents ?? null,
    observed_quantity: entry.observedQuantity ?? null,
    observed_hours: entry.observedHours ?? null,
    observed_rate_cents: entry.observedRateCents === null || entry.observedRateCents === undefined ? null : Math.round(entry.observedRateCents),
    observed_cost_cents: entry.observedCostCents ?? null,
    observed_factor: entry.factor,
    trust_weight: sourceTrust(sourceType, reconciliation),
    confidence: quality,
    quality_score: quality,
    reconciliation_status: reconciliation,
    event_classification: actual.event_classification ?? (actualKind === "change_order" ? "change_order" : actualKind === "rework" ? "rework" : "baseline"),
    project_features: { occurredOn: actual.occurred_on ?? null, source: actual.workbook_import_id ? "job_workbook" : "manual_actual" },
    status: "accepted",
    source_created_at: actual.created_at ?? new Date().toISOString()
  }));
  const existing = await admin.from("learning_evidence").select("id").eq("organization_id", options.organizationId).eq("contract_actual_id", actual.id).limit(1);
  if (existing.error) throw new Error("Failed to check existing actual-job evidence");
  if (!existing.data?.length) {
    const inserted = await admin.from("learning_evidence").insert(rows);
    if (inserted.error) throw new Error("Failed to save actual-job learning evidence");
  }
  if (options.deferRefresh) return { tradeProfileId: estimate.trade_profile_id };
  return refreshLearningModel(admin, options.organizationId, estimate.trade_profile_id, options.createdBy ?? "job-actual");
}

export async function rollbackLearningModel(admin: any, organizationId: string, modelId: string, createdBy: string) {
  const target = await admin.from("learning_model_versions").select("*").eq("id", modelId).eq("organization_id", organizationId).maybeSingle();
  if (target.error || !target.data) throw new Error("Learning model version not found");
  const current = await admin.from("learning_model_versions").select("id").eq("organization_id", organizationId).eq("trade_profile_id", target.data.trade_profile_id).eq("status", "active").maybeSingle();
  if (current.data?.id === target.data.id) return target.data;
  if (current.data?.id) await admin.from("learning_model_versions").update({ status: "superseded" }).eq("id", current.data.id).eq("organization_id", organizationId);
  const activated = await admin.from("learning_model_versions").update({ status: "active", activated_at: new Date().toISOString(), created_by: `${createdBy}:rollback` }).eq("id", target.data.id).eq("organization_id", organizationId).select("*").single();
  if (activated.error || !activated.data) {
    if (current.data?.id) await admin.from("learning_model_versions").update({ status: "active" }).eq("id", current.data.id).eq("organization_id", organizationId);
    throw new Error("Failed to roll back the learning model");
  }
  return activated.data;
}
