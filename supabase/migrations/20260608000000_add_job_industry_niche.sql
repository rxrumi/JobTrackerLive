alter table public.job_postings
  add column if not exists industry text,
  add column if not exists niche text;

alter table public.job_snapshots
  add column if not exists industry text,
  add column if not exists niche text;

alter table public.daily_scan_stats
  add column if not exists per_industry jsonb not null default '{}'::jsonb,
  add column if not exists per_niche jsonb not null default '{}'::jsonb;

create index if not exists job_postings_industry_active_idx
  on public.job_postings (industry, is_active);

create index if not exists job_snapshots_industry_niche_idx
  on public.job_snapshots (industry, niche);
