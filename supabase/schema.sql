-- =====================================================================
-- Fleet Tracker: database schema for Supabase (Postgres 15+)
--
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run: every statement is idempotent.
--
-- The Next.js server connects with the database connection string (pooler),
-- so it bypasses RLS. RLS is enabled with NO policies on purpose: that blocks
-- Supabase's public REST/GraphQL APIs (anon / authenticated keys) from reading
-- any of these tables. All access goes through the app's /api routes, which
-- enforce the on-duty rules.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- users ----------
create table if not exists public.users (
  id                      bigint generated always as identity primary key,
  enrollment_code         text        not null unique,
  username                text        not null,
  password_hash           text        not null,
  display_name            text        not null,
  role                    text        not null check (role in ('admin', 'worker')),
  active                  boolean     not null default true,
  on_duty                 boolean     not null default false,
  consent_policy_version  text,
  consent_at              timestamptz,
  created_at              timestamptz not null default now()
);
-- Usernames are case-insensitive.
create unique index if not exists users_username_lower_key on public.users (lower(username));

-- ---------- duty sessions (one row per shift) ----------
create table if not exists public.duty_sessions (
  id          bigint generated always as identity primary key,
  user_id     bigint      not null references public.users (id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists duty_sessions_user_started on public.duty_sessions (user_id, started_at desc);
-- At most one open shift per worker.
create unique index if not exists duty_sessions_one_open on public.duty_sessions (user_id) where ended_at is null;

-- ---------- location pings (on duty only) ----------
create table if not exists public.location_pings (
  id           bigint generated always as identity primary key,
  user_id      bigint           not null references public.users (id) on delete cascade,
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  accuracy     real,
  battery      smallint check (battery between 0 and 100),
  recorded_at  timestamptz      not null,
  received_at  timestamptz      not null default now()
);
create index if not exists location_pings_user_time on public.location_pings (user_id, recorded_at desc);
create index if not exists location_pings_time on public.location_pings (recorded_at);

-- ---------- call events (device call log, on-duty windows only) ----------
create table if not exists public.call_events (
  id              bigint generated always as identity primary key,
  user_id         bigint      not null references public.users (id) on delete cascade,
  client_id       text        not null,
  direction       text        not null check (direction in ('outgoing', 'incoming', 'missed')),
  contact_name    text,
  contact_number  text        not null,
  started_at      timestamptz not null,
  duration_sec    integer     not null check (duration_sec >= 0),
  received_at     timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists call_events_user_time on public.call_events (user_id, started_at desc);
create index if not exists call_events_time on public.call_events (started_at);

-- ---------- rate limiting (shared across serverless instances) ----------
create table if not exists public.rate_limits (
  key           text        primary key,
  window_start  timestamptz not null,
  count         integer     not null
);

-- ---------- lock down the public APIs ----------
alter table public.users          enable row level security;
alter table public.duty_sessions  enable row level security;
alter table public.location_pings enable row level security;
alter table public.call_events    enable row level security;
alter table public.rate_limits    enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.users, public.duty_sessions, public.location_pings,
                  public.call_events, public.rate_limits from anon, authenticated;
  end if;
end $$;

-- ---------- retention ----------
create or replace function public.fleet_purge_expired(location_days integer default 90, call_days integer default 180)
returns void
language sql
as $$
  delete from public.location_pings where recorded_at < now() - make_interval(days => location_days);
  delete from public.call_events    where started_at  < now() - make_interval(days => call_days);
  delete from public.rate_limits    where window_start < now() - interval '1 day';
$$;

-- Hourly purge via pg_cron (available on all Supabase projects).
-- Change the 90 / 180 here if your policy uses different retention windows.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('fleet-retention', '15 * * * *', 'select public.fleet_purge_expired(90, 180)');
  else
    raise notice 'pg_cron not available: schedule public.fleet_purge_expired() some other way';
  end if;
end $$;

-- ---------- first admin account ----------
-- Creates admin / CHANGE-ME-NOW if no admin exists yet. Sign in to the
-- dashboard and change it immediately (or edit the password here before running).
insert into public.users (enrollment_code, username, password_hash, display_name, role)
select 'ADM' || upper(substr(md5(random()::text), 1, 8)),
       'admin',
       extensions.crypt('CHANGE-ME-NOW', extensions.gen_salt('bf', 12)),
       'Administrator',
       'admin'
where not exists (select 1 from public.users where role = 'admin');
