begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(15);

select extensions.ok(
  to_regprocedure('public.rls_auto_enable()') is null,
  'RLS event function is absent from the exposed public schema'
);
select extensions.ok(
  to_regprocedure('app_private.rls_auto_enable()') is not null,
  'RLS event function exists in the internal schema'
);
select extensions.ok(
  not has_schema_privilege('anon', 'app_private', 'USAGE'),
  'anonymous clients cannot access the internal schema'
);
select extensions.ok(
  not has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  'authenticated clients cannot access the internal schema'
);
select extensions.ok(
  not has_schema_privilege('service_role', 'app_private', 'USAGE'),
  'service role cannot access the internal schema'
);
select extensions.ok(
  not has_function_privilege('anon', 'app_private.rls_auto_enable()', 'EXECUTE'),
  'anonymous clients cannot execute the RLS event function'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'app_private.rls_auto_enable()', 'EXECUTE'),
  'authenticated clients cannot execute the RLS event function'
);
select extensions.ok(
  not has_function_privilege('service_role', 'app_private.rls_auto_enable()', 'EXECUTE'),
  'service role cannot execute the DDL event function'
);
select extensions.ok(
  exists (
    select 1
    from pg_event_trigger evt
    join pg_proc proc on proc.oid = evt.evtfoid
    join pg_namespace ns on ns.oid = proc.pronamespace
    where evt.evtname = 'ensure_rls'
      and evt.evtenabled <> 'D'
      and evt.evtevent = 'ddl_command_end'
      and evt.evttags @> array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
      and ns.nspname = 'app_private'
      and proc.proname = 'rls_auto_enable'
  ),
  'enabled ensure_rls trigger points to the internal function'
);

create table public.security_hardening_rls_probe (id bigint primary key);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.security_hardening_rls_probe'::regclass),
  'event trigger still enables RLS on new public tables'
);

create table public."Security Hardening Mixed Case" ("Mixed ID" bigint primary key);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public."Security Hardening Mixed Case"'::regclass),
  'quoted mixed-case public tables receive RLS safely'
);

create table public.security_hardening_ctas_probe as
select 1::bigint as id;
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.security_hardening_ctas_probe'::regclass),
  'CREATE TABLE AS public tables receive RLS'
);

select 1::bigint as id into public.security_hardening_select_into_probe;
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.security_hardening_select_into_probe'::regclass),
  'SELECT INTO public tables receive RLS'
);

create or replace function app_private.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'forced RLS hardening failure';
end;
$$;

select extensions.throws_ok(
  $$create table public.security_hardening_rollback_probe (id bigint primary key)$$,
  'P0001',
  'forced RLS hardening failure',
  'an RLS hardening failure aborts public table creation'
);
select extensions.ok(
  to_regclass('public.security_hardening_rollback_probe') is null,
  'failed hardening leaves no unprotected public table behind'
);

select * from extensions.finish();
rollback;
