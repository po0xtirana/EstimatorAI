import { buildHierarchicalLearningModel, calculateLearningMetrics, predictionInterval, resolveLearningFactor } from "./hierarchical-model";

const now = new Date("2026-08-08T12:00:00Z");
const base = {
  normalized_kind: "labor" as const,
  hierarchy_level: "task" as const,
  task_key: "paint-walls",
  resource_key: null,
  metric: "labor_hours_factor" as const,
  confidence: 95,
  quality_score: 95,
  source_type: "completed_job_actual",
  created_at: "2026-08-08T10:00:00Z"
};

const first = buildHierarchicalLearningModel([{ ...base, observed_factor: 1.4, trust_weight: 1 }], now);
const firstFactor = resolveLearningFactor(first, "labor_hours_factor", "labor", "paint-walls");
if (firstFactor <= 1 || firstFactor >= 1.1) throw new Error(`first observation was not conservatively shrunk: ${firstFactor}`);

const mixed = buildHierarchicalLearningModel([
  { ...base, observed_factor: 0.8, trust_weight: 0.2, source_type: "estimator_workbook" },
  { ...base, observed_factor: 1.2, trust_weight: 1, source_type: "completed_job_actual" }
], now);
const mixedFactor = resolveLearningFactor(mixed, "labor_hours_factor", "labor", "paint-walls");
if (mixedFactor <= 1) throw new Error("completed-job truth did not outweigh provisional workbook evidence");

const robust = buildHierarchicalLearningModel([
  { ...base, observed_factor: 1.08, trust_weight: 1 },
  { ...base, observed_factor: 1.1, trust_weight: 1 },
  { ...base, observed_factor: 1.09, trust_weight: 1 },
  { ...base, observed_factor: 2, trust_weight: 1 }
], now);
const robustFactor = resolveLearningFactor(robust, "labor_hours_factor", "labor", "paint-walls");
if (robustFactor >= 1.15) throw new Error(`outlier dominated the hierarchical model: ${robustFactor}`);

const categoryFactor = resolveLearningFactor(robust, "labor_hours_factor", "labor", "unknown-task");
if (categoryFactor <= 1) throw new Error("task fallback did not resolve to the category parent");

const interval = predictionInterval(100_000, robust, { labor: 100_000 });
if (interval.p50CostCents !== 100_000 || interval.p80CostCents <= interval.p50CostCents) throw new Error("P50/P80 prediction interval failed");

const metrics = calculateLearningMetrics([
  { ...base, observed_factor: 1.2, trust_weight: 1, predicted_cost_cents: 100_000, observed_cost_cents: 120_000 },
  { ...base, observed_factor: 0.9, trust_weight: 1, predicted_cost_cents: 90_000, observed_cost_cents: 100_000 }
]);
if (metrics.wapePercent !== 13.64 || metrics.signedBiasPercent !== -13.64) throw new Error(`accuracy metrics failed: ${JSON.stringify(metrics)}`);

export default Promise.resolve();
