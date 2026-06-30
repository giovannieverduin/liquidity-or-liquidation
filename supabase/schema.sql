-- Liquidity or Liquidation - leaderboard schema
-- Run this against the existing GGE website Supabase project (it just adds two
-- new tables prefixed lol_, so it won't collide with anything already there).
--
-- Access model: ALL reads and writes go through the Vercel serverless function
-- (api/leaderboard.js) using the service role key, which bypasses RLS. RLS is
-- enabled with NO anon/public policies, so a leaked anon key can neither read
-- nor write these tables directly. The anon key is not used by this game at all.

-- ---------------------------------------------------------------------------
-- Public leaderboard
-- ---------------------------------------------------------------------------
create table if not exists public.lol_leaderboard (
  key     text primary key,            -- derived server-side from the handle
  handle  text not null,
  twitter text,
  score   bigint not null default 0,
  ts      timestamptz not null default now()
);

create index if not exists lol_leaderboard_score_idx
  on public.lol_leaderboard (score desc);

-- ---------------------------------------------------------------------------
-- IP rate-limit log (hashed IPs only, never raw addresses)
-- ---------------------------------------------------------------------------
create table if not exists public.lol_rate_limit (
  id      bigint generated always as identity primary key,
  ip_hash text not null,
  ts      timestamptz not null default now()
);

create index if not exists lol_rate_limit_ip_ts_idx
  on public.lol_rate_limit (ip_hash, ts);

-- ---------------------------------------------------------------------------
-- Lock both tables down. No anon policies = no direct client access.
-- The service role key used by the serverless function bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.lol_leaderboard enable row level security;
alter table public.lol_rate_limit  enable row level security;

-- Optional hardening: explicitly revoke from the anon/authenticated roles so
-- the intent is obvious in the schema (RLS already blocks them with no policy).
revoke all on public.lol_leaderboard from anon, authenticated;
revoke all on public.lol_rate_limit  from anon, authenticated;
