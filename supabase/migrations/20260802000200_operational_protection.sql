create table public.operational_rate_limits (
  scope text not null check (scope in ('checkout', 'consume_analysis', 'protected_analysis')),
  user_id uuid not null references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (scope, user_id, window_started_at)
);

alter table public.operational_rate_limits enable row level security;
revoke all on table public.operational_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.operational_rate_limits to service_role;

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
    or p_scope not in ('checkout', 'consume_analysis', 'protected_analysis')
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
    and window_started_at < clock_timestamp() - interval '1 day';

  return v_request_count <= p_limit;
end;
$$;

revoke all on function public.enforce_account_rate_limit(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.enforce_account_rate_limit(uuid, text, integer, integer)
  to service_role;

create or replace view public.billing_reconciliation_anomalies
with (security_invoker = true)
as
select
  'stuck_checkout'::text as anomaly_type,
  orders.id as order_id,
  null::uuid as payment_id,
  orders.updated_at as observed_at
from public.orders
where orders.status in ('creating_preference', 'preference_unknown')
  and orders.updated_at < clock_timestamp() - interval '15 minutes'
union all
select
  'approved_without_purchase'::text,
  payments.order_id,
  payments.id,
  payments.updated_at
from public.payments
where payments.status = 'approved'
  and payments.user_id is not null
  and not exists (
    select 1
    from public.credit_ledger
    where credit_ledger.payment_id = payments.id
      and credit_ledger.entry_type = 'purchase'
  );

revoke all on table public.billing_reconciliation_anomalies from public, anon, authenticated;
grant select on table public.billing_reconciliation_anomalies to service_role;
