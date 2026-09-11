-- Phase 1: scheduling persistence hardening
-- Applied to Supabase project xtjujzjkabffeenhxsib.

alter table public.posts
  add column if not exists max_attempts integer not null default 3,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists idempotency_key text;

alter table public.posts
  drop constraint if exists posts_attempts_nonnegative_ck;

alter table public.posts
  add constraint posts_attempts_nonnegative_ck
  check (attempts >= 0 and max_attempts > 0 and attempts <= max_attempts);

create index if not exists idx_posts_retry_due
  on public.posts (next_attempt_at, scheduled_at)
  where status = 'scheduled' and next_attempt_at is not null;

create index if not exists idx_posts_active_schedule
  on public.posts (plan_id, group_id, scheduled_at, status);

create unique index if not exists posts_plan_slot_uq_v2
  on public.posts (plan_id, slot_index)
  where plan_id is not null and slot_index is not null;

create unique index if not exists posts_idempotency_key_uq
  on public.posts (idempotency_key)
  where idempotency_key is not null;
