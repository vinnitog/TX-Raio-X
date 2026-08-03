const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Supabase local auth uses branded confirmation and recovery templates", () => {
  const config = read("supabase/config.toml");
  assert.match(config, /\[auth\.email\.template\.confirmation\][\s\S]*subject = "Confirme sua conta no Tx Raio-X"[\s\S]*content_path = "\.\/supabase\/templates\/confirmation\.html"/);
  assert.match(config, /\[auth\.email\.template\.recovery\][\s\S]*subject = "Redefina sua senha do Tx Raio-X"[\s\S]*content_path = "\.\/supabase\/templates\/recovery\.html"/);
});

for (const [name, expectedAction] of [
  ["confirmation", "Confirmar meu e-mail"],
  ["recovery", "Escolher nova senha"]
]) {
  test(`${name} email keeps one safe Supabase action and the security notice`, () => {
    const html = read(`supabase/templates/${name}.html`);
    assert.match(html, /lang="pt-BR"/);
    assert.equal((html.match(/\{\{ \.ConfirmationURL \}\}/g) ?? []).length, 1);
    assert.match(html, new RegExp(expectedAction));
    assert.match(html, /Nunca|nunca/);
    assert.doesNotMatch(html, /<script|javascript:|\.Token\s*\}\}/i);
  });
}
