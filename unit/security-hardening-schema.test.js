const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(
  root, "supabase/migrations/20260822000200_harden_rls_auto_enable.sql"
), "utf8");
const postgresSuite = fs.readFileSync(path.join(
  root, "supabase/tests/security_hardening_test.sql"
), "utf8");
const supabaseConfig = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");

test("automatic RLS runs from an internal schema with no API execution grants", () => {
  assert.match(migration, /create schema if not exists app_private/i);
  assert.match(migration, /security definer[\s\S]*set search_path = pg_catalog/i);
  assert.match(
    migration,
    /revoke all on function app_private\.rls_auto_enable\(\)[\s\S]*from public, anon, authenticated, service_role/i
  );
  assert.match(migration, /execute function app_private\.rls_auto_enable\(\)/i);
  assert.match(migration, /drop function if exists public\.rls_auto_enable\(\)/i);
  assert.match(
    migration,
    /where command_tag in \(\s*'CREATE TABLE',\s*'CREATE TABLE AS',\s*'SELECT INTO'\s*\)/i
  );
  assert.match(migration, /and object_type in \(\s*'table',\s*'partitioned table'\s*\)/i);
  assert.match(migration, /if cmd\.schema_name = 'public' then/i);
  assert.match(
    migration,
    /format\(\s*'alter table if exists %s enable row level security',\s*cmd\.object_identity\s*\)/i
  );
  assert.match(migration, /when others then[\s\S]*?raise log[\s\S]*?raise;/i);
  assert.doesNotMatch(migration, /when others then\s+raise log[^;]+;\s+end;/i);
  assert.doesNotMatch(
    supabaseConfig.match(/^schemas\s*=\s*\[[^\n]+/m)?.[0] ?? "",
    /app_private/i
  );
});

test("PostgreSQL security suite verifies grants and automatic RLS behavior", () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(
      postgresSuite,
      new RegExp(`not has_schema_privilege\\('${role}', 'app_private', 'USAGE'\\)`, "i")
    );
    assert.match(
      postgresSuite,
      new RegExp(`not has_function_privilege\\('${role}', 'app_private\\.rls_auto_enable\\(\\)', 'EXECUTE'\\)`, "i")
    );
  }
  assert.match(postgresSuite, /create table public\.security_hardening_rls_probe/i);
  assert.match(postgresSuite, /create table public\."Security Hardening Mixed Case"/i);
  assert.match(postgresSuite, /create table public\.security_hardening_ctas_probe as/i);
  assert.match(postgresSuite, /select[\s\S]*?into public\.security_hardening_select_into_probe/i);
  assert.match(postgresSuite, /relrowsecurity/i);
  assert.match(
    postgresSuite,
    /evt\.evtname = 'ensure_rls'[\s\S]*?evt\.evtevent = 'ddl_command_end'[\s\S]*?CREATE TABLE AS[\s\S]*?SELECT INTO[\s\S]*?ns\.nspname = 'app_private'/i
  );
  assert.match(postgresSuite, /throws_ok[\s\S]*?forced RLS hardening failure/i);
  assert.match(postgresSuite, /to_regclass\('public\.security_hardening_rollback_probe'\) is null/i);
});
