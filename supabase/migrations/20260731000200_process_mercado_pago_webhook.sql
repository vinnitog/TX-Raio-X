alter table public.payments
  add column provider_updated_at timestamptz;

create or replace function public.enforce_payment_order_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_user_id uuid;
  expected_provider text;
  expected_amount_cents integer;
  expected_currency text;
begin
  if tg_op = 'UPDATE'
    and old.user_id is not null
    and new.user_id is null
    and (to_jsonb(new) - 'user_id' - 'updated_at')
      = (to_jsonb(old) - 'user_id' - 'updated_at') then
    return new;
  end if;

  if tg_op = 'UPDATE' and (
    new.order_id is distinct from old.order_id
    or new.provider is distinct from old.provider
    or new.provider_payment_id is distinct from old.provider_payment_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.amount_cents is distinct from old.amount_cents
    or new.currency is distinct from old.currency
  ) then
    raise exception 'payment identity and amount are immutable';
  end if;

  select user_id, provider, amount_cents, currency
    into expected_user_id, expected_provider, expected_amount_cents, expected_currency
    from public.orders
    where id = new.order_id;

  if not found then
    raise exception 'payment order does not exist';
  end if;

  if tg_op = 'INSERT' and new.user_id is null and expected_user_id is not null then
    raise exception 'payments require their order owner';
  end if;

  if new.user_id is distinct from expected_user_id
    or new.provider is distinct from expected_provider
    or new.amount_cents is distinct from expected_amount_cents
    or new.currency is distinct from expected_currency then
    raise exception 'payment does not match its order';
  end if;

  return new;
end;
$$;

