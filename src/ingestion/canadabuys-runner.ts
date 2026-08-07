import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { normalizeCanadaBuysCsvWithStats, type NormalizedTender } from "./canadabuys";

const DATASET_ID = "6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2";
const OPEN_DATA_API = `https://open.canada.ca/data/api/action/package_show?id=${DATASET_ID}`;
const CLIENT_HEADERS = {
  accept: "text/csv, application/octet-stream;q=0.9, */*;q=0.1",
  "user-agent": "BidPilot/0.1 (Canadian open-data ingestion)"
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function resolveCanadaBuysCsvUrl(fetchImpl: FetchLike = fetch): Promise<string> {
  const response = await fetchImpl(OPEN_DATA_API, { headers: { ...CLIENT_HEADERS, accept: "application/json" } });
  if (!response.ok) throw new Error(`CanadaBuys metadata request failed: HTTP ${response.status}`);
  const payload = await response.json() as { success?: boolean; result?: { resources?: Array<{ url?: string; format?: string; name?: string }> } };
  const resources = payload.result?.resources ?? [];
  const currentCsv = resources.find((resource) => {
    const text = `${resource.name ?? ""} ${resource.url ?? ""}`.toLowerCase();
    return resource.format?.toLowerCase() === "csv" && text.includes("open tender notices");
  }) ?? resources.find((resource) => {
    const text = `${resource.name ?? ""} ${resource.url ?? ""}`.toLowerCase();
    return resource.format?.toLowerCase() === "csv" && text.includes("new tender notices");
  }) ?? resources.find((resource) => {
    const text = `${resource.name ?? ""} ${resource.url ?? ""}`.toLowerCase();
    return resource.format?.toLowerCase() === "csv" && text.includes("tender") && !text.includes("archived");
  });
  if (!currentCsv?.url) throw new Error("No current CanadaBuys tender CSV resource was found in the official dataset metadata");
  return currentCsv.url;
}

async function upsertTender(client: PoolClient, tender: NormalizedTender): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into tenders (
      source, source_record_id, solicitation_number, title_en, title_fr,
      description_en, description_fr, buyer_name, procurement_category,
      procurement_code, estimated_value_cents, currency, published_at, closing_at, source_url,
      raw_payload, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,now())
    on conflict (source, source_record_id) do update set
      solicitation_number = excluded.solicitation_number,
      title_en = excluded.title_en, title_fr = excluded.title_fr,
      description_en = excluded.description_en, description_fr = excluded.description_fr,
      buyer_name = excluded.buyer_name, procurement_category = excluded.procurement_category,
      procurement_code = excluded.procurement_code, estimated_value_cents = excluded.estimated_value_cents,
      currency = excluded.currency, published_at = excluded.published_at, closing_at = excluded.closing_at, source_url = excluded.source_url,
      raw_payload = excluded.raw_payload, updated_at = now()
    returning id`,
    [
      tender.source, tender.sourceRecordId, tender.solicitationNumber, tender.title.en, tender.title.fr,
      tender.description.en, tender.description.fr, tender.buyerName, tender.procurementCategory,
      tender.procurementCode, tender.estimatedValueCents, tender.currency ?? "CAD", tender.publishedAt, tender.closingAt,
      tender.sourceUrl, JSON.stringify(tender.rawPayload)
    ]
  );
  return result.rows[0].id;
}

function sourceFingerprint(tender: NormalizedTender): string {
  return createHash("sha256").update(JSON.stringify({ titleEn: tender.title.en, titleFr: tender.title.fr, descriptionEn: tender.description.en, descriptionFr: tender.description.fr, sourceUrl: tender.sourceUrl, rawPayload: tender.rawPayload })).digest("hex");
}

async function enqueueTenderJobs(client: PoolClient, tenderId: string, fingerprint: string): Promise<void> {
  const organizations = await client.query<{ organization_id: string }>("select id as organization_id from organizations");
  for (const organization of organizations.rows) {
    await client.query(
      `insert into organization_tenders (organization_id, tender_id, status)
       values ($1, $2, 'new')
       on conflict (organization_id, tender_id) do nothing`,
      [organization.organization_id, tenderId]
    );
    await client.query(
      `insert into tender_processing_jobs (organization_id, tender_id, job_type, source_fingerprint, status, stage, next_run_at)
       values ($1, $2, 'analyze_tender', $3, 'queued', 'queued', now())
       on conflict (organization_id, tender_id, job_type, source_fingerprint) do nothing`,
      [organization.organization_id, tenderId, fingerprint]
    );
  }
}

export async function runCanadaBuysIngestion(options: {
  databaseUrl: string;
  datasetUrl?: string;
  fetchImpl?: FetchLike;
  pool?: Pool;
}): Promise<{ datasetUrl: string; rowsSeen: number; rowsAvailable: number; rowsSelected: number; rowsNormalized: number; rowsRejected: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const datasetUrl = options.datasetUrl || await resolveCanadaBuysCsvUrl(fetchImpl);
  const response = await fetchImpl(datasetUrl, { headers: CLIENT_HEADERS });
  if (!response.ok) throw new Error(`CanadaBuys CSV download failed: HTTP ${response.status}`);
  const csv = await response.text();
  const stats = normalizeCanadaBuysCsvWithStats(csv);
  const pool = options.pool ?? new Pool({ connectionString: options.databaseUrl, max: 4 });
  const client = await pool.connect();
  let runId: string | undefined;
  try {
    await client.query("begin");
    const run = await client.query<{ id: string }>(
      `insert into ingestion_runs (source, dataset_url, rows_seen, rows_normalized, rows_selected, rows_rejected)
       values ('canadabuys', $1, $2, $3, $4, $5) returning id`,
      [datasetUrl, stats.rowsSeen, stats.records.length, stats.records.length, stats.rowsRejected]
    );
    runId = run.rows[0].id;
    for (const tender of stats.records) {
      const tenderId = await upsertTender(client, tender);
      await enqueueTenderJobs(client, tenderId, sourceFingerprint(tender));
    }
    await client.query("update ingestion_runs set status = 'succeeded', completed_at = now() where id = $1", [runId]);
    await client.query("commit");
    return { datasetUrl, rowsSeen: stats.rowsSeen, rowsAvailable: stats.records.length, rowsSelected: stats.records.length, rowsNormalized: stats.records.length, rowsRejected: stats.rowsRejected };
  } catch (error) {
    await client.query("rollback");
    await client.query(
      `insert into ingestion_runs (source, dataset_url, rows_seen, rows_normalized, rows_selected, rows_rejected, status, completed_at, error_message)
       values ('canadabuys', $1, $2, $3, $4, $5, 'failed', now(), $6)`,
      [datasetUrl, stats.rowsSeen, stats.records.length, stats.records.length, stats.rowsRejected, error instanceof Error ? error.message : String(error)]
    );
    throw error;
  } finally {
    client.release();
    if (!options.pool) await pool.end();
  }
}
