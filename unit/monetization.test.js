const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function normalizeVisibleText(content) {
  return content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

test("customer-facing offer consistently sells ten analyses for R$ 4,90 without renewal", () => {
  const surfaces = {
    "index.html": read("index.html"),
    "termos.html": read("termos.html"),
    "README.md": read("README.md"),
    "PROJECT_CONTEXT.md": read("PROJECT_CONTEXT.md"),
    "docs/MONETIZATION_STRATEGY.md": read("docs/MONETIZATION_STRATEGY.md")
  };

  for (const [file, content] of Object.entries(surfaces)) {
    const visibleText = normalizeVisibleText(content);
    assert.match(visibleText, /R\$ 4,90/, `${file} should state the active price`);
    assert.match(visibleText, /\b10\b/, `${file} should state the pack size`);
    assert.match(
      visibleText,
      /sem (?:assinatura|renova..o)|sem renova..o autom.tica/i,
      `${file} should state that the offer does not renew automatically`
    );
  }

  for (const file of ["index.html", "termos.html", "README.md", "PROJECT_CONTEXT.md"]) {
    const visibleText = normalizeVisibleText(surfaces[file]);
    assert.doesNotMatch(visibleText, /R\$ 4,99/, `${file} must not sell the old price`);
    assert.doesNotMatch(
      visibleText,
      /(?:compr|desbloque|pacote)[^\n.]{0,80}ilimitad|ilimitad[^\n.]{0,80}(?:compr|desbloque|pacote)/i,
      `${file} must not sell unlimited access`
    );
  }

  assert.match(
    surfaces["docs/MONETIZATION_STRATEGY.md"],
    /R\$ 4,99 ilimitado[\s\S]*?Encerrar para novas compras; preservar legado/,
    "the strategy may mention the old offer only as retired legacy"
  );
});
