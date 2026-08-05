create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid references tenders(id) on delete set null,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'bid', 'active', 'complete', 'archived')),
  created_at timestamptz not null default now()
);

create table project_cost_overrides (
  project_id uuid primary key references projects(id) on delete cascade,
  profile_version_id uuid not null references cost_profile_versions(id) on delete restrict,
  markup_percent numeric(8,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table project_labor_overrides (
  project_id uuid not null references projects(id) on delete cascade,
  role_key text not null,
  hourly_cost_cents bigint not null check (hourly_cost_cents >= 0),
  primary key (project_id, role_key)
);

create table project_material_overrides (
  project_id uuid not null references projects(id) on delete cascade,
  material_key text not null,
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  primary key (project_id, material_key)
);

create table project_overhead_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label_en text not null,
  label_fr text,
  amount_cents bigint not null check (amount_cents >= 0)
);

alter table projects enable row level security;
alter table project_cost_overrides enable row level security;
alter table project_labor_overrides enable row level security;
alter table project_material_overrides enable row level security;
alter table project_overhead_overrides enable row level security;
alter table projects force row level security;
alter table project_cost_overrides force row level security;
alter table project_labor_overrides force row level security;
alter table project_material_overrides force row level security;
alter table project_overhead_overrides force row level security;

create policy projects_org_isolation on projects using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy project_cost_overrides_org_isolation on project_cost_overrides using (exists (select 1 from projects p where p.id = project_id and p.organization_id = current_organization_id())) with check (exists (select 1 from projects p where p.id = project_id and p.organization_id = current_organization_id()));
create policy project_labor_overrides_org_isolation on project_labor_overrides using (exists (select 1 from projects p where p.id = project_id and p.organization_id = current_organization_id())) with check (exists (select 1 from projects p where p.id = project_id and p.organization_id = current_organization_id()));
create policy project_material_overrides_org_isolation on project_material_overrides using (exists (select 1 from projects p where p.id = project_id and p.organization_id = current_organization_id())) with check (exists (select 1 from projects p where p.id = project_id and p.organization_id = current_organization_id()));
create policy project_overhead_overrides_org_isolation on project_overhead_overrides using (exists (select 1 from projects p where p.id = project_id and p.organization_id = current_organization_id())) with check (exists (select 1 from projects p where p.id = project_id and p.organization_id = current_organization_id()));
