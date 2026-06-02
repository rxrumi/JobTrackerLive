create schema if not exists private;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  last_login_at timestamptz,
  onboarding_completed boolean not null default false,
  account_type text not null default 'individual' check (account_type in ('individual', 'agency')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  full_name text not null,
  current_title text not null,
  years_experience numeric not null check (years_experience >= 0),
  target_role_families text[] not null default '{}',
  target_seniority text not null,
  target_countries text[] not null default '{}',
  visa_needed boolean not null default true,
  preferred_work_mode text,
  salary_min_usd integer check (salary_min_usd is null or salary_min_usd >= 0),
  linkedin_url text,
  resume_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (array_length(target_role_families, 1) > 0),
  check (array_length(target_countries, 1) > 0)
);

create table public.agency_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  agency_name text not null,
  agency_type text not null check (
    agency_type in (
      'recruiting_agency',
      'lead_gen_agency',
      'immigration_consultancy',
      'career_services',
      'market_research',
      'other'
    )
  ),
  target_markets text[] not null default '{}',
  target_role_families text[] not null default '{}',
  target_countries text[] not null default '{}',
  use_case text not null check (
    use_case in (
      'recruiting',
      'lead_generation',
      'visa_market_research',
      'talent_intelligence',
      'job_data_integration',
      'other'
    )
  ),
  integration_interest text not null default 'none' check (
    integration_interest in (
      'none',
      'zapier',
      'make',
      'clay',
      'airtable',
      'google_sheets',
      'crm',
      'api',
      'webhook'
    )
  ),
  monthly_data_volume text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (array_length(target_role_families, 1) > 0),
  check (array_length(target_countries, 1) > 0)
);

create table public.user_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  job_id text not null,
  status text not null default 'Not started' check (
    status in (
      'Not started',
      'Saved',
      'Applied',
      'Recruiter screen',
      'Interview',
      'Final round',
      'Offer',
      'Rejected',
      'On hold'
    )
  ),
  starred boolean not null default false,
  notes text,
  applied_at timestamptz,
  saved_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create index user_jobs_user_id_updated_at_idx on public.user_jobs (user_id, updated_at desc);
create index user_jobs_user_id_status_idx on public.user_jobs (user_id, status);

create table public.user_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_type text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index user_activity_user_id_created_at_idx on public.user_activity (user_id, created_at desc);

create table public.account_access (
  user_id uuid primary key references public.users(id) on delete cascade,
  plan text not null default 'free',
  account_type text not null default 'individual' check (account_type in ('individual', 'agency')),
  api_access_enabled boolean not null default false,
  integrations_enabled boolean not null default false,
  export_enabled text not null default 'none' check (export_enabled in ('none', 'limited', 'full')),
  rate_limit_tier text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

create trigger agency_profiles_set_updated_at
before update on public.agency_profiles
for each row execute function public.set_updated_at();

create trigger user_jobs_set_updated_at
before update on public.user_jobs
for each row execute function public.set_updated_at();

create trigger account_access_set_updated_at
before update on public.account_access
for each row execute function public.set_updated_at();

create or replace function private.normalize_account_type(value text)
returns text
language sql
immutable
as $$
  select case when value in ('individual', 'agency') then value else 'individual' end;
$$;

create or replace function private.default_export_enabled(value text)
returns text
language sql
immutable
as $$
  select case when value = 'agency' then 'limited' else 'none' end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  next_account_type text := private.normalize_account_type(new.raw_user_meta_data->>'account_type');
begin
  insert into public.users (id, email, account_type)
  values (new.id, coalesce(new.email, ''), next_account_type)
  on conflict (id) do nothing;

  insert into public.account_access (
    user_id,
    account_type,
    plan,
    api_access_enabled,
    integrations_enabled,
    export_enabled,
    rate_limit_tier
  )
  values (
    new.id,
    next_account_type,
    'free',
    false,
    false,
    private.default_export_enabled(next_account_type),
    'free'
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.sync_account_access_type()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.account_type is distinct from old.account_type then
    insert into public.account_access (
      user_id,
      account_type,
      plan,
      api_access_enabled,
      integrations_enabled,
      export_enabled,
      rate_limit_tier
    )
    values (
      new.id,
      new.account_type,
      'free',
      false,
      false,
      private.default_export_enabled(new.account_type),
      'free'
    )
    on conflict (user_id) do update
      set account_type = excluded.account_type,
          export_enabled = case
            when public.account_access.export_enabled = 'full' then 'full'
            when excluded.account_type = 'agency' then 'limited'
            else 'none'
          end,
          updated_at = now();
  end if;

  return new;
end;
$$;

create trigger users_sync_account_access_type
after update of account_type on public.users
for each row execute function private.sync_account_access_type();

alter table public.users enable row level security;
alter table public.user_profiles enable row level security;
alter table public.agency_profiles enable row level security;
alter table public.user_jobs enable row level security;
alter table public.user_activity enable row level security;
alter table public.account_access enable row level security;

create policy "users can select own user row"
on public.users for select
to authenticated
using ((select auth.uid()) = id);

create policy "users can insert own user row"
on public.users for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "users can update own user row"
on public.users for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "users can select own individual profile"
on public.user_profiles for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can insert own individual profile"
on public.user_profiles for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "users can update own individual profile"
on public.user_profiles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users can delete own individual profile"
on public.user_profiles for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can select own agency profile"
on public.agency_profiles for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can insert own agency profile"
on public.agency_profiles for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "users can update own agency profile"
on public.agency_profiles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users can delete own agency profile"
on public.agency_profiles for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can select own job state"
on public.user_jobs for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can insert own job state"
on public.user_jobs for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "users can update own job state"
on public.user_jobs for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users can delete own job state"
on public.user_jobs for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can select own activity"
on public.user_activity for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can insert own activity"
on public.user_activity for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "users can select own account access"
on public.account_access for select
to authenticated
using ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update on public.users to authenticated;
grant select, insert, update, delete on public.user_profiles to authenticated;
grant select, insert, update, delete on public.agency_profiles to authenticated;
grant select, insert, update, delete on public.user_jobs to authenticated;
grant select, insert on public.user_activity to authenticated;
grant select on public.account_access to authenticated;
