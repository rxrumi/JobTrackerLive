drop policy if exists "users can insert own account access" on public.account_access;

create policy "users can insert own account access"
on public.account_access
for insert
to authenticated
with check ((select auth.uid()) = user_id);

grant insert on public.account_access to authenticated;
