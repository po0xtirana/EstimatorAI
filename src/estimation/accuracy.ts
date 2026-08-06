export type AccuracyResource = {
  resourceKind: "labor" | "equipment" | "vehicle" | "material" | "subcontractor" | "overhead";
  resourceKey: string;
  name: string;
  unit: string;
  rateCents: number;
  rateBasis: "hour" | "day" | "unit" | "lump_sum";
  availableQuantity?: number | null;
  wastePercent?: number;
};

export type AccuracyCrew = {
  crewKey: string;
  name: string;
  productionFactor: number;
  maxCrewsAvailable?: number | null;
  roles: Array<{ roleResourceKey: string; headcount: number; skillSlugs?: string[] }>;
};

export type AccuracyAssembly = {
  taskKey: string;
  name: string;
  unit: string;
  laborHoursPerUnit: number;
  defaultWastePercent?: number;
  preferredCrewKey?: string | null;
  materialComponents?: Array<{ resourceKey: string; quantityPerUnit: number; wastePercent?: number }>;
  equipmentComponents?: Array<{ resourceKey: string; quantityPerUnit: number; rateBasis?: AccuracyResource["rateBasis"] }>;
};

export type AccuracyTradeProfile = {
  tradeSlug: string;
  targetMarkupPercent: number;
  targetMarginPercent?: number | null;
  contingencyPercent: number;
  mobilizationCents: number;
  travelCostPerKmCents: number;
  serviceRadiusKm?: number | null;
  shiftHours: number;
  workingDaysPerWeek: number;
  currentPipelineLoadPercent?: number | null;
  resources: AccuracyResource[];
  crews: AccuracyCrew[];
  assemblies: AccuracyAssembly[];
};

export type AccuracyScopeItem = {
  id: string;
  taskKey?: string | null;
  description: string;
  quantity?: number | null;
  unit?: string | null;
  confidence?: number | null;
  sourceDocumentId?: string | null;
  sourcePage?: number | null;
  evidenceText?: string | null;
};

export type AccuracyEstimateLine = {
  id: string;
  scopeItemId?: string;
  kind: "labor" | "material" | "equipment" | "vehicle" | "subcontractor" | "overhead" | "mobilization" | "risk" | "markup";
  taskKey?: string;
  resourceKey?: string;
  label: string;
  quantity: number;
  unit: string;
  unitCostCents: number;
  amountCents: number;
  formula: string;
  confidence: number;
  sourceType: "tender_document" | "company_assumption" | "reviewed_override" | "system_default";
  sourceDocumentId?: string;
  sourcePage?: number;
  evidenceText?: string;
};

export type AccuracyException = {
  scopeItemId?: string;
  exceptionType: "missing_quantity" | "unsupported_task" | "unclear_scope" | "conflicting_document" | "capacity_gap" | "missing_rate" | "schedule_risk" | "compliance_risk" | "manual_review";
  severity: "info" | "warning" | "blocking";
  title: string;
  message: string;
};

export type AccuracyResourceDemand = {
  resourceKind: string;
  resourceKey: string;
  unit: string;
  requiredQuantity: number;
  availableQuantity: number | null;
  gapQuantity: number | null;
  notes?: string;
};

export type AccuracyEstimateResult = {
  lines: AccuracyEstimateLine[];
  exceptions: AccuracyException[];
  resourceDemand: AccuracyResourceDemand[];
  laborSubtotalCents: number;
  materialSubtotalCents: number;
  equipmentSubtotalCents: number;
  subcontractorSubtotalCents: number;
  overheadSubtotalCents: number;
  riskReserveCents: number;
  markupCents: number;
  recommendedPriceCents: number;
  laborHours: number;
  scheduleDays: number | null;
  confidenceScore: number;
  bidScore: number;
};

function nonNegative(value: number | null | undefined): number {
  return Number.isFinite(value) && (value as number) >= 0 ? (value as number) : 0;
}

