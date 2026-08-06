import type { NormalizedTender } from "../ingestion/canadabuys";

export type CapabilityProfile = {
  tradeSlugs: string[];
  certifications: string[];
  serviceRegions: string[];
  bondingCapacityCents: number | null;
  availableCrewSize: number | null;
  pipelineLoadPercent: number | null;
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
  };
  reasons: string[];
};

const TRADE_TERMS: Record<string, string[]> = {
  "general-renovation": ["renovation", "refurbishment", "building improvement"],
  "fire-water-restoration": ["fire damage", "water damage", "restoration", "remediation"],
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

export function matchTender(tender: NormalizedTender, profile: CapabilityProfile): MatchResult {
  const text = sourceText(tender);
  const detectedTrades = Object.entries(TRADE_TERMS).filter(([, terms]) => terms.some((term) => text.includes(term.toLowerCase()))).map(([slug]) => slug);
  const matchedTrades = profile.tradeSlugs.filter((slug) => (TRADE_TERMS[slug] ?? [slug.replaceAll("-", " ")]).some((term) => text.includes(term.toLowerCase())));
  const trade = matchedTrades.length ? 40 : tender.procurementCategory === "construction" ? 8 : 0;
  const certification = profile.certifications.length ? 10 : 0;
  const region = profile.serviceRegions.length && profile.serviceRegions.some((regionName) => text.includes(regionName.toLowerCase())) ? 15 : profile.serviceRegions.length ? 0 : 5;
  const value = tender.estimatedValueCents;
  const bonding = value === null || profile.bondingCapacityCents === null ? 5 : value <= profile.bondingCapacityCents ? 15 : 0;
  const capacity = profile.pipelineLoadPercent === null || profile.availableCrewSize === null ? 5 : profile.pipelineLoadPercent < 80 && profile.availableCrewSize > 0 ? 10 : 0;
  const score = clamp(trade + certification + region + bonding + capacity);
  const reasons: string[] = [];
  reasons.push(matchedTrades.length ? `Trade terms match: ${matchedTrades.join(", ")}.` : "No configured trade term was found in the tender text.");
  reasons.push(certification ? "At least one certification is configured for review." : "No certification has been configured yet.");
  reasons.push(region ? "Service-region coverage is compatible or not yet constrained." : "No configured service region was found.");
  reasons.push(bonding === 15 ? "Tender value is within the configured bonding capacity." : bonding === 0 ? "Tender value exceeds the configured bonding capacity." : "Bonding capacity is not configured or tender value is unavailable.");
  reasons.push(capacity === 10 ? "Configured crew capacity has room." : capacity === 0 ? "Current pipeline load or crew capacity is constrained." : "Crew capacity is not fully configured.");
  return { score, detectedTrades, matchedTrades, components: { trade, certification, region, bonding, capacity }, reasons, explanation: `${score}/100 match. ${reasons.join(" ")}` };
}
