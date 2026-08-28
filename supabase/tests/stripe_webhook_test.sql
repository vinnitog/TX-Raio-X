begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(22);

insert into auth.users (id) values ('10000000-0000-4000-8000-000000000001');
insert into public.orders (
  id, user_id, provider, provider_environment, provider_checkout_session_id,
  provider_price_id, idempotency_key, status, package_code, package_credits,
  amount_cents, currency
) values (
  '20000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000001',
  'mercado_pago', 'test', 'legacy-preference-1234', null,
  'mercado-pago:test:legacy:order:99', 'payment_approved',
  'analysis_pack_10', 10, 490, 'BRL'
);
insert into public.payments (
  order_id, user_id, provider, provider_environment, provider_payment_id,
  idempotency_key, status, amount_cents, refunded_cents, currency, provider_updated_at
) values (
  '20000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000001',
  'mercado_pago', 'test', 'legacy-payment-1234',
  'mercado-pago:test:legacy:payment:99', 'approved', 490, 0, 'BRL', now()
);
select extensions.is(
  (select concat_ws('|', orders.provider, payments.provider, orders.provider_price_id)
   from public.orders join public.payments on payments.order_id = orders.id
   where orders.id = '20000000-0000-4000-8000-000000000099'),
  'mercado_pago|mercado_pago',
  'legacy Mercado Pago financial rows remain readable without a Stripe Price'
);

insert into public.orders (
  id, user_id, provider, provider_environment, provider_checkout_session_id,
  provider_price_id, idempotency_key, status, package_code, package_credits,
  amount_cents, currency
) values (
  '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  'stripe', 'test', 'cs_test_abcdefgh1234', 'price_testpack10',
  'stripe:test:checkout:30000000-0000-4000-8000-000000000001',
  'checkout_ready', 'analysis_pack_10', 10, 490, 'BRL'
);

select extensions.is(
  public.create_or_get_stripe_checkout_order(
    '10000000-0000-4000-8000-000000000001', 'test',
    'stripe:test:checkout:30000000-0000-4000-8000-000000000099',
    'analysis_pack_10', 10, 490, 'BRL', 'price_testpack10'
  )->'order'->>'id',
  '20000000-0000-4000-8000-000000000001',
  'account-scoped checkout reuses the existing open order'
);
select extensions.is(
  public.create_or_get_stripe_checkout_order(
    '10000000-0000-4000-8000-000000000001', 'test',
    'stripe:test:checkout:30000000-0000-4000-8000-000000000098',
    'analysis_pack_10', 10, 490, 'BRL', 'price_testpack10'
  )->'order'->>'provider_checkout_session_id',
  'cs_test_abcdefgh1234',
  'a new browser key still recovers the existing Checkout Session for the account'
);
select extensions.is(
  (select count(*)::integer from public.orders
   where user_id = '10000000-0000-4000-8000-000000000001'
     and provider = 'stripe' and provider_environment = 'test'
     and status in ('creating_checkout', 'checkout_unknown', 'checkout_ready')),
  1,
  'only one open checkout exists per account'
);

-- a failed card attempt keeps the same Checkout Session reusable
select extensions.lives_ok($$ select * from public.process_stripe_payment('evt_carddeclined1','test','payment_intent.payment_failed','20000000-0000-4000-8000-000000000001','pi_payment1234','rejected','card_declined',490,0,'BRL',null,now()) $$, 'card failure is recorded');
select extensions.is((select status from public.orders where id = '20000000-0000-4000-8000-000000000001'), 'checkout_ready', 'card failure keeps the original checkout reusable');
-- approval after retrying the same session
select extensions.lives_ok($$ select * from public.process_stripe_payment('evt_approval1234','test','checkout.session.completed','20000000-0000-4000-8000-000000000001','pi_payment1234','approved','checkout_paid',490,0,'BRL',now(),now()) $$, 'approval');
-- repeated event
select extensions.is((select credited from public.process_stripe_payment('evt_approval1234','test','checkout.session.completed','20000000-0000-4000-8000-000000000001','pi_payment1234','approved','checkout_paid',490,0,'BRL',now(),now())), false, 'repeated event');
-- partial refund
select extensions.lives_ok($$ select * from public.process_stripe_payment('evt_partial1234','test','charge.refunded','20000000-0000-4000-8000-000000000001','pi_payment1234','partially_refunded','charge_refunded',490,100,'BRL',null,now()) $$, 'partial refund');
select extensions.is((select count(*)::integer from public.credit_ledger where entry_type = 'refund'), 0, 'partial refund does not reverse credits');
-- full refund
select extensions.lives_ok($$ select * from public.process_stripe_payment('evt_refund1234','test','charge.refunded','20000000-0000-4000-8000-000000000001','pi_payment1234','refunded','charge_refunded',490,490,'BRL',null,now() + interval '1 second') $$, 'full refund');
-- dispute is idempotent after reversal
select extensions.lives_ok($$ select * from public.process_stripe_payment('evt_dispute1234','test','charge.dispute.created','20000000-0000-4000-8000-000000000001','pi_payment1234','charged_back','dispute_created',490,490,'BRL',null,now() + interval '2 seconds') $$, 'dispute');
-- expiration
select extensions.is(public.process_stripe_checkout_expiration('evt_expired1234','test','20000000-0000-4000-8000-000000000001','cs_test_abcdefgh1234',now()), false, 'expiration cannot regress an approved/reversed order');

