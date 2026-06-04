alter table public.users
  alter column brand_theme set default 'graphite';

alter table public.job_postings
  add column if not exists updated_at timestamptz not null default now();

alter table public.daily_scan_stats
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists job_postings_set_updated_at on public.job_postings;

create trigger job_postings_set_updated_at
before update on public.job_postings
for each row execute function public.set_updated_at();

drop trigger if exists daily_scan_stats_set_updated_at on public.daily_scan_stats;

create trigger daily_scan_stats_set_updated_at
before update on public.daily_scan_stats
for each row execute function public.set_updated_at();

create index if not exists user_jobs_user_id_viewed_at_idx
  on public.user_jobs (user_id, viewed_at desc)
  where viewed_at is not null;

create index if not exists user_job_history_user_job_created_at_idx
  on public.user_job_history (user_id, job_id, created_at desc);

create index if not exists job_postings_company_active_idx
  on public.job_postings (company, is_active);

create index if not exists job_snapshots_country_family_idx
  on public.job_snapshots (country, role_family);

create index if not exists job_views_job_id_viewed_at_idx
  on public.job_views (job_id, viewed_at desc);

create index if not exists search_queries_created_at_idx
  on public.search_queries (created_at desc);

create index if not exists page_views_created_at_idx
  on public.page_views (created_at desc);
