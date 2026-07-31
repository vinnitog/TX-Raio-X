create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  provider text not null default 'mercado_pago',
  provider_preference_id text,
  idempotency_key text not null unique,
  status text not null default 'created',
  package_code text not null,
  package_credits integer not null,
  amount_cents integer not null,
  currency text not null default 'BRL',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_provider_format check (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint orders_status_format check (status ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint orders_package_code_format check (package_code ~ '^[a-z][a-z0-9_]{1,79}$'),
  constraint orders_package_credits_positive check (package_credits > 0),
  constraint orders_amount_cents_positive check (amount_cents > 0),
  constraint orders_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint orders_provider_preference_not_blank check (
    provider_preference_id is null or length(btrim(provider_preference_id)) > 0
  ),
  constraint orders_idempotency_not_blank check (length(btrim(idempotency_key)) > 0)
);

create unique index orders_provider_preference_unique
  on public.orders (provider, provider_preference_id)
  where provider_preference_id is not null;

create index orders_user_created_idx
  on public.orders (user_id, created_at desc)
  where user_id is not null;

create index orders_status_created_idx
  on public.orders (status, created_at desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null default 'mercado_pago',
  provider_payment_id text not null,
  idempotency_key text not null unique,
  status text not null,
  status_detail text,
  amount_cents integer not null,
  refunded_cents integer not null default 0,
  currency text not null default 'BRL',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_provider_format check (provider ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint payments_status_format check (status ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint payments_status_detail_length check (
    status_detail is null or char_length(status_detail) <= 120
  ),
  constraint payments_provider_payment_not_blank check (
    length(btrim(provider_payment_id)) > 0
  ),
  constraint payments_idempotency_not_blank check (length(btrim(idempotency_key)) > 0),
  constraint payments_amount_cents_positive check (amount_cents > 0),
  constraint payments_refunded_cents_valid check (
    refunded_cents >= 0 and refunded_cents <= amount_cents
  ),
  constraint payments_currency_format check (currency ~ '^[A-Z]{3}$'),
  unique (provider, provider_payment_id)
);

create index payments_order_created_idx
  on public.payments (order_id, created_at desc);

create index payments_user_created_idx
  on public.payments (user_id, created_at desc)
  where user_id is not null;

create index payments_status_created_idx
  on public.payments (status, created_at desc);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  entry_type text not null,
  credit_delta integer not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  constraint credit_ledger_entry_type check (
    entry_type in ('purchase', 'consumption', 'refund', 'chargeback', 'adjustment', 'migration')
  ),
  constraint credit_ledger_nonzero check (credit_delta <> 0),
  constraint credit_ledger_idempotency_not_blank check (length(btrim(idempotency_key)) > 0),
  constraint credit_ledger_entry_shape check (
    (entry_type = 'purchase' and credit_delta > 0 and order_id is not null and payment_id is not null)
    or (
      entry_type in ('refund', 'chargeback')
      and credit_delta < 0
      and order_id is not null
      and payment_id is not null
    )
    or (entry_type = 'consumption' and credit_delta < 0)
    or (entry_type in ('adjustment', 'migration') and credit_delta <> 0)
  )
);

create index credit_ledger_user_created_idx
  on public.credit_ledger (user_id, created_at desc)
  where user_id is not null;

create index credit_ledger_order_idx
  on public.credit_ledger (order_id)
  where order_id is not null;

create index credit_ledger_payment_idx
  on public.credit_ledger (payment_id)
  where payment_id is not null;

create unique index credit_ledger_purchase_payment_unique
  on public.credit_ledger (payment_id)
  where entry_type = 'purchase';

create unique index credit_ledger_reversal_payment_unique
  on public.credit_ledger (payment_id)
  where entry_type in ('refund', 'chargeback');

create or replace function public.enforce_order_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.user_id is null then
    raise exception 'orders require an authenticated owner';
  end if;

  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    if old.user_id is not null
      and new.user_id is null
      and (to_jsonb(new) - 'user_id' - 'updated_at')
        = (to_jsonb(old) - 'user_id' - 'updated_at') then
      return new;
    end if;

    raise exception 'order owner is immutable';
  end if;

  if tg_op = 'UPDATE' and (
    new.provider is distinct from old.provider
    or new.idempotency_key is distinct from old.idempotency_key
    or new.package_code is distinct from old.package_code
    or new.package_credits is distinct from old.package_credits
    or new.amount_cents is distinct from old.amount_cents
    or new.currency is distinct from old.currency
  ) then
    raise exception 'order commercial snapshot is immutable';
  end if;

  return new;
end;
$$;

create trigger orders_enforce_owner
before insert or update on public.orders
for each row execute function public.enforce_order_owner();

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

  if tg_op = 'INSERT' and new.user_id is null then
    raise exception 'payments require an authenticated owner';
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

create trigger payments_enforce_order_integrity
before insert or update on public.payments
for each row execute function public.enforce_payment_order_integrity();

create or replace function public.enforce_credit_ledger_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_user_id uuid;
  order_credits integer;
  payment_user_id uuid;
  payment_order_id uuid;
  payment_status text;
  payment_amount_cents integer;
  payment_refunded_cents integer;
begin
  if new.user_id is null and new.entry_type not in ('refund', 'chargeback') then
    raise exception 'credit ledger entries require an authenticated owner';
  end if;

  if new.order_id is not null then
    select user_id, package_credits
      into order_user_id, order_credits
      from public.orders
      where id = new.order_id;

    if not found or order_user_id is distinct from new.user_id then
      raise exception 'credit ledger order ownership mismatch';
    end if;
  end if;

  if new.payment_id is not null then
    select user_id, order_id, status, amount_cents, refunded_cents
      into payment_user_id, payment_order_id, payment_status,
        payment_amount_cents, payment_refunded_cents
      from public.payments
      where id = new.payment_id;

    if not found or payment_user_id is distinct from new.user_id then
      raise exception 'credit ledger payment ownership mismatch';
    end if;
  end if;

  if new.entry_type = 'purchase' and (
    payment_order_id is distinct from new.order_id
    or new.credit_delta is distinct from order_credits
    or payment_status is distinct from 'approved'
  ) then
    raise exception 'purchase ledger entry requires its matching approved payment';
  end if;

  if new.entry_type in ('refund', 'chargeback') and (
    payment_order_id is distinct from new.order_id
    or new.credit_delta is distinct from -order_credits
    or (
      new.entry_type = 'refund'
      and (
        payment_status is distinct from 'refunded'
        or payment_refunded_cents is distinct from payment_amount_cents
      )
    )
    or (
      new.entry_type = 'chargeback'
      and payment_status is distinct from 'charged_back'
    )
  ) then
    raise exception 'credit reversal requires its matching fully reversed payment';
  end if;

  return new;
end;
$$;

create trigger credit_ledger_enforce_integrity
before insert on public.credit_ledger
for each row execute function public.enforce_credit_ledger_integrity();

create or replace function public.set_billing_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_billing_updated_at();

create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_billing_updated_at();

create or replace function public.protect_credit_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.user_id is not null
    and new.user_id is null
    and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;

  raise exception 'credit_ledger is append-only';
end;
$$;

create trigger credit_ledger_append_only
before update or delete on public.credit_ledger
for each row execute function public.protect_credit_ledger();

alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.credit_ledger enable row level security;

create policy orders_select_own
  on public.orders
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy payments_select_own
  on public.payments
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy credit_ledger_select_own
  on public.credit_ledger
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.orders from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.credit_ledger from anon, authenticated;
grant select on table public.orders to authenticated;
grant select on table public.payments to authenticated;
grant select on table public.credit_ledger to authenticated;
grant select, insert, update on table public.orders to service_role;
grant select, insert, update on table public.payments to service_role;
grant select, insert on table public.credit_ledger to service_role;

revoke execute on function public.enforce_order_owner() from public, anon, authenticated;
revoke execute on function public.enforce_payment_order_integrity() from public, anon, authenticated;
revoke execute on function public.enforce_credit_ledger_integrity() from public, anon, authenticated;
revoke execute on function public.set_billing_updated_at() from public, anon, authenticated;
revoke execute on function public.protect_credit_ledger() from public, anon, authenticated;
