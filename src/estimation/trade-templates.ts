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
const subcontractor = (resourceKey: string, name: string, unit: string, rateCents: number): AccuracyResource => ({ resourceKind: "subcontractor", resourceKey, name, unit, rateCents, rateBasis: "unit" });
const overhead = (resourceKey: string, name: string, rateCents: number): AccuracyResource => ({ resourceKind: "overhead", resourceKey, name, unit: "lump sum", rateCents, rateBasis: "lump_sum" });

const templates: Record<string, TradeTemplate> = {
  "general-renovation": {
    tradeSlug: "general-renovation",
    name: "Renovation and fit-out",
    resources: [
      labor("supervisor", "Site supervisor", 5200), labor("carpenter", "Carpenter / skilled installer", 4400), labor("drywall-installer", "Drywall installer", 4200), labor("painter", "Painter", 4000), labor("laborer", "General laborer", 2800),
      material("protection-material", "Floor and dust protection", "m2", 390), material("disposal-bin", "Construction disposal bin", "ea", 85000), material("drywall-board", "5/8 drywall board", "sheet", 1850), material("ceiling-tile", "Acoustic ceiling tile", "m2", 2450), material("interior-paint", "Interior paint", "litre", 1800), material("flooring-finish", "Commercial flooring finish", "m2", 5200), material("door-hardware-set", "Door and hardware set", "ea", 145000), material("millwork-allowance", "Architectural millwork allowance", "m", 65000),
      equipment("lift", "Material lift", "day", 9500), equipment("negative-air", "Negative-air and dust control", "day", 6500),
      subcontractor("mechanical-coordination", "Mechanical trade allowance", "lump sum", 250000), subcontractor("electrical-coordination", "Electrical trade allowance", "lump sum", 250000),
      overhead("permits-inspections", "Permits and inspection allowance", 150000), overhead("safety-closeout", "Safety, commissioning, and closeout", 200000)
    ],
    crews: [
      { crewKey: "renovation-crew", name: "General renovation crew", productionFactor: 1, maxCrewsAvailable: 1, roles: [{ roleResourceKey: "supervisor", headcount: 1, skillSlugs: ["site-supervision"] }, { roleResourceKey: "carpenter", headcount: 2, skillSlugs: ["finish-carpentry"] }, { roleResourceKey: "laborer", headcount: 1 }] },
      { crewKey: "demolition-crew", name: "Demolition and protection crew", productionFactor: 1.08, maxCrewsAvailable: 1, roles: [{ roleResourceKey: "supervisor", headcount: 1 }, { roleResourceKey: "laborer", headcount: 3, skillSlugs: ["demolition"] }] },
      { crewKey: "finishes-crew", name: "Drywall and finishes crew", productionFactor: 1.05, maxCrewsAvailable: 2, roles: [{ roleResourceKey: "drywall-installer", headcount: 2, skillSlugs: ["drywall"] }, { roleResourceKey: "painter", headcount: 1, skillSlugs: ["painting"] }, { roleResourceKey: "laborer", headcount: 1 }] }
    ],
    assemblies: [
      { taskKey: "site-protection", name: "Site protection and occupied-building controls", unit: "m2", laborHoursPerUnit: 0.06, preferredCrewKey: "demolition-crew", materialComponents: [{ resourceKey: "protection-material", quantityPerUnit: 1.08 }], equipmentComponents: [{ resourceKey: "negative-air", quantityPerUnit: 0.01 }] },
      { taskKey: "selective-demolition", name: "Selective demolition and disposal", unit: "m2", laborHoursPerUnit: 0.22, preferredCrewKey: "demolition-crew", materialComponents: [{ resourceKey: "disposal-bin", quantityPerUnit: 0.015 }] },
      { taskKey: "drywall-install", name: "Drywall partitions and repairs", unit: "m2", laborHoursPerUnit: 0.18, preferredCrewKey: "finishes-crew", materialComponents: [{ resourceKey: "drywall-board", quantityPerUnit: 0.08 }], equipmentComponents: [{ resourceKey: "lift", quantityPerUnit: 0.01 }] },
      { taskKey: "acoustic-ceiling", name: "Acoustic ceiling system", unit: "m2", laborHoursPerUnit: 0.16, preferredCrewKey: "finishes-crew", materialComponents: [{ resourceKey: "ceiling-tile", quantityPerUnit: 1.05 }] },
      { taskKey: "paint-walls", name: "Painting and coatings", unit: "m2", laborHoursPerUnit: 0.1, preferredCrewKey: "finishes-crew", materialComponents: [{ resourceKey: "interior-paint", quantityPerUnit: 0.12 }] },
      { taskKey: "commercial-flooring", name: "Commercial flooring installation", unit: "m2", laborHoursPerUnit: 0.2, preferredCrewKey: "renovation-crew", materialComponents: [{ resourceKey: "flooring-finish", quantityPerUnit: 1.07 }] },
      { taskKey: "doors-hardware", name: "Doors, frames, and hardware", unit: "ea", laborHoursPerUnit: 3.5, preferredCrewKey: "renovation-crew", materialComponents: [{ resourceKey: "door-hardware-set", quantityPerUnit: 1 }] },
      { taskKey: "millwork", name: "Millwork and finish carpentry", unit: "m", laborHoursPerUnit: 0.75, preferredCrewKey: "renovation-crew", materialComponents: [{ resourceKey: "millwork-allowance", quantityPerUnit: 1 }] },
      { taskKey: "minor-mechanical", name: "Minor mechanical coordination", unit: "allowance", laborHoursPerUnit: 0.5, preferredCrewKey: "renovation-crew", equipmentComponents: [{ resourceKey: "mechanical-coordination", quantityPerUnit: 1 }] },
      { taskKey: "minor-electrical", name: "Minor electrical coordination", unit: "allowance", laborHoursPerUnit: 0.5, preferredCrewKey: "renovation-crew", equipmentComponents: [{ resourceKey: "electrical-coordination", quantityPerUnit: 1 }] },
      { taskKey: "mobilization-supervision", name: "Mobilization and site supervision", unit: "week", laborHoursPerUnit: 40, preferredCrewKey: "renovation-crew" },
      { taskKey: "closeout", name: "Inspection, deficiencies, and closeout", unit: "project", laborHoursPerUnit: 24, preferredCrewKey: "renovation-crew" }
    ]
  },
  "fire-water-restoration": {
    tradeSlug: "fire-water-restoration",
    name: "Fire and water damage",
    resources: [labor("restoration-supervisor", "Restoration supervisor", 5600), labor("restoration-technician", "Restoration technician", 3900), labor("laborer", "General laborer", 2800), material("containment-poly", "Containment poly", "m2", 250), equipment("air-mover", "Air mover", "day", 3500), equipment("dehumidifier", "Dehumidifier", "day", 6000)],
    crews: [{ crewKey: "restoration-crew", name: "Restoration response crew", productionFactor: 1, maxCrewsAvailable: 1, roles: [{ roleResourceKey: "restoration-supervisor", headcount: 1 }, { roleResourceKey: "restoration-technician", headcount: 2 }] }],
    assemblies: [{ taskKey: "water-extraction", name: "Water extraction and setup", unit: "m2", laborHoursPerUnit: 0.12, preferredCrewKey: "restoration-crew", equipmentComponents: [{ resourceKey: "air-mover", quantityPerUnit: 0.06 }, { resourceKey: "dehumidifier", quantityPerUnit: 0.02 }] }, { taskKey: "containment", name: "Containment and protection", unit: "m2", laborHoursPerUnit: 0.08, preferredCrewKey: "restoration-crew", materialComponents: [{ resourceKey: "containment-poly", quantityPerUnit: 1.1 }] }]
  },
  restoration: {
    tradeSlug: "restoration",
    name: "Restoration",
    resources: [labor("restoration-supervisor", "Restoration supervisor", 5600), labor("restoration-technician", "Restoration technician", 3900), labor("laborer", "General laborer", 2800), material("protection-material", "Protection and packing material", "m2", 325), equipment("air-scrubber", "Air scrubber", "day", 5500)],
    crews: [{ crewKey: "restoration-crew", name: "Restoration crew", productionFactor: 1, maxCrewsAvailable: 1, roles: [{ roleResourceKey: "restoration-supervisor", headcount: 1 }, { roleResourceKey: "restoration-technician", headcount: 2 }] }],
    assemblies: [{ taskKey: "restoration-cleaning", name: "Restoration cleaning and protection", unit: "m2", laborHoursPerUnit: 0.16, preferredCrewKey: "restoration-crew", materialComponents: [{ resourceKey: "protection-material", quantityPerUnit: 0.4 }], equipmentComponents: [{ resourceKey: "air-scrubber", quantityPerUnit: 0.01 }] }, { taskKey: "contents-packout", name: "Contents pack-out and handling", unit: "ea", laborHoursPerUnit: 0.45, preferredCrewKey: "restoration-crew" }]
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
