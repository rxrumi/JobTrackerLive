create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.normalize_account_type(value text)
returns text
language sql
immutable
set search_path = private
as $$
  select case when value in ('individual', 'agency') then value else 'individual' end;
$$;

create or replace function private.default_export_enabled(value text)
returns text
language sql
immutable
set search_path = private
as $$
  select case when value = 'agency' then 'limited' else 'none' end;
$$;
