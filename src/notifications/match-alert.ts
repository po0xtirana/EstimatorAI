export type AlertCandidate = { organizationId: string; tenderId: string; score: number; titleEn: string; titleFr: string | null };
export type AlertPreference = { threshold: number; emailEnabled: boolean };

export function shouldCreateMatchAlert(candidate: AlertCandidate, preference: AlertPreference): boolean {
  return candidate.score >= preference.threshold;
}

export function buildMatchAlert(candidate: AlertCandidate) {
  return {
    organizationId: candidate.organizationId,
    tenderId: candidate.tenderId,
    kind: "match_threshold" as const,
    titleEn: `New ${Math.round(candidate.score)}/100 tender match`,
    titleFr: candidate.titleFr ? `Nouvelle correspondance d’appel d’offres de ${Math.round(candidate.score)}/100` : null,
    bodyEn: candidate.titleEn,
    bodyFr: candidate.titleFr
  };
}
