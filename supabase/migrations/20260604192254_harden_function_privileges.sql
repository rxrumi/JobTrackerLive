-- Tighten direct function execution privileges. Trigger functions remain usable
-- by their triggers, but are no longer callable as public API functions.

revoke all on function public.set_updated_at() from public;
revoke all on function public.set_updated_at() from anon;
revoke all on function public.set_updated_at() from authenticated;

revoke all on function private.normalize_account_type(text) from public;
revoke all on function private.normalize_account_type(text) from anon;
revoke all on function private.normalize_account_type(text) from authenticated;

revoke all on function private.default_export_enabled(text) from public;
revoke all on function private.default_export_enabled(text) from anon;
revoke all on function private.default_export_enabled(text) from authenticated;

revoke all on function private.handle_new_user() from public;
revoke all on function private.handle_new_user() from anon;
revoke all on function private.handle_new_user() from authenticated;

revoke all on function private.sync_account_access_type() from public;
revoke all on function private.sync_account_access_type() from anon;
revoke all on function private.sync_account_access_type() from authenticated;

do $$
begin
  if to_regclass('public.job_views') is not null then
    drop policy if exists "Users select own job_views" on public.job_views;
    create policy "Users select own job_views"
    on public.job_views for select
    to authenticated
    using ((select auth.uid()) = user_id);
  end if;
end $$;

do $$
begin
  if to_regclass('public.search_queries') is not null then
    drop policy if exists "Users select own search_queries" on public.search_queries;
    create policy "Users select own search_queries"
    on public.search_queries for select
    to authenticated
    using ((select auth.uid()) = user_id);
  end if;
end $$;

do $$
begin
  if to_regclass('public.page_views') is not null then
    drop policy if exists "Users select own page_views" on public.page_views;
    create policy "Users select own page_views"
    on public.page_views for select
    to authenticated
    using ((select auth.uid()) = user_id);
  end if;
end $$;
