-- Make the server-only boundary explicit to the advisor and index every FK.

create index if not exists tender_email_events_source_idx on tender_email_events (source_key);

create policy tender_email_events_service_role_only on tender_email_events
  for all
  to service_role
  using (true)
  with check (true);
