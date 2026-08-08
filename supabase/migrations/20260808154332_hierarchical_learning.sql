-- Unified, auditable learning for estimator workbooks and completed-job actuals.
alter table organizations add column if not exists shared_learning_opt_in boolean not null default false;

alter table estimator_workbook_imports
  alter column estimate_run_id drop not null,
  add column if not exists purpose text not null default 'estimator_estimate'
    check (purpose in ('estimator_estimate', 'job_actual')),
  add column if not exists contract_id uuid references contracts(id) on delete cascade,
  add column if not exists version_number integer not null default 1 check (version_number > 0),
  add column if not exists reconciliation_status text not null default 'partial'
    check (reconciliation_status in ('pending', 'partial', 'reconciled', 'rejected')),
  add column if not exists control_total_cents bigint,
  add column if not exists reconciled_total_cents bigint,
  add column if not exists superseded_by uuid references estimator_workbook_imports(id) on delete set null;

alter table estimator_workbook_imports drop constraint if exists estimator_workbook_imports_organization_id_estimate_run_id_file_hash_key;
alter table estimator_workbook_imports add constraint estimator_workbook_import_target_check check (
  (purpose = 'estimator_estimate' and estimate_run_id is not null)
  or (purpose = 'job_actual' and contract_id is not null)
);
create unique index if not exists estimator_workbook_imports_target_hash_uidx
  on estimator_workbook_imports (
    organization_id,
    purpose,
    coalesce(estimate_run_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(contract_id, '00000000-0000-0000-0000-000000000000'::uuid),
    file_hash
  );
create index if not exists estimator_workbook_imports_contract_idx
  on estimator_workbook_imports (contract_id, created_at desc);

alter table estimator_workbook_lines
  add column if not exists cost_code text,
  add column if not exists tax_cents bigint,
  add column if not exists currency_code text not null default 'CAD',
  add column if not exists occurred_on date;

alter table contract_actuals drop constraint if exists contract_actuals_actual_kind_check;
alter table contract_actuals add constraint contract_actuals_actual_kind_check check (
  actual_kind in ('labor', 'material', 'equipment', 'vehicle', 'subcontractor', 'overhead', 'schedule', 'change_order', 'rework')
);
alter table contract_actuals
  add column if not exists workbook_import_id uuid references estimator_workbook_imports(id) on delete set null,
  add column if not exists workbook_line_id uuid references estimator_workbook_lines(id) on delete set null,
  add column if not exists reconciliation_status text not null default 'partial'
    check (reconciliation_status in ('pending', 'partial', 'reconciled', 'rejected')),
  add column if not exists event_classification text not null default 'baseline'
    check (event_classification in ('baseline', 'change_order', 'rework', 'abnormal')),
  add column if not exists quality_score numeric(5,2) check (quality_score is null or (quality_score >= 0 and quality_score <= 100));
create index if not exists contract_actuals_workbook_idx on contract_actuals (workbook_import_id);
create unique index if not exists contract_actuals_workbook_line_uidx on contract_actuals (workbook_line_id) where workbook_line_id is not null;

create table workbook_mapping_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  purpose text not null check (purpose in ('estimator_estimate', 'job_actual')),
  workbook_fingerprint text not null,
  sheet_patterns jsonb not null default '[]'::jsonb,
  column_mappings jsonb not null default '{}'::jsonb,
  cost_code_mappings jsonb not null default '{}'::jsonb,
  confidence numeric(5,2) not null default 0 check (confidence >= 0 and confidence <= 100),
  successful_import_count integer not null default 1 check (successful_import_count > 0),
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, purpose, workbook_fingerprint)
);

create table learning_model_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trade_profile_id uuid not null references trade_profiles(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'building' check (status in ('building', 'active', 'superseded', 'rolled_back', 'failed')),
  methodology text not null default 'hierarchical_log_ratio_v1',
  parameters jsonb not null default '{}'::jsonb,
  training_window jsonb not null default '{}'::jsonb,
  evidence_count integer not null default 0 check (evidence_count >= 0),
  accuracy_metrics jsonb not null default '{}'::jsonb,
  uncertainty_metrics jsonb not null default '{}'::jsonb,
  previous_version_id uuid references learning_model_versions(id) on delete set null,
  created_by text,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (trade_profile_id, version_number)
);
create unique index learning_model_versions_one_active_idx
  on learning_model_versions (trade_profile_id) where status = 'active';
create index learning_model_versions_org_profile_idx
  on learning_model_versions (organization_id, trade_profile_id, version_number desc);

