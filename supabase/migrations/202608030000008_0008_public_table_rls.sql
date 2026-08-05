-- Security hardening for Supabase's exposed public schema.
-- trade_catalog is safe for authenticated/public read; tender and ingestion
-- records must remain backend/service-role-only until organization read paths
-- are implemented.

alter table trade_catalog enable row level security;
create policy trade_catalog_public_read on trade_catalog
  for select using (active = true);

alter table tenders enable row level security;
alter table ingestion_runs enable row level security;

-- Intentionally no anon/authenticated policies for tenders or ingestion_runs.
-- Backend service-role operations bypass RLS; client access must go through
-- organization-scoped API paths after auth is wired.
