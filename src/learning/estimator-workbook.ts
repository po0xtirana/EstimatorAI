import readExcelFile from "read-excel-file/node";

export const WORKBOOK_PARSER_VERSION = "estimator-workbook-v1";
export const WORKBOOK_MAX_BYTES = 12 * 1024 * 1024;

export type WorkbookKind = "labor" | "material" | "equipment" | "subcontractor" | "overhead" | "risk" | "markup" | "unknown";
export type WorkbookCell = string | number | boolean | Date | null;

export type ParsedWorkbookLine = {
  sourceSheet: string;
  sourceRow: number;
  sourceRange: string;
  rawLabel: string;
  normalizedKind: WorkbookKind;
  taskKey: string | null;
  resourceKey: string | null;
  costCode: string | null;
  quantity: number | null;
  unit: string | null;
  hours: number | null;
  unitCostCents: number | null;
  taxCents: number | null;
  currencyCode: string;
  occurredOn: string | null;
  amountCents: number;
  extractionConfidence: number;
  reviewStatus: "auto_accepted" | "needs_review";
  mappingReason: string;
  rawRow: Array<string | number | boolean | null>;
};

export type ParsedWorkbook = {
  lines: ParsedWorkbookLine[];
  categoryTotals: Record<WorkbookKind, number>;
  totalAmountCents: number;
  extractionConfidence: number;
  warnings: string[];
  metadata: { sheetCount: number; sheetNames: string[]; parserVersion: string };
  mappingMetadata: { sheets: Array<{ name: string; headerRow: number | null; columns: Record<string, string>; extractedLines: number }> };
};

export type EstimateComparisonCategory = { aiCents: number; estimatorCents: number; varianceCents: number; variancePercent: number | null };
export type EstimateComparison = {
  aiTotalCents: number;
  estimatorTotalCents: number;
  varianceCents: number;
  variancePercent: number | null;
  categoryComparison: Record<string, EstimateComparisonCategory>;
  overallConfidence: number;
  status: "ready" | "needs_review";
  lines: Array<{ estimateLineId: string | null; workbookLineId: string | null; normalizedKind: WorkbookKind; matchScore: number; aiAmountCents: number; estimatorAmountCents: number; varianceCents: number; matchReason: string }>;
};

type ColumnField = "label" | "category" | "cost_code" | "quantity" | "unit" | "hours" | "rate" | "amount" | "tax" | "date";
type ColumnMapping = { index: number; field: ColumnField; header: string; kindHint?: WorkbookKind };
type ParsedCandidate = ParsedWorkbookLine & { summary: boolean };

const supportedKinds: WorkbookKind[] = ["labor", "material", "equipment", "subcontractor", "overhead", "risk", "markup", "unknown"];
const learningKinds: WorkbookKind[] = ["labor", "material", "equipment", "subcontractor", "overhead", "risk", "markup"];

function cleanText(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalized(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9%]+/g, " ").replace(/\s+/g, " ").trim();
}

function slug(value: string): string | null {
  const result = normalized(value).replace(/\s+/g, "-").slice(0, 120);
  return result || null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || /%$/.test(text)) return null;
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  const parsed = Number(text.replace(/[,$£€\s()]/g, "").replace(/^-/, ""));
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : null;
}

function cents(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.round(parsed * 100);
}

function kindFromText(...values: unknown[]): WorkbookKind {
  const text = normalized(values.map(cleanText).join(" "));
  if (/\b(labou?r|wages?|payroll|man hours?|crew hours?)\b/.test(text)) return "labor";
  if (/\b(materials?|supplies|products?|purchases?)\b/.test(text)) return "material";
  if (/\b(equipment|plant|tools?|vehicles?|rentals?|machinery)\b/.test(text)) return "equipment";
  if (/\b(subcontracts?|subcontractors?|sub trades?|subtrades?|sublets?|trade contractors?)\b/.test(text)) return "subcontractor";
  if (/\b(overhead|general conditions?|general requirements?|supervision|insurance|permits?|mobilization|travel|disposal|safety)\b/.test(text)) return "overhead";
  if (/\b(contingenc(?:y|ies)|risk|allowances?)\b/.test(text)) return "risk";
  if (/\b(markup|profit|margin|fee)\b/.test(text)) return "markup";
  return "unknown";
}

