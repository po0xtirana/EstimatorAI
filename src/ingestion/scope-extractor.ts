export type ExtractedScope = { taskKey: string | null; description: string; quantity: number; unit: string; confidence: number; evidenceText: string; sourcePage?: number };

const TASK_TERMS: Array<{ taskKey: string; terms: string[] }> = [
  { taskKey: "paint-walls", terms: ["paint", "painting", "repaint"] },
  { taskKey: "drywall-install", terms: ["drywall", "gypsum", "wallboard"] },
  { taskKey: "shingle-roof", terms: ["shingle", "roofing", "roof replacement"] },
  { taskKey: "water-extraction", terms: ["water extraction", "water damage", "drying"] },
  { taskKey: "containment", terms: ["containment", "poly barrier", "protection"] }
];

function taskFor(text: string): string | null {
  const normalized = text.toLowerCase();
  return TASK_TERMS.find((candidate) => candidate.terms.some((term) => normalized.includes(term)))?.taskKey ?? null;
}

export function extractScopeFromText(text: string, sourcePage?: number): ExtractedScope[] {
  const results: ExtractedScope[] = [];
  const pattern = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(m2|m²|sqm|sq\.?\s*ft|sf|ft2|linear\s*m|lm|ea|each|units?)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const quantity = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const index = match.index ?? 0;
    const lastAnd = text.lastIndexOf(" and ", index);
    const lastComma = text.lastIndexOf(",", index);
    const lastNewline = text.lastIndexOf("\n", index);
    const boundary = Math.max(lastAnd >= 0 ? lastAnd + 5 : 0, lastComma >= 0 ? lastComma + 1 : 0, lastNewline >= 0 ? lastNewline + 1 : 0);
    const start = Math.max(boundary, index - 90);
    const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 40);
    const evidenceText = text.slice(start, end).replace(/\s+/g, " ").trim();
    const taskKey = taskFor(evidenceText);
    const unit = match[2].toLowerCase().replace("m²", "m2").replace(/sq\.?\s*ft|sf|ft2/, "sq ft").replace(/linear\s*m|lm/, "lm").replace(/each|units?/, "ea");
    results.push({ taskKey, description: taskKey ? `Extracted ${taskKey.replaceAll("-", " ")}` : "Extracted tender quantity", quantity, unit, confidence: taskKey ? 72 : 45, evidenceText, ...(sourcePage ? { sourcePage } : {}) });
  }
  return results;
}
