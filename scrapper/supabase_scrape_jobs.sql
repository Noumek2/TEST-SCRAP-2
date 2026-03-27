create extension if not exists pgcrypto;

create table if not exists public.scrape_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  logs jsonb not null default '[]'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists scrape_jobs_status_created_at_idx
  on public.scrape_jobs (status, created_at);
