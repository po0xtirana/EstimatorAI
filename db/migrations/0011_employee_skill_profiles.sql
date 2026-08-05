create table organization_staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  role_title text not null check (length(trim(role_title)) > 0),
  skill_summary text not null default '',
  classified_skills text[] not null default '{}',
  skill_confidence numeric(5,2),
  hourly_cost_cents bigint not null default 0 check (hourly_cost_cents >= 0),
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index organization_staff_organization_id_idx on organization_staff (organization_id);
alter table organization_staff enable row level security;
alter table organization_staff force row level security;
create policy organization_staff_org_isolation on organization_staff using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
