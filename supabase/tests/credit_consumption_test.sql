begin;

create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users (id) values
  ('50000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002');

insert into public.orders (
  id, user_id, provider, provider_environment, provider_price_id, idempotency_key, status,
  package_code, package_credits, amount_cents, currency
) values (
  '60000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'stripe', 'test', 'price_testpack10', 'stripe:test:credit:order:1', 'payment_rejected',
  'analysis_pack_10', 10, 490, 'BRL'
), (
  '60000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000001',
  'stripe', 'test', 'price_testpack10', 'stripe:test:credit:order:2', 'payment_rejected',
  'analysis_pack_10', 10, 490, 'BRL'
), (
  '60000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000001',
  'stripe', 'test', 'price_testpack10', 'stripe:test:credit:order:3', 'payment_rejected',
  'analysis_pack_10', 10, 490, 'BRL'
);

select * from public.process_stripe_payment(
  'evt_creditapproval1', 'test', 'checkout.session.completed',
  '60000000-0000-4000-8000-000000000001', 'pi_creditpayment1', 'approved', null,
  490, 0, 'BRL', '2026-08-01T10:00:00Z', '2026-08-01T10:00:00Z'
);

select extensions.results_eq(
  $$select consumed, applied, balance, free_remaining, source from public.consume_analysis_credit(
    '50000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001'
  )$$,
  $$values (true, true, 10::bigint, 1::bigint, 'free'::text)$$,
  'first completed analysis consumes the account free allowance before paid balance'
);

select extensions.results_eq(
  $$select consumed, applied, balance, free_remaining, source from public.consume_analysis_credit(
    '50000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001'
  )$$,
  $$values (true, false, 10::bigint, 1::bigint, 'free'::text)$$,
  'repeating the analysis identifier does not consume twice'
);

select extensions.results_eq(
  $$select consumed, applied, balance, free_remaining, source from public.consume_analysis_credit(
    '50000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000002'
  )$$,
  $$values (true, true, 0::bigint, 1::bigint, 'free'::text)$$,
  'another account receives only its own free allowance'
);

do $$
begin
  perform * from public.consume_analysis_credit(
    '50000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000003'
  );
end;
$$;

select extensions.results_eq(
  $$select consumed, applied, balance, free_remaining, source from public.consume_analysis_credit(
    '50000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000004'
  )$$,
  $$values (false, false, 0::bigint, 0::bigint, null::text)$$,
  'another account cannot consume the purchaser paid balance after its free allowance'
);

select extensions.is(
  (select count(*)::integer from public.credit_ledger
   where user_id = '50000000-0000-4000-8000-000000000001'
     and entry_type = 'free_consumption'),
  1,
  'ledger contains one append-only free consumption entry for the purchaser'
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
  $$select balance, free_remaining, has_paid_access from public.get_credit_entitlement()$$,
  $$values (10::bigint, 1::bigint, true)$$,
  'authenticated account recovers its current balance and paid benefit'
);
reset role;

-- Exhaust the remaining free grant, then consume one paid credit before reversal.
select * from public.consume_analysis_credit(
  '50000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000005'
);
select extensions.results_eq(
  $$select consumed, applied, balance, free_remaining, source from public.consume_analysis_credit(
    '50000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000006'
  )$$,
  $$values (true, true, 9::bigint, 0::bigint, 'paid'::text)$$,
  'paid balance is consumed only after the free grant is exhausted'
);

select * from public.process_stripe_payment(
  'evt_creditrefund1', 'test', 'charge.refunded',
  '60000000-0000-4000-8000-000000000001', 'pi_creditpayment1', 'refunded', null,
  490, 490, 'BRL', '2026-08-01T10:00:00Z', '2026-08-01T11:00:00Z'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000001', true);
select extensions.results_eq(
  $$select balance, free_remaining, has_paid_access from public.get_credit_entitlement()$$,
  $$values (0::bigint, 0::bigint, false)$$,
  'full refund clamps displayed balance and removes paid benefit'
);
reset role;

-- Repurchase restores only the net paid balance after the prior consumption/refund.
select * from public.process_stripe_payment(
  'evt_creditapproval2', 'test', 'checkout.session.completed',
  '60000000-0000-4000-8000-000000000002', 'pi_creditpayment2', 'approved', null,
  490, 0, 'BRL', '2026-08-01T12:00:00Z', '2026-08-01T12:00:00Z'
);
select extensions.results_eq(
  $$select balance, free_remaining, has_paid_access from public.get_service_credit_entitlement(
    '50000000-0000-4000-8000-000000000001'
  )$$,
  $$values (9::bigint, 0::bigint, true)$$,
  'repurchase restores nine net credits after one paid consumption and full refund'
);

select * from public.consume_analysis_credit(
  '50000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000007'
);
select * from public.process_stripe_payment(
  'evt_creditdispute2', 'test', 'charge.dispute.created',
  '60000000-0000-4000-8000-000000000002', 'pi_creditpayment2', 'charged_back', null,
  490, 490, 'BRL', '2026-08-01T12:00:00Z', '2026-08-01T13:00:00Z'
);
select extensions.results_eq(
  $$select balance, free_remaining, has_paid_access from public.get_service_credit_entitlement(
    '50000000-0000-4000-8000-000000000001'
  )$$,
  $$values (0::bigint, 0::bigint, false)$$,
  'chargeback after consumption clamps the recoverable balance and removes paid access'
);

select * from public.process_stripe_payment(
  'evt_creditapproval3', 'test', 'checkout.session.completed',
  '60000000-0000-4000-8000-000000000003', 'pi_creditpayment3', 'approved', null,
  490, 0, 'BRL', '2026-08-01T14:00:00Z', '2026-08-01T14:00:00Z'
);
select extensions.results_eq(
  $$select balance, free_remaining, has_paid_access from public.get_service_credit_entitlement(
    '50000000-0000-4000-8000-000000000001'
  )$$,
  $$values (8::bigint, 0::bigint, true)$$,
  'a new purchase remains available after refund and chargeback history'
);

select * from extensions.finish();
rollback;
