/** Pure CanadaBuys CSV normalization. No database or LLM access belongs here. */

export type BilingualText = { en: string | null; fr: string | null };

export type NormalizedTender = {
  source: "canadabuys";
  sourceRecordId: string;
  solicitationNumber: string | null;
  title: BilingualText;
  description: BilingualText;
  buyerName: string | null;
  procurementCategory: "construction" | "other" | "unknown";
  procurementCode: string | null;
  estimatedValueCents: number | null;
  currency: "CAD" | null;
  closingAt: string | null;
  sourceUrl: string | null;
  rawPayload: Record<string, string>;
};

type CsvRow = Record<string, string>;

const fields = {
  reference: ["referenceNumber-numeroReference", "referenceNumber", "reference_number"],
  solicitation: ["solicitationNumber-numeroSollicitation", "solicitationNumber", "solicitation_number"],
  titleEn: ["title-titre-eng", "title_en", "title-eng"],
  titleFr: ["title-titre-fra", "title_fr", "title-fra"],
  descriptionEn: ["tenderDescription-descriptionAppelOffres-eng", "description-description-eng", "description_en", "description-eng"],
  descriptionFr: ["tenderDescription-descriptionAppelOffres-fra", "description-description-fra", "description_fr", "description-fra"],
  buyer: ["contractingEntityName-nomEntitContractante-eng", "contractingEntityName-nomEntitContractante-fra", "tenderOrganizationName-nomOrganisationAppelOffres", "buyer_name", "organization"],
  category: ["procurementCategory-categorieApprovisionnement", "procurement_category", "category"],
  value: ["tenderValue-appelOffresValeur", "estimated_value", "contract_value"],
  currency: ["contractCurrency-contratMonnaie", "currency"],
  closing: ["tenderClosingDate-appelOffresDateCloture", "tenderClosingDate-appelOffresdateCloture", "closing_date", "closing_at"],
  url: ["noticeURL-URLavis-eng", "noticeURL-URLavis-fra", "noticeURL-urlAvis", "source_url", "url"]
} as const;

function value(row: CsvRow, candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    const found = row[candidate]?.trim();
    if (found) return found;
  }
  return null;
}

function parseMoneyCents(input: string | null): number | null {
  if (!input) return null;
  const normalized = input.replace(/[$,\s]/g, "").replace(/[^0-9.-]/g, "");
  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function parseClosingAt(input: string | null): string | null {
  if (!input) return null;
  // The documented CanadaBuys format is UTC-0500. An explicit offset is
  // required so a server's local timezone cannot silently change the deadline.
  const withOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(input)
    ? input
    : input.includes("T") ? `${input}-05:00` : `${input} -0500`;
  const timestamp = Date.parse(withOffset);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function category(code: string | null): NormalizedTender["procurementCategory"] {
  if (!code) return "unknown";
  const normalized = code.toUpperCase().replace(/^\*/, "");
  return normalized === "CNST" || /construction/i.test(normalized) ? "construction" : "other";
}

export function normalizeCanadaBuysRow(row: CsvRow): NormalizedTender | null {
  const solicitationNumber = value(row, fields.solicitation);
  const reference = value(row, fields.reference);
  const sourceRecordId = solicitationNumber ?? reference;
  if (!sourceRecordId) return null;

  const title = { en: value(row, fields.titleEn), fr: value(row, fields.titleFr) };
  if (!title.en && !title.fr) return null;
  const procurementCode = value(row, fields.category);
  const currency = value(row, fields.currency)?.toUpperCase();

  return {
    source: "canadabuys",
    sourceRecordId,
    solicitationNumber,
    title,
    description: { en: value(row, fields.descriptionEn), fr: value(row, fields.descriptionFr) },
    buyerName: value(row, fields.buyer),
    procurementCategory: category(procurementCode),
    procurementCode,
    estimatedValueCents: parseMoneyCents(value(row, fields.value)),
    currency: currency === "CAD" || !currency ? "CAD" : null,
    closingAt: parseClosingAt(value(row, fields.closing)),
    sourceUrl: value(row, fields.url),
    rawPayload: { ...row }
  };
}

/** RFC 4180-compatible enough for the government CSV exports: quoted commas,
 * escaped quotes, CRLF, and UTF-8 text are handled without external packages. */
export function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i], next = input[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(cell); cell = ""; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell); cell = "";
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = []; continue;
    }
    cell += char;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

export function normalizeCanadaBuysCsv(input: string): NormalizedTender[] {
  return parseCsv(input).flatMap((row) => {
    const normalized = normalizeCanadaBuysRow(row);
    return normalized ? [normalized] : [];
  });
}

export function normalizeCanadaBuysCsvWithStats(input: string): { records: NormalizedTender[]; rowsSeen: number; rowsRejected: number } {
  const rows = parseCsv(input);
  const records = rows.flatMap((row) => {
    const normalized = normalizeCanadaBuysRow(row);
    return normalized ? [normalized] : [];
  });
  return { records, rowsSeen: rows.length, rowsRejected: rows.length - records.length };
}
