-- Switch all active billing flows to Stripe while preserving legacy provider rows.
alter table public.orders rename column provider_preference_id to provider_checkout_session_id;
alter table public.orders rename constraint orders_provider_preference_not_blank to orders_provider_checkout_session_not_blank;
alter index public.orders_provider_preference_unique rename to orders_provider_checkout_session_unique;

alter table public.orders add column provider_environment text not null default 'test';
alter table public.orders add column provider_price_id text;
alter table public.payments add column provider_environment text not null default 'test';
alter table public.orders alter column provider set default 'stripe';
alter table public.payments alter column provider set default 'stripe';
alter table public.orders add constraint orders_provider_environment_check check (provider_environment in ('test', 'live'));
alter table public.payments add constraint payments_provider_environment_check check (provider_environment in ('test', 'live'));
alter table public.orders add constraint orders_stripe_price_snapshot_check check (
  (provider = 'stripe' and provider_price_id ~ '^price_[A-Za-z0-9]{8,255}$')
  or (provider <> 'stripe' and provider_price_id is null)
);

drop index public.orders_provider_checkout_session_unique;
create unique index orders_provider_checkout_session_unique
  on public.orders (provider, provider_environment, provider_checkout_session_id)
  where provider_checkout_session_id is not null;
create unique index orders_one_open_stripe_checkout_per_user
  on public.orders (user_id, provider_environment)
  where provider = 'stripe' and user_id is not null
    and status in ('creating_checkout', 'checkout_unknown', 'checkout_ready');

alter table public.payments drop constraint payments_provider_provider_payment_id_key;
alter table public.payments add constraint payments_provider_environment_payment_unique
  unique (provider, provider_environment, provider_payment_id);

