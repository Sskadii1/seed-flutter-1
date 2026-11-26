/**
 * Supabase PostgreSQL DDL & Sync Contract for SEED.
 * The app runs local-first immediately with zero setup, and syncs idempotently
 * via client_attempt_id when Supabase credentials are configured.
 */
export const SUPABASE_MIGRATION_SQL = `-- SEED Korean Learning Platform — Core Schema (Supabase / PostgreSQL)
-- Run in Supabase SQL Editor when enabling cloud sync

create table if not exists public.srs_cards (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  item_type text not null check (item_type in ('vocab', 'grammar', 'phoneme')),
  unit_id text not null,
  stage smallint not null check (stage between 1 and 4),
  stability double precision not null,
  difficulty double precision not null,
  reps integer not null default 0,
  lapses integer not null default 0,
  last_review_at timestamptz not null,
  due_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table if not exists public.attempts (
  client_attempt_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id text not null,
  item_ids text[] not null default '{}',
  category text not null,
  stage smallint not null,
  grade smallint not null check (grade between 1 and 4),
  xp_earned integer not null,
  elapsed_days double precision not null default 0,
  wrong_attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'premium')),
  source text not null check (source in ('apple_iap', 'google_play', 'payos', 'manual_grant')),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.srs_cards enable row level security;
alter table public.attempts enable row level security;
alter table public.entitlements enable row level security;

create policy "Users own their srs_cards" on public.srs_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users own their attempts" on public.attempts
  for select using (auth.uid() = user_id);
create policy "Users insert own attempts" on public.attempts
  for insert with check (auth.uid() = user_id);

create policy "Users read own entitlement" on public.entitlements
  for select using (auth.uid() = user_id);
`;
