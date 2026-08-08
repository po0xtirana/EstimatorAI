import { generateAccuracyEstimate, type AccuracyTradeProfile } from "./accuracy";

const profile: AccuracyTradeProfile = {
  tradeSlug: "painting",
  targetMarkupPercent: 10,
  contingencyPercent: 5,
  mobilizationCents: 1000,
  travelCostPerKmCents: 0,
  shiftHours: 8,
  workingDaysPerWeek: 5,
  resources: [
    { resourceKind: "labor", resourceKey: "painter", name: "Painter", unit: "hour", rateCents: 4000, rateBasis: "hour", availableQuantity: 3 },
    { resourceKind: "material", resourceKey: "paint", name: "Interior paint", unit: "litre", rateCents: 1800, rateBasis: "unit", wastePercent: 10 },
    { resourceKind: "overhead", resourceKey: "supervision", name: "Supervision", unit: "lump sum", rateCents: 500, rateBasis: "lump_sum" }
  ],
  crews: [{ crewKey: "paint-crew", name: "Painting crew", productionFactor: 1, roles: [{ roleResourceKey: "painter", headcount: 2 }] }],
  assemblies: [{ taskKey: "paint-walls", name: "Paint walls", unit: "m2", laborHoursPerUnit: 0.1, materialComponents: [{ resourceKey: "paint", quantityPerUnit: 0.12 }], preferredCrewKey: "paint-crew" }]
};

const result = generateAccuracyEstimate(profile, [{ id: "scope-1", taskKey: "paint-walls", description: "Paint walls", quantity: 100, unit: "m2", confidence: 90 }]);
if (result.laborHours !== 10 || result.laborSubtotalCents !== 40000) throw new Error("assembly labor calculation failed");
if (result.materialSubtotalCents !== 23760 || result.recommendedPriceCents <= result.materialSubtotalCents) throw new Error("waste and price calculation failed");
if (result.exceptions.length !== 0 || result.scheduleDays !== 0.625) throw new Error("clean estimate calculation failed");

const missing = generateAccuracyEstimate(profile, [{ id: "scope-2", taskKey: "unknown", description: "Unknown task", quantity: null, unit: "m2" }]);
if (missing.exceptions[0]?.exceptionType !== "missing_quantity") throw new Error("missing quantity exception failed");

const crewChoice = generateAccuracyEstimate({
  ...profile,
  resources: [...profile.resources, { resourceKind: "labor", resourceKey: "lower-cost-painter", name: "Lower-cost painter", unit: "hour", rateCents: 2000, rateBasis: "hour", availableQuantity: 2 }],
  crews: [
    { crewKey: "expensive-crew", name: "Preferred but expensive", productionFactor: 1, roles: [{ roleResourceKey: "painter", headcount: 2 }] },
    { crewKey: "lower-cost-crew", name: "Lower-cost crew", productionFactor: 1, roles: [{ roleResourceKey: "lower-cost-painter", headcount: 2 }] }
  ]
}, [{ id: "scope-3", taskKey: "paint-walls", description: "Paint walls", quantity: 10, unit: "m2", confidence: 90 }]);
if (crewChoice.lines.find((line) => line.kind === "labor")?.unitCostCents !== 2000) throw new Error("least-cost feasible crew selection failed");

const calibrated = generateAccuracyEstimate({ ...profile, calibrationFactors: { labor: 1.1, material: 0.9 } }, [{ id: "scope-4", taskKey: "paint-walls", description: "Paint walls", quantity: 100, unit: "m2", confidence: 90 }]);
if (calibrated.laborSubtotalCents !== 44000 || calibrated.materialSubtotalCents !== 21384) throw new Error("company learning calibration failed");
if (!calibrated.lines.find((line) => line.kind === "labor")?.formula.includes("company learning factor")) throw new Error("calibration evidence failed");