function classifyHeader(value: unknown): Omit<ColumnMapping, "index"> | null {
  const header = cleanText(value);
  const text = normalized(header);
  if (!text) return null;
  if (/\b(labou?r|man|crew)\s*(hours?|hrs?)\b|\b(hours?|hrs?)\s*(labou?r|man|crew)\b/.test(text)) return { field: "hours", header };
  if (/\b(qty|quantity|quantities)\b/.test(text)) return { field: "quantity", header };
  if (/\b(cost code|job code|activity code|item code|account code|gl code)\b/.test(text)) return { field: "cost_code", header };
  if (/\b(tax|hst|gst|pst|vat)\b/.test(text)) return { field: "tax", header };
  if (/^(date|invoice date|transaction date|posting date|work date)$/.test(text)) return { field: "date", header };
  if (/^(unit|uom|measure|unit of measure)$/.test(text)) return { field: "unit", header };
  if (/\b(unit|hourly|daily)\s*(cost|rate|price)\b|\b(cost|rate|price)\s*(per|each|ea|hour|hr|unit|day)\b|^rate$/.test(text)) return { field: "rate", header };
  const kind = kindFromText(text);
  const moneyWord = /\b(amount|cost|total|price|extension|extended|value)\b/.test(text);
  if (kind !== "unknown" && (moneyWord || /^(labou?r|materials?|equipment|subcontractors?|overhead|contingency|markup)$/.test(text))) return { field: "amount", header, kindHint: kind };
  if (/\b(amount|total cost|estimated cost|estimate|extension|extended cost|bid amount|price)\b/.test(text)) return { field: "amount", header };
  if (/\b(category|cost type|cost code type|division|trade|class)\b/.test(text)) return { field: "category", header };
  if (/\b(description|scope|activity|task|work item|line item|item name|resource|name)\b/.test(text) || /^(item|details?)$/.test(text)) return { field: "label", header };
  return null;
}

function excelColumn(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26); }
  return result;
}

function detectHeader(rows: WorkbookCell[][]): { rowIndex: number; columns: ColumnMapping[] } | null {
  let best: { rowIndex: number; columns: ColumnMapping[]; score: number } | null = null;
  rows.slice(0, 35).forEach((row, rowIndex) => {
    const columns = row.map((cell, index) => ({ index, mapping: classifyHeader(cell) })).filter((item): item is { index: number; mapping: Omit<ColumnMapping, "index"> } => Boolean(item.mapping)).map((item) => ({ index: item.index, ...item.mapping }));
    const fields = new Set(columns.map((column) => column.field));
    const amountColumns = columns.filter((column) => column.field === "amount").length;
    const score = columns.length + amountColumns * 4 + (fields.has("label") ? 3 : 0) + (fields.has("quantity") && fields.has("rate") ? 3 : 0);
    const viable = amountColumns > 0 || (fields.has("rate") && (fields.has("quantity") || fields.has("hours")));
    if (viable && (!best || score > best.score)) best = { rowIndex, columns, score };
  });
  const detected = best as { rowIndex: number; columns: ColumnMapping[]; score: number } | null;
  return detected ? { rowIndex: detected.rowIndex, columns: detected.columns } : null;
}

function serializableRow(row: WorkbookCell[]): Array<string | number | boolean | null> {
  return row.map((value) => value instanceof Date ? value.toISOString() : value);
}

