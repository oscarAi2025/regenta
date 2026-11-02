-- Copia local de cómo es una base de Supabase, para probar las migraciones como en producción (ver tasks/despliegue.md).
-- Uso (borra la base local «regenta»):
--   psql -h /tmp -p 5433 -U postgres -d postgres -f tests/supabase-local.sql
--   DATABASE_URL='postgres://sb_postgres@localhost:5433/regenta?host=/tmp' node scripts/db-reset.mjs --produccion --demo
drop database if exists regenta with (force);
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='sb_postgres') then create role sb_postgres login createrole createdb replication bypassrls; end if;
end $$;
alter role sb_postgres nosuperuser;
grant anon, authenticated, service_role to sb_postgres;
create database regenta owner sb_postgres;
\c regenta
alter schema public owner to sb_postgres;
create schema extensions;
create extension pgcrypto schema extensions;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;
create function auth.role() returns text language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $f$;
grant usage on schema auth, extensions to anon, authenticated, service_role, sb_postgres;
grant usage on schema public to anon, authenticated, service_role;
alter role sb_postgres set search_path = "$user", public, extensions;
alter role authenticated set search_path = "$user", public, extensions;
alter default privileges for role sb_postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role sb_postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role sb_postgres in schema public grant all on functions to anon, authenticated, service_role;
