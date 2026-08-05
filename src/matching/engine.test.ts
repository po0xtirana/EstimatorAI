import { matchTender } from "./engine";

const tender = { source: "canadabuys", sourceRecordId: "T-1", solicitationNumber: "T-1", title: { en: "Drywall and painting renovation", fr: "Rénovation de cloisons sèches et peinture" }, description: { en: "Interior work in Toronto", fr: null }, buyerName: "Public Works", procurementCategory: "construction", procurementCode: "*CNST", estimatedValueCents: 5000000, currency: "CAD", closingAt: null, sourceUrl: null, rawPayload: {} } as const;
const result = matchTender(tender, { tradeSlugs: ["drywall", "painting"], certifications: ["WHMIS"], serviceRegions: ["Toronto"], bondingCapacityCents: 10000000, availableCrewSize: 4, pipelineLoadPercent: 40 });
if (result.score !== 90) throw new Error(`unexpected match score: ${result.score}`);
if (!result.explanation.includes("drywall") || !result.explanation.includes("bonding capacity")) throw new Error("match explanation is incomplete");
