import { sha256 } from "../ingestion/document-processing";

export function tenderSourceFingerprint(tender: any): string {
  return sha256(JSON.stringify({
    titleEn: tender.title_en ?? null,
    titleFr: tender.title_fr ?? null,
    descriptionEn: tender.description_en ?? null,
    descriptionFr: tender.description_fr ?? null,
    sourceUrl: tender.source_url ?? null,
    rawPayload: tender.raw_payload ?? null
  }));
}
