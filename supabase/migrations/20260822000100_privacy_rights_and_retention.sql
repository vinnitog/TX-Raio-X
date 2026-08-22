alter table public.operational_rate_limits
  drop constraint operational_rate_limits_scope_check;

alter table public.operational_rate_limits
  add constraint operational_rate_limits_scope_check
  check (scope in ('checkout', 'consume_analysis', 'protected_analysis', 'privacy_account'));

create or replace function public.enforce_account_rate_limit(
  p_user_id uuid,
  p_scope text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if p_user_id is null
    or p_scope not in ('checkout', 'consume_analysis', 'protected_analysis', 'privacy_account')
    or p_limit not between 1 and 1000
    or p_window_seconds not between 10 and 86400 then
    raise exception 'invalid rate limit configuration';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_scope || ':' || p_user_id::text, 0));
  v_window_started_at := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.operational_rate_limits (
    scope, user_id, window_started_at, request_count
  ) values (
    p_scope, p_user_id, v_window_started_at, 1
  )
  on conflict (scope, user_id, window_started_at)
  do update set request_count = public.operational_rate_limits.request_count + 1
  returning request_count into v_request_count;

  delete from public.operational_rate_limits
  where user_id = p_user_id
    and scope = p_scope
    and window_started_at < clock_timestamp() - interval '2 days';

  return v_request_count <= p_limit;
end;
$$;

revoke all on function public.enforce_account_rate_limit(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.enforce_account_rate_limit(uuid, text, integer, integer)
  to service_role;

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  request_type text not null check (request_type = 'account_erasure'),
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint privacy_requests_completion_shape check (
    (status = 'processing' and completed_at is null)
    or (status in ('completed', 'failed') and completed_at is not null)
  )
);

create unique index privacy_requests_processing_user_unique
  on public.privacy_requests (user_id, request_type)
  where user_id is not null and status = 'processing';

alter table public.privacy_requests enable row level security;
revoke all on table public.privacy_requests from public, anon, authenticated;
grant select, insert, update on table public.privacy_requests to service_role;

create or replace function public.get_account_privacy_export(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'provider', o.provider,
        'providerPreferenceId', o.provider_preference_id,
        'status', o.status,
        'packageCode', o.package_code,
        'packageCredits', o.package_credits,
        'amountCents', o.amount_cents,
        'currency', o.currency,
        'createdAt', o.created_at,
        'updatedAt', o.updated_at
      ) order by o.created_at desc)
      from public.orders o where o.user_id = p_user_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'orderId', p.order_id,
        'provider', p.provider,
        'providerPaymentId', p.provider_payment_id,
        'status', p.status,
        'amountCents', p.amount_cents,
        'refundedCents', p.refunded_cents,
        'currency', p.currency,
        'approvedAt', p.approved_at,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at
      ) order by p.created_at desc)
      from public.payments p where p.user_id = p_user_id
    ), '[]'::jsonb),
    'creditLedger', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'orderId', l.order_id,
        'paymentId', l.payment_id,
        'entryType', l.entry_type,
        'creditDelta', l.credit_delta,
        'createdAt', l.created_at
      ) order by l.created_at desc)
      from public.credit_ledger l where l.user_id = p_user_id
    ), '[]'::jsonb),
    'analysisReceipts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'analysisId', r.analysis_id,
        'requestFingerprint', r.request_fingerprint,
        'createdAt', r.created_at
      ) order by r.created_at desc)
      from public.protected_analysis_receipts r where r.user_id = p_user_id
    ), '[]'::jsonb),
    'rateLimits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'scope', rl.scope,
        'windowStartedAt', rl.window_started_at,
        'requestCount', rl.request_count
      ) order by rl.window_started_at desc)
      from public.operational_rate_limits rl where rl.user_id = p_user_id
    ), '[]'::jsonb),
    'privacyRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'requestType', pr.request_type,
        'status', pr.status,
        'requestedAt', pr.requested_at,
        'completedAt', pr.completed_at
      ) order by pr.requested_at desc)
      from public.privacy_requests pr where pr.user_id = p_user_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_account_privacy_export(uuid)
  from public, anon, authenticated;
grant execute on function public.get_account_privacy_export(uuid) to service_role;

