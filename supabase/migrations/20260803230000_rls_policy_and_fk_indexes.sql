-- Explicitly deny direct Data API access to operational/global records.
-- Server-side service-role code bypasses RLS and remains the only access path.
create policy tenders_no_direct_client_access on tenders
  for all using (false) with check (false);
create policy ingestion_runs_no_direct_client_access on ingestion_runs
  for all using (false) with check (false);

-- Prevent role-controlled search_path changes from affecting this helper.
alter function public.current_organization_id() set search_path to pg_catalog, public;

create index contracts_organization_id_idx on contracts (organization_id);
create index contracts_tender_id_idx on contracts (tender_id);
create index contracts_project_id_idx on contracts (project_id);
create index notifications_tender_id_idx on notifications (tender_id);
create index organization_tenders_tender_id_idx on organization_tenders (tender_id);
create index organization_trades_trade_id_idx on organization_trades (trade_id);
create index overhead_cost_lines_profile_version_id_idx on overhead_cost_lines (profile_version_id);
create index project_cost_overrides_profile_version_id_idx on project_cost_overrides (profile_version_id);
create index project_overhead_overrides_project_id_idx on project_overhead_overrides (project_id);
create index projects_organization_id_idx on projects (organization_id);
create index projects_tender_id_idx on projects (tender_id);
create index tender_matches_tender_id_idx on tender_matches (tender_id);
create index trade_catalog_parent_slug_idx on trade_catalog (parent_slug);
