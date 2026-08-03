const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "pages.yml"),
  "utf8"
);

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("Pages deploys only main, including manual dispatches", () => {
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*-\s*main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /branches:[\s\S]*?-\s*develop/);
  assert.match(workflow, /if:\s*github\.ref == ['"]refs\/heads\/main['"]/);
});

test("Pages uses the required permissions and deployment environment", () => {
  const permissionsBlock = workflow.match(
    /^permissions:\s*\r?\n([\s\S]*?)(?=^\S)/m
  )?.[1];
  const permissions = Object.fromEntries(
    [...(permissionsBlock ?? "").matchAll(/^\s+([\w-]+):\s*(\S+)\s*$/gm)]
      .map((match) => [match[1], match[2]])
  );

  assert.deepEqual(permissions, {
    contents: "read",
    pages: "write",
    "id-token": "write"
  });
  assert.match(workflow, /environment:[\s\S]*?name:\s*github-pages/);
  assert.match(
    workflow,
    /url:\s*\$\{\{\s*steps\.deployment\.outputs\.page_url\s*\}\}/
  );
});

test("Pages uploads only the public allowlist and deploys in the required order", () => {
  const checkout = workflow.indexOf("actions/checkout@");
  const configure = workflow.indexOf("actions/configure-pages@");
  const upload = workflow.indexOf("actions/upload-pages-artifact@");
  const deploy = workflow.indexOf("actions/deploy-pages@");

  assert.ok(checkout > -1 && checkout < configure);
  assert.ok(configure < upload && upload < deploy);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/configure-pages@v5/);
  assert.match(workflow, /Build public allowlist[\s\S]*?mkdir -p _site\/js/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4[\s\S]*?path:\s*["']_site["']/);
  assert.doesNotMatch(workflow, /cp -R (?:\.|supabase|docs|unit)/);
  assert.doesNotMatch(workflow, /js\/(?:transaction-analyzer|transaction-chain|analyzer|chain-client)\.mjs/);
  assert.match(workflow, /id:\s*deployment[\s\S]*?actions\/deploy-pages@v4/);
  assert.ok(fs.existsSync(path.join(root, "index.html")));
});

test("the static PWA remains relative-path safe for a Pages project subpath", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  const app = read("js/app.mjs");
  const serviceWorker = read("sw.js");

  for (const file of ["index.html", "privacidade.html", "termos.html"]) {
    for (const reference of read(file).matchAll(/(?:href|src)=["']([^"'#]+)["']/g)) {
      assert.doesNotMatch(
        reference[1],
        /^(?:\/|https?:)/,
        `${file}: ${reference[1]} must stay relative`
      );
    }
  }
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  for (const icon of manifest.icons) {
    assert.doesNotMatch(icon.src, /^(?:\/|https?:)/, `${icon.src} must stay relative`);
  }
  assert.match(app, /serviceWorker\.register\(["']\.\/sw\.js["']\)/);
  const appShell = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1];
  assert.ok(appShell, "service worker should declare APP_SHELL");
  for (const entry of appShell.matchAll(/["']([^"']+)["']/g)) {
    assert.doesNotMatch(entry[1], /^(?:\/|https?:)/, `${entry[1]} must stay relative`);
  }
});
