export const SUPABASE_SQL_SCHEMA = `-- ==========================================
-- ForgeDeals - Supabase Database Schema
-- Execute this in the Supabase SQL Editor
-- ==========================================

-- 1. Table: products
create table if not exists products (
  id text primary key,
  product_identity_key text unique not null,
  product_name text not null,
  brand text,
  category text,
  sku text,
  original_url text not null,
  affiliate_url text not null,
  current_price numeric not null,
  previous_price numeric,
  lowest_price numeric,
  image_url text,
  active boolean default true,
  last_scraped_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for unique product identity
create index if not exists idx_products_identity_key on products(product_identity_key);
create index if not exists idx_products_sku on products(sku);

-- 2. Table: publications
create table if not exists publications (
  id text primary key,
  product_id text references products(id) on delete cascade,
  scheduled_at timestamptz not null,
  status text not null default 'draft', -- draft, scheduled, publishing, published, failed, cancelled
  content text not null,
  facebook_group_url text,
  facebook_post_url text,
  published_at timestamptz,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_publications_scheduled_at on publications(scheduled_at);
create index if not exists idx_publications_status on publications(status);
create index if not exists idx_publications_product_id on publications(product_id);

-- 3. Table: price_history
create table if not exists price_history (
  id text primary key,
  product_id text references products(id) on delete cascade,
  price numeric not null,
  checked_at timestamptz default now()
);

create index if not exists idx_price_history_product on price_history(product_id);

-- 4. Table: settings
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- Enable RLS if needed (or disable for service role operations)
alter table products enable row level security;
alter table publications enable row level security;
alter table price_history enable row level security;
alter table settings enable row level security;

-- Allow service role full access
create policy if not exists "Service role has full access to products" on products
  for all using (true) with check (true);

create policy if not exists "Service role has full access to publications" on publications
  for all using (true) with check (true);

create policy if not exists "Service role has full access to price_history" on price_history
  for all using (true) with check (true);

create policy if not exists "Service role has full access to settings" on settings
  for all using (true) with check (true);
`;
