-- Daily CanadaBuys feed metadata and bounded opportunity ingestion.

alter table tenders
  add column if not exists published_at timestamptz;

alter table ingestion_runs
  add column if not exists rows_selected integer not null default 0 check (rows_selected >= 0);

create index if not exists tenders_published_at_idx
  on tenders (published_at desc nulls last, closing_at asc nulls last);
