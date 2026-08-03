begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(14);

insert into auth.users (id) values ('60000000-0000-4000-8000-000000000001');

select extensions.is(
  (select free_remaining from public.get_service_credit_entitlement('60000000-0000-4000-8000-000000000001')),
  2::bigint,
  'new account starts with two server-side free analyses'
);

create temporary table first_result as
select * from public.finalize_protected_analysis(
  '60000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001', repeat('a', 64)
);
select extensions.ok((select consumed and applied and not conflict from first_result),
  'first protected result consumes exactly once');
select extensions.is((select source from first_result), 'free', 'free allowance is consumed first');
select extensions.is((select free_remaining from first_result), 1::bigint, 'one free analysis remains');

create temporary table replay_result as
select * from public.finalize_protected_analysis(
  '60000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001', repeat('a', 64)
);
select extensions.ok((select consumed and not applied and not conflict from replay_result),
  'same identifier and fingerprint replay without another debit');
select extensions.is(
  (select count(*)::integer from public.credit_ledger
    where idempotency_key like 'protected-analysis:%'),
  1,
  'replay has one ledger debit'
);

create temporary table conflict_result as
select * from public.finalize_protected_analysis(
  '60000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001', repeat('b', 64)
);
select extensions.ok((select conflict and not consumed from conflict_result),
  'same identifier cannot be rebound to another request');

select * from public.finalize_protected_analysis(
  '60000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000002', repeat('c', 64)
);
select extensions.is(
  (select free_remaining from public.get_service_credit_entitlement('60000000-0000-4000-8000-000000000001')),
  0::bigint,
  'second distinct protected analysis exhausts the free allowance'
);
create temporary table zero_balance_replay as
select * from public.finalize_protected_analysis(
  '60000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001', repeat('a', 64)
);
select extensions.ok((select consumed and not applied and not conflict from zero_balance_replay),
  'matching replay remains recoverable after the account reaches zero balance');

create temporary table zero_balance_conflict as
select * from public.finalize_protected_analysis(
  '60000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001', repeat('f', 64)
);
select extensions.ok((select conflict and not consumed from zero_balance_conflict),
  'reusing the identifier for a different fingerprint conflicts at zero balance');
select extensions.ok(
  not (select consumed from public.finalize_protected_analysis(
    '60000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000003', repeat('d', 64)
  )),
  'third analysis is denied without paid balance'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.finalize_protected_analysis(uuid,uuid,text)', 'EXECUTE'),
  'browser cannot finalize an analysis'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.finalize_protected_analysis(uuid,uuid,text)', 'EXECUTE'),
  'service role can finalize an analysis'
);
select extensions.ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'protected_analysis_receipts'
      and column_name in ('hash', 'transaction_hash', 'wallet', 'payload', 'result')
  ),
  'receipt table stores no raw transaction or result payload'
);

select * from extensions.finish();
rollback;
