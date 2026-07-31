const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migrationPath = "supabase/migrations/20260731000100_create_billing_tables.sql";
const tableNames = ["orders", "payments", "credit_ledger"];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function normalize(sql) {
  return sql.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractBalancedBlock(sql, marker) {
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.notEqual(start, -1, `missing SQL block: ${marker}`);

  const open = sql.indexOf("(", start + marker.length);
  assert.notEqual(open, -1, `missing opening parenthesis: ${marker}`);

  let depth = 0;
  for (let index = open; index < sql.length; index += 1) {
    if (sql[index] === "(") depth += 1;
    if (sql[index] === ")") depth -= 1;
    if (depth === 0) return sql.slice(open + 1, index);
  }

  assert.fail(`missing closing parenthesis: ${marker}`);
}

function extractDollarFunction(sql, name) {
  const marker = `create or replace function public.${name}()`;
  const start = sql.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, `missing function: ${name}`);
  const end = sql.indexOf("$$;", start);
  assert.notEqual(end, -1, `unterminated function: ${name}`);
  return normalize(sql.slice(start, end + 3));
}

function extractStatement(sql, marker) {
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.notEqual(start, -1, `missing statement: ${marker}`);
  const end = sql.indexOf(";", start);
  assert.notEqual(end, -1, `unterminated statement: ${marker}`);
  return normalize(sql.slice(start, end + 1));
}

function splitTopLevelCommaList(value) {
  const parts = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    if (value[index] === ")") depth -= 1;
    if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(value.slice(start));
  return parts.map(normalize).filter(Boolean);
}

function tableColumns(sql, table) {
  const definitions = splitTopLevelCommaList(
    extractBalancedBlock(sql, `create table public.${table}`)
  );
  const nonColumns = new Set(["constraint", "primary", "unique", "check", "foreign"]);

  return definitions
    .map((definition) => definition.split(" ")[0].replaceAll('"', ""))
    .filter((name) => !nonColumns.has(name));
}

function grantsFor(sql, table, role) {
  const statements = normalize(sql).split(";");
  const suffix = ` on table public.${table} to ${role}`;
  const statement = statements.find((candidate) =>
    candidate.trim().startsWith("grant ") && candidate.trim().endsWith(suffix)
  );

  if (!statement) return [];
  return statement
    .trim()
    .slice("grant ".length, -suffix.length)
    .split(",")
    .map((permission) => permission.trim())
    .sort();
}

const migration = read(migrationPath);
const normalizedMigration = normalize(migration);

test("Supabase config and the billing migration exist", () => {
  assert.ok(fs.existsSync(path.join(root, "supabase/config.toml")));
  assert.ok(fs.existsSync(path.join(root, migrationPath)));
});

