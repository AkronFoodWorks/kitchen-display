-- =====================================================================
-- Kitchen display — schedule cache
-- Run once in the afw-tools Supabase project:
--   Dashboard → SQL Editor → New query → paste → Run
-- =====================================================================

-- A single row holding the latest copy of the Food Corridor schedule.
-- The kitchen-schedule Edge Function rewrites it at most once a minute
-- while a TV is showing the display.
create table if not exists public.kitchen_schedule_cache (
  id          smallint    primary key default 1 check (id = 1),
  payload     jsonb       not null,
  fetched_at  timestamptz not null default now()
);

-- Row level security ON with no policies: the public browser key can't
-- read or write this table at all. Only the Edge Function (which runs
-- with the project's service role) touches it. Member cloud-save data
-- is in a separate table and is not affected.
alter table public.kitchen_schedule_cache enable row level security;
