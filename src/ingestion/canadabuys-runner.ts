import { Pool } from "pg";
import { normalizeCanadaBuysCsvWithStats } from "./canadabuys";
import { enqueueTenderAnalysis, upsertCanonicalTender } from "./tender-intelligence";

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
      const canonical = await upsertCanonicalTender(client, tender);
      await enqueueTenderAnalysis(client, canonical);
    }
    await client.query("update ingestion_runs set status = 'succeeded', completed_at = now() where id = $1", [runId]);
    await client.query("update tender_sources set last_attempt_at=now(), last_success_at=now(), last_error=null, next_scan_at=now() + make_interval(mins => scan_interval_minutes), connection_status='connected', updated_at=now() where source_key='canadabuys'");
    await client.query("commit");
    return { datasetUrl, rowsSeen: stats.rowsSeen, rowsAvailable: stats.records.length, rowsSelected: stats.records.length, rowsNormalized: stats.records.length, rowsRejected: stats.rowsRejected };
  } catch (error) {
    await client.query("rollback");
    await client.query("update tender_sources set last_attempt_at=now(), last_error=$1, connection_status='outage', updated_at=now() where source_key='canadabuys'", [error instanceof Error ? error.message : String(error)]).catch(() => undefined);
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
