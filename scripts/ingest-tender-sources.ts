import { Pool } from "pg";
import { runCanadaBuysIngestion } from "../src/ingestion/canadabuys-runner";

type Source = { source_key: string; connector_kind: string; metadata: Record<string, unknown> };

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  try {
    const result = await pool.query<Source>("select source_key, connector_kind, metadata from tender_sources where enabled=true and (next_scan_at is null or next_scan_at <= now()) order by source_key");
    const outcomes: Array<Record<string, unknown>> = [];
    for (const source of result.rows) {
      if (source.connector_kind === "canadabuys_csv") {
        outcomes.push({ source: source.source_key, ...(await runCanadaBuysIngestion({ databaseUrl, datasetUrl: process.env.CANADABUYS_TENDER_CSV_URL, pool })) });
        continue;
      }
      const message = `No deployed connector is configured for ${source.connector_kind}; source remains visible instead of being silently skipped.`;
      await pool.query("update tender_sources set last_attempt_at=now(), last_error=$2, connection_status='outage', updated_at=now() where source_key=$1", [source.source_key, message]);
      outcomes.push({ source: source.source_key, status: "not_configured", message });
    }
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), sources: outcomes }));
  } finally { await pool.end(); }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
