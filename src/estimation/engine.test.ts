import { calculateEstimate } from "./engine";

const result = calculateEstimate({
  labor: [{ id: "l1", taskType: "Drywall", role: "Installer", hours: 10.5, hourlyCostCents: 4200 }],
  materials: [{ id: "m1", taskType: "Drywall", material: "5/8 board", quantity: 12, unitCostCents: 1850 }],
  overhead: [{ id: "o1", label: "Equipment", amountCents: 2500 }],
  markupPercent: 10
});
if (result.laborSubtotalCents !== 44100) throw new Error("labor subtotal failed");
if (result.materialSubtotalCents !== 22200) throw new Error("material subtotal failed");
if (result.directCostCents !== 68800 || result.markupCents !== 6880 || result.recommendedPriceCents !== 75680) throw new Error("estimate totals failed");
if (!result.lines.every((line) => line.formula.includes("$"))) throw new Error("line formulas missing");