create table learning_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  trade_profile_id uuid not null references trade_profiles(id) on delete cascade,
  estimate_run_id uuid references estimate_runs(id) on delete set null,
  contract_id uuid references contracts(id) on delete set null,
  workbook_import_id uuid references estimator_workbook_imports(id) on delete set null,
  contract_actual_id uuid references contract_actuals(id) on delete set null,
  assumption_version_id uuid references trade_profile_assumption_versions(id) on delete set null,
  source_type text not null check (source_type in ('completed_job_actual', 'partial_job_actual', 'manual_correction', 'estimator_workbook', 'shared_prior')),
  metric text not null check (metric in (
    'category_cost_factor', 'quantity_factor', 'labor_hours_factor', 'labor_rate_factor',
    'material_consumption_factor', 'unit_cost_factor', 'equipment_duration_factor',
    'subcontractor_cost_factor', 'overhead_factor', 'schedule_factor', 'risk_factor'
  )),
  normalized_kind text not null check (normalized_kind in ('labor', 'material', 'equipment', 'subcontractor', 'overhead', 'schedule', 'risk')),
  hierarchy_level text not null check (hierarchy_level in ('company', 'trade', 'category', 'task', 'resource')),
  task_key text,
  assembly_id uuid references trade_profile_assemblies(id) on delete set null,
  resource_key text,
  predicted_quantity numeric(18,6),
  predicted_hours numeric(18,6),
  predicted_rate_cents bigint,
  predicted_cost_cents bigint,
  observed_quantity numeric(18,6),
  observed_hours numeric(18,6),
  observed_rate_cents bigint,
  observed_cost_cents bigint,
  observed_factor numeric(12,6) not null check (observed_factor > 0),
  trust_weight numeric(7,6) not null check (trust_weight > 0 and trust_weight <= 1),
  confidence numeric(5,2) not null check (confidence >= 0 and confidence <= 100),
  quality_score numeric(5,2) not null check (quality_score >= 0 and quality_score <= 100),
  reconciliation_status text not null check (reconciliation_status in ('pending', 'partial', 'reconciled')),
  event_classification text not null default 'baseline' check (event_classification in ('baseline', 'change_order', 'rework', 'abnormal')),
  project_features jsonb not null default '{}'::jsonb,
  status text not null default 'accepted' check (status in ('accepted', 'needs_review', 'superseded', 'rejected')),
  superseded_by uuid references learning_evidence(id) on delete set null,
  source_created_at timestamptz,
  created_at timestamptz not null default now()
);
create index learning_evidence_model_idx
  on learning_evidence (organization_id, trade_profile_id, status, metric, normalized_kind, created_at desc);
create index learning_evidence_estimate_idx on learning_evidence (estimate_run_id);
create index learning_evidence_contract_idx on learning_evidence (contract_id);
create index learning_evidence_workbook_idx on learning_evidence (workbook_import_id);
create index learning_evidence_actual_idx on learning_evidence (contract_actual_id);
create unique index learning_evidence_actual_metric_uidx
  on learning_evidence (
    contract_actual_id,
    metric,
    normalized_kind,
    coalesce(task_key, ''),
    coalesce(resource_key, '')
  ) where contract_actual_id is not null and status <> 'superseded';

create table learning_shared_priors (
  id uuid primary key default gen_random_uuid(),
  trade_slug text not null,
  province text not null default 'all',
  project_type text not null default 'all',
  normalized_kind text not null,
  metric text not null,
  task_key text not null default '',
  contributor_count integer not null check (contributor_count >= 10),
  completed_job_count integer not null check (completed_job_count >= 50),
  mean_log_factor numeric(12,8) not null,
  standard_deviation numeric(12,8) not null check (standard_deviation >= 0),
  effective_weight numeric(12,4) not null default 1 check (effective_weight > 0),
  computed_at timestamptz not null default now(),
  unique (trade_slug, province, project_type, normalized_kind, metric, task_key)
);

alter table estimate_runs
  add column if not exists learning_model_version_id uuid references learning_model_versions(id) on delete set null,
  add column if not exists expected_cost_cents bigint,
  add column if not exists p50_cost_cents bigint,
  add column if not exists p80_cost_cents bigint,
  add column if not exists accuracy_explanation jsonb not null default '{}'::jsonb;
create index if not exists estimate_runs_learning_model_idx on estimate_runs (learning_model_version_id);

alter table workbook_mapping_profiles enable row level security;
alter table workbook_mapping_profiles force row level security;
alter table learning_model_versions enable row level security;
alter table learning_model_versions force row level security;
alter table learning_evidence enable row level security;
alter table learning_evidence force row level security;
alter table learning_shared_priors enable row level security;
alter table learning_shared_priors force row level security;

create policy workbook_mapping_profiles_org_isolation on workbook_mapping_profiles
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
create policy learning_model_versions_org_isolation on learning_model_versions
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
create policy learning_evidence_org_isolation on learning_evidence
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());

-- Shared priors are server-only aggregates. Tenant clients never query them directly.
grant select, insert, update, delete on workbook_mapping_profiles to service_role;
grant select, insert, update, delete on learning_model_versions to service_role;
grant select, insert, update, delete on learning_evidence to service_role;
grant select, insert, update, delete on learning_shared_priors to service_role;
grant select, update on organizations to service_role;
grant select, insert, update, delete on estimator_workbook_imports to service_role;
grant select, insert, update, delete on estimator_workbook_lines to service_role;
grant select, insert, update, delete on contract_actuals to service_role;
grant select, insert, update, delete on estimate_runs to service_role;
