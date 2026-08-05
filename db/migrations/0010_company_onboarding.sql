alter table organizations
  add column if not exists industry text,
  add column if not exists website text,
  add column if not exists phone text;

alter table staff_cost_rates
  add column if not exists available_headcount integer not null default 0 check (available_headcount >= 0),
  add column if not exists skill_summary text;
