create table public.agency_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  agency_name text,
  message text not null check (length(trim(message)) between 1 and 2000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index agency_feedback_user_id_created_at_idx
  on public.agency_feedback (user_id, created_at desc);

alter table public.agency_feedback enable row level security;

create policy "users can select own agency feedback"
on public.agency_feedback for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can insert own agency feedback"
on public.agency_feedback for insert
to authenticated
with check ((select auth.uid()) = user_id);

grant select, insert on public.agency_feedback to authenticated;
