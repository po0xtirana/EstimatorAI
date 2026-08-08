import { canonicalTenderFingerprint, tenderChangeTypes, tenderRevisionFingerprint } from "./tender-intelligence";
import type { NormalizedTender } from "./canadabuys";

const base: NormalizedTender = { source: "canadabuys", sourceRecordId: "CB-101", solicitationNumber: "RFP-101", title: { en: "School interior renovation", fr: null }, description: { en: "Drywall and painting", fr: null }, buyerName: "Ontario School Board", procurementCategory: "construction", procurementCode: "CNST", estimatedValueCents: 50000000, currency: "CAD", publishedAt: "2026-08-01T12:00:00Z", closingAt: "2026-08-20T18:00:00Z", sourceUrl: "https://example.test/one", rawPayload: { revision: "1" } };
const duplicate: NormalizedTender = { ...base, source: "bidsandtenders", sourceRecordId: "BT-999", sourceUrl: "https://example.test/two" };
if (canonicalTenderFingerprint(base) !== canonicalTenderFingerprint(duplicate)) throw new Error("Cross-source duplicates should share a canonical fingerprint");
if (tenderRevisionFingerprint(base) === tenderRevisionFingerprint({ ...base, closingAt: "2026-08-22T18:00:00Z" })) throw new Error("Deadline changes should create a new revision");
if (!tenderChangeTypes({ closing_at: base.closingAt, title_en: base.title.en, title_fr: null, description_en: base.description.en, description_fr: null, estimated_value_cents: base.estimatedValueCents, raw_payload: base.rawPayload }, { ...base, closingAt: "2026-08-22T18:00:00Z" }).includes("deadline")) throw new Error("Deadline change was not classified");
