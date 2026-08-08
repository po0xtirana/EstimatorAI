import type { NormalizedTender } from "../ingestion/canadabuys";

export type CapabilityProfile = {
  tradeSlugs: string[];
  certifications: string[];
  serviceRegions: string[];
  bondingCapacityCents: number | null;
  availableCrewSize: number | null;
  pipelineLoadPercent: number | null;
  minimumProjectSizeCents?: number | null;
  maximumProjectSizeCents?: number | null;
  preferredBuyers?: string[];
  preferredProjectTypes?: string[];
  excludedTerms?: string[];
  learnedPositiveTerms?: Record<string, number>;
  learnedNegativeTerms?: Record<string, number>;
};

export type MatchResult = {
  score: number;
  detectedTrades: string[];
  matchedTrades: string[];
  explanation: string;
  components: {
    trade: number;
    certification: number;
    region: number;
    bonding: number;
    capacity: number;
    projectFit: number;
    learnedPreference: number;
  };
  reasons: string[];
  detectedProjectType: string;
  requiredCertifications: string[];
  missingCertifications: string[];
  blocked: boolean;
};

const TRADE_TERMS: Record<string, string[]> = {
  "general-renovation": ["renovation", "refurbishment", "building improvement"],
  restoration: ["restoration", "rebuild", "recovery", "contents pack-out"],
  "fire-water-restoration": ["fire damage", "water damage", "remediation", "emergency drying"],
  painting: ["painting", "paint", "coating"],
  "window-replacement": ["window", "glazing", "fenestration"],
  drywall: ["drywall", "gypsum", "partition", "wallboard"],
  flooring: ["flooring", "floor", "carpet", "tile"],
  insulation: ["insulation", "thermal", "vapour barrier"],
  "doors-and-hardware": ["door", "hardware"],
  roofing: ["roof", "roofing"],
  siding: ["siding", "cladding", "exterior envelope"],
  "demolition-abatement": ["demolition", "abatement", "asbestos"],
  "finish-carpentry": ["millwork", "trim", "finish carpentry"]
};

function sourceText(tender: NormalizedTender): string {
  return [tender.title.en, tender.title.fr, tender.description.en, tender.description.fr, tender.buyerName, ...Object.values(tender.rawPayload)].filter(Boolean).join(" ").toLowerCase();
}

function clamp(value: number): number { return Math.max(0, Math.min(100, value)); }

const PROJECT_TYPES: Record<string, string[]> = {
  "interior-fit-out": ["fit-out", "fit out", "tenant improvement", "interior renovation", "office renovation"],
  "occupied-renovation": ["occupied", "phased renovation", "after hours"],
  restoration: ["restoration", "fire damage", "water damage", "remediation"],
  roofing: ["roof", "roofing"],
  painting: ["painting", "coating"]
};
const CERTIFICATION_TERMS = ["whmis", "iicrc", "wrt", "working at heights", "fall arrest", "wsib", "red seal"];

function learnedPreference(text: string, profile: CapabilityProfile): number {
  const positive = Object.entries(profile.learnedPositiveTerms ?? {}).reduce((sum, [term, weight]) => text.includes(term.toLowerCase()) ? sum + Number(weight) : sum, 0);
  const negative = Object.entries(profile.learnedNegativeTerms ?? {}).reduce((sum, [term, weight]) => text.includes(term.toLowerCase()) ? sum + Number(weight) : sum, 0);
  return Math.max(-10, Math.min(10, Math.round(positive - negative)));
}

