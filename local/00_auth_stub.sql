-- SOLO PARA PRUEBAS LOCALES: imita lo mínimo de Supabase (auth.users, auth.uid(), roles)
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
  encrypted_password text, updated_at timestamptz);
alter table auth.users add column if not exists encrypted_password text, add column if not exists updated_at timestamptz;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create schema if not exists storage;
