create or replace function public.get_credit_entitlement()
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

create or replace function public.get_service_credit_entitlement(p_user_id uuid)
returns table (balance bigint, free_remaining bigint, has_paid_access boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    greatest(coalesce(sum(entry.credit_delta) filter (
      where entry.entry_type not in ('free_grant', 'free_consumption')
    ), 0), 0)::bigint,
    greatest(coalesce(sum(entry.credit_delta) filter (
      where entry.entry_type in ('free_grant', 'free_consumption')
    ), 0), 0)::bigint,
    exists (
      select 1
      from public.credit_ledger purchase
      where purchase.user_id = p_user_id
        and purchase.entry_type = 'purchase'
        and not exists (
          select 1
          from public.credit_ledger reversal
          where reversal.payment_id = purchase.payment_id
            and reversal.entry_type in ('refund', 'chargeback')
        )
    )
  from public.credit_ledger entry
  where entry.user_id = p_user_id;
$$;

revoke all on function public.get_service_credit_entitlement(uuid)
  from public, anon, authenticated;
grant execute on function public.get_service_credit_entitlement(uuid) to service_role;
