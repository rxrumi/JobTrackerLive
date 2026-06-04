alter table public.user_job_history enable row level security;

drop policy if exists "users can select own job history" on public.user_job_history;
drop policy if exists "users can insert own job history" on public.user_job_history;

create policy "users can select own job history"
on public.user_job_history
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can insert own job history"
on public.user_job_history
for insert
to authenticated
with check ((select auth.uid()) = user_id);

grant select, insert on public.user_job_history to authenticated;
