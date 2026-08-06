export const SUPPORTED_PILOT_TRADE_SLUGS = [
  "general-renovation",
  "restoration",
  "fire-water-restoration",
  "painting",
  "roofing"
] as const;

export function isSupportedPilotTrade(slug: string): boolean {
  return (SUPPORTED_PILOT_TRADE_SLUGS as readonly string[]).includes(slug);
}
