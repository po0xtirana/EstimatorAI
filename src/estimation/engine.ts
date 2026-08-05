export type LaborLine = {
  id: string;
  taskType: string;
  role: string;
  hours: number;
  hourlyCostCents: number;
};

export type MaterialLine = {
  id: string;
  taskType: string;
  material: string;
  quantity: number;
  unitCostCents: number;
};

export type OverheadLine = {
  id: string;
  label: string;
  amountCents: number;
};

export type EstimateInputs = {
  labor: LaborLine[];
  materials: MaterialLine[];
  overhead: OverheadLine[];
  markupPercent: number;
};

export type EstimateLine = {
  id: string;
  kind: "labor" | "material" | "overhead" | "markup";
  label: string;
  quantity: number;
  unitCostCents: number;
  amountCents: number;
  formula: string;
};

export type EstimateResult = {
  lines: EstimateLine[];
  laborSubtotalCents: number;
  materialSubtotalCents: number;
  overheadSubtotalCents: number;
  directCostCents: number;
  markupCents: number;
  recommendedPriceCents: number;
};

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`);
}

function cents(value: number, label: string): number {
  assertFiniteNonNegative(value, label);
  if (!Number.isSafeInteger(Math.round(value))) throw new Error(`${label} exceeds safe integer precision`);
  return Math.round(value);
}

function multiply(quantity: number, unitCostCents: number, label: string): number {
  assertFiniteNonNegative(quantity, `${label} quantity`);
  assertFiniteNonNegative(unitCostCents, `${label} unit cost`);
  const amount = Math.round(quantity * unitCostCents);
  if (!Number.isSafeInteger(amount)) throw new Error(`${label} amount exceeds safe integer precision`);
  return amount;
}

export function calculateEstimate(input: EstimateInputs): EstimateResult {
  assertFiniteNonNegative(input.markupPercent, "markupPercent");
  const lines: EstimateLine[] = [];
  const laborSubtotalCents = input.labor.reduce((total, item) => {
    const hourly = cents(item.hourlyCostCents, `${item.id} hourlyCostCents`);
    const amount = multiply(item.hours, hourly, item.id);
    lines.push({ id: item.id, kind: "labor", label: `${item.taskType} — ${item.role}`, quantity: item.hours, unitCostCents: hourly, amountCents: amount, formula: `${item.hours} h × $${(hourly / 100).toFixed(2)}/h = $${(amount / 100).toFixed(2)}` });
    return total + amount;
  }, 0);
  const materialSubtotalCents = input.materials.reduce((total, item) => {
    const unit = cents(item.unitCostCents, `${item.id} unitCostCents`);
    const amount = multiply(item.quantity, unit, item.id);
    lines.push({ id: item.id, kind: "material", label: `${item.taskType} — ${item.material}`, quantity: item.quantity, unitCostCents: unit, amountCents: amount, formula: `${item.quantity} × $${(unit / 100).toFixed(2)} = $${(amount / 100).toFixed(2)}` });
    return total + amount;
  }, 0);
  const overheadSubtotalCents = input.overhead.reduce((total, item) => {
    const amount = cents(item.amountCents, `${item.id} amountCents`);
    lines.push({ id: item.id, kind: "overhead", label: item.label, quantity: 1, unitCostCents: amount, amountCents: amount, formula: `1 × $${(amount / 100).toFixed(2)} = $${(amount / 100).toFixed(2)}` });
    return total + amount;
  }, 0);
  const directCostCents = laborSubtotalCents + materialSubtotalCents + overheadSubtotalCents;
  const markupCents = Math.round(directCostCents * input.markupPercent / 100);
  lines.push({ id: "markup", kind: "markup", label: "Target markup", quantity: input.markupPercent, unitCostCents: directCostCents, amountCents: markupCents, formula: `$${(directCostCents / 100).toFixed(2)} × ${input.markupPercent.toFixed(2)}% = $${(markupCents / 100).toFixed(2)}` });
  return { lines, laborSubtotalCents, materialSubtotalCents, overheadSubtotalCents, directCostCents, markupCents, recommendedPriceCents: directCostCents + markupCents };
}
