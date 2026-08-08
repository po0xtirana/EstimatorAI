-- Explicit deny policies keep global ingestion data service-role only while
-- satisfying the database advisor's expectation that every RLS table has a policy.

create policy tender_sources_service_only on tender_sources
  for all to anon, authenticated using (false) with check (false);
create policy tender_source_references_service_only on tender_source_references
  for all to anon, authenticated using (false) with check (false);
create policy tender_revisions_service_only on tender_revisions
  for all to anon, authenticated using (false) with check (false);