export function matchTender(tender: NormalizedTender, profile: CapabilityProfile): MatchResult {
  const text = sourceText(tender);
  const detectedTrades = Object.entries(TRADE_TERMS).filter(([, terms]) => terms.some((term) => text.includes(term.toLowerCase()))).map(([slug]) => slug);
  const matchedTrades = profile.tradeSlugs.filter((slug) => (TRADE_TERMS[slug] ?? [slug.replaceAll("-", " ")]).some((term) => text.includes(term.toLowerCase())));
  const detectedProjectType = Object.entries(PROJECT_TYPES).find(([, terms]) => terms.some((term) => text.includes(term)))?.[0] ?? "general-construction";
  const excluded = (profile.excludedTerms ?? []).find((term) => term.trim() && text.includes(term.trim().toLowerCase()));
  const trade = matchedTrades.length ? 40 : tender.procurementCategory === "construction" ? 8 : 0;
  const requiredCertifications = CERTIFICATION_TERMS.filter((term) => text.includes(term));
  const configuredCertificationText = profile.certifications.join(" ").toLowerCase();
  const missingCertifications = requiredCertifications.filter((term) => !configuredCertificationText.includes(term));
  const certification = requiredCertifications.length ? missingCertifications.length ? 0 : 10 : profile.certifications.length ? 10 : 0;
  const region = profile.serviceRegions.length && profile.serviceRegions.some((regionName) => text.includes(regionName.toLowerCase())) ? 15 : profile.serviceRegions.length ? 0 : 5;
  const value = tender.estimatedValueCents;
  const bonding = value === null || profile.bondingCapacityCents === null ? 5 : value <= profile.bondingCapacityCents ? 15 : 0;
  const capacity = profile.pipelineLoadPercent === null || profile.availableCrewSize === null ? 5 : profile.pipelineLoadPercent < 80 && profile.availableCrewSize > 0 ? 10 : 0;
  const belowMinimum = value !== null && profile.minimumProjectSizeCents != null && value < profile.minimumProjectSizeCents;
  const aboveMaximum = value !== null && profile.maximumProjectSizeCents != null && value > profile.maximumProjectSizeCents;
  const preferredBuyer = (profile.preferredBuyers ?? []).some((buyer) => text.includes(buyer.toLowerCase()));
  const preferredProject = (profile.preferredProjectTypes ?? []).includes(detectedProjectType);
  const projectFit = belowMinimum || aboveMaximum ? -10 : preferredBuyer || preferredProject ? 10 : 0;
  const learned = learnedPreference(text, profile);
  const blocked = Boolean(excluded);
  const score = blocked ? 0 : clamp(trade + certification + region + bonding + capacity + projectFit + learned);
  const reasons: string[] = [];
  reasons.push(matchedTrades.length ? `Trade terms match: ${matchedTrades.join(", ")}.` : "No configured trade term was found in the tender text.");
  reasons.push(requiredCertifications.length ? missingCertifications.length ? `Required certification gap: ${missingCertifications.join(", ")}.` : `Required certifications appear covered: ${requiredCertifications.join(", ")}.` : certification ? "Company certifications are configured; verify tender-specific requirements during review." : "No certification has been configured yet.");
  reasons.push(region ? "Service-region coverage is compatible or not yet constrained." : "No configured service region was found.");
  reasons.push(bonding === 15 ? "Tender value is within the configured bonding capacity." : bonding === 0 ? "Tender value exceeds the configured bonding capacity." : "Bonding capacity is not configured or tender value is unavailable.");
  reasons.push(capacity === 10 ? "Configured crew capacity has room." : capacity === 0 ? "Current pipeline load or crew capacity is constrained." : "Crew capacity is not fully configured.");
  if (belowMinimum) reasons.push("Tender value is below the company’s preferred project size.");
  if (aboveMaximum) reasons.push("Tender value is above the company’s preferred project size.");
  if (preferredBuyer) reasons.push("The buyer is on the company’s preferred-buyer list.");
  if (preferredProject) reasons.push(`The ${detectedProjectType} project type is preferred.`);
  if (learned > 0) reasons.push("Past relevance feedback increases this opportunity’s ranking.");
  if (learned < 0) reasons.push("Past relevance feedback reduces this opportunity’s ranking.");
  if (excluded) reasons.push(`Excluded work detected: ${excluded}.`);
  return { score, detectedTrades, matchedTrades, components: { trade, certification, region, bonding, capacity, projectFit, learnedPreference: learned }, reasons, detectedProjectType, requiredCertifications, missingCertifications, blocked, explanation: `${score}/100 match. ${reasons.join(" ")}` };
}
