const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("workflow kit files exist", () => {
  for (const file of ["AGENTS.md", "CLAUDE.md", "PROJECT_CONTEXT.md", "test.cmd", "package.json", ".gitignore"]) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} should exist`);
  }
});

test("codex and claude share the mandatory workflow", () => {
  const agents = read("AGENTS.md");
  const claude = read("CLAUDE.md");
  for (const content of [agents, claude]) {
    const order = ["senior-dev", "ui-ux-expert", "code-reviewer", "qa-senior", "qa-automate"];
    let lastIndex = -1;
    for (const step of order) {
      const index = content.indexOf(step);
      assert.ok(index > lastIndex, `${step} should appear after the previous workflow step`);
      lastIndex = index;
    }
    assert.match(content, /develop/);
    assert.match(content, /Nunca.*push direto.*main|Nunca faca push direto para `main`/s);
  }
});

test("frontend work requires ui ux review", () => {
  const agents = read("AGENTS.md");
  const claude = read("CLAUDE.md");
  assert.match(agents, /qualquer ajuste de front-end deve acionar `ui-ux-expert`/);
  assert.match(claude, /qualquer mudanca de front-end deve passar por avaliacao UI\/UX/);
});

test("browser blocked by client policy is documented", () => {
  const agents = read("AGENTS.md");
  const claude = read("CLAUDE.md");
  for (const content of [agents, claude]) {
    assert.match(content, /ERR_BLOCKED_BY_CLIENT/);
    assert.match(content, /file:\/\//);
    assert.match(content, /localhost/);
    assert.match(content, /127\.0\.0\.1/);
  }
});

test("project context records stack decision", () => {
  const context = read("PROJECT_CONTEXT.md");
  assert.match(context, /## Stack Escolhida/);
  assert.match(context, /## Motivo Da Stack/);
  assert.match(context, /## Alternativas Rejeitadas/);
  assert.match(context, /Revisao Obrigatoria De Stack/);
});

test("roadmap keeps authentication and paid access recoverable and private", () => {
  const roadmap = read("ROADMAP.md");
  assert.match(roadmap, /OAuth\/OpenID Connect/);
  assert.match(roadmap, /e-mail e senha/);
  assert.match(roadmap, /Não solicitar acesso à caixa de entrada do Gmail/);
  assert.match(roadmap, /`localStorage` usado apenas como cache/);
  assert.match(roadmap, /entitlement/);
  assert.match(roadmap, /reembolso, chargeback/);
  assert.match(roadmap, /reautenticação/);
  assert.doesNotMatch(roadmap, /programa de convite|indicação automática/);
});
