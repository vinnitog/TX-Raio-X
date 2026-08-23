const assert = require("node:assert/strict");
const { readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

function filesUnder(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(directory.replaceAll("\\", "/"), entry.name);
    return entry.isDirectory() ? filesUnder(relative) : [relative];
  });
}

function expandSources(sources) {
  return sources.flatMap((source) => source.endsWith("/") || ["css", "icons", "js"].includes(source)
    ? filesUnder(source.replace(/\/$/, ""))
    : [source.replaceAll("\\", "/")]);
}

function appShellFiles() {
  const body = read("sw.js").match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] ?? "";
  return [...body.matchAll(/["']\.\/(.+?)["']/g)].map((match) => match[1]).filter(Boolean);
}

function dockerPublicFiles() {
  const sources = read("Dockerfile").split(/\r?\n/).filter((line) => /^COPY\s+/i.test(line)).flatMap((line) => {
    const tokens = line.trim().split(/\s+/).slice(1);
    return tokens.slice(0, -1);
  }).filter((source) => source !== "Caddyfile");
  return expandSources(sources);
}

function pagesPublicFiles() {
  const sources = read(".github/workflows/pages.yml").split(/\r?\n/).map((line) => line.trim())
    .filter((line) => /^cp\s+/.test(line)).flatMap((line) => {
      const tokens = line.split(/\s+/).slice(1).filter((token) => token !== "-R");
      return tokens.slice(0, -1);
    });
  return expandSources(sources);
}

test("Railway deploy uses Docker, dynamic port and a healthcheck", () => {
  const railway = JSON.parse(read("railway.json"));
  const caddy = read("Caddyfile");

  assert.equal(railway.build.builder, "DOCKERFILE");
  assert.equal(railway.build.dockerfilePath, "Dockerfile");
  assert.equal(railway.deploy.healthcheckPath, "/health");
  assert.match(caddy, /:\{\$PORT:3000\}/);
  assert.match(caddy, /handle \/health[\s\S]*respond 200/);
});

test("Railway image copies only the public PWA allowlist", () => {
  const dockerfile = read("Dockerfile");
  const dockerignore = read(".dockerignore");

  for (const file of ["index.html", "privacidade.html", "termos.html", "manifest.webmanifest", "sw.js"]) {
    assert.match(dockerfile, new RegExp(file.replace(".", "\\.")));
  }
  for (const forbidden of [/COPY\s+supabase[\\/]/i, /\.lgpd/i, /COPY\s+unit[\\/]/i, /COPY\s+e2e[\\/]/i, /\.env/i, /service_role/i, /STRIPE_SECRET_KEY/i]) {
    assert.doesNotMatch(dockerfile, forbidden);
  }
  assert.match(dockerignore, /^\*$/m);
  assert.doesNotMatch(dockerignore, /!supabase|!\.env|!\.lgpd/i);
});

test("Railway, Pages and the service worker publish the same app shell", () => {
  const expectedDeployment = [...new Set([...appShellFiles(), "sw.js"])].sort();
  const railwayFiles = [...new Set(dockerPublicFiles())].sort();
  const pagesFiles = [...new Set(pagesPublicFiles())].sort();
  assert.deepEqual(railwayFiles, pagesFiles);
  assert.deepEqual(railwayFiles, expectedDeployment);
});

test("Caddy protects the static PWA and minimizes access logs", () => {
  const caddy = read("Caddyfile");

  assert.match(caddy, /Content-Security-Policy/);
  assert.match(caddy, /frame-ancestors 'none'/);
  assert.match(caddy, /X-Content-Type-Options "nosniff"/);
  assert.match(caddy, /request>remote_ip ip_mask 24 48/);
  assert.match(caddy, /request>client_ip ip_mask 24 48/);
  assert.match(caddy, /request>headers>X-Real-Ip delete/);
  assert.match(caddy, /request>headers>X-Forwarded-For delete/);
  assert.match(caddy, /request>headers>Forwarded delete/);
  assert.match(caddy, /request>headers>Cf-Connecting-Ip delete/);
  assert.match(caddy, /request>headers>True-Client-Ip delete/);
  assert.match(caddy, /request>headers>Authorization delete/);
  assert.match(caddy, /request>headers>Proxy-Authorization delete/);
  assert.match(caddy, /request>headers>Cookie delete/);
  assert.match(caddy, /request>uri regexp \\\?\.\*\$ ""/);
  assert.match(caddy, /handle \/sw\.js[\s\S]*no-cache, no-store/);
  assert.match(caddy, /handle \/manifest\.webmanifest[\s\S]*?Cache-Control "no-cache"/);
  const htmlBlock = caddy.match(/handle @html \{([\s\S]*?)\n\t\}/)?.[1] || "";
  assert.match(htmlBlock, /public, max-age=0, must-revalidate/);
  for (const path of ["css", "js", "icons"]) {
    const block = caddy.match(new RegExp(`handle /${path}/\\* \\{([\\s\\S]*?)\\n\\t\\}`))?.[1] || "";
    assert.match(block, /max-age=0, must-revalidate/);
  }
  assert.doesNotMatch(caddy, /SUPABASE_SERVICE_ROLE|STRIPE_SECRET|WEBHOOK_SECRET/i);
});

test("Caddy image is pinned and runs without root privileges", () => {
  const dockerfile = read("Dockerfile");

  assert.match(dockerfile, /^FROM caddy:2-alpine@sha256:[a-f0-9]{64}$/m);
  assert.match(dockerfile, /^USER 65532:65532$/m);
  assert.match(dockerfile, /^ENV XDG_CONFIG_HOME=\/tmp\//m);
  assert.match(dockerfile, /^ENV XDG_DATA_HOME=\/tmp\//m);
});
