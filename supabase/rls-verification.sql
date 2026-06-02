-- Run after applying migrations with two confirmed Supabase Auth users.
-- Replace the UUIDs and execute each section with a JWT/session for the noted user.

-- As user A, these should only return user A rows.
select * from public.users where id = auth.uid();
select * from public.user_profiles where user_id = auth.uid();
select * from public.agency_profiles where user_id = auth.uid();
select * from public.user_jobs where user_id = auth.uid();
select * from public.user_activity where user_id = auth.uid();
select * from public.account_access where user_id = auth.uid();

-- As user A, replacing this UUID with user B's id should return zero rows.
select * from public.users where id = '00000000-0000-4000-8000-000000000002';
select * from public.user_profiles where user_id = '00000000-0000-4000-8000-000000000002';
select * from public.agency_profiles where user_id = '00000000-0000-4000-8000-000000000002';
select * from public.user_jobs where user_id = '00000000-0000-4000-8000-000000000002';
select * from public.user_activity where user_id = '00000000-0000-4000-8000-000000000002';
select * from public.account_access where user_id = '00000000-0000-4000-8000-000000000002';

-- As user A, this should fail because users can read but not update account access.
update public.account_access
set api_access_enabled = true
where user_id = auth.uid();
