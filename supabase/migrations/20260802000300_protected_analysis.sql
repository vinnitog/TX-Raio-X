create table public.protected_analysis_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, analysis_id)
);

alter table public.protected_analysis_receipts enable row level security;
revoke all on table public.protected_analysis_receipts from public, anon, authenticated;
grant select, insert on table public.protected_analysis_receipts to service_role;

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

create or replace function public.finalize_protected_analysis(
  p_user_id uuid,
  p_analysis_id uuid,
  p_request_fingerprint text
)
returns table (
  consumed boolean,
  applied boolean,
  conflict boolean,
  balance bigint,
  free_remaining bigint,
  source text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_existing_fingerprint text;
  v_existing_type text;
  v_paid_balance bigint;
  v_free_remaining bigint;
begin
  if p_user_id is null or p_analysis_id is null
    or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid protected analysis request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  v_key := 'protected-analysis:' || p_user_id::text || ':' || p_analysis_id::text;

  select request_fingerprint
  into v_existing_fingerprint
  from public.protected_analysis_receipts
  where user_id = p_user_id and analysis_id = p_analysis_id;

  if found and v_existing_fingerprint <> p_request_fingerprint then
    return query select false, false, true, 0::bigint, 0::bigint, null::text;
    return;
  end if;

  select
    coalesce(sum(entry.credit_delta) filter (
      where entry.entry_type not in ('free_grant', 'free_consumption')
    ), 0),
    coalesce(sum(entry.credit_delta) filter (
      where entry.entry_type in ('free_grant', 'free_consumption')
    ), 0)
  into v_paid_balance, v_free_remaining
  from public.credit_ledger entry
  where entry.user_id = p_user_id;

  select entry.entry_type
  into v_existing_type
  from public.credit_ledger entry
  where entry.user_id = p_user_id
    and entry.idempotency_key = v_key
    and entry.entry_type in ('free_consumption', 'consumption')
    and entry.credit_delta = -1;

  if found then
    return query select
      true, false, false,
      greatest(v_paid_balance, 0), greatest(v_free_remaining, 0),
      case when v_existing_type = 'free_consumption' then 'free' else 'paid' end;
    return;
  end if;

  if v_free_remaining < 1 and v_paid_balance < 1 then
    return query select false, false, false, 0::bigint, 0::bigint, null::text;
    return;
  end if;

  insert into public.protected_analysis_receipts (
    user_id, analysis_id, request_fingerprint
  ) values (
    p_user_id, p_analysis_id, p_request_fingerprint
  ) on conflict (user_id, analysis_id) do nothing;

  if v_free_remaining > 0 then
    insert into public.credit_ledger (
      user_id, order_id, payment_id, entry_type, credit_delta, idempotency_key
    ) values (
      p_user_id, null, null, 'free_consumption', -1, v_key
    );
    return query select
      true, true, false, greatest(v_paid_balance, 0), v_free_remaining - 1, 'free'::text;
    return;
  end if;

  insert into public.credit_ledger (
    user_id, order_id, payment_id, entry_type, credit_delta, idempotency_key
  ) values (
    p_user_id, null, null, 'consumption', -1, v_key
  );
  return query select true, true, false, v_paid_balance - 1, 0::bigint, 'paid'::text;
end;
$$;

revoke all on function public.finalize_protected_analysis(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.finalize_protected_analysis(uuid, uuid, text)
  to service_role;
