import { resolveProjectProfile } from "./profile";

const base = { markupPercent: 10, laborRates: { installer: 4200 }, materialRates: { drywall: 1850 }, overhead: [{ id: "fuel", label: "Fuel", amountCents: 1000 }] };
const resolved = resolveProjectProfile(base, { markupPercent: 12, laborRates: { installer: 4500 }, materialRates: { paint: 3200 } });
if (resolved.markupPercent !== 12 || resolved.laborRates.installer !== 4500 || resolved.materialRates.drywall !== 1850 || resolved.materialRates.paint !== 3200) throw new Error("project override merge failed");
resolved.overhead[0].amountCents = 9999;
if (base.overhead[0].amountCents !== 1000) throw new Error("base profile was mutated");
