import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { NormalizedTender } from "./canadabuys";

function normalized(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase();
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function canonicalTenderFingerprint(tender: NormalizedTender): string {
  const solicitation = normalized(tender.solicitationNumber ?? tender.sourceRecordId);
  const buyer = normalized(tender.buyerName);
  const title = normalized(tender.title.en ?? tender.title.fr);
  const closingDate = tender.closingAt?.slice(0, 10) ?? "";
  return digest(solicitation ? { solicitation, buyer } : { buyer, title, closingDate });
}

export function tenderRevisionFingerprint(tender: NormalizedTender): string {
  return digest({
    title: tender.title,
    description: tender.description,
    buyerName: tender.buyerName,
    procurementCategory: tender.procurementCategory,
    procurementCode: tender.procurementCode,
    estimatedValueCents: tender.estimatedValueCents,
    publishedAt: tender.publishedAt,
    closingAt: tender.closingAt,
    sourceUrl: tender.sourceUrl,
    rawPayload: tender.rawPayload
  });
}

export function tenderChangeTypes(previous: Record<string, unknown> | null, tender: NormalizedTender): string[] {
  if (!previous) return ["initial"];
  const changes: string[] = [];
  if ((previous.closing_at ?? null) !== (tender.closingAt ?? null)) changes.push("deadline");
  if ((previous.title_en ?? null) !== tender.title.en || (previous.title_fr ?? null) !== tender.title.fr) changes.push("title");
  if ((previous.description_en ?? null) !== tender.description.en || (previous.description_fr ?? null) !== tender.description.fr) changes.push("scope");
  if (Number(previous.estimated_value_cents ?? -1) !== Number(tender.estimatedValueCents ?? -1)) changes.push("value");
  if (JSON.stringify(stable(previous.raw_payload ?? {})) !== JSON.stringify(stable(tender.rawPayload))) changes.push("source_payload");
  return changes.length ? changes : ["metadata"];
}

export type CanonicalUpsertResult = { tenderId: string; revisionHash: string; isNewTender: boolean; isNewRevision: boolean; changeTypes: string[] };

export async function upsertCanonicalTender(client: PoolClient, tender: NormalizedTender): Promise<CanonicalUpsertResult> {
  const canonical = canonicalTenderFingerprint(tender);
  const revisionHash = tenderRevisionFingerprint(tender);
  const reference = await client.query<{ tender_id: string }>(
    `select tender_id from tender_source_references where source_key = $1 and source_record_id = $2`,
    [tender.source, tender.sourceRecordId]
  );
  let tenderId = reference.rows[0]?.tender_id;
  let isNewTender = false;

  if (!tenderId) {
    const canonicalMatch = await client.query<{ id: string }>(
      `select id from tenders where canonical_fingerprint = $1
       or ($2 is not null and lower(coalesce(solicitation_number, '')) = lower($2) and lower(coalesce(buyer_name, '')) = lower(coalesce($3, '')))
       order by ingested_at asc limit 1`,
      [canonical, tender.solicitationNumber, tender.buyerName]
    );
    tenderId = canonicalMatch.rows[0]?.id;
  }

  let previous: Record<string, unknown> | null = null;
  if (tenderId) {
    const prior = await client.query<Record<string, unknown>>(`select * from tenders where id = $1 for update`, [tenderId]);
    previous = prior.rows[0] ?? null;
    await client.query(
      `update tenders set solicitation_number=$2, title_en=$3, title_fr=$4, description_en=$5, description_fr=$6,
       buyer_name=$7, procurement_category=$8, procurement_code=$9, estimated_value_cents=$10, currency=$11,
       published_at=$12, closing_at=$13, source_url=coalesce($14, source_url), raw_payload=$15::jsonb,
       last_seen_at=now(), updated_at=now() where id=$1`,
      [tenderId, tender.solicitationNumber, tender.title.en, tender.title.fr, tender.description.en, tender.description.fr,
        tender.buyerName, tender.procurementCategory, tender.procurementCode, tender.estimatedValueCents, tender.currency ?? "CAD",
        tender.publishedAt, tender.closingAt, tender.sourceUrl, JSON.stringify(tender.rawPayload)]
    );
  } else {
    const inserted = await client.query<{ id: string }>(
      `insert into tenders (source, source_record_id, solicitation_number, title_en, title_fr, description_en, description_fr,
       buyer_name, procurement_category, procurement_code, estimated_value_cents, currency, published_at, closing_at,
       source_url, raw_payload, canonical_fingerprint, first_seen_at, last_seen_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,now(),now(),now()) returning id`,
      [tender.source, tender.sourceRecordId, tender.solicitationNumber, tender.title.en, tender.title.fr, tender.description.en,
        tender.description.fr, tender.buyerName, tender.procurementCategory, tender.procurementCode, tender.estimatedValueCents,
        tender.currency ?? "CAD", tender.publishedAt, tender.closingAt, tender.sourceUrl, JSON.stringify(tender.rawPayload), canonical]
    );
    tenderId = inserted.rows[0].id;
    isNewTender = true;
  }

  await client.query(
    `insert into tender_source_references (tender_id, source_key, source_record_id, source_url, metadata)
     values ($1,$2,$3,$4,$5::jsonb)
     on conflict (source_key, source_record_id) do update set tender_id=excluded.tender_id, source_url=excluded.source_url, last_seen_at=now(), metadata=excluded.metadata`,
    [tenderId, tender.source, tender.sourceRecordId, tender.sourceUrl, JSON.stringify({ solicitationNumber: tender.solicitationNumber })]
  );

  const priorRevision = await client.query<{ snapshot: Record<string, unknown> }>(
    `select snapshot from tender_revisions where tender_id=$1 order by detected_at desc limit 1`, [tenderId]
  );
  const isNewRevision = !(await client.query(`select 1 from tender_revisions where tender_id=$1 and content_hash=$2`, [tenderId, revisionHash])).rowCount;
  const changeTypes = tenderChangeTypes(priorRevision.rows[0]?.snapshot ?? previous, tender);
  if (isNewRevision) {
    const snapshot = { title_en: tender.title.en, title_fr: tender.title.fr, description_en: tender.description.en, description_fr: tender.description.fr, estimated_value_cents: tender.estimatedValueCents, closing_at: tender.closingAt, raw_payload: tender.rawPayload };
    await client.query(
      `insert into tender_revisions (tender_id, source_key, source_revision, content_hash, change_types, snapshot, source_url, published_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [tenderId, tender.source, tender.rawPayload.revision ?? null, revisionHash, changeTypes, JSON.stringify(snapshot), tender.sourceUrl, tender.publishedAt]
    );
    if (!isNewTender) await client.query(`update tenders set amendment_at=now() where id=$1`, [tenderId]);
  }
  return { tenderId, revisionHash, isNewTender, isNewRevision, changeTypes };
}

export async function enqueueTenderAnalysis(client: PoolClient, result: CanonicalUpsertResult): Promise<void> {
  if (!result.isNewRevision) return;
  const organizations = await client.query<{ organization_id: string }>("select id as organization_id from organizations");
  for (const organization of organizations.rows) {
    await enqueueTenderAnalysisForOrganization(client, result, organization.organization_id);
  }
}

export async function enqueueTenderAnalysisForOrganization(client: PoolClient, result: CanonicalUpsertResult, organizationId: string, options: { force?: boolean } = {}): Promise<void> {
  if (!result.isNewRevision && !options.force) return;
    await client.query(
      `insert into organization_tenders (organization_id, tender_id, status, updated_at) values ($1,$2,'new',now())
       on conflict (organization_id, tender_id) do update set updated_at=now()`,
      [organizationId, result.tenderId]
    );
    await client.query(
      `insert into tender_processing_jobs (organization_id, tender_id, job_type, source_fingerprint, status, stage, next_run_at)
       values ($1,$2,'analyze_tender',$3,'queued','queued',now())
       on conflict (organization_id, tender_id, job_type, source_fingerprint) do nothing`,
      [organizationId, result.tenderId, result.revisionHash]
    );
    if (result.isNewRevision && !result.isNewTender && result.changeTypes.includes("deadline")) {
      await client.query(
        `insert into notifications (organization_id, tender_id, kind, title_en, body_en)
         values ($1,$2,'deadline_changed','Tender deadline changed','A connected source reported a new closing deadline. Review the latest tender revision.')
         on conflict (organization_id, tender_id, kind) do update set body_en=excluded.body_en, read_at=null, created_at=now()`,
        [organizationId, result.tenderId]
      );
    } else if (result.isNewRevision && !result.isNewTender) {
      await client.query(
        `insert into notifications (organization_id, tender_id, kind, title_en, body_en)
         values ($1,$2,'amendment','Tender amendment detected','A connected source reported a new tender revision. The analysis has been queued again.')
         on conflict (organization_id, tender_id, kind) do update set body_en=excluded.body_en, read_at=null, created_at=now()`,
        [organizationId, result.tenderId]
      );
    }
}
