create table contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid references tenders(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  name text not null,
  status text not null default 'bid' check (status in ('bid', 'active', 'complete', 'cancelled')),
  estimated_price_cents bigint check (estimated_price_cents is null or estimated_price_cents >= 0),
  estimated_cost_cents bigint check (estimated_cost_cents is null or estimated_cost_cents >= 0),
  duration_months integer check (duration_months is null or duration_months > 0),
  created_at timestamptz not null default now()
);

create table contract_monthly_cashflow (
  contract_id uuid not null references contracts(id) on delete cascade,
  month date not null,
  cost_cents bigint not null check (cost_cents >= 0),
  billing_cents bigint not null check (billing_cents >= 0),
  assumptions jsonb not null default '{}'::jsonb,
  primary key (contract_id, month)
);

create table contract_staffing_plan (
  contract_id uuid not null references contracts(id) on delete cascade,
  role_key text not null,
  required_headcount integer not null check (required_headcount >= 0),
  available_headcount integer check (available_headcount is null or available_headcount >= 0),
  primary key (contract_id, role_key)
);

alter table contracts enable row level security;
alter table contract_monthly_cashflow enable row level security;
alter table contract_staffing_plan enable row level security;
alter table contracts force row level security;
alter table contract_monthly_cashflow force row level security;
alter table contract_staffing_plan force row level security;
create policy contracts_org_isolation on contracts using (organization_id = current_organization_id()) with check (organization_id = current_organization_id());
create policy contract_cashflow_org_isolation on contract_monthly_cashflow using (exists (select 1 from contracts c where c.id = contract_id and c.organization_id = current_organization_id())) with check (exists (select 1 from contracts c where c.id = contract_id and c.organization_id = current_organization_id()));
create policy contract_staffing_org_isolation on contract_staffing_plan using (exists (select 1 from contracts c where c.id = contract_id and c.organization_id = current_organization_id())) with check (exists (select 1 from contracts c where c.id = contract_id and c.organization_id = current_organization_id()));
