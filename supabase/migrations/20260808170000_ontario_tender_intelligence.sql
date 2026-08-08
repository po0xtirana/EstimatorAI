-- Ontario tender intelligence: lawful source registry, canonical opportunities,
-- revision history, company source connections, and relevance feedback.

create table tender_sources (
  source_key text primary key check (source_key ~ '^[a-z0-9-]+$'),
  name text not null,
  jurisdiction text not null default 'Ontario',
  source_category text not null check (source_category in ('federal', 'provincial', 'municipal', 'broader_public_sector', 'commercial', 'email')),
  access_mode text not null check (access_mode in ('public_feed', 'licensed', 'customer_authorized', 'email_forwarding')),
  connector_kind text not null check (connector_kind in ('canadabuys_csv', 'generic_csv', 'json_feed', 'rss_feed', 'email', 'restricted_portal')),
  base_url text,
  coverage_label text not null,
  scan_interval_minutes integer not null default 360 check (scan_interval_minutes between 60 and 1440),
  enabled boolean not null default false,
  connection_status text not null default 'planned' check (connection_status in ('connected', 'connection_required', 'planned', 'paused', 'outage')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  next_scan_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into tender_sources (source_key, name, jurisdiction, source_category, access_mode, connector_kind, base_url, coverage_label, scan_interval_minutes, enabled, connection_status) values
  ('canadabuys', 'CanadaBuys', 'Canada', 'federal', 'public_feed', 'canadabuys_csv', 'https://canadabuys.canada.ca/', 'Federal tender notices and amendments', 360, true, 'connected'),
  ('ontario-tenders-portal', 'Ontario Tenders Portal', 'Ontario', 'provincial', 'customer_authorized', 'restricted_portal', 'https://ontariotenders.app.jaggaer.com/', 'Ontario ministries and participating agencies', 360, false, 'connection_required'),
  ('bidsandtenders', 'Bids&Tenders buyer portals', 'Ontario', 'municipal', 'licensed', 'restricted_portal', 'https://www.bidsandtenders.ca/', 'Connected municipalities, school boards, and public agencies', 360, false, 'connection_required'),
  ('merx', 'MERX', 'Canada', 'commercial', 'licensed', 'restricted_portal', 'https://www.merx.com/', 'Licensed public and private opportunities', 360, false, 'connection_required'),
  ('biddingo', 'Biddingo', 'Canada', 'commercial', 'licensed', 'restricted_portal', 'https://www.biddingo.com/', 'Licensed public-sector opportunities', 360, false, 'connection_required'),
  ('bonfire', 'Bonfire buyer portals', 'Ontario', 'broader_public_sector', 'customer_authorized', 'restricted_portal', 'https://gobonfire.com/', 'Customer-authorized institutional buyer portals', 360, false, 'connection_required'),
  ('estimating-inbox', 'Estimating inbox', 'Ontario', 'email', 'email_forwarding', 'email', null, 'Tender invitations and addenda forwarded by the contractor', 60, false, 'connection_required'),
  ('seao', 'SEAO (legacy)', 'Quebec', 'provincial', 'customer_authorized', 'restricted_portal', 'https://www.seao.ca/', 'Legacy source retained for existing records', 360, false, 'paused')
on conflict (source_key) do update set
  name = excluded.name,
  coverage_label = excluded.coverage_label,
  base_url = excluded.base_url,
  updated_at = now();

alter table tenders
  drop constraint if exists tenders_source_check;

alter table tenders
  add column if not exists canonical_fingerprint text,
  add column if not exists source_revision text,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists amendment_at timestamptz,
  add column if not exists region_keys text[] not null default '{}',
  add column if not exists project_type text;

update tenders
set canonical_fingerprint = encode(digest(lower(source || '|' || source_record_id), 'sha256'), 'hex')
where canonical_fingerprint is null;

alter table tenders alter column canonical_fingerprint set not null;
create unique index if not exists tenders_canonical_fingerprint_uidx on tenders (canonical_fingerprint);
create index if not exists tenders_last_seen_idx on tenders (last_seen_at desc);
create index if not exists tenders_amendment_idx on tenders (amendment_at desc nulls last);

create table tender_source_references (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  source_key text not null references tender_sources(source_key) on delete restrict,
  source_record_id text not null,
  source_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (source_key, source_record_id)
);

insert into tender_source_references (tender_id, source_key, source_record_id, source_url, first_seen_at, last_seen_at)
select id, source, source_record_id, source_url, ingested_at, updated_at from tenders
on conflict (source_key, source_record_id) do nothing;

create table tender_revisions (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  source_key text not null references tender_sources(source_key) on delete restrict,
  source_revision text,
  content_hash text not null,
  change_types text[] not null default '{}',
  snapshot jsonb not null,
  source_url text,
  published_at timestamptz,
  detected_at timestamptz not null default now(),
  unique (tender_id, content_hash)
);

insert into tender_revisions (tender_id, source_key, source_revision, content_hash, change_types, snapshot, source_url, published_at, detected_at)
select id, source, source_revision,
       encode(digest(raw_payload::text, 'sha256'), 'hex'),
       array['initial'],
       jsonb_build_object('title_en', title_en, 'title_fr', title_fr, 'buyer_name', buyer_name, 'closing_at', closing_at, 'raw_payload', raw_payload),
       source_url, published_at, ingested_at
from tenders
on conflict (tender_id, content_hash) do nothing;

create table organization_tender_source_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_key text not null references tender_sources(source_key) on delete cascade,
  status text not null default 'connection_required' check (status in ('connected', 'connection_required', 'verifying', 'paused', 'error')),
  connection_type text not null check (connection_type in ('platform', 'licensed', 'authorized_credentials', 'email_forwarding')),
  forwarding_address text,
  secret_hash text,
  configuration jsonb not null default '{}'::jsonb,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_key)
);

