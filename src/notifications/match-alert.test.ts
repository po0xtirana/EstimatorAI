import { buildMatchAlert, shouldCreateMatchAlert } from "./match-alert";

const candidate = { organizationId: "org", tenderId: "tender", score: 82, titleEn: "Drywall renewal", titleFr: "Renouvellement de cloisons sèches" };
if (!shouldCreateMatchAlert(candidate, { threshold: 80, emailEnabled: false })) throw new Error("threshold alert failed");
if (shouldCreateMatchAlert(candidate, { threshold: 90, emailEnabled: false })) throw new Error("threshold rejection failed");
if (!buildMatchAlert(candidate).titleFr) throw new Error("French alert missing");
