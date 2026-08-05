import type { AccuracyAssembly, AccuracyCrew, AccuracyResource } from "./accuracy";

export type TradeTemplate = {
  tradeSlug: string;
  name: string;
  resources: AccuracyResource[];
  crews: AccuracyCrew[];
  assemblies: AccuracyAssembly[];
};

const labor = (resourceKey: string, name: string, rateCents: number): AccuracyResource => ({ resourceKind: "labor", resourceKey, name, unit: "hour", rateCents, rateBasis: "hour", availableQuantity: 0 });
const material = (resourceKey: string, name: string, unit: string, rateCents: number): AccuracyResource => ({ resourceKind: "material", resourceKey, name, unit, rateCents, rateBasis: "unit", wastePercent: 5 });
const equipment = (resourceKey: string, name: string, unit: string, rateCents: number): AccuracyResource => ({ resourceKind: "equipment", resourceKey, name, unit, rateCents, rateBasis: "day", availableQuantity: 0 });

const templates: Record<string, TradeTemplate> = {
  "general-renovation": {
    tradeSlug: "general-renovation",
    name: "Renovation and fit-out",
    resources: [labor("supervisor", "Site supervisor", 5200), labor("installer", "Skilled installer", 4200), labor("laborer", "General laborer", 2800), material("drywall-board", "5/8 drywall board", "sheet", 1850), material("interior-paint", "Interior paint", "litre", 1800), equipment("lift", "Material lift", "day", 9500)],
    crews: [{ crewKey: "renovation-crew", name: "Renovation crew", productionFactor: 1, maxCrewsAvailable: 1, roles: [{ roleResourceKey: "supervisor", headcount: 1 }, { roleResourceKey: "installer", headcount: 2 }, { roleResourceKey: "laborer", headcount: 1 }] }],
    assemblies: [{ taskKey: "drywall-install", name: "Drywall installation", unit: "m2", laborHoursPerUnit: 0.18, preferredCrewKey: "renovation-crew", materialComponents: [{ resourceKey: "drywall-board", quantityPerUnit: 0.08 }], equipmentComponents: [{ resourceKey: "lift", quantityPerUnit: 0.01 }] }, { taskKey: "paint-walls", name: "Paint walls", unit: "m2", laborHoursPerUnit: 0.1, preferredCrewKey: "renovation-crew", materialComponents: [{ resourceKey: "interior-paint", quantityPerUnit: 0.12 }] }]
  },
  "fire-water-restoration": {
    tradeSlug: "fire-water-restoration",
    name: "Restoration and fire-water damage",
    resources: [labor("restoration-supervisor", "Restoration supervisor", 5600), labor("restoration-technician", "Restoration technician", 3900), labor("laborer", "General laborer", 2800), material("containment-poly", "Containment poly", "m2", 250), equipment("air-mover", "Air mover", "day", 3500), equipment("dehumidifier", "Dehumidifier", "day", 6000)],
    crews: [{ crewKey: "restoration-crew", name: "Restoration response crew", productionFactor: 1, maxCrewsAvailable: 1, roles: [{ roleResourceKey: "restoration-supervisor", headcount: 1 }, { roleResourceKey: "restoration-technician", headcount: 2 }] }],
    assemblies: [{ taskKey: "water-extraction", name: "Water extraction and setup", unit: "m2", laborHoursPerUnit: 0.12, preferredCrewKey: "restoration-crew", equipmentComponents: [{ resourceKey: "air-mover", quantityPerUnit: 0.06 }, { resourceKey: "dehumidifier", quantityPerUnit: 0.02 }] }, { taskKey: "containment", name: "Containment and protection", unit: "m2", laborHoursPerUnit: 0.08, preferredCrewKey: "restoration-crew", materialComponents: [{ resourceKey: "containment-poly", quantityPerUnit: 1.1 }] }]
  },
  painting: {
    tradeSlug: "painting",
    name: "Painting",
    resources: [labor("painter", "Painter", 4000), labor("painter-helper", "Painter helper", 2800), material("interior-paint", "Interior paint", "litre", 1800), material("primer", "Primer", "litre", 1600), equipment("sprayer", "Paint sprayer", "day", 7500)],
    crews: [{ crewKey: "painting-crew", name: "Painting crew", productionFactor: 1, maxCrewsAvailable: 2, roles: [{ roleResourceKey: "painter", headcount: 1 }, { roleResourceKey: "painter-helper", headcount: 1 }] }],
    assemblies: [{ taskKey: "paint-walls", name: "Paint walls", unit: "m2", laborHoursPerUnit: 0.1, preferredCrewKey: "painting-crew", materialComponents: [{ resourceKey: "interior-paint", quantityPerUnit: 0.12 }] }, { taskKey: "prime-walls", name: "Prime walls", unit: "m2", laborHoursPerUnit: 0.06, preferredCrewKey: "painting-crew", materialComponents: [{ resourceKey: "primer", quantityPerUnit: 0.1 }] }]
  },
  roofing: {
    tradeSlug: "roofing",
    name: "Roofing",
    resources: [labor("roofer", "Roofer", 4400), labor("roofing-helper", "Roofing helper", 3000), material("shingles", "Architectural shingles", "m2", 1850), material("underlayment", "Roof underlayment", "m2", 450), equipment("roof-hoist", "Roof hoist", "day", 12000)],
    crews: [{ crewKey: "roofing-crew", name: "Roofing crew", productionFactor: 1, maxCrewsAvailable: 2, roles: [{ roleResourceKey: "roofer", headcount: 2 }, { roleResourceKey: "roofing-helper", headcount: 2 }] }],
    assemblies: [{ taskKey: "shingle-roof", name: "Shingle roof installation", unit: "m2", laborHoursPerUnit: 0.12, preferredCrewKey: "roofing-crew", materialComponents: [{ resourceKey: "shingles", quantityPerUnit: 1 }, { resourceKey: "underlayment", quantityPerUnit: 1 }], equipmentComponents: [{ resourceKey: "roof-hoist", quantityPerUnit: 0.01 }] }]
  }
};

export function getTradeTemplate(tradeSlug: string): TradeTemplate | null {
  const template = templates[tradeSlug];
  return template ? JSON.parse(JSON.stringify(template)) as TradeTemplate : null;
}

export function listTradeTemplates(): TradeTemplate[] {
  return Object.values(templates).map((template) => JSON.parse(JSON.stringify(template)) as TradeTemplate);
}
