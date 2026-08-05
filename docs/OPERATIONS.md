# Automated CanadaBuys ingestion

## Local run

1. Apply `db/migrations/0001_phase0_foundation.sql`, `0002_ingestion_runs.sql` to PostgreSQL.
2. Set `DATABASE_URL`.
3. Run `npm run ingest:canadabuys`.

`CANADABUYS_TENDER_CSV_URL` is optional. When omitted, the worker resolves the current non-archived tender CSV from the official Open Government catalog. Every request uses an identified User-Agent because the CanadaBuys CSV endpoint rejects anonymous automated requests.

## Supabase runtime configuration

The dedicated BidPilot project is `uenlzatwyhvnccvtlmor` in Canada Central. Copy `.env.example` to `.env.local`, then supply `SUPABASE_SECRET_KEY` from the project's Supabase API Keys page. Keep that key server-only; it is needed for organization membership lookup and backend ingestion, while the publishable key is safe for the browser.

## Scheduled run

`.github/workflows/canadabuys-ingestion.yml` runs every two hours and can also be dispatched manually. Configure these repository secrets:

- `DATABASE_URL`
- `CANADABUYS_TENDER_CSV_URL` (optional; omit to use metadata discovery)

The worker records successful and failed ingestion runs, preserves the raw source row, rejects only records with no solicitation/reference identifier or no bilingual title, and upserts on `(source, source_record_id)`.
