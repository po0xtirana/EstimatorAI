-- EstimatorAI refinement foundation: guided readiness, durable tender jobs,
-- versioned tender analysis, and immutable estimate lineage.

create table company_setup_progress (
  organization_id uuid primary key references organizations(id) on delete cascade,
  completed_steps text[] not null default '{}',
  skipped_steps text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table tender_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  job_type text not null check (job_type in ('analyze_tender', 'process_documents', 'generate_estimate')),
  source_fingerprint text not null,
  stage text not null default 'queued' check (stage in ('queued', 'classifying', 'matching', 'discovering_documents', 'extracting_scope', 'estimating', 'completed')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'retryable', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_run_at timestamptz not null default now(),
  last_error text,
  result_metadata jsonb not null default '{}',
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, tender_id, job_type, source_fingerprint)
);

create table tender_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  trade_profile_id uuid references trade_profiles(id) on delete set null,
  source_fingerprint text not null,
  detected_trades text[] not null default '{}',
  matched_trades text[] not null default '{}',
  decision text not null check (decision in ('viable', 'review', 'not_viable')),
  match_score numeric(5,2) check (match_score is null or (match_score >= 0 and match_score <= 100)),
  components jsonb not null default '{}',
  capability_gaps jsonb not null default '[]',
  reasons jsonb not null default '[]',
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, tender_id, source_fingerprint)
);

alter table estimate_runs add column tender_analysis_id uuid references tender_analyses(id) on delete set null;
alter table estimate_runs add column assumption_version_id uuid references trade_profile_assumption_versions(id) on delete set null;
alter table estimate_lines add column assumption_version_id uuid references trade_profile_assumption_versions(id) on delete set null;

create index company_setup_progress_org_idx on company_setup_progress (organization_id);
create index tender_processing_jobs_ready_idx on tender_processing_jobs (status, next_run_at);
create index tender_processing_jobs_tender_idx on tender_processing_jobs (organization_id, tender_id, created_at desc);
create index tender_analyses_tender_idx on tender_analyses (organization_id, tender_id, computed_at desc);
create index estimate_runs_analysis_idx on estimate_runs (tender_analysis_id);
create index estimate_runs_assumption_version_idx on estimate_runs (assumption_version_id);
create index estimate_lines_assumption_version_idx on estimate_lines (assumption_version_id);

alter table company_setup_progress enable row level security;
alter table tender_processing_jobs enable row level security;
alter table tender_analyses enable row level security;
alter table company_setup_progress force row level security;
alter table tender_processing_jobs force row level security;
alter table tender_analyses force row level security;

create policy company_setup_progress_org_isolation on company_setup_progress
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
create policy tender_processing_jobs_org_isolation on tender_processing_jobs
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
create policy tender_analyses_org_isolation on tender_analyses
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
