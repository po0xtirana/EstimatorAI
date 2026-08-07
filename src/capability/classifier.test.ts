import { classifySkills, scoreTeamFit } from "./classifier";

const skills = classifySkills("Senior installer", "Drywall, gypsum board, and finish carpentry");
if (!skills.some((skill) => skill.slug === "drywall") || !skills.some((skill) => skill.slug === "finish-carpentry")) throw new Error("skill classification failed");
const fit = scoreTeamFit("Replace drywall and repair partitions", [{ roleTitle: "Installer", skillSummary: "Drywall and gypsum", classifiedSkills: ["drywall"] }]);
if (fit.score === null || !fit.matchedMembers.length) throw new Error("team fit scoring failed");
