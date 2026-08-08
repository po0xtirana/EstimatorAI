import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var estimatorAiPool: Pool | undefined;
}

export function applicationPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for tender intake");
  if (!globalThis.estimatorAiPool) {
    globalThis.estimatorAiPool = new Pool({ connectionString, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  }
  return globalThis.estimatorAiPool;
}