insert into organization_tender_source_connections (organization_id, source_key, status, connection_type)
select id, 'canadabuys', 'connected', 'platform' from organizations
on conflict (organization_id, source_key) do nothing;

create table tender_relevance_feedback (
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  label text not null check (label in ('relevant', 'not_relevant')),
  reason text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, tender_id)
);

create table organization_match_preferences (
  organization_id uuid primary key references organizations(id) on delete cascade,
  preferred_buyers text[] not null default '{}',
  preferred_project_types text[] not null default '{}',
  excluded_terms text[] not null default '{}',
  maximum_project_size_cents bigint check (maximum_project_size_cents is null or maximum_project_size_cents >= 0),
  learned_positive_terms jsonb not null default '{}'::jsonb,
  learned_negative_terms jsonb not null default '{}'::jsonb,
  feedback_count integer not null default 0 check (feedback_count >= 0),
  updated_at timestamptz not null default now()
);

alter table organization_tenders
  add column if not exists decision text check (decision is null or decision in ('viable', 'review', 'not_viable')),
  add column if not exists recommended_action text,
  add column if not exists urgency text check (urgency is null or urgency in ('low', 'normal', 'high', 'critical')),
  add column if not exists estimating_effort_minutes integer check (estimating_effort_minutes is null or estimating_effort_minutes >= 0),
  add column if not exists updated_at timestamptz not null default now();

alter table tender_analyses
  add column if not exists project_type text,
  add column if not exists urgency text check (urgency is null or urgency in ('low', 'normal', 'high', 'critical')),
  add column if not exists expected_estimating_effort_minutes integer check (expected_estimating_effort_minutes is null or expected_estimating_effort_minutes >= 0),
  add column if not exists recommended_action text;

alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in ('match_threshold', 'ingestion_failed', 'amendment', 'deadline_changed', 'source_outage', 'system'));

alter table ingestion_runs drop constraint if exists ingestion_runs_source_check;

create index if not exists tender_source_references_tender_idx on tender_source_references (tender_id);
create index if not exists tender_revisions_tender_idx on tender_revisions (tender_id, detected_at desc);
create index if not exists tender_feedback_org_label_idx on tender_relevance_feedback (organization_id, label);
create index if not exists source_connections_org_idx on organization_tender_source_connections (organization_id, status);

alter table tender_sources enable row level security;
alter table tender_source_references enable row level security;
alter table tender_revisions enable row level security;
alter table organization_tender_source_connections enable row level security;
alter table tender_relevance_feedback enable row level security;
alter table organization_match_preferences enable row level security;
alter table tender_sources force row level security;
alter table tender_source_references force row level security;
alter table tender_revisions force row level security;
alter table organization_tender_source_connections force row level security;
alter table tender_relevance_feedback force row level security;
alter table organization_match_preferences force row level security;

-- Global source/revision tables are deliberately service-role only. Tenant rows
-- use the same explicit organization boundary as the rest of the application.
create policy source_connections_org_isolation on organization_tender_source_connections
  using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy tender_relevance_feedback_org_isolation on tender_relevance_feedback
  using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy organization_match_preferences_org_isolation on organization_match_preferences
  using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());

revoke all on tender_sources, tender_source_references, tender_revisions from anon, authenticated;
grant all on tender_sources, tender_source_references, tender_revisions to service_role;
grant select, insert, update, delete on organization_tender_source_connections, tender_relevance_feedback, organization_match_preferences to authenticated;
grant all on organization_tender_source_connections, tender_relevance_feedback, organization_match_preferences to service_role;

