-- ForgeDeals: canonical Facebook copy stored with each product.
alter table public.affiliate_links add column if not exists facebook_copy text;
comment on column public.affiliate_links.facebook_copy is 'Canonical SEO Facebook copy generated during product ingestion. Must not contain price or URL and must contain @todos.';
create index if not exists idx_affiliate_links_facebook_copy_missing on public.affiliate_links (id) where facebook_copy is null or btrim(facebook_copy) = '';
