alter table public.users
  add column if not exists brand_theme text not null default 'cobalt';

alter table public.users
  drop constraint if exists users_brand_theme_check;

alter table public.users
  add constraint users_brand_theme_check
  check (brand_theme in ('cobalt', 'graphite', 'aurora'));
