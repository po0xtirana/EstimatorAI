import type { EstimateInputs, LaborLine, MaterialLine, OverheadLine } from "./engine";

export type CostProfile = {
  markupPercent: number;
  laborRates: Record<string, number>;
  materialRates: Record<string, number>;
  overhead: OverheadLine[];
};

export type ProjectOverrides = {
  markupPercent?: number;
  laborRates?: Record<string, number>;
  materialRates?: Record<string, number>;
  overhead?: OverheadLine[];
};

export function resolveProjectProfile(base: CostProfile, overrides: ProjectOverrides = {}): CostProfile {
  return {
    markupPercent: overrides.markupPercent ?? base.markupPercent,
    laborRates: { ...base.laborRates, ...overrides.laborRates },
    materialRates: { ...base.materialRates, ...overrides.materialRates },
    overhead: overrides.overhead ? overrides.overhead.map((line) => ({ ...line })) : base.overhead.map((line) => ({ ...line }))
  };
}

export function applyProfileToEstimate(profile: CostProfile, labor: Array<Omit<LaborLine, "hourlyCostCents">>, materials: Array<Omit<MaterialLine, "unitCostCents">>): EstimateInputs {
  return {
    markupPercent: profile.markupPercent,
    overhead: profile.overhead.map((line) => ({ ...line })),
    labor: labor.map((line) => ({ ...line, hourlyCostCents: profile.laborRates[line.role] ?? 0 })),
    materials: materials.map((line) => ({ ...line, unitCostCents: profile.materialRates[line.material] ?? 0 }))
  };
}
