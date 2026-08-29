const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("quality gate validates public app, browser journeys and the real Postgres schema", () => {
  const workflow = read(".github/workflows/quality-gate.yml");

  assert.match(workflow, /pull_request:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[develop\]/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow, /name:\s*quality-gate/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /npm run test:e2e/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40} # v6/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40} # v6/);
  assert.match(workflow, /supabase\/setup-cli@[0-9a-f]{40} # v2\.1\.1/);
  assert.match(workflow, /version:\s*["']?2\.84\.2["']?/);
  assert.match(workflow, /supabase db start/);
  assert.match(workflow, /supabase test db/);
});

test("versioned Supabase auth redirects include the Railway deployment", () => {
  const config = read("supabase/config.toml");
  assert.match(config, /https:\/\/tx-raio-x-production\.up\.railway\.app\/\*\*/);
});

test("main branch protection runbook keeps develop available to the project workflow", () => {
  const operations = read("docs/OPERATIONS.md");
  assert.match(operations, /Branch protection da `main`/);
  assert.match(operations, /`quality-gate`/);
  assert.match(operations, /0 aprova[cç][oõ]es/i);
  assert.match(operations, /N[aã]o aplicar a regra a `develop`/i);
});