function parseSheet(name: string, rows: WorkbookCell[][]): { lines: ParsedWorkbookLine[]; headerRow: number | null; columns: Record<string, string>; warning?: string } {
  const detected = detectHeader(rows);
  if (!detected) return { lines: [], headerRow: null, columns: {}, warning: `${name}: no cost table header could be identified.` };
  const columnMap = Object.fromEntries(detected.columns.map((column) => [`${column.field}${column.kindHint ? `:${column.kindHint}` : ""}`, column.header]));
  const byField = (field: ColumnField) => detected.columns.find((column) => column.field === field);
  const labelColumn = byField("label");
  const categoryColumn = byField("category");
  const costCodeColumn = byField("cost_code");
  const quantityColumn = byField("quantity");
  const unitColumn = byField("unit");
  const hoursColumn = byField("hours");
  const rateColumn = byField("rate");
  const taxColumn = byField("tax");
  const dateColumn = byField("date");
  const amountColumns = detected.columns.filter((column) => column.field === "amount");
  const candidates: ParsedCandidate[] = [];

  for (let rowIndex = detected.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (!row.some((cell) => cleanText(cell))) continue;
    const fallbackLabel = row.find((cell) => typeof cell === "string" && cleanText(cell).length > 1);
    const rawLabel = cleanText(labelColumn ? row[labelColumn.index] : null) || cleanText(fallbackLabel) || `Row ${rowIndex + 1}`;
    const category = cleanText(categoryColumn ? row[categoryColumn.index] : "");
    const costCode = cleanText(costCodeColumn ? row[costCodeColumn.index] : "") || null;
    const quantity = finiteNumber(quantityColumn ? row[quantityColumn.index] : null);
    const hours = finiteNumber(hoursColumn ? row[hoursColumn.index] : null);
    const rateCents = cents(rateColumn ? row[rateColumn.index] : null);
    const taxCents = cents(taxColumn ? row[taxColumn.index] : null);
    const dateValue = dateColumn ? row[dateColumn.index] : null;
    const occurredOn = dateValue instanceof Date ? dateValue.toISOString().slice(0, 10) : /^\d{4}-\d{2}-\d{2}$/.test(cleanText(dateValue)) ? cleanText(dateValue) : null;
    const unit = cleanText(unitColumn ? row[unitColumn.index] : "") || null;
    const summary = /\b(sub\s*total|grand total|total estimate|total bid|summary|direct cost)\b/.test(normalized(rawLabel));
    const sourceRange = `A${rowIndex + 1}:${excelColumn(Math.max(0, row.length - 1))}${rowIndex + 1}`;
    const rawRow = serializableRow(row);
    const directAmounts = amountColumns.map((column) => ({ column, amountCents: cents(row[column.index]) })).filter((item): item is { column: ColumnMapping; amountCents: number } => item.amountCents !== null && item.amountCents !== 0);

    if (directAmounts.length) {
      for (const item of directAmounts) {
        const kind = item.column.kindHint ?? kindFromText(category, rawLabel, name);
        const confidence = Math.max(45, Math.min(98, 72 + (labelColumn ? 7 : 0) + (kind !== "unknown" ? 12 : 0) + (item.column.kindHint ? 5 : 0) - (summary ? 8 : 0)));
        candidates.push({ sourceSheet: name, sourceRow: rowIndex + 1, sourceRange, rawLabel, normalizedKind: kind, taskKey: slug(rawLabel), resourceKey: null, costCode, quantity, unit, hours, unitCostCents: rateCents, taxCents, currencyCode: "CAD", occurredOn, amountCents: item.amountCents, extractionConfidence: confidence, reviewStatus: confidence >= 78 && kind !== "unknown" ? "auto_accepted" : "needs_review", mappingReason: item.column.kindHint ? `Mapped from the ${item.column.header} column.` : `Mapped from ${item.column.header}; category inferred from row and sheet labels.`, rawRow, summary });
      }
      continue;
    }

    const basis = hours ?? quantity;
    if (basis !== null && rateCents !== null && basis !== 0 && rateCents !== 0) {
      const kind = kindFromText(category, rawLabel, name, hours !== null ? "labor" : "");
      const amountCents = Math.round(basis * rateCents);
      const confidence = kind === "unknown" ? 58 : 82;
      candidates.push({ sourceSheet: name, sourceRow: rowIndex + 1, sourceRange, rawLabel, normalizedKind: kind, taskKey: slug(rawLabel), resourceKey: null, costCode, quantity, unit, hours, unitCostCents: rateCents, taxCents, currencyCode: "CAD", occurredOn, amountCents, extractionConfidence: confidence, reviewStatus: confidence >= 78 ? "auto_accepted" : "needs_review", mappingReason: `Calculated ${hours !== null ? "hours" : "quantity"} × rate because no extended amount was present.`, rawRow, summary });
    }
  }

  const details = candidates.filter((candidate) => !candidate.summary);
  const selected = details.length ? details : candidates;
  return { lines: selected.map(({ summary: _summary, ...line }) => line), headerRow: detected.rowIndex + 1, columns: columnMap };
}

