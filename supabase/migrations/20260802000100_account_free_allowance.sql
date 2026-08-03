alter table public.credit_ledger
  drop constraint credit_ledger_entry_type,
  drop constraint credit_ledger_entry_shape;

alter table public.credit_ledger
  add constraint credit_ledger_entry_type check (
    entry_type in (
      'purchase', 'consumption', 'free_grant', 'free_consumption',
      'refund', 'chargeback', 'adjustment', 'migration'
    )
  ),
  add constraint credit_ledger_entry_shape check (
    (entry_type = 'purchase' and credit_delta > 0 and order_id is not null and payment_id is not null)
    or (
      entry_type in ('refund', 'chargeback')
      and credit_delta < 0
      and order_id is not null
      and payment_id is not null
    )
    or (entry_type in ('consumption', 'free_consumption') and credit_delta = -1
      and order_id is null and payment_id is null)
    or (entry_type = 'free_grant' and credit_delta = 2
      and order_id is null and payment_id is null)
    or (entry_type in ('adjustment', 'migration') and credit_delta <> 0)
  );

create unique index credit_ledger_free_grant_user_unique
  on public.credit_ledger (user_id)
  where entry_type = 'free_grant' and user_id is not null;

create or replace function public.grant_account_free_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.credit_ledger (
    user_id, order_id, payment_id, entry_type, credit_delta, idempotency_key
  ) values (
    new.id, null, null, 'free_grant', 2, 'free_grant:' || new.id::text
  ) on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

revoke all on function public.grant_account_free_allowance()
  from public, anon, authenticated;

drop trigger if exists users_grant_account_free_allowance on auth.users;
create trigger users_grant_account_free_allowance
after insert on auth.users
for each row execute function public.grant_account_free_allowance();

insert into public.credit_ledger (
  user_id, order_id, payment_id, entry_type, credit_delta, idempotency_key
)
select
  users.id, null, null, 'free_grant', 2, 'free_grant:' || users.id::text
from auth.users users
on conflict (idempotency_key) do nothing;

drop function public.get_credit_entitlement();
create function public.get_credit_entitlement()
returns table (
  balance bigint,
  free_remaining bigint,
  has_paid_access boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    greatest(coalesce(sum(entry.credit_delta) filter (
      where entry.entry_type not in ('free_grant', 'free_consumption')
    ), 0), 0)::bigint as balance,
    greatest(coalesce(sum(entry.credit_delta) filter (
      where entry.entry_type in ('free_grant', 'free_consumption')
    ), 0), 0)::bigint as free_remaining,
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

drop function public.consume_analysis_credit(uuid, uuid);
create function public.consume_analysis_credit(
  p_user_id uuid,
  p_analysis_id uuid
)
returns table (
  consumed boolean,
  applied boolean,
  balance bigint,
  free_remaining bigint,
  source text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumption_key text;
  current_paid_balance bigint;
  current_free_remaining bigint;
  existing_type text;
begin
  if p_user_id is null or p_analysis_id is null then
    raise exception 'user and analysis identifiers are required';
  end if;

  consumption_key := 'analysis:' || p_user_id::text || ':' || p_analysis_id::text;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select
    coalesce(sum(entry.credit_delta) filter (
      where entry.entry_type not in ('free_grant', 'free_consumption')
    ), 0),
    coalesce(sum(entry.credit_delta) filter (
      where entry.entry_type in ('free_grant', 'free_consumption')
    ), 0)
  into current_paid_balance, current_free_remaining
  from public.credit_ledger entry
  where entry.user_id = p_user_id;

  select entry.entry_type
    into existing_type
    from public.credit_ledger entry
    where entry.idempotency_key = consumption_key
      and entry.user_id = p_user_id
      and entry.entry_type in ('consumption', 'free_consumption')
      and entry.credit_delta = -1;

  if found then
    return query select
      true,
      false,
      greatest(current_paid_balance, 0),
      greatest(current_free_remaining, 0),
      case when existing_type = 'free_consumption' then 'free' else 'paid' end;
    return;
  end if;

  if current_free_remaining > 0 then
    insert into public.credit_ledger (
      user_id, order_id, payment_id, entry_type, credit_delta, idempotency_key
    ) values (
      p_user_id, null, null, 'free_consumption', -1, consumption_key
    );
    return query select
      true, true, greatest(current_paid_balance, 0), current_free_remaining - 1, 'free'::text;
    return;
  end if;

  if current_paid_balance < 1 then
    return query select false, false, 0::bigint, 0::bigint, null::text;
    return;
  end if;

  insert into public.credit_ledger (
    user_id, order_id, payment_id, entry_type, credit_delta, idempotency_key
  ) values (
    p_user_id, null, null, 'consumption', -1, consumption_key
  );

  return query select true, true, current_paid_balance - 1, 0::bigint, 'paid'::text;
end;
$$;

revoke all on function public.consume_analysis_credit(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_analysis_credit(uuid, uuid)
  to service_role;