create table public.billing_webhook_events (
  provider text not null,
  provider_environment text not null check (provider_environment in ('test', 'live')),
  provider_event_id text not null,
  event_type text not null,
  processed_at timestamptz not null default now(),
  primary key (provider, provider_environment, provider_event_id),
  constraint billing_webhook_events_provider_format check (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint billing_webhook_events_event_not_blank check (length(btrim(provider_event_id)) > 0),
  constraint billing_webhook_events_type_length check (length(event_type) between 1 and 120)
);
alter table public.billing_webhook_events enable row level security;
revoke all on table public.billing_webhook_events from public, anon, authenticated;
grant select, insert on table public.billing_webhook_events to service_role;

create or replace function public.enforce_order_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.user_id is null then raise exception 'orders require an authenticated owner'; end if;
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    if old.user_id is not null and new.user_id is null
      and (to_jsonb(new) - 'user_id' - 'updated_at') = (to_jsonb(old) - 'user_id' - 'updated_at') then return new; end if;
    raise exception 'order owner is immutable';
  end if;
  if tg_op = 'UPDATE' and (
    new.provider is distinct from old.provider or new.provider_environment is distinct from old.provider_environment
    or new.provider_price_id is distinct from old.provider_price_id
    or new.idempotency_key is distinct from old.idempotency_key or new.package_code is distinct from old.package_code
    or new.package_credits is distinct from old.package_credits or new.amount_cents is distinct from old.amount_cents
    or new.currency is distinct from old.currency
  ) then raise exception 'order commercial snapshot is immutable'; end if;
  return new;
end;
$$;

create or replace function public.create_or_get_stripe_checkout_order(
  p_user_id uuid, p_provider_environment text, p_idempotency_key text,
  p_package_code text, p_package_credits integer, p_amount_cents integer,
  p_currency text, p_provider_price_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare existing_order public.orders%rowtype;
begin
  if p_user_id is null or p_provider_environment not in ('test', 'live')
    or p_idempotency_key !~* '^stripe:(test|live):checkout:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_package_code !~ '^[a-z][a-z0-9_]{1,79}$' or p_package_credits <= 0
    or p_amount_cents <= 0 or p_currency !~ '^[A-Z]{3}$'
    or p_provider_price_id !~ '^price_[A-Za-z0-9]{8,255}$'
  then raise exception 'invalid Stripe order snapshot'; end if;

  perform pg_advisory_xact_lock(hashtextextended('privacy-erasure:' || p_user_id::text, 0));
  -- An exact retry must recover the same rejected order. This keeps the
  -- Stripe idempotency key stable after a synchronous API rejection while a
  -- different key can still start a fresh checkout after an async failure.
  select * into existing_order from public.orders
  where user_id = p_user_id and provider = 'stripe'
    and provider_environment = p_provider_environment
    and idempotency_key = p_idempotency_key
    and status in ('creating_checkout', 'checkout_unknown', 'checkout_ready', 'payment_rejected')
  limit 1 for update;

  if found then
    if existing_order.package_code is distinct from p_package_code
      or existing_order.package_credits is distinct from p_package_credits
      or existing_order.amount_cents is distinct from p_amount_cents
      or existing_order.currency is distinct from p_currency
    then raise exception 'checkout idempotency terms conflict'; end if;
    return jsonb_build_object('created', false, 'order', to_jsonb(existing_order));
  end if;

  select * into existing_order from public.orders
  where user_id = p_user_id and provider = 'stripe'
    and provider_environment = p_provider_environment
    and status in ('creating_checkout', 'checkout_unknown', 'checkout_ready')
  order by created_at desc limit 1 for update;

  if found then
    if existing_order.package_code is distinct from p_package_code
      or existing_order.package_credits is distinct from p_package_credits
      or existing_order.amount_cents is distinct from p_amount_cents
      or existing_order.currency is distinct from p_currency
    then raise exception 'open checkout terms conflict'; end if;
    return jsonb_build_object('created', false, 'order', to_jsonb(existing_order));
  end if;

  insert into public.orders (
    user_id, provider, provider_environment, provider_price_id, idempotency_key,
    status, package_code, package_credits, amount_cents, currency
  ) values (
    p_user_id, 'stripe', p_provider_environment, p_provider_price_id,
    p_idempotency_key, 'creating_checkout', p_package_code,
    p_package_credits, p_amount_cents, p_currency
  ) returning * into existing_order;
  return jsonb_build_object('created', true, 'order', to_jsonb(existing_order));
end;
$$;
revoke all on function public.create_or_get_stripe_checkout_order(uuid, text, text, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.create_or_get_stripe_checkout_order(uuid, text, text, text, integer, integer, text, text) to service_role;

create or replace function public.enforce_payment_order_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_user_id uuid; expected_provider text; expected_environment text;
  expected_amount_cents integer; expected_currency text;
begin
  if tg_op = 'UPDATE' and old.user_id is not null and new.user_id is null
    and (to_jsonb(new) - 'user_id' - 'updated_at') = (to_jsonb(old) - 'user_id' - 'updated_at') then return new; end if;
  if tg_op = 'UPDATE' and (
    new.order_id is distinct from old.order_id or new.provider is distinct from old.provider
    or new.provider_environment is distinct from old.provider_environment
    or new.provider_payment_id is distinct from old.provider_payment_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.amount_cents is distinct from old.amount_cents or new.currency is distinct from old.currency
  ) then raise exception 'payment identity and amount are immutable'; end if;
  select user_id, provider, provider_environment, amount_cents, currency
    into expected_user_id, expected_provider, expected_environment, expected_amount_cents, expected_currency
    from public.orders where id = new.order_id;
  if not found then raise exception 'payment order does not exist'; end if;
  if tg_op = 'INSERT' and new.user_id is null and expected_user_id is not null then raise exception 'payments require their order owner'; end if;
  if new.user_id is distinct from expected_user_id or new.provider is distinct from expected_provider
    or new.provider_environment is distinct from expected_environment
    or new.amount_cents is distinct from expected_amount_cents or new.currency is distinct from expected_currency
  then raise exception 'payment does not match its order'; end if;
  return new;
end;
$$;

drop function if exists public.process_mercado_pago_payment(uuid, text, text, text, integer, integer, text, timestamptz, timestamptz);

create or replace function public.process_stripe_payment(
  p_event_id text, p_provider_environment text, p_event_type text, p_order_id uuid,
  p_provider_payment_id text, p_status text, p_status_detail text,
  p_amount_cents integer, p_refunded_cents integer, p_currency text,
  p_approved_at timestamptz, p_provider_updated_at timestamptz
)
returns table (payment_id uuid, credited boolean, reversed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_order public.orders%rowtype; persisted_payment public.payments%rowtype;
  credit_inserted boolean := false; reversal_inserted boolean := false;
  affected_rows integer := 0; reversal_type text; has_existing_payment boolean := false;
begin
  if p_event_id !~ '^evt_[A-Za-z0-9]{8,255}$' or p_provider_payment_id !~ '^pi_[A-Za-z0-9]{8,255}$'
    or p_provider_environment not in ('test', 'live')
    or p_event_type not in ('checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'payment_intent.payment_failed', 'charge.refunded', 'charge.dispute.created')
    or p_status not in ('approved', 'rejected', 'partially_refunded', 'refunded', 'charged_back')
    or (p_status_detail is not null and length(p_status_detail) > 120)
    or p_amount_cents <= 0 or p_refunded_cents < 0 or p_refunded_cents > p_amount_cents
    or p_currency !~ '^[A-Z]{3}$' or p_provider_updated_at is null
  then raise exception 'invalid Stripe payment snapshot'; end if;

  insert into public.billing_webhook_events (provider, provider_environment, provider_event_id, event_type)
  values ('stripe', p_provider_environment, p_event_id, p_event_type)
  on conflict do nothing;
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then
    return query select p.id, false, false from public.payments p
      where p.provider = 'stripe' and p.provider_environment = p_provider_environment
        and p.provider_payment_id = p_provider_payment_id;
    return;
  end if;

  select * into locked_order from public.orders where id = p_order_id for update;
  if not found or locked_order.provider is distinct from 'stripe'
    or locked_order.provider_environment is distinct from p_provider_environment
    or locked_order.amount_cents is distinct from p_amount_cents
    or locked_order.currency is distinct from p_currency
  then raise exception 'payment does not match its order'; end if;

  select * into persisted_payment from public.payments
    where provider = 'stripe' and provider_environment = p_provider_environment
      and provider_payment_id = p_provider_payment_id for update;
  has_existing_payment := found;
  if has_existing_payment and (
    persisted_payment.order_id is distinct from locked_order.id
    or persisted_payment.user_id is distinct from locked_order.user_id
    or persisted_payment.amount_cents is distinct from locked_order.amount_cents
    or persisted_payment.currency is distinct from locked_order.currency
  ) then raise exception 'provider payment identity conflict'; end if;
  if has_existing_payment and not (
    persisted_payment.status = 'partially_refunded' and p_status = 'approved'
  ) and (
    persisted_payment.provider_updated_at > p_provider_updated_at
    or (persisted_payment.status in ('refunded', 'charged_back') and p_status not in ('refunded', 'charged_back'))
    or (persisted_payment.status = 'approved' and p_status = 'rejected')
  ) then return query select persisted_payment.id, false, false; return; end if;

  if has_existing_payment and persisted_payment.status = 'partially_refunded' and p_status = 'approved' then
    update public.payments set
      status = 'approved',
      approved_at = coalesce(p_approved_at, approved_at),
      provider_updated_at = greatest(provider_updated_at, p_provider_updated_at)
    where id = persisted_payment.id returning * into persisted_payment;
  elsif has_existing_payment then
    update public.payments set status = p_status, status_detail = p_status_detail,
      refunded_cents = p_refunded_cents, approved_at = coalesce(p_approved_at, approved_at),
      provider_updated_at = p_provider_updated_at
    where id = persisted_payment.id returning * into persisted_payment;
  else
    insert into public.payments (
      order_id, user_id, provider, provider_environment, provider_payment_id, idempotency_key,
      status, status_detail, amount_cents, refunded_cents, currency, approved_at, provider_updated_at
    ) values (
      locked_order.id, locked_order.user_id, 'stripe', p_provider_environment, p_provider_payment_id,
      'stripe:' || p_provider_environment || ':payment:' || p_provider_payment_id,
      p_status, p_status_detail, p_amount_cents, p_refunded_cents, p_currency, p_approved_at, p_provider_updated_at
    ) returning * into persisted_payment;
  end if;

  if p_status = 'approved' and locked_order.user_id is not null then
    insert into public.credit_ledger (user_id, order_id, payment_id, entry_type, credit_delta, idempotency_key)
    values (locked_order.user_id, locked_order.id, persisted_payment.id, 'purchase', locked_order.package_credits,
      'stripe:' || p_provider_environment || ':payment:' || p_provider_payment_id || ':purchase')
    on conflict do nothing;
    get diagnostics affected_rows = row_count; credit_inserted := affected_rows = 1;
  elsif p_status = 'charged_back' or (p_status = 'refunded' and p_refunded_cents = p_amount_cents) then
    reversal_type := case when p_status = 'charged_back' then 'chargeback' else 'refund' end;
    if exists (select 1 from public.credit_ledger ledger where ledger.payment_id = persisted_payment.id and ledger.entry_type = 'purchase') then
      insert into public.credit_ledger (user_id, order_id, payment_id, entry_type, credit_delta, idempotency_key)
      values (locked_order.user_id, locked_order.id, persisted_payment.id, reversal_type, -locked_order.package_credits,
        'stripe:' || p_provider_environment || ':payment:' || p_provider_payment_id || ':reversal')
      on conflict do nothing;
      get diagnostics affected_rows = row_count; reversal_inserted := affected_rows = 1;
    end if;
  end if;

  if exists (
    select 1 from public.credit_ledger purchase where purchase.order_id = locked_order.id and purchase.entry_type = 'purchase'
      and not exists (select 1 from public.credit_ledger reversal where reversal.payment_id = purchase.payment_id and reversal.entry_type in ('refund', 'chargeback'))
  ) then update public.orders set status = 'payment_approved' where id = locked_order.id;
  elsif exists (select 1 from public.credit_ledger ledger where ledger.order_id = locked_order.id and ledger.entry_type in ('refund', 'chargeback')) then
    update public.orders set status = case
      when exists (select 1 from public.payments payment where payment.order_id = locked_order.id and payment.status = 'charged_back') then 'payment_charged_back'
      when exists (select 1 from public.credit_ledger ledger where ledger.order_id = locked_order.id and ledger.entry_type = 'refund') then 'payment_refunded'
      else status end where id = locked_order.id;
  else update public.orders set status = case
    when p_status = 'rejected' and p_event_type = 'payment_intent.payment_failed'
      then case
        when locked_order.status in ('creating_checkout', 'checkout_unknown', 'checkout_ready') then 'checkout_ready'
        else locked_order.status
      end
    else 'payment_' || p_status
  end where id = locked_order.id;
  end if;
  return query select persisted_payment.id, credit_inserted, reversal_inserted;
end;
$$;

revoke all on function public.process_stripe_payment(text, text, text, uuid, text, text, text, integer, integer, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.process_stripe_payment(text, text, text, uuid, text, text, text, integer, integer, text, timestamptz, timestamptz) to service_role;

create or replace function public.process_stripe_checkout_expiration(
  p_event_id text, p_provider_environment text, p_order_id uuid,
  p_provider_checkout_session_id text, p_provider_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare affected_rows integer := 0; locked_order public.orders%rowtype;
begin
  if p_event_id !~ '^evt_[A-Za-z0-9]{8,255}$'
    or p_provider_environment not in ('test', 'live')
    or p_provider_checkout_session_id !~ '^cs_(test|live)_[A-Za-z0-9]{8,255}$'
    or p_provider_updated_at is null then raise exception 'invalid Stripe expiration snapshot'; end if;
  insert into public.billing_webhook_events (provider, provider_environment, provider_event_id, event_type)
  values ('stripe', p_provider_environment, p_event_id, 'checkout.session.expired')
  on conflict do nothing;
  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then return false; end if;
  select * into locked_order from public.orders where id = p_order_id for update;
  if not found or locked_order.provider is distinct from 'stripe'
    or locked_order.provider_environment is distinct from p_provider_environment
    or locked_order.provider_checkout_session_id is distinct from p_provider_checkout_session_id
  then raise exception 'expiration does not match its order'; end if;
  if locked_order.status in ('payment_approved', 'payment_refunded', 'payment_charged_back') then return false; end if;
  update public.orders set status = 'payment_cancelled' where id = p_order_id;
  return true;
end;
$$;
revoke all on function public.process_stripe_checkout_expiration(text, text, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.process_stripe_checkout_expiration(text, text, uuid, text, timestamptz) to service_role;

create or replace view public.billing_reconciliation_anomalies
with (security_invoker = true)
as
select 'stuck_checkout'::text as anomaly_type, orders.id as order_id,
  null::uuid as payment_id, orders.updated_at as observed_at
from public.orders
where orders.status in ('creating_checkout', 'checkout_unknown')
  and orders.updated_at < clock_timestamp() - interval '15 minutes'
union all
select 'approved_without_purchase'::text, payments.order_id, payments.id, payments.updated_at
from public.payments
where payments.status = 'approved' and payments.user_id is not null
  and not exists (
    select 1 from public.credit_ledger
    where credit_ledger.payment_id = payments.id and credit_ledger.entry_type = 'purchase'
  );
revoke all on table public.billing_reconciliation_anomalies from public, anon, authenticated;
grant select on table public.billing_reconciliation_anomalies to service_role;

create or replace function public.get_account_privacy_export(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'provider', o.provider, 'providerEnvironment', o.provider_environment,
      'providerCheckoutSessionId', o.provider_checkout_session_id, 'status', o.status,
      'packageCode', o.package_code, 'packageCredits', o.package_credits,
      'amountCents', o.amount_cents, 'currency', o.currency,
      'createdAt', o.created_at, 'updatedAt', o.updated_at) order by o.created_at desc)
      from public.orders o where o.user_id = p_user_id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'orderId', p.order_id, 'provider', p.provider,
      'providerEnvironment', p.provider_environment, 'providerPaymentId', p.provider_payment_id,
      'status', p.status, 'amountCents', p.amount_cents, 'refundedCents', p.refunded_cents,
      'currency', p.currency, 'approvedAt', p.approved_at,
      'createdAt', p.created_at, 'updatedAt', p.updated_at) order by p.created_at desc)
      from public.payments p where p.user_id = p_user_id), '[]'::jsonb),
    'creditLedger', coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'orderId', l.order_id, 'paymentId', l.payment_id,
      'entryType', l.entry_type, 'creditDelta', l.credit_delta, 'createdAt', l.created_at) order by l.created_at desc)
      from public.credit_ledger l where l.user_id = p_user_id), '[]'::jsonb),
    'analysisReceipts', coalesce((select jsonb_agg(jsonb_build_object(
      'analysisId', r.analysis_id, 'requestFingerprint', r.request_fingerprint, 'createdAt', r.created_at) order by r.created_at desc)
      from public.protected_analysis_receipts r where r.user_id = p_user_id), '[]'::jsonb),
    'rateLimits', coalesce((select jsonb_agg(jsonb_build_object(
      'scope', rl.scope, 'windowStartedAt', rl.window_started_at, 'requestCount', rl.request_count) order by rl.window_started_at desc)
      from public.operational_rate_limits rl where rl.user_id = p_user_id), '[]'::jsonb),
    'privacyRequests', coalesce((select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'requestType', pr.request_type, 'status', pr.status,
      'requestedAt', pr.requested_at, 'completedAt', pr.completed_at) order by pr.requested_at desc)
      from public.privacy_requests pr where pr.user_id = p_user_id), '[]'::jsonb)
  );
$$;
revoke all on function public.get_account_privacy_export(uuid) from public, anon, authenticated;
grant execute on function public.get_account_privacy_export(uuid) to service_role;