function parseCsv(text: string): WorkbookCell[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export async function parseEstimatorWorkbook(buffer: Buffer, fileName: string): Promise<ParsedWorkbook> {
  if (!buffer.length) throw new Error("The uploaded workbook is empty.");
  if (buffer.length > WORKBOOK_MAX_BYTES) throw new Error("The workbook is larger than the 12 MB upload limit.");
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "xls") throw new Error("Legacy .xls files are not supported. Open the file in Excel and save it as .xlsx, then upload it again.");
  let sheets: Array<{ sheet: string; data: WorkbookCell[][] }>;
  if (extension === "csv") sheets = [{ sheet: fileName.replace(/\.csv$/i, "") || "Estimate", data: parseCsv(buffer.toString("utf8")) }];
  else if (extension === "xlsx" || extension === "xlsm") sheets = (await readExcelFile(buffer)) as Array<{ sheet: string; data: WorkbookCell[][] }>;
  else throw new Error("Upload an .xlsx, .xlsm, or .csv estimator workbook.");

  const warnings: string[] = [];
  const mappings: ParsedWorkbook["mappingMetadata"]["sheets"] = [];
  const lines = sheets.flatMap((sheet) => {
    const parsed = parseSheet(sheet.sheet, sheet.data);
    if (parsed.warning) warnings.push(parsed.warning);
    mappings.push({ name: sheet.sheet, headerRow: parsed.headerRow, columns: parsed.columns, extractedLines: parsed.lines.length });
    return parsed.lines;
  });
  if (!lines.length) throw new Error("No cost lines were found. Include a description and an amount, or quantity/hours and a rate, in at least one sheet.");
  const categoryTotals = Object.fromEntries(supportedKinds.map((kind) => [kind, 0])) as Record<WorkbookKind, number>;
  for (const line of lines) categoryTotals[line.normalizedKind] += line.amountCents;
  const totalAmountCents = learningKinds.reduce((sum, kind) => sum + categoryTotals[kind], 0) + categoryTotals.unknown;
  const extractionConfidence = Math.round(lines.reduce((sum, line) => sum + line.extractionConfidence, 0) / lines.length);
  const reviewCount = lines.filter((line) => line.reviewStatus === "needs_review").length;
  if (reviewCount) warnings.push(`${reviewCount} line${reviewCount === 1 ? " needs" : "s need"} a quick category review before it can influence learning.`);
  return { lines, categoryTotals, totalAmountCents, extractionConfidence, warnings, metadata: { sheetCount: sheets.length, sheetNames: sheets.map((sheet) => sheet.sheet), parserVersion: WORKBOOK_PARSER_VERSION }, mappingMetadata: { sheets: mappings } };
}

function canonicalEstimateKind(value: string): WorkbookKind {
  if (value === "vehicle") return "equipment";
  if (value === "mobilization") return "overhead";
  return supportedKinds.includes(value as WorkbookKind) ? value as WorkbookKind : "unknown";
}

function tokenSet(value: string): Set<string> {
  return new Set(normalized(value).split(" ").filter((token) => token.length > 2 && !["cost", "total", "labor", "labour", "material", "equipment"].includes(token)));
}

function labelSimilarity(left: string, right: string): number {
  const a = tokenSet(left); const b = tokenSet(right);
  if (!a.size || !b.size) return normalized(left) === normalized(right) ? 100 : 0;
  const overlap = Array.from(a).filter((token) => b.has(token)).length;
  return Math.round((overlap / Math.max(a.size, b.size)) * 100);
}

function percentVariance(base: number, observed: number): number | null {
  return base === 0 ? null : Math.round(((observed - base) / base) * 10000) / 100;
}

