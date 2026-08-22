begin;

create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

insert into auth.users (id) values
  ('91000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000002');

select extensions.ok(
  not has_function_privilege('authenticated', 'public.get_account_privacy_export(uuid)', 'EXECUTE'),
  'browser cannot export an arbitrary account'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.get_account_privacy_export(uuid)', 'EXECUTE'),
  'service role can export after authenticating the caller'
);

insert into public.orders (
  id, user_id, provider, provider_preference_id, idempotency_key, status,
  package_code, package_credits, amount_cents, currency
) values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
   'mercado_pago', 'pref-a', 'privacy:test:a', 'payment_rejected', 'analysis_pack_10', 10, 490, 'BRL'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002',
   'mercado_pago', 'pref-b', 'privacy:test:b', 'payment_rejected', 'analysis_pack_10', 10, 490, 'BRL');

select extensions.is(
  jsonb_array_length(public.get_account_privacy_export('91000000-0000-4000-8000-000000000001')->'orders'),
  1, 'export contains only the selected account order'
);
select extensions.ok(
  not (public.get_account_privacy_export('91000000-0000-4000-8000-000000000001')::text like '%pref-b%'),
  'export never contains another account provider identifier'
);

select public.begin_account_erasure('91000000-0000-4000-8000-000000000001');
select extensions.throws_ok(
  $$insert into public.orders (
    user_id, provider, idempotency_key, status, package_code, package_credits, amount_cents, currency
  ) values (
    '91000000-0000-4000-8000-000000000001', 'mercado_pago', 'privacy:race',
    'creating_preference', 'analysis_pack_10', 10, 490, 'BRL'
  )$$,
  'P0001', 'account_erasure_in_progress',
  'checkout cannot start after erasure enters processing'
);
select extensions.is(
  (select count(*)::integer from public.privacy_requests
   where user_id = '91000000-0000-4000-8000-000000000001' and status = 'processing'),
  1, 'begin erasure is idempotent per account'
);
select public.complete_account_erasure(
  (select id from public.privacy_requests where user_id = '91000000-0000-4000-8000-000000000001'),
  'failed'
);

insert into public.orders (
  user_id, provider, idempotency_key, status, package_code, package_credits, amount_cents, currency
) values (
  '91000000-0000-4000-8000-000000000001', 'mercado_pago', 'privacy:unknown',
  'preference_unknown', 'analysis_pack_10', 10, 490, 'BRL'
);
select extensions.is(
  (public.get_account_erasure_eligibility('91000000-0000-4000-8000-000000000001')->>'hasOpenCheckout')::boolean,
  true, 'non-terminal order blocks erasure even without a preference id'
);

create temporary table privacy_non_terminal_matrix (
  status text primary key,
  user_id uuid not null default gen_random_uuid()
);
insert into privacy_non_terminal_matrix (status) values
  ('creating_preference'),
  ('preference_unknown'),
  ('checkout_ready'),
  ('payment_authorized'),
  ('payment_in_mediation'),
  ('payment_in_process'),
  ('payment_pending');
insert into auth.users (id)
select user_id from privacy_non_terminal_matrix;
insert into public.orders (
  user_id, provider, idempotency_key, status,
  package_code, package_credits, amount_cents, currency
)
select
  user_id, 'mercado_pago', 'privacy:matrix:' || status, status,
  'analysis_pack_10', 10, 490, 'BRL'
from privacy_non_terminal_matrix;

select extensions.is_empty(
  $$select status from privacy_non_terminal_matrix
    where not (
      public.get_account_erasure_eligibility(user_id)->>'hasOpenCheckout'
    )::boolean$$,
  'every non-terminal order status blocks erasure without provider preference ids'
);

select public.begin_account_erasure(
  (select user_id from privacy_non_terminal_matrix where status = 'checkout_ready')
);
select extensions.is(
  (public.get_account_erasure_eligibility(
    (select user_id from privacy_non_terminal_matrix where status = 'checkout_ready')
  )->>'hasOpenCheckout')::boolean,
  true,
  'checkout created before erasure remains visible after the processing marker'
);
select public.complete_account_erasure(
  (select pr.id from public.privacy_requests pr
   join privacy_non_terminal_matrix matrix on matrix.user_id = pr.user_id
   where matrix.status = 'checkout_ready' and pr.status = 'processing'),
  'failed'
);

insert into public.protected_analysis_receipts (user_id, analysis_id, request_fingerprint, created_at)
values (
  '91000000-0000-4000-8000-000000000002',
  '93000000-0000-4000-8000-000000000001', repeat('a', 64), clock_timestamp() - interval '10 days'
);
insert into public.operational_rate_limits (scope, user_id, window_started_at, request_count)
values
  ('privacy_account', '91000000-0000-4000-8000-000000000002', clock_timestamp() - interval '3 days', 1),
  ('checkout', '91000000-0000-4000-8000-000000000002', clock_timestamp(), 1);

select public.cleanup_expired_operational_data();
select extensions.is(
  (select count(*)::integer from public.operational_rate_limits
   where user_id = '91000000-0000-4000-8000-000000000002'),
  1, 'cleanup removes only expired rate limits'
);
select extensions.is(
  (select count(*)::integer from public.protected_analysis_receipts
   where user_id = '91000000-0000-4000-8000-000000000002'),
  1, 'cleanup preserves idempotency receipts for the account lifetime'
);

select public.begin_account_erasure('91000000-0000-4000-8000-000000000002');
update public.privacy_requests
set requested_at = clock_timestamp() - interval '1 hour'
where user_id = '91000000-0000-4000-8000-000000000002' and status = 'processing';
delete from auth.users where id = '91000000-0000-4000-8000-000000000002';
select extensions.is(
  (select user_id from public.orders where id = '92000000-0000-4000-8000-000000000002'),
  null::uuid, 'account deletion anonymizes financial ownership'
);
select extensions.is(
  (select count(*)::integer from public.protected_analysis_receipts
   where analysis_id = '93000000-0000-4000-8000-000000000001'),
  0, 'account deletion cascades operational receipts'
);
select public.cleanup_expired_operational_data();
select extensions.is(
  (select status from public.privacy_requests where user_id is null order by requested_at desc limit 1),
  'completed', 'cleanup reconciles processing audit after confirmed auth deletion'
);

select * from extensions.finish();
rollback;
