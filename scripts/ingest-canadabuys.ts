import { runCanadaBuysIngestion } from "../src/ingestion/canadabuys-runner";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const result = await runCanadaBuysIngestion({
    databaseUrl,
    datasetUrl: process.env.CANADABUYS_TENDER_CSV_URL
  });
  console.log(JSON.stringify({ source: "canadabuys", ...result }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