export function compareEstimatorWorkbook(aiLines: Array<{ id: string; kind: string; label: string; amount_cents: number }>, workbookLines: Array<ParsedWorkbookLine & { id: string }>, extractionConfidence: number): EstimateComparison {
  const categories = learningKinds;
  const categoryComparison: Record<string, EstimateComparisonCategory> = {};
  for (const kind of categories) {
    const aiCents = aiLines.filter((line) => canonicalEstimateKind(line.kind) === kind).reduce((sum, line) => sum + Number(line.amount_cents), 0);
    const estimatorCents = workbookLines.filter((line) => line.normalizedKind === kind && line.reviewStatus !== "needs_review").reduce((sum, line) => sum + line.amountCents, 0);
    categoryComparison[kind] = { aiCents, estimatorCents, varianceCents: estimatorCents - aiCents, variancePercent: percentVariance(aiCents, estimatorCents) };
  }
  const aiTotalCents = Object.values(categoryComparison).reduce((sum, category) => sum + category.aiCents, 0);
  const estimatorTotalCents = Object.values(categoryComparison).reduce((sum, category) => sum + category.estimatorCents, 0);
  const usedAi = new Set<string>();
  const lineComparisons: EstimateComparison["lines"] = [];
  for (const workbookLine of workbookLines) {
    const candidates = aiLines.filter((line) => !usedAi.has(line.id) && canonicalEstimateKind(line.kind) === workbookLine.normalizedKind).map((line) => ({ line, score: labelSimilarity(line.label, workbookLine.rawLabel) })).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best && best.score >= 25) usedAi.add(best.line.id);
    const aiAmount = best && best.score >= 25 ? Number(best.line.amount_cents) : 0;
    lineComparisons.push({ estimateLineId: best && best.score >= 25 ? best.line.id : null, workbookLineId: workbookLine.id, normalizedKind: workbookLine.normalizedKind, matchScore: best?.score ?? 0, aiAmountCents: aiAmount, estimatorAmountCents: workbookLine.amountCents, varianceCents: workbookLine.amountCents - aiAmount, matchReason: best && best.score >= 25 ? `Matched by category and ${best.score}% label similarity.` : "No sufficiently similar AI estimate line was found." });
  }
  for (const aiLine of aiLines.filter((line) => !usedAi.has(line.id))) {
    lineComparisons.push({ estimateLineId: aiLine.id, workbookLineId: null, normalizedKind: canonicalEstimateKind(aiLine.kind), matchScore: 0, aiAmountCents: Number(aiLine.amount_cents), estimatorAmountCents: 0, varianceCents: -Number(aiLine.amount_cents), matchReason: "No estimator workbook line was matched to this AI line." });
  }
  const reviewLines = workbookLines.filter((line) => line.reviewStatus === "needs_review").length;
  const matched = lineComparisons.filter((line) => line.estimateLineId && line.workbookLineId).length;
  const matchCoverage = workbookLines.length ? matched / workbookLines.length : 0;
  const overallConfidence = Math.max(0, Math.min(100, Math.round(extractionConfidence * 0.7 + matchCoverage * 30 - reviewLines * 2)));
  return { aiTotalCents, estimatorTotalCents, varianceCents: estimatorTotalCents - aiTotalCents, variancePercent: percentVariance(aiTotalCents, estimatorTotalCents), categoryComparison, overallConfidence, status: reviewLines || overallConfidence < 72 ? "needs_review" : "ready", lines: lineComparisons };
}

export function calculateCalibration(observations: Array<{ observed_factor: number; trust_weight: number; confidence: number; created_at: string }>): { sampleCount: number; weightedFactor: number; appliedFactor: number; confidence: number; status: "collecting" | "active"; deviation: number } {
  const usable = observations.filter((item) => Number(item.observed_factor) > 0 && Number(item.confidence) >= 75).slice(0, 20);
  if (!usable.length) return { sampleCount: 0, weightedFactor: 1, appliedFactor: 1, confidence: 0, status: "collecting", deviation: 0 };
  let weightTotal = 0; let weightedTotal = 0;
  usable.forEach((item, index) => { const recency = Math.max(0.5, 1 - index * 0.03); const weight = Number(item.trust_weight) * (Number(item.confidence) / 100) * recency; weightTotal += weight; weightedTotal += Math.max(0.5, Math.min(1.5, Number(item.observed_factor))) * weight; });
  const weightedFactor = weightedTotal / Math.max(0.0001, weightTotal);
  const deviation = Math.sqrt(usable.reduce((sum, item) => sum + Math.pow(Number(item.observed_factor) - weightedFactor, 2), 0) / usable.length);
  const confidence = Math.round(Math.min(95, usable.length * 18 + Math.max(0, 35 - deviation * 150)));
  const active = usable.length >= 3 && deviation <= 0.16 && confidence >= 75;
  return { sampleCount: usable.length, weightedFactor: Math.round(weightedFactor * 10000) / 10000, appliedFactor: active ? Math.round(Math.max(0.8, Math.min(1.2, weightedFactor)) * 10000) / 10000 : 1, confidence, status: active ? "active" : "collecting", deviation: Math.round(deviation * 10000) / 10000 };
}
