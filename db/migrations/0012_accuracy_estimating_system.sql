-- Accuracy-first trade profiles, evidence-backed scope, estimate runs, and actuals.

create table trade_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trade_slug text not null references trade_catalog(slug) on delete restrict,
  name text not null,
  active boolean not null default true,
  service_radius_km numeric(10,2) check (service_radius_km is null or service_radius_km >= 0),
  minimum_project_size_cents bigint check (minimum_project_size_cents is null or minimum_project_size_cents >= 0),
  target_markup_percent numeric(8,4) not null default 10 check (target_markup_percent >= 0),
  target_margin_percent numeric(8,4) check (target_margin_percent is null or (target_margin_percent >= 0 and target_margin_percent < 100)),
  contingency_percent numeric(8,4) not null default 5 check (contingency_percent >= 0),
  mobilization_cents bigint not null default 0 check (mobilization_cents >= 0),
  travel_cost_per_km_cents bigint not null default 0 check (travel_cost_per_km_cents >= 0),
  working_days_per_week numeric(4,2) not null default 5 check (working_days_per_week > 0 and working_days_per_week <= 7),
  shift_hours numeric(5,2) not null default 8 check (shift_hours > 0 and shift_hours <= 24),
  overtime_multiplier numeric(5,3) not null default 1.5 check (overtime_multiplier >= 1),
  current_pipeline_load_percent numeric(5,2) check (current_pipeline_load_percent is null or (current_pipeline_load_percent >= 0 and current_pipeline_load_percent <= 100)),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, trade_slug)
);

create table trade_profile_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trade_profile_id uuid not null references trade_profiles(id) on delete cascade,
  resource_kind text not null check (resource_kind in ('labor', 'equipment', 'vehicle', 'material', 'subcontractor', 'overhead')),
  resource_key text not null,
  name text not null,
  unit text not null,
  rate_cents bigint not null check (rate_cents >= 0),
  rate_basis text not null check (rate_basis in ('hour', 'day', 'unit', 'lump_sum')),
  available_quantity numeric(12,4) check (available_quantity is null or available_quantity >= 0),
  waste_percent numeric(8,4) not null default 0 check (waste_percent >= 0),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trade_profile_id, resource_kind, resource_key)
);

create table trade_profile_crews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trade_profile_id uuid not null references trade_profiles(id) on delete cascade,
  crew_key text not null,
  name text not null,
  production_factor numeric(8,4) not null default 1 check (production_factor > 0),
  max_crews_available integer check (max_crews_available is null or max_crews_available >= 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (trade_profile_id, crew_key)
);

create table trade_profile_crew_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  crew_id uuid not null references trade_profile_crews(id) on delete cascade,
  role_resource_key text not null,
  headcount integer not null check (headcount > 0),
  skill_slugs text[] not null default '{}',
  unique (crew_id, role_resource_key)
);

create table trade_profile_assemblies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trade_profile_id uuid not null references trade_profiles(id) on delete cascade,
  task_key text not null,
  name text not null,
  unit text not null,
  labor_hours_per_unit numeric(14,6) not null check (labor_hours_per_unit >= 0),
  default_waste_percent numeric(8,4) not null default 0 check (default_waste_percent >= 0),
  preferred_crew_id uuid references trade_profile_crews(id) on delete set null,
  material_components jsonb not null default '[]'::jsonb,
  equipment_components jsonb not null default '[]'::jsonb,
  conditions jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trade_profile_id, task_key)
);

create table tender_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  file_name text not null,
  document_type text not null check (document_type in ('notice', 'specification', 'drawing', 'bill_of_quantities', 'addendum', 'schedule', 'other')),
  version_label text,
  source_url text,
  storage_path text,
  file_hash text,
  processing_status text not null default 'pending' check (processing_status in ('pending', 'processing', 'processed', 'failed', 'needs_review')),
  extracted_text text,
  page_count integer check (page_count is null or page_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tender_scope_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  tender_document_id uuid references tender_documents(id) on delete set null,
  trade_profile_id uuid references trade_profiles(id) on delete set null,
  task_key text,
  description text not null,
  quantity numeric(18,6),
  unit text,
  location text,
  source_page integer,
  evidence_text text,
  confidence numeric(5,2) check (confidence is null or (confidence >= 0 and confidence <= 100)),
  review_status text not null default 'needs_review' check (review_status in ('accepted', 'needs_review', 'rejected')),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table estimate_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid references tenders(id) on delete set null,
  contract_id uuid references contracts(id) on delete set null,
  trade_profile_id uuid not null references trade_profiles(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'rejected', 'superseded')),
  version_number integer not null default 1 check (version_number > 0),
  assumptions jsonb not null default '{}'::jsonb,
  labor_subtotal_cents bigint not null default 0 check (labor_subtotal_cents >= 0),
  material_subtotal_cents bigint not null default 0 check (material_subtotal_cents >= 0),
  equipment_subtotal_cents bigint not null default 0 check (equipment_subtotal_cents >= 0),
  subcontractor_subtotal_cents bigint not null default 0 check (subcontractor_subtotal_cents >= 0),
  overhead_subtotal_cents bigint not null default 0 check (overhead_subtotal_cents >= 0),
  risk_reserve_cents bigint not null default 0 check (risk_reserve_cents >= 0),
  markup_cents bigint not null default 0 check (markup_cents >= 0),
  recommended_price_cents bigint not null default 0 check (recommended_price_cents >= 0),
  confidence_score numeric(5,2) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 100)),
  bid_score numeric(5,2) check (bid_score is null or (bid_score >= 0 and bid_score <= 100)),
  schedule_days numeric(12,2) check (schedule_days is null or schedule_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table estimate_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  estimate_run_id uuid not null references estimate_runs(id) on delete cascade,
  tender_scope_item_id uuid references tender_scope_items(id) on delete set null,
  tender_document_id uuid references tender_documents(id) on delete set null,
  kind text not null check (kind in ('labor', 'material', 'equipment', 'vehicle', 'subcontractor', 'overhead', 'mobilization', 'risk', 'markup')),
  task_key text,
  resource_key text,
  label text not null,
  quantity numeric(18,6) not null default 0 check (quantity >= 0),
  unit text,
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  formula text,
  confidence numeric(5,2) check (confidence is null or (confidence >= 0 and confidence <= 100)),
  source_type text not null check (source_type in ('tender_document', 'company_assumption', 'reviewed_override', 'system_default')),
  source_page integer,
  evidence_text text,
  created_at timestamptz not null default now()
);

