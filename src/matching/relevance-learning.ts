const STOP_WORDS = new Set(["about", "after", "against", "building", "contract", "from", "have", "into", "notice", "project", "public", "services", "shall", "tender", "that", "their", "this", "with", "work", "works"]);

export type RelevanceObservation = { label: "relevant" | "not_relevant"; text: string };

export function tenderTerms(text: string): string[] {
  return Array.from(new Set(text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((term) => term.length >= 4 && !STOP_WORDS.has(term))));
}

export function learnRelevanceTerms(observations: RelevanceObservation[], limit = 30): { positive: Record<string, number>; negative: Record<string, number> } {
  const counts = new Map<string, { relevant: number; irrelevant: number }>();
  for (const observation of observations) {
    for (const term of tenderTerms(observation.text)) {
      const count = counts.get(term) ?? { relevant: 0, irrelevant: 0 };
      if (observation.label === "relevant") count.relevant += 1;
      else count.irrelevant += 1;
      counts.set(term, count);
    }
  }
  const ranked = Array.from(counts.entries()).map(([term, count]) => ({ term, difference: count.relevant - count.irrelevant, evidence: count.relevant + count.irrelevant })).filter((item) => item.difference !== 0).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || b.evidence - a.evidence).slice(0, limit);
  const positive: Record<string, number> = {}, negative: Record<string, number> = {};
  for (const item of ranked) {
    const weight = Math.min(3, Math.max(0.5, Math.abs(item.difference) / Math.max(1, item.evidence) * 3));
    if (item.difference > 0) positive[item.term] = weight;
    else negative[item.term] = weight;
  }
  return { positive, negative };
}
