export type LearningMetric =
  | "category_cost_factor"
  | "quantity_factor"
  | "labor_hours_factor"
  | "labor_rate_factor"
  | "material_consumption_factor"
  | "unit_cost_factor"
  | "equipment_duration_factor"
  | "subcontractor_cost_factor"
  | "overhead_factor"
  | "schedule_factor"
  | "risk_factor";

export type LearningKind = "labor" | "material" | "equipment" | "subcontractor" | "overhead" | "schedule" | "risk";
export type LearningLevel = "category" | "task" | "resource";

export type LearningEvidenceInput = {
  id?: string;
  contract_actual_id?: string | null;
  metric: LearningMetric;
  normalized_kind: LearningKind;
  hierarchy_level: "company" | "trade" | LearningLevel;
  task_key?: string | null;
  resource_key?: string | null;
  observed_factor: number;
  trust_weight: number;
  confidence: number;
  quality_score: number;
  source_type: string;
  predicted_cost_cents?: number | null;
  observed_cost_cents?: number | null;
  created_at: string;
};

export type LearningNode = {
  key: string;
  level: LearningLevel;
  kind: LearningKind;
  metric: LearningMetric;
  taskKey: string | null;
  resourceKey: string | null;
  factor: number;
  rawFactor: number;
  confidence: number;
  effectiveWeight: number;
  sampleCount: number;
  logStandardDeviation: number;
  sourceBreakdown: Record<string, number>;
  explanation: string;
};

export type HierarchicalLearningParameters = {
  methodology: "hierarchical_log_ratio_v1";
  generatedAt: string;
  evidenceCount: number;
  category: Record<string, LearningNode>;
  task: Record<string, LearningNode>;
  resource: Record<string, LearningNode>;
  defaults: { priorStrength: Record<LearningLevel, number>; factorBounds: [number, number]; recencyHalfLifeDays: number };
};

const FACTOR_MIN = 0.65;
const FACTOR_MAX = 1.45;
const OBSERVATION_MIN = 0.5;
const OBSERVATION_MAX = 2;
const HALF_LIFE_DAYS = 365;
const PRIOR_STRENGTH: Record<LearningLevel, number> = { category: 5, task: 8, resource: 10 };

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number, places = 6) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function nodeKey(level: LearningLevel, kind: LearningKind, metric: LearningMetric, taskKey?: string | null, resourceKey?: string | null) {
  if (level === "resource") return `${kind}:${metric}:task:${taskKey ?? "*"}:resource:${resourceKey ?? "*"}`;
  if (level === "task") return `${kind}:${metric}:task:${taskKey ?? "*"}`;
  return `${kind}:${metric}`;
}

function observationWeight(item: LearningEvidenceInput, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - new Date(item.created_at).getTime()) / 86_400_000);
  const recency = Math.max(0.2, 0.5 ** (ageDays / HALF_LIFE_DAYS));
  return clamp(finite(item.trust_weight), 0, 1) * clamp(finite(item.confidence) / 100, 0, 1) * clamp(finite(item.quality_score) / 100, 0, 1) * recency;
}

function robustLogs(items: LearningEvidenceInput[]) {
  const logs = items.map((item) => Math.log(clamp(finite(item.observed_factor, 1), OBSERVATION_MIN, OBSERVATION_MAX)));
  const center = median(logs);
  const mad = median(logs.map((value) => Math.abs(value - center)));
  const radius = Math.max(0.08, mad * 3.5);
  return logs.map((value) => clamp(value, center - radius, center + radius));
}