function money(value: number): number {
  return Math.max(0, Math.round(value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function findResource(resources: AccuracyResource[], kind: AccuracyResource["resourceKind"], key: string): AccuracyResource | undefined {
  return resources.find((resource) => resource.resourceKind === kind && resource.resourceKey === key);
}

function crewCost(profile: AccuracyTradeProfile, crew: AccuracyCrew): number {
  const roles = crew.roles.map((role) => ({ role, resource: findResource(profile.resources, "labor", role.roleResourceKey) })).filter((item): item is { role: { roleResourceKey: string; headcount: number; skillSlugs?: string[] }; resource: AccuracyResource } => Boolean(item.resource));
  return roles.reduce((sum, item) => sum + item.resource.rateCents * item.role.headcount, 0) / Math.max(0.1, crew.productionFactor);
}

function feasibleCrews(profile: AccuracyTradeProfile): AccuracyCrew[] {
  return profile.crews.filter((crew) => {
    if (crew.maxCrewsAvailable !== null && crew.maxCrewsAvailable !== undefined && crew.maxCrewsAvailable <= 0) return false;
    return crew.roles.length > 0 && crew.roles.every((role) => {
      const resource = findResource(profile.resources, "labor", role.roleResourceKey);
      return Boolean(resource) && (resource?.availableQuantity === null || resource?.availableQuantity === undefined || resource.availableQuantity >= role.headcount);
    });
  }).sort((a, b) => crewCost(profile, a) - crewCost(profile, b));
}

function pushDemand(demand: Map<string, AccuracyResourceDemand>, resource: AccuracyResource, quantity: number, notes?: string) {
  const key = `${resource.resourceKind}:${resource.resourceKey}`;
  const existing = demand.get(key);
  const required = (existing?.requiredQuantity ?? 0) + quantity;
  // Labor availability is a headcount constraint, while demand is measured in
  // hours. Crew feasibility handles the headcount check separately.
  const available = resource.resourceKind === "labor" ? null : resource.availableQuantity ?? null;
  demand.set(key, {
    resourceKind: resource.resourceKind,
    resourceKey: resource.resourceKey,
    unit: resource.unit,
    requiredQuantity: round(required),
    availableQuantity: available,
    gapQuantity: available === null ? null : round(Math.max(0, required - available)),
    notes
  });
}

export function generateAccuracyEstimate(profile: AccuracyTradeProfile, scopeItems: AccuracyScopeItem[]): AccuracyEstimateResult {
  const lines: AccuracyEstimateLine[] = [];
  const exceptions: AccuracyException[] = [];
  const demand = new Map<string, AccuracyResourceDemand>();
  let laborSubtotalCents = 0;
  let materialSubtotalCents = 0;
  let equipmentSubtotalCents = 0;
  let subcontractorSubtotalCents = 0;
  let laborHours = 0;
  let confidenceTotal = 0;
  let confidenceCount = 0;
  const feasible = feasibleCrews(profile);

  for (const scope of scopeItems) {
    const confidence = scope.confidence ?? 55;
    confidenceTotal += confidence;
    confidenceCount += 1;
    if (!scope.quantity || scope.quantity <= 0) {
      exceptions.push({ scopeItemId: scope.id, exceptionType: "missing_quantity", severity: "blocking", title: "Quantity required", message: `${scope.description} does not have a usable quantity.` });
      continue;
    }
    const assembly = profile.assemblies.find((candidate) => candidate.taskKey === scope.taskKey);
    if (!assembly) {
      exceptions.push({ scopeItemId: scope.id, exceptionType: "unsupported_task", severity: "blocking", title: "No production template", message: `No ${profile.tradeSlug} assembly is mapped to ${scope.taskKey ?? scope.description}.` });
      continue;
    }

    const crew = feasible.find((candidate) => candidate.crewKey === assembly.preferredCrewKey) ?? feasible[0] ?? profile.crews.find((candidate) => candidate.crewKey === assembly.preferredCrewKey) ?? profile.crews[0];
    const roleCosts = (crew?.roles ?? []).map((role) => ({ role, resource: findResource(profile.resources, "labor", role.roleResourceKey) })).filter((item): item is { role: { roleResourceKey: string; headcount: number; skillSlugs?: string[] }; resource: AccuracyResource } => Boolean(item.resource));
    const totalHeadcount = roleCosts.reduce((sum, item) => sum + item.role.headcount, 0);
    const weightedHourlyCost = totalHeadcount ? roleCosts.reduce((sum, item) => sum + item.resource.rateCents * item.role.headcount, 0) / totalHeadcount : 0;
    const itemHours = scope.quantity * assembly.laborHoursPerUnit / Math.max(0.1, crew?.productionFactor ?? 1);
    laborHours += itemHours;
    if (!feasible.some((candidate) => candidate.crewKey === crew?.crewKey)) {
      exceptions.push({ scopeItemId: scope.id, exceptionType: "capacity_gap", severity: "blocking", title: "No feasible crew available", message: `The ${assembly.name} template requires roles or headcount that are not currently available.` });
    }
    if (!roleCosts.length) {
      exceptions.push({ scopeItemId: scope.id, exceptionType: "missing_rate", severity: "blocking", title: "Labor rate required", message: `The ${assembly.name} crew has no configured labor rates.` });
    } else {
      const laborAmount = money(itemHours * weightedHourlyCost);
      laborSubtotalCents += laborAmount;
      lines.push({ id: `${scope.id}-labor`, scopeItemId: scope.id, kind: "labor", taskKey: assembly.taskKey, label: `${assembly.name} labor`, quantity: round(itemHours), unit: "hour", unitCostCents: money(weightedHourlyCost), amountCents: laborAmount, formula: `${scope.quantity} ${scope.unit ?? assembly.unit} × ${assembly.laborHoursPerUnit} h/${assembly.unit} × $${(weightedHourlyCost / 100).toFixed(2)}/h`, confidence, sourceType: "company_assumption", sourceDocumentId: scope.sourceDocumentId ?? undefined, sourcePage: scope.sourcePage ?? undefined, evidenceText: scope.evidenceText ?? undefined });
      for (const item of roleCosts) pushDemand(demand, item.resource, itemHours * item.role.headcount / totalHeadcount, `${assembly.name} labor hours`);
    }

    for (const component of assembly.materialComponents ?? []) {
      const resource = findResource(profile.resources, "material", component.resourceKey);
      if (!resource) {
        exceptions.push({ scopeItemId: scope.id, exceptionType: "missing_rate", severity: "blocking", title: "Material rate required", message: `No material rate is configured for ${component.resourceKey}.` });
        continue;
      }
      const waste = 1 + (component.wastePercent ?? resource.wastePercent ?? assembly.defaultWastePercent ?? 0) / 100;
      const quantity = scope.quantity * component.quantityPerUnit * waste;
      const amount = money(quantity * resource.rateCents);
      materialSubtotalCents += amount;
      lines.push({ id: `${scope.id}-material-${component.resourceKey}`, scopeItemId: scope.id, kind: "material", taskKey: assembly.taskKey, resourceKey: resource.resourceKey, label: resource.name, quantity: round(quantity), unit: resource.unit, unitCostCents: resource.rateCents, amountCents: amount, formula: `${scope.quantity} ${scope.unit ?? assembly.unit} × ${component.quantityPerUnit} ${resource.unit}/${assembly.unit} × ${waste.toFixed(2)} waste factor`, confidence, sourceType: "company_assumption", sourceDocumentId: scope.sourceDocumentId ?? undefined, sourcePage: scope.sourcePage ?? undefined, evidenceText: scope.evidenceText ?? undefined });
      pushDemand(demand, resource, quantity, `${assembly.name} material consumption`);
    }

    for (const component of assembly.equipmentComponents ?? []) {
      const resource = findResource(profile.resources, "equipment", component.resourceKey) ?? findResource(profile.resources, "vehicle", component.resourceKey);
      if (!resource) {
        exceptions.push({ scopeItemId: scope.id, exceptionType: "missing_rate", severity: "warning", title: "Equipment rate required", message: `No equipment or vehicle rate is configured for ${component.resourceKey}.` });
        continue;
      }
      const quantity = scope.quantity * component.quantityPerUnit;
      const amount = money(quantity * resource.rateCents);
      equipmentSubtotalCents += amount;
      lines.push({ id: `${scope.id}-equipment-${component.resourceKey}`, scopeItemId: scope.id, kind: resource.resourceKind, taskKey: assembly.taskKey, resourceKey: resource.resourceKey, label: resource.name, quantity: round(quantity), unit: resource.unit, unitCostCents: resource.rateCents, amountCents: amount, formula: `${scope.quantity} ${scope.unit ?? assembly.unit} × ${component.quantityPerUnit} ${resource.unit}/${assembly.unit}`, confidence: Math.max(40, confidence - 5), sourceType: "company_assumption", sourceDocumentId: scope.sourceDocumentId ?? undefined, sourcePage: scope.sourcePage ?? undefined, evidenceText: scope.evidenceText ?? undefined });
      pushDemand(demand, resource, quantity, `${assembly.name} equipment demand`);
    }
  }

  for (const item of Array.from(demand.values())) {
    if (item.gapQuantity !== null && item.gapQuantity > 0) {
      exceptions.push({ exceptionType: "capacity_gap", severity: "warning", title: `${item.resourceKey} availability gap`, message: `The estimate requires ${item.requiredQuantity} ${item.unit}, but only ${item.availableQuantity} is configured as available.` });
    }
  }
  const overheadResources = profile.resources.filter((resource) => resource.resourceKind === "overhead");
  const overheadSubtotalCents = overheadResources.reduce((sum, resource) => {
    const amount = resource.rateBasis === "lump_sum" || resource.rateBasis === "unit" ? resource.rateCents : money(laborHours * resource.rateCents);
    lines.push({ id: `overhead-${resource.resourceKey}`, kind: "overhead", resourceKey: resource.resourceKey, label: resource.name, quantity: 1, unit: resource.unit, unitCostCents: resource.rateCents, amountCents: amount, formula: resource.rateBasis === "lump_sum" ? "Company overhead allocation" : `${laborHours.toFixed(2)} h × $${(resource.rateCents / 100).toFixed(2)}/h`, confidence: 85, sourceType: "company_assumption" });
    return sum + amount;
  }, 0);
  const mobilization = nonNegative(profile.mobilizationCents);
  if (mobilization > 0) lines.push({ id: "mobilization", kind: "mobilization", label: "Mobilization and setup", quantity: 1, unit: "lump sum", unitCostCents: mobilization, amountCents: mobilization, formula: "Trade profile mobilization allowance", confidence: 80, sourceType: "company_assumption" });
  const subtotalBeforeRisk = laborSubtotalCents + materialSubtotalCents + equipmentSubtotalCents + subcontractorSubtotalCents + overheadSubtotalCents + mobilization;
  const riskReserveCents = money(subtotalBeforeRisk * nonNegative(profile.contingencyPercent) / 100);
  if (riskReserveCents > 0) lines.push({ id: "risk-reserve", kind: "risk", label: "Contingency and risk reserve", quantity: nonNegative(profile.contingencyPercent), unit: "%", unitCostCents: subtotalBeforeRisk, amountCents: riskReserveCents, formula: `$${(subtotalBeforeRisk / 100).toFixed(2)} × ${nonNegative(profile.contingencyPercent).toFixed(2)}%`, confidence: 70, sourceType: "company_assumption" });
  const costBeforeMarkup = subtotalBeforeRisk + riskReserveCents;
  const markupCents = money(costBeforeMarkup * nonNegative(profile.targetMarkupPercent) / 100);
  lines.push({ id: "markup", kind: "markup", label: "Target markup", quantity: nonNegative(profile.targetMarkupPercent), unit: "%", unitCostCents: costBeforeMarkup, amountCents: markupCents, formula: `$${(costBeforeMarkup / 100).toFixed(2)} × ${nonNegative(profile.targetMarkupPercent).toFixed(2)}%`, confidence: 90, sourceType: "company_assumption" });

  const dailyCapacity = feasible.length ? Math.max(...feasible.map((crew) => crew.roles.reduce((sum, role) => sum + role.headcount, 0) * profile.shiftHours * crew.productionFactor)) : 0;
  const scheduleDays = dailyCapacity > 0 ? round(laborHours / dailyCapacity) : null;
  if (scheduleDays === null && laborHours > 0) exceptions.push({ exceptionType: "schedule_risk", severity: "blocking", title: "Crew capacity required", message: "Add a crew template with roles and headcount to calculate schedule duration." });
  const capacityGap = profile.currentPipelineLoadPercent !== null && profile.currentPipelineLoadPercent !== undefined && profile.currentPipelineLoadPercent >= 80;
  if (capacityGap) exceptions.push({ exceptionType: "capacity_gap", severity: "warning", title: "Pipeline capacity is constrained", message: `Current pipeline load is ${profile.currentPipelineLoadPercent}%. Review the staffing plan before bidding.` });
  const blockingCount = exceptions.filter((exception) => exception.severity === "blocking").length;
  const confidenceScore = Math.max(0, Math.min(100, Math.round((confidenceCount ? confidenceTotal / confidenceCount : 0) - blockingCount * 12)));
  const bidScore = Math.max(0, Math.min(100, Math.round(confidenceScore - (capacityGap ? 15 : 0) - blockingCount * 20)));
  return { lines, exceptions, resourceDemand: Array.from(demand.values()), laborSubtotalCents, materialSubtotalCents, equipmentSubtotalCents, subcontractorSubtotalCents, overheadSubtotalCents, riskReserveCents, markupCents, recommendedPriceCents: costBeforeMarkup + markupCents, laborHours: round(laborHours), scheduleDays, confidenceScore, bidScore };
}
