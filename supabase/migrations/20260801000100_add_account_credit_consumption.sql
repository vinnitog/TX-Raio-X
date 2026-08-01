create or replace function public.get_credit_entitlement()
returns table (
  balance bigint,
  has_paid_access boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    greatest(coalesce(sum(entry.credit_delta), 0), 0)::bigint as balance,
    exists (
      select 1
      from public.credit_ledger purchase
      where purchase.user_id = (select auth.uid())
        and purchase.entry_type = 'purchase'
        and not exists (
          select 1
          from public.credit_ledger reversal
          where reversal.payment_id = purchase.payment_id
            and reversal.entry_type in ('refund', 'chargeback')
        )
    ) as has_paid_access
  from public.credit_ledger entry
  where entry.user_id = (select auth.uid());
$$;

revoke all on function public.get_credit_entitlement() from public, anon;
grant execute on function public.get_credit_entitlement() to authenticated;

create or replace function public.consume_analysis_credit(
  p_user_id uuid,
  p_analysis_id uuid
)
returns table (
  consumed boolean,
  applied boolean,
  balance bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumption_key text;
  current_balance bigint;
begin
  if p_user_id is null or p_analysis_id is null then
    raise exception 'user and analysis identifiers are required';
  end if;

  consumption_key := 'analysis:' || p_user_id::text || ':' || p_analysis_id::text;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select coalesce(sum(entry.credit_delta), 0)
    into current_balance
    from public.credit_ledger entry
    where entry.user_id = p_user_id;

  if exists (
    select 1
    from public.credit_ledger entry
    where entry.idempotency_key = consumption_key
      and entry.user_id = p_user_id
      and entry.entry_type = 'consumption'
      and entry.credit_delta = -1
  ) then
    return query select true, false, greatest(current_balance, 0);
    return;
  end if;

  if current_balance < 1 then
    return query select false, false, greatest(current_balance, 0);
    return;
  end if;

  insert into public.credit_ledger (
    user_id,
    order_id,
    payment_id,
    entry_type,
    credit_delta,
    idempotency_key
  ) values (
    p_user_id,
    null,
    null,
    'consumption',
    -1,
    consumption_key
  );

  return query select true, true, current_balance - 1;
end;
$$;

revoke all on function public.consume_analysis_credit(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_analysis_credit(uuid, uuid)
  to service_role;
