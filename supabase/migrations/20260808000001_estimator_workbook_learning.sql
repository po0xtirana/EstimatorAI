-- Estimator workbook imports are professional-judgment evidence. They are kept
-- separate from completed-job actuals so the two learning sources can carry
-- different trust weights and remain independently auditable.
create table estimator_workbook_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  estimate_run_id uuid not null references estimate_runs(id) on delete cascade,
  trade_profile_id uuid not null references trade_profiles(id) on delete cascade,
  uploaded_by text,
  file_name text not null,
  file_hash text not null,
  mime_type text,
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  status text not null default 'processing' check (status in ('processing', 'processed', 'needs_review', 'failed')),
  parser_version text not null,
  workbook_metadata jsonb not null default '{}'::jsonb,
  mapping_metadata jsonb not null default '{}'::jsonb,
  category_totals jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  row_count integer not null default 0 check (row_count >= 0),
  total_amount_cents bigint not null default 0 check (total_amount_cents >= 0),
  extraction_confidence numeric(5,2) check (extraction_confidence is null or (extraction_confidence >= 0 and extraction_confidence <= 100)),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, estimate_run_id, file_hash)
);

create table estimator_workbook_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  workbook_import_id uuid not null references estimator_workbook_imports(id) on delete cascade,
  source_sheet text not null,
  source_row integer not null check (source_row > 0),
  source_range text,
  raw_label text not null,
  normalized_kind text not null check (normalized_kind in ('labor', 'material', 'equipment', 'subcontractor', 'overhead', 'risk', 'markup', 'unknown')),
  task_key text,
  resource_key text,
  quantity numeric(18,6),
  unit text,
  hours numeric(18,6),
  unit_cost_cents bigint,
  amount_cents bigint not null,
  extraction_confidence numeric(5,2) not null check (extraction_confidence >= 0 and extraction_confidence <= 100),
  review_status text not null default 'auto_accepted' check (review_status in ('auto_accepted', 'needs_review', 'accepted', 'rejected')),
  mapping_reason text,
  raw_row jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table estimate_workbook_comparisons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  estimate_run_id uuid not null references estimate_runs(id) on delete cascade,
  workbook_import_id uuid not null unique references estimator_workbook_imports(id) on delete cascade,
  ai_total_cents bigint not null check (ai_total_cents >= 0),
  estimator_total_cents bigint not null check (estimator_total_cents >= 0),
  variance_cents bigint not null,
  variance_percent numeric(12,4),
  category_comparison jsonb not null default '{}'::jsonb,
  overall_confidence numeric(5,2) not null check (overall_confidence >= 0 and overall_confidence <= 100),
  status text not null check (status in ('ready', 'needs_review')),
  created_at timestamptz not null default now()
);

create table estimate_workbook_comparison_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  comparison_id uuid not null references estimate_workbook_comparisons(id) on delete cascade,
  estimate_line_id uuid references estimate_lines(id) on delete set null,
  workbook_line_id uuid references estimator_workbook_lines(id) on delete set null,
  normalized_kind text not null check (normalized_kind in ('labor', 'material', 'equipment', 'subcontractor', 'overhead', 'risk', 'markup', 'unknown')),
  match_score numeric(5,2) not null check (match_score >= 0 and match_score <= 100),
  ai_amount_cents bigint not null default 0,
  estimator_amount_cents bigint not null default 0,
  variance_cents bigint not null default 0,
  match_reason text,
  created_at timestamptz not null default now()
);

