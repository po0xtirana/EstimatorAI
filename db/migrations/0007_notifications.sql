create table notification_preferences (
  organization_id uuid primary key references organizations(id) on delete cascade,
  match_threshold numeric(5,2) not null default 70 check (match_threshold >= 0 and match_threshold <= 100),
  email_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid references tenders(id) on delete cascade,
  kind text not null check (kind in ('match_threshold', 'ingestion_failed', 'system')),
  title_en text not null,
  title_fr text,
  body_en text not null,
  body_fr text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, tender_id, kind)
);

alter table notification_preferences enable row level security;
alter table notifications enable row level security;
alter table notification_preferences force row level security;
alter table notifications force row level security;
create policy notification_preferences_org_isolation on notification_preferences using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy notifications_org_isolation on notifications using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
