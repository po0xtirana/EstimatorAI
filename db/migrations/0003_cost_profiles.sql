create table cost_profile_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  effective_from date not null,
  effective_to date,
  target_markup_percent numeric(8,4) not null default 10 check (target_markup_percent >= 0),
  created_at timestamptz not null default now(),
  unique (organization_id, version_number),
  check (effective_to is null or effective_to >= effective_from)
);

create table staff_cost_rates (
  id uuid primary key default gen_random_uuid(),
  profile_version_id uuid not null references cost_profile_versions(id) on delete cascade,
  role_key text not null,
  role_name_en text not null,
  role_name_fr text,
  hourly_cost_cents bigint not null check (hourly_cost_cents >= 0),
  unique (profile_version_id, role_key)
);

create table material_cost_rates (
  id uuid primary key default gen_random_uuid(),
  profile_version_id uuid not null references cost_profile_versions(id) on delete cascade,
  material_key text not null,
  material_name_en text not null,
  material_name_fr text,
  unit text not null,
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  is_suggested_baseline boolean not null default false,
  unique (profile_version_id, material_key)
);

create table overhead_cost_lines (
  id uuid primary key default gen_random_uuid(),
  profile_version_id uuid not null references cost_profile_versions(id) on delete cascade,
  label_en text not null,
  label_fr text,
  amount_cents bigint not null check (amount_cents >= 0)
);

create table productivity_assumptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  task_type_key text not null,
  task_name_en text not null,
  task_name_fr text,
  unit text not null,
  labor_hours_per_unit numeric(12,4) not null check (labor_hours_per_unit >= 0),
  unique (organization_id, task_type_key)
);

alter table cost_profile_versions enable row level security;
alter table staff_cost_rates enable row level security;
alter table material_cost_rates enable row level security;
alter table overhead_cost_lines enable row level security;
alter table productivity_assumptions enable row level security;
alter table cost_profile_versions force row level security;
alter table staff_cost_rates force row level security;
alter table material_cost_rates force row level security;
alter table overhead_cost_lines force row level security;
alter table productivity_assumptions force row level security;

create policy cost_profile_versions_org_isolation on cost_profile_versions using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy productivity_assumptions_org_isolation on productivity_assumptions using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy staff_cost_rates_org_isolation on staff_cost_rates using (exists (select 1 from cost_profile_versions p where p.id = profile_version_id and p.organization_id = current_organization_id())) with check (exists (select 1 from cost_profile_versions p where p.id = profile_version_id and p.organization_id = current_organization_id()));
create policy material_cost_rates_org_isolation on material_cost_rates using (exists (select 1 from cost_profile_versions p where p.id = profile_version_id and p.organization_id = current_organization_id())) with check (exists (select 1 from cost_profile_versions p where p.id = profile_version_id and p.organization_id = current_organization_id()));
create policy overhead_cost_lines_org_isolation on overhead_cost_lines using (exists (select 1 from cost_profile_versions p where p.id = profile_version_id and p.organization_id = current_organization_id())) with check (exists (select 1 from cost_profile_versions p where p.id = profile_version_id and p.organization_id = current_organization_id()));