create table trade_profile_calibration_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trade_profile_id uuid not null references trade_profiles(id) on delete cascade,
  workbook_import_id uuid references estimator_workbook_imports(id) on delete cascade,
  comparison_id uuid references estimate_workbook_comparisons(id) on delete cascade,
  source_type text not null check (source_type in ('estimator_workbook', 'actual_job')),
  metric text not null check (metric in ('category_cost_factor', 'labor_hours_factor', 'unit_cost_factor')),
  normalized_kind text not null check (normalized_kind in ('labor', 'material', 'equipment', 'subcontractor', 'overhead', 'risk', 'markup')),
  task_key text,
  baseline_value numeric(18,6) not null check (baseline_value > 0),
  observed_value numeric(18,6) not null check (observed_value >= 0),
  observed_factor numeric(12,6) not null check (observed_factor >= 0),
  trust_weight numeric(5,4) not null check (trust_weight > 0 and trust_weight <= 1),
  confidence numeric(5,2) not null check (confidence >= 0 and confidence <= 100),
  status text not null default 'accepted' check (status in ('accepted', 'needs_review', 'rejected')),
  created_at timestamptz not null default now()
);

create table trade_profile_calibrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trade_profile_id uuid not null references trade_profiles(id) on delete cascade,
  normalized_kind text not null check (normalized_kind in ('labor', 'material', 'equipment', 'subcontractor', 'overhead')),
  metric text not null default 'category_cost_factor' check (metric in ('category_cost_factor', 'labor_hours_factor', 'unit_cost_factor')),
  sample_count integer not null default 0 check (sample_count >= 0),
  weighted_factor numeric(12,6) not null default 1 check (weighted_factor > 0),
  applied_factor numeric(12,6) not null default 1 check (applied_factor > 0),
  confidence numeric(5,2) not null default 0 check (confidence >= 0 and confidence <= 100),
  status text not null default 'collecting' check (status in ('collecting', 'active', 'paused')),
  calculation_metadata jsonb not null default '{}'::jsonb,
  last_observation_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trade_profile_id, normalized_kind, metric)
);

create index estimator_workbook_imports_estimate_idx on estimator_workbook_imports (estimate_run_id, created_at desc);
create index estimator_workbook_imports_profile_idx on estimator_workbook_imports (trade_profile_id, created_at desc);
create index estimator_workbook_lines_import_idx on estimator_workbook_lines (workbook_import_id, source_sheet, source_row);
create index estimate_workbook_comparisons_estimate_idx on estimate_workbook_comparisons (estimate_run_id, created_at desc);
create index estimate_workbook_comparison_lines_comparison_idx on estimate_workbook_comparison_lines (comparison_id);
create index estimate_workbook_comparison_lines_estimate_line_idx on estimate_workbook_comparison_lines (estimate_line_id);
create index estimate_workbook_comparison_lines_workbook_line_idx on estimate_workbook_comparison_lines (workbook_line_id);
create index trade_profile_calibration_observations_profile_idx on trade_profile_calibration_observations (trade_profile_id, normalized_kind, created_at desc);
create index trade_profile_calibration_observations_import_idx on trade_profile_calibration_observations (workbook_import_id);
create index trade_profile_calibration_observations_comparison_idx on trade_profile_calibration_observations (comparison_id);
create index trade_profile_calibrations_org_idx on trade_profile_calibrations (organization_id);

alter table estimator_workbook_imports enable row level security;
alter table estimator_workbook_lines enable row level security;
alter table estimate_workbook_comparisons enable row level security;
alter table estimate_workbook_comparison_lines enable row level security;
alter table trade_profile_calibration_observations enable row level security;
alter table trade_profile_calibrations enable row level security;

alter table estimator_workbook_imports force row level security;
alter table estimator_workbook_lines force row level security;
alter table estimate_workbook_comparisons force row level security;
alter table estimate_workbook_comparison_lines force row level security;
alter table trade_profile_calibration_observations force row level security;
alter table trade_profile_calibrations force row level security;

create policy estimator_workbook_imports_org_isolation on estimator_workbook_imports using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy estimator_workbook_lines_org_isolation on estimator_workbook_lines using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy estimate_workbook_comparisons_org_isolation on estimate_workbook_comparisons using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy estimate_workbook_comparison_lines_org_isolation on estimate_workbook_comparison_lines using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy trade_profile_calibration_observations_org_isolation on trade_profile_calibration_observations using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy trade_profile_calibrations_org_isolation on trade_profile_calibrations using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