function buildNode(level: LearningLevel, items: LearningEvidenceInput[], priorFactor: number, now: Date): LearningNode {
  const first = items[0];
  const logs = robustLogs(items);
  const weights = items.map((item) => observationWeight(item, now));
  const effectiveWeight = weights.reduce((sum, value) => sum + value, 0);
  const weightedLog = logs.reduce((sum, value, index) => sum + value * weights[index], 0) / Math.max(0.000001, effectiveWeight);
  const priorLog = Math.log(clamp(priorFactor, FACTOR_MIN, FACTOR_MAX));
  const posteriorLog = (priorLog * PRIOR_STRENGTH[level] + weightedLog * effectiveWeight) / (PRIOR_STRENGTH[level] + effectiveWeight);
  const rawFactor = Math.exp(weightedLog);
  const factor = clamp(Math.exp(posteriorLog), FACTOR_MIN, FACTOR_MAX);
  const variance = logs.reduce((sum, value, index) => sum + weights[index] * (value - weightedLog) ** 2, 0) / Math.max(0.000001, effectiveWeight);
  const logStandardDeviation = Math.max(0.03, Math.sqrt(variance || 0.18 ** 2) / Math.sqrt(Math.max(1, effectiveWeight)));
  const averageQuality = items.reduce((sum, item) => sum + finite(item.quality_score), 0) / items.length;
  const confidence = clamp((effectiveWeight / (PRIOR_STRENGTH[level] + effectiveWeight)) * averageQuality, 1, 98);
  const sourceBreakdown: Record<string, number> = {};
  for (const item of items) sourceBreakdown[item.source_type] = (sourceBreakdown[item.source_type] ?? 0) + 1;
  const direction = factor >= 1 ? "increase" : "decrease";
  return {
    key: nodeKey(level, first.normalized_kind, first.metric, first.task_key, first.resource_key),
    level,
    kind: first.normalized_kind,
    metric: first.metric,
    taskKey: level === "category" ? null : first.task_key ?? null,
    resourceKey: level === "resource" ? first.resource_key ?? null : null,
    factor: rounded(factor),
    rawFactor: rounded(rawFactor),
    confidence: rounded(confidence, 2),
    effectiveWeight: rounded(effectiveWeight, 4),
    sampleCount: items.length,
    logStandardDeviation: rounded(logStandardDeviation),
    sourceBreakdown,
    explanation: `${items.length} accepted observation${items.length === 1 ? "" : "s"} suggest a ${Math.abs((factor - 1) * 100).toFixed(1)}% ${direction}; conservative shrinkage keeps the active adjustment at ${((factor - 1) * 100).toFixed(1)}%.`
  };
}

