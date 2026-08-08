-- Organization-specific tender inboxes for portal notifications and tender
-- invitations. Resend verifies the public webhook before any row is written.

alter table organization_tender_source_connections
  add column if not exists verified_at timestamptz,
  add column if not exists last_email_at timestamptz,
  add column if not exists processed_email_count integer not null default 0 check (processed_email_count >= 0),
  add column if not exists revoked_at timestamptz;

create table tender_email_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid not null references organization_tender_source_connections(id) on delete cascade,
  source_key text not null references tender_sources(source_key) on delete restrict,
  provider text not null default 'resend' check (provider in ('resend')),
  provider_event_id text not null,
  provider_email_id text not null,
  message_id text,
  sender text,
  recipients text[] not null default '{}',
  subject text,
  status text not null default 'received' check (status in ('received', 'processing', 'processed', 'failed')),
  tender_id uuid references tenders(id) on delete set null,
  attachment_count integer not null default 0 check (attachment_count >= 0),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_event_id),
  unique (provider, provider_email_id, connection_id)
);

create index tender_email_events_org_received_idx on tender_email_events (organization_id, received_at desc);
create index tender_email_events_connection_idx on tender_email_events (connection_id, received_at desc);
create index tender_email_events_tender_idx on tender_email_events (tender_id) where tender_id is not null;

alter table tender_email_events enable row level security;
alter table tender_email_events force row level security;

-- Intake details can contain confidential invitation metadata. They remain
-- server-only; organization users access summarized status through scoped APIs.
revoke all on tender_email_events from anon, authenticated;
grant all on tender_email_events to service_role;

comment on table tender_email_events is 'Immutable, idempotent intake log for verified inbound tender-notification emails.';
comment on column organization_tender_source_connections.secret_hash is 'SHA-256 hash of the random routing token embedded in the private inbound address.';

create or replace function increment_tender_connection_email_count(connection_id_input uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update organization_tender_source_connections
  set processed_email_count = processed_email_count + 1,
      updated_at = now()
  where id = connection_id_input;
$$;

revoke all on function increment_tender_connection_email_count(uuid) from public, anon, authenticated;
grant execute on function increment_tender_connection_email_count(uuid) to service_role;
