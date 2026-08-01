begin;

create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');

insert into public.orders (
  id, user_id, provider, idempotency_key, status,
  package_code, package_credits, amount_cents, currency
) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'mercado_pago', 'test:order:1', 'checkout_ready', 'analysis_pack_10', 10, 490, 'BRL'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'mercado_pago', 'test:order:2', 'checkout_ready', 'analysis_pack_10', 10, 490, 'BRL'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002',
   'mercado_pago', 'test:order:3', 'checkout_ready', 'analysis_pack_10', 10, 490, 'BRL'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001',
   'mercado_pago', 'test:order:4', 'checkout_ready', 'analysis_pack_10', 10, 490, 'BRL');

-- Non-crediting states never create ledger entries.
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000004', '4001', 'pending', null,
  490, 0, 'BRL', null, '2026-07-31T10:00:00Z'
);
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000004', '4001', 'in_process', null,
  490, 0, 'BRL', null, '2026-07-31T10:01:00Z'
);
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000004', '4001', 'rejected', null,
  490, 0, 'BRL', null, '2026-07-31T10:02:00Z'
);
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000004', '4001', 'cancelled', null,
  490, 0, 'BRL', null, '2026-07-31T10:03:00Z'
);
select extensions.is(
  (select count(*)::integer from public.credit_ledger where order_id = '20000000-0000-4000-8000-000000000004'),
  0, 'pending, in-process, rejected and cancelled do not touch the ledger'
);

-- Approval is idempotent and stale/out-of-order snapshots are ignored.
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000001', '1001', 'approved', 'accredited',
  490, 0, 'BRL', '2026-07-31T11:00:00Z', '2026-07-31T11:00:00Z'
);
select extensions.is(
  (select sum(credit_delta)::integer from public.credit_ledger where order_id = '20000000-0000-4000-8000-000000000001'),
  10, 'approved payment grants one package'
);
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000001', '1001', 'approved', 'accredited',
  490, 0, 'BRL', '2026-07-31T11:00:00Z', '2026-07-31T11:00:00Z'
);
select extensions.is(
  (select count(*)::integer from public.credit_ledger where payment_id = (
    select id from public.payments where provider_payment_id = '1001'
  )), 1, 'repeated approval is idempotent'
);
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000001', '1001', 'pending', null,
  490, 0, 'BRL', null, '2026-07-31T10:59:00Z'
);
select extensions.is(
  (select status from public.payments where provider_payment_id = '1001'),
  'approved', 'stale snapshot cannot regress an approved payment'
);

-- Partial refund does not reverse credits; full refund does exactly once.
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000001', '1001', 'refunded', 'partial_refund',
  490, 100, 'BRL', '2026-07-31T11:00:00Z', '2026-07-31T12:00:00Z'
);
select extensions.is(
  (select sum(credit_delta)::integer from public.credit_ledger where order_id = '20000000-0000-4000-8000-000000000001'),
  10, 'partial refund does not change credits'
);
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000001', '1001', 'refunded', 'full_refund',
  490, 490, 'BRL', '2026-07-31T11:00:00Z', '2026-07-31T13:00:00Z'
);
select extensions.is(
  (select sum(credit_delta)::integer from public.credit_ledger where order_id = '20000000-0000-4000-8000-000000000001'),
  0, 'full refund reverses the package exactly once'
);
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000001', '1001', 'refunded', 'full_refund',
  490, 490, 'BRL', '2026-07-31T11:00:00Z', '2026-07-31T13:01:00Z'
);
select extensions.is(
  (select count(*)::integer from public.credit_ledger where payment_id = (
    select id from public.payments where provider_payment_id = '1001'
  )), 2, 'repeated full refund does not duplicate the reversal'
);

-- Chargeback dominates refund and cannot be regressed by a late approval.
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000001', '1001', 'charged_back', 'charged_back',
  490, 490, 'BRL', '2026-07-31T11:00:00Z', '2026-07-31T14:00:00Z'
);
select extensions.is(
  (select status from public.orders where id = '20000000-0000-4000-8000-000000000001'),
  'payment_charged_back', 'chargeback dominates a prior refund in aggregate order state'
);
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000001', '1001', 'approved', 'late_approval',
  490, 0, 'BRL', '2026-07-31T15:00:00Z', '2026-07-31T15:00:00Z'
);
select extensions.is(
  (select status from public.payments where provider_payment_id = '1001'),
  'charged_back', 'terminal chargeback ignores a late approval'
);

-- Two payments on one order retain the grant from the non-refunded payment.
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000002', '2001', 'approved', null,
  490, 0, 'BRL', '2026-07-31T11:00:00Z', '2026-07-31T11:00:00Z'
);
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000002', '2002', 'approved', null,
  490, 0, 'BRL', '2026-07-31T11:01:00Z', '2026-07-31T11:01:00Z'
);
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000002', '2001', 'refunded', null,
  490, 490, 'BRL', '2026-07-31T11:00:00Z', '2026-07-31T12:00:00Z'
);
select extensions.is(
  (select sum(credit_delta)::integer from public.credit_ledger where order_id = '20000000-0000-4000-8000-000000000002'),
  10, 'two payments minus one full refund leave one package'
);
select extensions.is(
  (select status from public.orders where id = '20000000-0000-4000-8000-000000000002'),
  'payment_approved', 'one active approved payment keeps the aggregate order approved'
);

-- Anonymized ownership records payment state but never grants new credit.
delete from auth.users where id = '10000000-0000-4000-8000-000000000002';
select * from public.process_mercado_pago_payment(
  '20000000-0000-4000-8000-000000000003', '3001', 'approved', null,
  490, 0, 'BRL', '2026-07-31T11:00:00Z', '2026-07-31T11:00:00Z'
);
select extensions.is(
  (select count(*)::integer from public.credit_ledger where order_id = '20000000-0000-4000-8000-000000000003'),
  0, 'anonymized order never receives a new ledger grant'
);
select extensions.is(
  (select user_id from public.payments where provider_payment_id = '3001'),
  null::uuid, 'anonymized payment preserves null ownership'
);

-- Function grants stay service-role only.
select extensions.ok(
  not has_function_privilege('anon', 'public.process_mercado_pago_payment(uuid,text,text,text,integer,integer,text,timestamptz,timestamptz)', 'EXECUTE'),
  'anon cannot execute the payment RPC'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.process_mercado_pago_payment(uuid,text,text,text,integer,integer,text,timestamptz,timestamptz)', 'EXECUTE'),
  'authenticated cannot execute the payment RPC'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.process_mercado_pago_payment(uuid,text,text,text,integer,integer,text,timestamptz,timestamptz)', 'EXECUTE'),
  'service_role can execute the payment RPC'
);

-- Rejected snapshots roll back without partial payment or ledger writes.
select extensions.throws_ok(
  $$select * from public.process_mercado_pago_payment(
    '20000000-0000-4000-8000-000000000004', '4999', 'approved', null,
    491, 0, 'BRL', '2026-07-31T11:00:00Z', '2026-07-31T11:00:00Z'
  )$$,
  'payment does not match its order',
  'snapshot mismatch aborts the transaction'
);
select extensions.is(
  (select count(*)::integer from public.payments where provider_payment_id = '4999'),
  0, 'rollback leaves no payment row'
);
select extensions.is(
  (select count(*)::integer from public.credit_ledger where idempotency_key like 'mercado_pago:payment:4999:%'),
  0, 'rollback leaves no ledger row'
);

select * from extensions.finish();
rollback;