function groupBy(items: LearningEvidenceInput[], key: (item: LearningEvidenceInput) => string) {
  const groups = new Map<string, LearningEvidenceInput[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

export function buildHierarchicalLearningModel(evidence: LearningEvidenceInput[], now = new Date()): HierarchicalLearningParameters {
  const usable = evidence.filter((item) => finite(item.observed_factor) > 0 && finite(item.trust_weight) > 0 && finite(item.confidence) >= 40 && finite(item.quality_score) >= 40);
  const category: Record<string, LearningNode> = {};
  const task: Record<string, LearningNode> = {};
  const resource: Record<string, LearningNode> = {};

  const categoryGroups = groupBy(usable, (item) => nodeKey("category", item.normalized_kind, item.metric));
  for (const [key, items] of Array.from(categoryGroups.entries())) category[key] = buildNode("category", items, 1, now);

  const taskItems = usable.filter((item) => item.task_key);
  const taskGroups = groupBy(taskItems, (item) => nodeKey("task", item.normalized_kind, item.metric, item.task_key));
  for (const [key, items] of Array.from(taskGroups.entries())) {
    const parent = category[nodeKey("category", items[0].normalized_kind, items[0].metric)];
    task[key] = buildNode("task", items, parent?.factor ?? 1, now);
  }

  const resourceItems = usable.filter((item) => item.resource_key);
  const resourceGroups = groupBy(resourceItems, (item) => nodeKey("resource", item.normalized_kind, item.metric, item.task_key, item.resource_key));
  for (const [key, items] of Array.from(resourceGroups.entries())) {
    const parent = task[nodeKey("task", items[0].normalized_kind, items[0].metric, items[0].task_key)] ?? category[nodeKey("category", items[0].normalized_kind, items[0].metric)];
    resource[key] = buildNode("resource", items, parent?.factor ?? 1, now);
  }

  return {
    methodology: "hierarchical_log_ratio_v1",
    generatedAt: now.toISOString(),
    evidenceCount: usable.length,
    category,
    task,
    resource,
    defaults: { priorStrength: PRIOR_STRENGTH, factorBounds: [FACTOR_MIN, FACTOR_MAX], recencyHalfLifeDays: HALF_LIFE_DAYS }
  };
}

export function resolveLearningNode(parameters: HierarchicalLearningParameters | null | undefined, metric: LearningMetric, kind: LearningKind, taskKey?: string | null, resourceKey?: string | null): LearningNode | null {
  if (!parameters) return null;
  if (resourceKey) {
    const resource = parameters.resource?.[nodeKey("resource", kind, metric, taskKey, resourceKey)];
    if (resource) return resource;
  }
  if (taskKey) {
    const task = parameters.task?.[nodeKey("task", kind, metric, taskKey)];
    if (task) return task;
  }
  return parameters.category?.[nodeKey("category", kind, metric)] ?? null;
}

export function resolveLearningFactor(parameters: HierarchicalLearningParameters | null | undefined, metric: LearningMetric, kind: LearningKind, taskKey?: string | null, resourceKey?: string | null): number {
  return resolveLearningNode(parameters, metric, kind, taskKey, resourceKey)?.factor ?? 1;
}

export function calculateLearningMetrics(evidence: LearningEvidenceInput[]) {
  const candidates = evidence.filter((item) => finite(item.predicted_cost_cents) > 0 && item.observed_cost_cents !== null && item.observed_cost_cents !== undefined && finite(item.observed_cost_cents) >= 0);
  const unique = new Map<string, LearningEvidenceInput>();
  for (const item of candidates) {
    const key = item.contract_actual_id ?? item.id ?? `${item.normalized_kind}:${item.metric}:${item.created_at}:${item.predicted_cost_cents}:${item.observed_cost_cents}`;
    const existing = unique.get(key);
    if (!existing || item.metric === "category_cost_factor") unique.set(key, item);
  }
  const costs = Array.from(unique.values());
  const predicted = costs.reduce((sum, item) => sum + finite(item.predicted_cost_cents), 0);
  const actual = costs.reduce((sum, item) => sum + finite(item.observed_cost_cents), 0);
  const absoluteError = costs.reduce((sum, item) => sum + Math.abs(finite(item.observed_cost_cents) - finite(item.predicted_cost_cents)), 0);
  const percentages = costs.map((item) => Math.abs(finite(item.observed_cost_cents) - finite(item.predicted_cost_cents)) / Math.max(1, finite(item.observed_cost_cents)) * 100);
  return {
    costObservationCount: costs.length,
    wapePercent: actual > 0 ? rounded(absoluteError / actual * 100, 2) : null,
    signedBiasPercent: actual > 0 ? rounded((predicted - actual) / actual * 100, 2) : null,
    medianAbsolutePercentageError: percentages.length ? rounded(median(percentages), 2) : null,
    predictedCostCents: Math.round(predicted),
    observedCostCents: Math.round(actual)
  };
}

export function predictionInterval(expectedCostCents: number, parameters: HierarchicalLearningParameters | null | undefined, categoryCosts: Partial<Record<LearningKind, number>>) {
  const weightedVariance = Object.entries(categoryCosts).reduce((sum, [kind, amount]) => {
    if (!amount || amount <= 0) return sum;
    const node = resolveLearningNode(parameters, "category_cost_factor", kind as LearningKind);
    const sigma = node?.logStandardDeviation ?? 0.18;
    return sum + (amount / Math.max(1, expectedCostCents)) * sigma ** 2;
  }, 0);
  const sigma = Math.sqrt(Math.max(0.04 ** 2, weightedVariance || 0.18 ** 2));
  return {
    expectedCostCents: Math.max(0, Math.round(expectedCostCents)),
    p50CostCents: Math.max(0, Math.round(expectedCostCents)),
    p80CostCents: Math.max(0, Math.round(expectedCostCents * Math.exp(0.841621 * sigma))),
    logStandardDeviation: rounded(sigma),
    method: "lognormal_residual_p50_p80"
  };
}

export function explainLearning(parameters: HierarchicalLearningParameters | null | undefined, limit = 8) {
  if (!parameters) return [];
  return [...Object.values(parameters.resource ?? {}), ...Object.values(parameters.task ?? {}), ...Object.values(parameters.category ?? {})]
    .filter((node) => Math.abs(node.factor - 1) >= 0.002)
    .sort((left, right) => Math.abs(right.factor - 1) - Math.abs(left.factor - 1))
    .slice(0, limit)
    .map((node) => ({ key: node.key, level: node.level, kind: node.kind, metric: node.metric, taskKey: node.taskKey, resourceKey: node.resourceKey, factor: node.factor, confidence: node.confidence, sampleCount: node.sampleCount, explanation: node.explanation }));
}
