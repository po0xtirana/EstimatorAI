-- BidPilot Phase 0 foundation. PostgreSQL 15+.
-- The application must set app.current_organization_id after authentication.

create extension if not exists pgcrypto;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  default_currency char(3) not null default 'CAD' check (default_currency = 'CAD'),
  created_at timestamptz not null default now()
);

create table organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  auth_subject text not null,
  role text not null check (role in ('owner', 'admin', 'estimator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, auth_subject)
);

create table trade_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_en text not null,
  name_fr text,
  parent_slug text references trade_catalog(slug),
  active boolean not null default true
);

create table organization_trades (
  organization_id uuid not null references organizations(id) on delete cascade,
  trade_id uuid not null references trade_catalog(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (organization_id, trade_id)
);

create table tenders (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('canadabuys', 'seao')),
  source_record_id text not null,
  title_en text,
  title_fr text,
  description_en text,
  description_fr text,
  buyer_name text,
  procurement_category text not null default 'other' check (procurement_category in ('construction', 'other', 'unknown')),
  estimated_value_cents bigint check (estimated_value_cents is null or estimated_value_cents >= 0),
  currency char(3) not null default 'CAD' check (currency = 'CAD'),
  closing_at timestamptz,
  source_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_record_id),
  check (title_en is not null or title_fr is not null)
);

create table organization_tenders (
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  status text not null default 'new' check (status in ('new', 'reviewing', 'bid', 'no_go', 'archived')),
  match_score numeric(5,2) check (match_score is null or (match_score >= 0 and match_score <= 100)),
  created_at timestamptz not null default now(),
  primary key (organization_id, tender_id)
);

alter table organizations enable row level security;

create or replace function current_organization_id() returns uuid
language sql stable as $$ select nullif(current_setting('app.current_organization_id', true), '')::uuid $$;

alter table organization_members enable row level security;
alter table organization_trades enable row level security;
alter table organization_tenders enable row level security;

-- FORCE prevents accidental policy bypass when the application role owns a table.
alter table organizations force row level security;
alter table organization_members force row level security;
alter table organization_trades force row level security;
alter table organization_tenders force row level security;

create policy organizations_isolation on organizations
  using (id = current_organization_id())
  with check (id = current_organization_id());

create policy organization_members_isolation on organization_members
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
create policy organization_trades_isolation on organization_trades
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
create policy organization_tenders_isolation on organization_tenders
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());

insert into trade_catalog (slug, name_en, name_fr, parent_slug) values
  ('general-renovation', 'General renovation', 'Rénovation générale', null),
  ('fire-water-restoration', 'Fire and water damage restoration', 'Restauration après incendie et dégâts d’eau', 'general-renovation'),
  ('painting', 'Painting', 'Peinture', 'general-renovation'),
  ('window-replacement', 'Window replacement', 'Remplacement de fenêtres', 'general-renovation'),
  ('drywall', 'Drywall and gypsum board', 'Cloisons sèches et panneaux de gypse', 'general-renovation'),
  ('flooring', 'Flooring', 'Revêtements de sol', 'general-renovation'),
  ('insulation', 'Insulation', 'Isolation', 'general-renovation'),
  ('doors-and-hardware', 'Doors and hardware', 'Portes et quincaillerie', 'general-renovation'),
  ('roofing', 'Roofing', 'Toiture', 'general-renovation'),
  ('siding', 'Siding and exterior cladding', 'Parement et revêtement extérieur', 'general-renovation'),
  ('demolition-abatement', 'Demolition and abatement', 'Démolition et désamiantage', 'general-renovation'),
  ('finish-carpentry', 'Finish carpentry', 'Menuiserie de finition', 'general-renovation'),
  ('minor-electrical', 'Minor electrical coordination', 'Coordination électrique mineure', 'general-renovation'),
  ('minor-plumbing', 'Minor plumbing coordination', 'Coordination plomberie mineure', 'general-renovation')
on conflict (slug) do nothing;