create or replace function public.get_account_erasure_eligibility(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'paidBalance', greatest(coalesce((
      select sum(l.credit_delta)
      from public.credit_ledger l
      where l.user_id = p_user_id
        and l.entry_type not in ('free_grant', 'free_consumption')
    ), 0), 0),
    'hasOpenCheckout', exists (
      select 1 from public.orders o
      where o.user_id = p_user_id
        and o.status not in (
          'payment_approved', 'payment_rejected', 'payment_cancelled',
          'payment_refunded', 'payment_charged_back', 'preference_failed'
        )
    )
  );
$$;

revoke all on function public.get_account_erasure_eligibility(uuid)
  from public, anon, authenticated;
grant execute on function public.get_account_erasure_eligibility(uuid) to service_role;

create or replace function public.begin_account_erasure(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if p_user_id is null then raise exception 'user is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('privacy-erasure:' || p_user_id::text, 0));

  select id into v_request_id
  from public.privacy_requests
  where user_id = p_user_id and request_type = 'account_erasure' and status = 'processing'
  limit 1;

  if v_request_id is null then
    insert into public.privacy_requests (user_id, request_type)
    values (p_user_id, 'account_erasure') returning id into v_request_id;
  end if;
  return v_request_id;
end;
$$;

revoke all on function public.begin_account_erasure(uuid)
  from public, anon, authenticated;
grant execute on function public.begin_account_erasure(uuid) to service_role;

create or replace function public.guard_checkout_during_erasure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('privacy-erasure:' || new.user_id::text, 0));
  update public.privacy_requests
  set status = 'failed', completed_at = clock_timestamp()
  where user_id = new.user_id
    and request_type = 'account_erasure'
    and status = 'processing'
    and requested_at < clock_timestamp() - interval '15 minutes';
  if exists (
    select 1 from public.privacy_requests pr
    where pr.user_id = new.user_id
      and pr.request_type = 'account_erasure'
      and pr.status = 'processing'
  ) then
    raise exception using errcode = 'P0001', message = 'account_erasure_in_progress';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_checkout_during_erasure()
  from public, anon, authenticated;

create trigger orders_guard_checkout_during_erasure
before insert on public.orders
for each row execute function public.guard_checkout_during_erasure();

create or replace function public.complete_account_erasure(
  p_request_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_request_id is null or p_status not in ('completed', 'failed') then
    raise exception 'invalid erasure completion';
  end if;

  update public.privacy_requests
  set
    status = case
      when p_status = 'completed' or status = 'completed' then 'completed'
      else 'failed'
    end,
    completed_at = clock_timestamp()
  where id = p_request_id and request_type = 'account_erasure';

  return found;
end;
$$;

revoke all on function public.complete_account_erasure(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_account_erasure(uuid, text) to service_role;

create or replace function public.cleanup_expired_operational_data()
returns table (
  rate_limits_deleted bigint,
  failed_privacy_requests_deleted bigint,
  completed_privacy_requests_reconciled bigint,
  stale_privacy_requests_failed bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate_limits bigint;
  v_privacy_requests bigint;
  v_reconciled_requests bigint;
  v_stale_requests bigint;
begin
  delete from public.operational_rate_limits
  where window_started_at < clock_timestamp() - interval '2 days';
  get diagnostics v_rate_limits = row_count;

  delete from public.privacy_requests
  where status = 'failed'
    and completed_at < clock_timestamp() - interval '90 days';
  get diagnostics v_privacy_requests = row_count;

  update public.privacy_requests
  set status = 'completed', completed_at = clock_timestamp()
  where status = 'processing'
    and user_id is null
    and requested_at < clock_timestamp() - interval '15 minutes';
  get diagnostics v_reconciled_requests = row_count;

  update public.privacy_requests
  set status = 'failed', completed_at = clock_timestamp()
  where status = 'processing'
    and user_id is not null
    and requested_at < clock_timestamp() - interval '15 minutes';
  get diagnostics v_stale_requests = row_count;

  return query select v_rate_limits, v_privacy_requests, v_reconciled_requests, v_stale_requests;
end;
$$;

revoke all on function public.cleanup_expired_operational_data()
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_operational_data() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job where jobname = 'tx-raio-x-operational-retention';
    perform cron.schedule(
      'tx-raio-x-operational-retention',
      '17 3 * * *',
      'select public.cleanup_expired_operational_data();'
    );
  end if;
end;
$$;