create or replace function public.process_mercado_pago_payment(
  p_order_id uuid,
  p_provider_payment_id text,
  p_status text,
  p_status_detail text,
  p_amount_cents integer,
  p_refunded_cents integer,
  p_currency text,
  p_approved_at timestamptz,
  p_provider_updated_at timestamptz
)
returns table (
  payment_id uuid,
  credited boolean,
  reversed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_order public.orders%rowtype;
  persisted_payment public.payments%rowtype;
  credit_inserted boolean := false;
  reversal_inserted boolean := false;
  affected_rows integer := 0;
  reversal_type text;
  has_existing_payment boolean := false;
begin
  if p_provider_payment_id !~ '^[0-9]{1,32}$'
    or p_status not in (
      'approved', 'authorized', 'cancelled', 'charged_back', 'in_mediation',
      'in_process', 'pending', 'refunded', 'rejected'
    )
    or (p_status_detail is not null and length(p_status_detail) > 120)
    or p_amount_cents <= 0
    or p_refunded_cents < 0
    or p_refunded_cents > p_amount_cents
    or p_currency !~ '^[A-Z]{3}$'
    or p_provider_updated_at is null then
    raise exception 'invalid Mercado Pago payment snapshot';
  end if;

  select * into locked_order
    from public.orders
    where id = p_order_id
    for update;

  if not found
    or locked_order.provider is distinct from 'mercado_pago'
    or locked_order.amount_cents is distinct from p_amount_cents
    or locked_order.currency is distinct from p_currency then
    raise exception 'payment does not match its order';
  end if;

  select * into persisted_payment
    from public.payments
    where provider = 'mercado_pago'
      and provider_payment_id = p_provider_payment_id
    for update;
  has_existing_payment := found;

  if has_existing_payment and (
    persisted_payment.order_id is distinct from locked_order.id
    or persisted_payment.user_id is distinct from locked_order.user_id
    or persisted_payment.amount_cents is distinct from locked_order.amount_cents
    or persisted_payment.currency is distinct from locked_order.currency
  ) then
    raise exception 'provider payment identity conflict';
  end if;

  if has_existing_payment and (
    persisted_payment.provider_updated_at > p_provider_updated_at
    or (
      persisted_payment.status in ('refunded', 'charged_back')
      and p_status not in ('refunded', 'charged_back')
    )
  ) then
    return query select persisted_payment.id, false, false;
    return;
  end if;

  if has_existing_payment then
    update public.payments set
      status = p_status,
      status_detail = p_status_detail,
      refunded_cents = p_refunded_cents,
      approved_at = coalesce(p_approved_at, approved_at),
      provider_updated_at = p_provider_updated_at
    where id = persisted_payment.id
    returning * into persisted_payment;
  else
    insert into public.payments (
      order_id,
      user_id,
      provider,
      provider_payment_id,
      idempotency_key,
      status,
      status_detail,
      amount_cents,
      refunded_cents,
      currency,
      approved_at,
      provider_updated_at
    ) values (
      locked_order.id,
      locked_order.user_id,
      'mercado_pago',
      p_provider_payment_id,
      'mercado_pago:payment:' || p_provider_payment_id,
      p_status,
      p_status_detail,
      p_amount_cents,
      p_refunded_cents,
      p_currency,
      p_approved_at,
      p_provider_updated_at
    )
    returning * into persisted_payment;
  end if;

  if p_status = 'approved' and locked_order.user_id is not null then
    insert into public.credit_ledger (
      user_id, order_id, payment_id, entry_type, credit_delta, idempotency_key
    ) values (
      locked_order.user_id,
      locked_order.id,
      persisted_payment.id,
      'purchase',
      locked_order.package_credits,
      'mercado_pago:payment:' || p_provider_payment_id || ':purchase'
    )
    on conflict do nothing;
    get diagnostics affected_rows = row_count;
    credit_inserted := affected_rows = 1;
  elsif p_status = 'charged_back'
    or (p_status = 'refunded' and p_refunded_cents = p_amount_cents) then
    reversal_type := case when p_status = 'charged_back' then 'chargeback' else 'refund' end;

    if exists (
      select 1 from public.credit_ledger purchase_entry
      where purchase_entry.payment_id = persisted_payment.id
        and purchase_entry.entry_type = 'purchase'
    ) then
      insert into public.credit_ledger (
        user_id, order_id, payment_id, entry_type, credit_delta, idempotency_key
      ) values (
        locked_order.user_id,
        locked_order.id,
        persisted_payment.id,
        reversal_type,
        -locked_order.package_credits,
        'mercado_pago:payment:' || p_provider_payment_id || ':reversal'
      )
      on conflict do nothing;
      get diagnostics affected_rows = row_count;
      reversal_inserted := affected_rows = 1;
    end if;
  end if;

  if exists (
    select 1
    from public.credit_ledger purchase
    where purchase.order_id = locked_order.id
      and purchase.entry_type = 'purchase'
      and not exists (
        select 1 from public.credit_ledger reversal
        where reversal.payment_id = purchase.payment_id
          and reversal.entry_type in ('refund', 'chargeback')
      )
  ) then
    update public.orders set status = 'payment_approved'
    where id = locked_order.id;
  elsif exists (
    select 1 from public.credit_ledger
    where order_id = locked_order.id and entry_type in ('refund', 'chargeback')
  ) then
    update public.orders set status = case
      when exists (
        select 1 from public.payments
        where order_id = locked_order.id and status = 'charged_back'
      ) or exists (
        select 1 from public.credit_ledger
        where order_id = locked_order.id and entry_type = 'chargeback'
      ) then 'payment_charged_back'
      when exists (
        select 1 from public.credit_ledger
        where order_id = locked_order.id
          and entry_type = 'refund'
      ) then 'payment_refunded'
      else status
    end
    where id = locked_order.id;
  else
    update public.orders
      set status = 'payment_' || p_status
      where id = locked_order.id;
  end if;

  return query select persisted_payment.id, credit_inserted, reversal_inserted;
end;
$$;

revoke all on function public.process_mercado_pago_payment(
  uuid, text, text, text, integer, integer, text, timestamptz, timestamptz
) from public, anon, authenticated;

grant execute on function public.process_mercado_pago_payment(
  uuid, text, text, text, integer, integer, text, timestamptz, timestamptz
) to service_role;