insert into public.orders (
  id, user_id, provider, provider_environment, provider_checkout_session_id,
  provider_price_id, idempotency_key, status, package_code, package_credits,
  amount_cents, currency
) values (
  '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
  'stripe', 'test', 'cs_test_zyxwvuts1234', 'price_testpack10',
  'stripe:test:checkout:30000000-0000-4000-8000-000000000002',
  'checkout_ready', 'analysis_pack_10', 10, 490, 'BRL'
);
select extensions.lives_ok($$ select * from public.process_stripe_payment('evt_partialfirst1','test','charge.refunded','20000000-0000-4000-8000-000000000002','pi_outoforder12','partially_refunded','charge_refunded',490,100,'BRL',null,now()) $$, 'partial refund can arrive before approval');
select extensions.lives_ok($$ select * from public.process_stripe_payment('evt_approvallate1','test','checkout.session.completed','20000000-0000-4000-8000-000000000002','pi_outoforder12','approved','checkout_paid',490,0,'BRL',now() - interval '1 minute',now() - interval '1 minute') $$, 'late approval after partial refund is merged');
select extensions.is((select count(*)::integer from public.credit_ledger where order_id = '20000000-0000-4000-8000-000000000002' and entry_type = 'purchase'), 1, 'out-of-order partial refund still grants the paid pack once');
select extensions.is((select status from public.payments where provider_payment_id = 'pi_outoforder12'), 'approved', 'late approval becomes the canonical payment status');
select extensions.is((select refunded_cents from public.payments where provider_payment_id = 'pi_outoforder12'), 100, 'late approval preserves the earlier partial refund amount');
-- service-role only
select extensions.ok(not has_function_privilege('anon', 'public.process_stripe_payment(text,text,text,uuid,text,text,text,integer,integer,text,timestamptz,timestamptz)', 'EXECUTE') and has_function_privilege('service_role', 'public.process_stripe_payment(text,text,text,uuid,text,text,text,integer,integer,text,timestamptz,timestamptz)', 'EXECUTE'), 'service-role only');

-- A synchronous Stripe API rejection has no Checkout Session yet. Retrying
-- the exact browser key must recover this row instead of colliding with the
-- globally unique idempotency key.
insert into public.orders (
  id, user_id, provider, provider_environment, provider_price_id,
  idempotency_key, status, package_code, package_credits, amount_cents, currency
) values (
  '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
  'stripe', 'test', 'price_testpack10',
  'stripe:test:checkout:30000000-0000-4000-8000-000000000003',
  'payment_rejected', 'analysis_pack_10', 10, 490, 'BRL'
);
select extensions.is(
  public.create_or_get_stripe_checkout_order(
    '10000000-0000-4000-8000-000000000001', 'test',
    'stripe:test:checkout:30000000-0000-4000-8000-000000000003',
    'analysis_pack_10', 10, 490, 'BRL', 'price_rotatedpack10'
  )->'order'->>'id',
  '20000000-0000-4000-8000-000000000003',
  'exact retry recovers the synchronously rejected order'
);
select extensions.is(
  public.create_or_get_stripe_checkout_order(
    '10000000-0000-4000-8000-000000000001', 'test',
    'stripe:test:checkout:30000000-0000-4000-8000-000000000004',
    'analysis_pack_10', 10, 490, 'BRL', 'price_testpack10'
  )->>'created',
  'true',
  'a different key can start a fresh checkout after a rejected payment'
);
select extensions.is(
  (select count(*)::integer from public.orders
   where user_id = '10000000-0000-4000-8000-000000000001'
     and provider = 'stripe' and provider_environment = 'test'
     and status = 'creating_checkout'),
  1,
  'fresh retry creates only one new open checkout'
);

select * from extensions.finish();
rollback;
