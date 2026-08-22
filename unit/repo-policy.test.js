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

test("published copy never describes the account as optional", () => {
  for (const file of ["index.html", "privacidade.html", "termos.html"]) {
    assert.doesNotMatch(read(file), /conta opcional/i, file);
  }
  assert.match(read("index.html"), /A conta libera duas análises grátis uma única vez/);
  assert.match(read("privacidade.html"), /Para realizar análises reais[^.]*é necessária uma conta/);
});

test("LGPD working papers remain explicit drafts and outside the published artifact", () => {
  const requiredFiles = [
    ".lgpd/data-map.md",
    ".lgpd/legal-basis.md",
    ".lgpd/vendors.md",
    ".lgpd/gaps.md",
    ".lgpd/STATUS.md",
    ".lgpd/policies/privacy-policy-v1.0-draft.md"
  ];
  for (const file of requiredFiles) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} should remain available for LGPD review`);
  }

  const status = read(".lgpd/STATUS.md");
  const legalBasis = read(".lgpd/legal-basis.md");
  const draft = read(".lgpd/policies/privacy-policy-v1.0-draft.md");
  const workflow = read(".github/workflows/pages.yml");
  assert.match(status, /\[ \] Política aprovada e publicada/);
  assert.match(status, /não está publicado/i);
  assert.match(legalBasis, /hipótese técnica; validar com profissional jurídico/i);
  assert.match(draft, /Não publicado[^\n]*requer revisão do controlador\/jurídico/i);
  assert.doesNotMatch(workflow, /\.lgpd|privacy-policy-v1\.0-draft/i);
  assert.match(workflow, /cp index\.html privacidade\.html termos\.html/);
});

test("LGPD inventory preserves the product data-minimization invariants", () => {
  const dataMap = read(".lgpd/data-map.md");
  const vendors = read(".lgpd/vendors.md");
  const gaps = read(".lgpd/gaps.md");

  assert.match(dataMap, /hash\/resultado bruto não persistidos/);
  assert.match(dataMap, /não persistido pelo Tx Raio-X/);
  assert.match(dataMap, /logs do provedor pendentes|retenção de logs do provedor pendente/);
  for (const vendor of ["Supabase", "Mercado Pago", "Google", "GitHub Pages", "Blockscout"] ) {
    assert.match(vendors, new RegExp(vendor));
  }
  assert.match(gaps, /P0[^\n]*bloqueiam produção/i);
  assert.match(gaps, /Identificar o controlador/);
  assert.match(gaps, /Validar juridicamente bases, retenções e o rascunho/);
});
