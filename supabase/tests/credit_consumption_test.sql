begin;

create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users (id) values
  ('50000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002');

insert into public.orders (
  id, user_id, provider, idempotency_key, status,
  package_code, package_credits, amount_cents, currency
) values (
  '60000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'mercado_pago', 'test:credit:order:1', 'checkout_ready',
  'analysis_pack_10', 10, 490, 'BRL'
);

select * from public.process_mercado_pago_payment(
  '60000000-0000-4000-8000-000000000001', '6001', 'approved', null,
  490, 0, 'BRL', '2026-08-01T10:00:00Z', '2026-08-01T10:00:00Z'
);

select extensions.results_eq(
  $$select consumed, applied, balance from public.consume_analysis_credit(
    '50000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001'
  )$$,
  $$values (true, true, 9::bigint)$$,
  'first completed paid analysis consumes one credit'
);

select extensions.results_eq(
  $$select consumed, applied, balance from public.consume_analysis_credit(
    '50000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001'
  )$$,
  $$values (true, false, 9::bigint)$$,
  'repeating the analysis identifier does not consume twice'
);

select extensions.results_eq(
  $$select consumed, applied, balance from public.consume_analysis_credit(
    '50000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000002'
  )$$,
  $$values (false, false, 0::bigint)$$,
  'another account cannot consume the purchaser balance'
);

select extensions.is(
  (select count(*)::integer from public.credit_ledger
   where user_id = '50000000-0000-4000-8000-000000000001'
     and entry_type = 'consumption'),
  1,
  'ledger contains one append-only consumption entry'
);

select extensions.ok(
  not has_function_privilege('anon', 'public.consume_analysis_credit(uuid,uuid)', 'EXECUTE'),
  'anon cannot execute credit consumption'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.consume_analysis_credit(uuid,uuid)', 'EXECUTE'),
  'browser cannot execute credit consumption directly'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.consume_analysis_credit(uuid,uuid)', 'EXECUTE'),
  'service role can execute credit consumption'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_credit_entitlement()', 'EXECUTE'),
  'authenticated account can read its derived entitlement'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.get_credit_entitlement()', 'EXECUTE'),
  'anonymous browser cannot read account entitlement'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000001', true);
select extensions.results_eq(
  $$select balance, has_paid_access from public.get_credit_entitlement()$$,
  $$values (9::bigint, true)$$,
  'authenticated account recovers its current balance and paid benefit'
);
reset role;

select * from public.process_mercado_pago_payment(
  '60000000-0000-4000-8000-000000000001', '6001', 'refunded', null,
  490, 490, 'BRL', '2026-08-01T10:00:00Z', '2026-08-01T11:00:00Z'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000001', true);
select extensions.results_eq(
  $$select balance, has_paid_access from public.get_credit_entitlement()$$,
  $$values (0::bigint, false)$$,
  'full refund clamps displayed balance and removes paid benefit'
);
reset role;

select * from extensions.finish();
rollback;
