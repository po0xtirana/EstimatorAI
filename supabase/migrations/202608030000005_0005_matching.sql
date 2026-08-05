create table organization_capability_profiles (
  organization_id uuid primary key references organizations(id) on delete cascade,
  bonding_capacity_cents bigint check (bonding_capacity_cents is null or bonding_capacity_cents >= 0),
  available_crew_size integer check (available_crew_size is null or available_crew_size >= 0),
  pipeline_load_percent numeric(5,2) check (pipeline_load_percent is null or (pipeline_load_percent >= 0 and pipeline_load_percent <= 100)),
  updated_at timestamptz not null default now()
);

create table organization_certifications (
  organization_id uuid not null references organizations(id) on delete cascade,
  certification_key text not null,
  name_en text not null,
  name_fr text,
  primary key (organization_id, certification_key)
);

create table organization_regions (
  organization_id uuid not null references organizations(id) on delete cascade,
  region_key text not null,
  name_en text not null,
  name_fr text,
  primary key (organization_id, region_key)
);

create table tender_matches (
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  score numeric(5,2) not null check (score >= 0 and score <= 100),
  components jsonb not null,
  explanation text not null,
  computed_at timestamptz not null default now(),
  primary key (organization_id, tender_id)
);

alter table organization_capability_profiles enable row level security;
alter table organization_certifications enable row level security;
alter table organization_regions enable row level security;
alter table tender_matches enable row level security;
alter table organization_capability_profiles force row level security;
alter table organization_certifications force row level security;
alter table organization_regions force row level security;
alter table tender_matches force row level security;

create policy capability_profile_org_isolation on organization_capability_profiles using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy certification_org_isolation on organization_certifications using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy region_org_isolation on organization_regions using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy tender_match_org_isolation on tender_matches using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
