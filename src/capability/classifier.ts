export type ClassifiedSkill = { slug: string; label: string; matchedTerms: string[]; confidence: number };
export type TeamMemberSkillInput = { roleTitle: string; skillSummary: string; classifiedSkills?: string[] };

const SKILL_TAXONOMY: Record<string, { label: string; terms: string[] }> = {
  "general-renovation": { label: "General renovation", terms: ["renovation", "remodel", "refurbishment", "building improvement"] },
  restoration: { label: "Restoration", terms: ["restoration", "rebuild", "recovery", "contents pack-out"] },
  "fire-water-restoration": { label: "Fire and water damage", terms: ["fire damage", "water damage", "remediation", "emergency drying"] },
  painting: { label: "Painting", terms: ["painting", "paint", "coating"] },
  drywall: { label: "Drywall and gypsum", terms: ["drywall", "gypsum", "partition", "wallboard"] },
  flooring: { label: "Flooring", terms: ["flooring", "carpet", "tile", "vinyl"] },
  insulation: { label: "Insulation", terms: ["insulation", "thermal", "vapour barrier", "vapor barrier"] },
  roofing: { label: "Roofing", terms: ["roof", "roofing", "shingle"] },
  siding: { label: "Siding and cladding", terms: ["siding", "cladding", "exterior envelope"] },
  "finish-carpentry": { label: "Finish carpentry", terms: ["millwork", "trim", "finish carpentry", "cabinet"] },
  "doors-and-hardware": { label: "Doors and hardware", terms: ["door", "hardware", "lockset"] },
  "window-replacement": { label: "Windows and glazing", terms: ["window", "glazing", "fenestration"] },
  "demolition-abatement": { label: "Demolition and abatement", terms: ["demolition", "abatement", "asbestos"] },
  "minor-electrical": { label: "Minor electrical", terms: ["electrical", "wiring", "lighting"] },
  "minor-plumbing": { label: "Minor plumbing", terms: ["plumbing", "pipe", "fixture"] }
};

function normalized(value: string): string { return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim(); }

export function classifySkills(roleTitle: string, skillSummary: string): ClassifiedSkill[] {
  const text = normalized(`${roleTitle} ${skillSummary}`);
  return Object.entries(SKILL_TAXONOMY).flatMap(([slug, skill]) => {
    const matchedTerms = skill.terms.filter((term) => text.includes(term));
    if (!matchedTerms.length) return [];
    return [{ slug, label: skill.label, matchedTerms, confidence: Math.min(1, 0.55 + matchedTerms.length * 0.15) }];
  });
}

export function scoreTeamFit(tenderText: string, members: TeamMemberSkillInput[]) {
  const tenderSkills = classifySkills("", tenderText);
  const tenderSlugs = new Set(tenderSkills.map((skill) => skill.slug));
  const matchedMembers = members.map((member) => {
    const memberSkills = member.classifiedSkills?.length ? member.classifiedSkills : classifySkills(member.roleTitle, member.skillSummary).map((skill) => skill.slug);
    return { roleTitle: member.roleTitle, matchedSkills: memberSkills.filter((skill) => tenderSlugs.has(skill)) };
  }).filter((member) => member.matchedSkills.length);
  const score = !members.length || !tenderSkills.length ? null : Math.min(100, Math.round((matchedMembers.length / members.length) * 70 + Math.min(30, tenderSkills.length * 10)));
  return { score, matchedMembers, tenderSkills: tenderSkills.map((skill) => skill.label) };
}

export { SKILL_TAXONOMY };
