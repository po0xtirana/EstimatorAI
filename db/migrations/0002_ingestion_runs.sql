create table ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('canadabuys', 'seao')),
  dataset_url text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  rows_seen integer not null default 0 check (rows_seen >= 0),
  rows_normalized integer not null default 0 check (rows_normalized >= 0),
  rows_rejected integer not null default 0 check (rows_rejected >= 0),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  error_message text
);

alter table tenders add column if not exists solicitation_number text;
alter table tenders add column if not exists procurement_code text;
create index if not exists tenders_closing_at_idx on tenders (closing_at);
create index if not exists tenders_category_idx on tenders (procurement_category);