test("static schema contract covers exactly the three financial tables", () => {
  const createdTables = [...normalizedMigration.matchAll(/create table public\.([a-z_]+) \(/g)]
    .map((match) => match[1]);

  assert.deepEqual(createdTables, tableNames);
});

test("orders preserve the package and price snapshot in integer cents", () => {
  const columns = tableColumns(migration, "orders");
  const order = normalize(extractBalancedBlock(migration, "create table public.orders"));

  for (const column of ["package_code", "package_credits", "amount_cents", "currency"]) {
    assert.ok(columns.includes(column), `orders must preserve ${column}`);
  }
  assert.ok(order.includes("amount_cents integer not null"));
  assert.ok(order.includes("package_credits integer not null"));
  assert.ok(order.includes("orders_amount_cents_positive check (amount_cents > 0)"));
  assert.ok(order.includes("orders_package_credits_positive check (package_credits > 0)"));
  assert.equal(columns.includes("amount"), false, "floating/decimal amount must not replace cents");
});

test("payments store paid and refunded values in bounded integer cents", () => {
  const columns = tableColumns(migration, "payments");
  const payment = normalize(extractBalancedBlock(migration, "create table public.payments"));

  assert.ok(columns.includes("amount_cents"));
  assert.ok(columns.includes("refunded_cents"));
  assert.ok(payment.includes("amount_cents integer not null"));
  assert.ok(payment.includes("refunded_cents integer not null default 0"));
  assert.ok(payment.includes("refunded_cents >= 0 and refunded_cents <= amount_cents"));
});

test("idempotency and provider identities are unique", () => {
  for (const table of tableNames) {
    const definition = normalize(extractBalancedBlock(migration, `create table public.${table}`));
    assert.ok(
      definition.includes("idempotency_key text not null unique"),
      `${table} must reject a repeated idempotency key`
    );
  }

  assert.ok(normalizedMigration.includes("unique (provider, provider_payment_id)"));
  assert.ok(normalizedMigration.includes("create unique index orders_provider_preference_unique"));
});

test("purchase and mixed reversal entries are unique per payment", () => {
  const purchaseIndex = extractStatement(
    migration,
    "create unique index credit_ledger_purchase_payment_unique"
  );
  const reversalIndex = extractStatement(
    migration,
    "create unique index credit_ledger_reversal_payment_unique"
  );

  assert.ok(purchaseIndex.includes("on public.credit_ledger (payment_id)"));
  assert.ok(purchaseIndex.includes("where entry_type = 'purchase'"));
  assert.ok(reversalIndex.includes("on public.credit_ledger (payment_id)"));
  assert.ok(reversalIndex.includes("where entry_type in ('refund', 'chargeback')"));
});

test("RLS exposes only each authenticated user's own rows", () => {
  for (const table of tableNames) {
    assert.ok(
      normalizedMigration.includes(`alter table public.${table} enable row level security`),
      `${table} must enable RLS`
    );

    const policy = extractStatement(migration, `create policy ${table}_select_own`);
    assert.ok(policy.includes(`on public.${table}`));
    assert.ok(policy.includes("for select to authenticated"));
    assert.ok(policy.includes("using ((select auth.uid()) = user_id)"));
  }

  const policies = [...normalizedMigration.matchAll(/create policy ([a-z_]+)/g)]
    .map((match) => match[1]);
  assert.deepEqual(policies, tableNames.map((table) => `${table}_select_own`));
});

test("browser roles cannot write and service_role receives minimum table grants", () => {
  const expectedServiceGrants = {
    orders: ["insert", "select", "update"],
    payments: ["insert", "select", "update"],
    credit_ledger: ["insert", "select"]
  };

  for (const table of tableNames) {
    assert.ok(
      normalizedMigration.includes(`revoke all on table public.${table} from anon, authenticated`)
    );
    assert.deepEqual(grantsFor(migration, table, "anon"), []);
    assert.deepEqual(grantsFor(migration, table, "authenticated"), ["select"]);
    assert.deepEqual(grantsFor(migration, table, "service_role"), expectedServiceGrants[table]);
  }
});

test("account deletion anonymizes financial ownership with ON DELETE SET NULL", () => {
  for (const table of tableNames) {
    const definition = normalize(extractBalancedBlock(migration, `create table public.${table}`));
    assert.ok(
      definition.includes("user_id uuid references auth.users(id) on delete set null"),
      `${table}.user_id must be anonymized, not cascade deleted`
    );
  }
});

test("owner and commercial identity triggers prevent cross-owner mutation", () => {
  const orderOwner = extractDollarFunction(migration, "enforce_order_owner");
  const paymentIntegrity = extractDollarFunction(migration, "enforce_payment_order_integrity");

  assert.ok(orderOwner.includes("new.user_id is null"));
  assert.ok(orderOwner.includes("order owner is immutable"));
  for (const field of [
    "provider", "idempotency_key", "package_code", "package_credits", "amount_cents", "currency"
  ]) {
    assert.ok(orderOwner.includes(`new.${field} is distinct from old.${field}`));
  }

  assert.ok(paymentIntegrity.includes("payments require an authenticated owner"));
  for (const field of ["order_id", "provider", "provider_payment_id", "idempotency_key", "amount_cents", "currency"]) {
    assert.ok(paymentIntegrity.includes(`new.${field} is distinct from old.${field}`));
  }
  for (const comparison of [
    "new.user_id is distinct from expected_user_id",
    "new.provider is distinct from expected_provider",
    "new.amount_cents is distinct from expected_amount_cents",
    "new.currency is distinct from expected_currency"
  ]) {
    assert.ok(paymentIntegrity.includes(comparison));
  }

  assert.ok(extractStatement(migration, "create trigger orders_enforce_owner")
    .includes("before insert or update on public.orders"));
  assert.ok(extractStatement(migration, "create trigger payments_enforce_order_integrity")
    .includes("before insert or update on public.payments"));
});

test("ledger purchase and reversals must match their original order and payment", () => {
  const integrity = extractDollarFunction(migration, "enforce_credit_ledger_integrity");

  assert.ok(integrity.includes("order_user_id is distinct from new.user_id"));
  assert.ok(integrity.includes("payment_user_id is distinct from new.user_id"));
  assert.ok(integrity.includes("payment_order_id is distinct from new.order_id"));

  assert.ok(integrity.includes("new.entry_type = 'purchase'"));
  assert.ok(integrity.includes("new.credit_delta is distinct from order_credits"));
  assert.ok(integrity.includes("payment_status is distinct from 'approved'"));

  assert.ok(integrity.includes("new.entry_type in ('refund', 'chargeback')"));
  assert.ok(integrity.includes("new.credit_delta is distinct from -order_credits"));
  assert.ok(integrity.includes("payment_status is distinct from 'refunded'"));
  assert.ok(integrity.includes("payment_refunded_cents is distinct from payment_amount_cents"));
  assert.ok(integrity.includes("payment_status is distinct from 'charged_back'"));

  const trigger = extractStatement(migration, "create trigger credit_ledger_enforce_integrity");
  assert.ok(trigger.includes("before insert on public.credit_ledger"));
});

test("credit ledger is append-only except for ownership anonymization", () => {
  const protection = extractDollarFunction(migration, "protect_credit_ledger");
  const trigger = extractStatement(migration, "create trigger credit_ledger_append_only");

  assert.ok(protection.includes("old.user_id is not null"));
  assert.ok(protection.includes("new.user_id is null"));
  assert.ok(protection.includes("to_jsonb(new) - 'user_id'"));
  assert.ok(protection.includes("credit_ledger is append-only"));
  assert.ok(trigger.includes("before update or delete on public.credit_ledger"));
});

test("financial tables explicitly exclude transaction, wallet, payload and PII fields", () => {
  const forbiddenColumns = [
    "hash", "transaction_hash", "wallet", "wallet_address", "address", "email", "name",
    "document", "cpf", "phone", "payload", "raw_payload", "metadata"
  ];

  for (const table of tableNames) {
    const columns = tableColumns(migration, table);
    for (const forbidden of forbiddenColumns) {
      assert.equal(columns.includes(forbidden), false, `${table} must not store ${forbidden}`);
    }
  }
});

test("monetization policy keeps partial refunds out of the automatic ledger", () => {
  const strategy = normalize(read("docs/MONETIZATION_STRATEGY.md"));

  assert.ok(strategy.includes("apenas reembolso integral ou chargeback reverte os 10 créditos"));
  assert.ok(strategy.includes("reembolso parcial não altera o ledger de créditos automaticamente"));
  assert.ok(strategy.includes("conciliação e tratamento manual"));
});

test("this suite is a static contract check, not a substitute for PostgreSQL execution", () => {
  assert.equal(typeof migration, "string");
  assert.ok(migration.length > 0);
  // Trigger execution, RLS behavior and concurrent idempotency still require Supabase/PostgreSQL integration tests.
});