create table estimate_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  estimate_run_id uuid not null references estimate_runs(id) on delete cascade,
  tender_scope_item_id uuid references tender_scope_items(id) on delete set null,
  exception_type text not null check (exception_type in ('missing_quantity', 'unsupported_task', 'unclear_scope', 'conflicting_document', 'capacity_gap', 'missing_rate', 'schedule_risk', 'compliance_risk', 'manual_review')),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'blocking')),
  title text not null,
  message text not null,
  resolved boolean not null default false,
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table estimate_resource_demand (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  estimate_run_id uuid not null references estimate_runs(id) on delete cascade,
  resource_kind text not null,
  resource_key text not null,
  unit text not null,
  required_quantity numeric(18,6) not null check (required_quantity >= 0),
  available_quantity numeric(18,6),
  gap_quantity numeric(18,6),
  notes text
);

create table contract_actuals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  estimate_run_id uuid references estimate_runs(id) on delete set null,
  actual_kind text not null check (actual_kind in ('labor', 'material', 'equipment', 'vehicle', 'subcontractor', 'schedule', 'change_order', 'rework')),
  task_key text,
  resource_key text,
  quantity numeric(18,6),
  unit text,
  hours numeric(18,6),
  cost_cents bigint check (cost_cents is null or cost_cents >= 0),
  occurred_on date,
  notes text,
  created_at timestamptz not null default now()
);

create index trade_profiles_org_idx on trade_profiles (organization_id);
create index trade_profile_resources_profile_idx on trade_profile_resources (trade_profile_id);
create index trade_profile_assemblies_profile_idx on trade_profile_assemblies (trade_profile_id);
create index tender_documents_tender_idx on tender_documents (tender_id);
create index tender_scope_items_tender_idx on tender_scope_items (tender_id);
create index estimate_runs_org_idx on estimate_runs (organization_id, created_at desc);
create index estimate_lines_run_idx on estimate_lines (estimate_run_id);
create index estimate_exceptions_run_idx on estimate_exceptions (estimate_run_id, resolved);
create index contract_actuals_contract_idx on contract_actuals (contract_id, occurred_on);

alter table trade_profiles enable row level security;
alter table trade_profile_resources enable row level security;
alter table trade_profile_crews enable row level security;
alter table trade_profile_crew_roles enable row level security;
alter table trade_profile_assemblies enable row level security;
alter table tender_documents enable row level security;
alter table tender_scope_items enable row level security;
alter table estimate_runs enable row level security;
alter table estimate_lines enable row level security;
alter table estimate_exceptions enable row level security;
alter table estimate_resource_demand enable row level security;
alter table contract_actuals enable row level security;

alter table trade_profiles force row level security;
alter table trade_profile_resources force row level security;
alter table trade_profile_crews force row level security;
alter table trade_profile_crew_roles force row level security;
alter table trade_profile_assemblies force row level security;
alter table tender_documents force row level security;
alter table tender_scope_items force row level security;
alter table estimate_runs force row level security;
alter table estimate_lines force row level security;
alter table estimate_exceptions force row level security;
alter table estimate_resource_demand force row level security;
alter table contract_actuals force row level security;

create policy trade_profiles_org_isolation on trade_profiles using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy trade_profile_resources_org_isolation on trade_profile_resources using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy trade_profile_crews_org_isolation on trade_profile_crews using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy trade_profile_crew_roles_org_isolation on trade_profile_crew_roles using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy trade_profile_assemblies_org_isolation on trade_profile_assemblies using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy tender_documents_org_isolation on tender_documents using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy tender_scope_items_org_isolation on tender_scope_items using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy estimate_runs_org_isolation on estimate_runs using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy estimate_lines_org_isolation on estimate_lines using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy estimate_exceptions_org_isolation on estimate_exceptions using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy estimate_resource_demand_org_isolation on estimate_resource_demand using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy contract_actuals_org_isolation on contract_actuals using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
