-- Versioned, reviewable snapshots for changes learned from completed jobs.
create table trade_profile_assumption_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trade_profile_id uuid not null references trade_profiles(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  source text not null check (source in ('manual', 'actuals_learning')),
  change_reason text not null,
  created_by text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (trade_profile_id, version_number)
);

create index trade_profile_assumption_versions_profile_idx on trade_profile_assumption_versions (trade_profile_id, created_at desc);
create index trade_profile_assumption_versions_org_idx on trade_profile_assumption_versions (organization_id);

alter table trade_profile_assumption_versions enable row level security;
alter table trade_profile_assumption_versions force row level security;
create policy trade_profile_assumption_versions_org_isolation on trade_profile_assumption_versions
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
