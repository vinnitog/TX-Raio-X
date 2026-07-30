const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function appShellEntries() {
  const serviceWorker = read("sw.js");
  const match = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(match, "sw.js should declare APP_SHELL");
  return [...match[1].matchAll(/["'](.+?)["']/g)].map((entry) => entry[1]);
}

test("every APP_SHELL entry points to an existing local asset", () => {
  const entries = appShellEntries();
  assert.ok(entries.length > 0, "APP_SHELL should not be empty");

  for (const entry of entries) {
    const relativePath = entry === "./" ? "index.html" : entry.replace(/^\.\//, "");
    assert.ok(
      fs.existsSync(path.join(root, relativePath)),
      `${entry} should exist in the project`
    );
  }
});

test("manifest icons exist and are included in the offline shell", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  const shell = new Set(appShellEntries().map((entry) => entry.replace(/^\.\//, "")));

  assert.equal(manifest.display, "standalone");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);

  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(root, icon.src)), `${icon.src} should exist`);
    assert.ok(shell.has(icon.src), `${icon.src} should be cached in APP_SHELL`);
  }
});

test("the installable entry point links the manifest and registers the service worker", () => {
  const index = read("index.html");
  const app = read("js/app.mjs");

  assert.match(index, /class=["'][^"']*\beyebrow\b[^"']*["']/i);
  assert.match(index, /<link\s+rel=["']manifest["']\s+href=["']manifest\.webmanifest["']/i);
  assert.match(index, /<script\s+type=["']module["']\s+src=["']js\/app\.mjs["']/i);
  assert.match(app, /serviceWorker\.register\(["']\.\/sw\.js["']\)/);
});

test("service worker uses a versioned cache and includes wallet history code", () => {
  const serviceWorker = read("sw.js");

  assert.match(serviceWorker, /const CACHE_NAME = ["']tx-raio-x-v34["'];/);
  assert.ok(
    appShellEntries().includes("./js/history-client.mjs"),
    "wallet history client should be cached for offline app startup"
  );
});

test("every local module imported by the app entry point is available offline", () => {
  const app = read("js/app.mjs");
  const shell = new Set(appShellEntries());
  const localImports = [...app.matchAll(/from\s+["'](\.\/[^"']+)["']/g)]
    .map((match) => `./js/${match[1].replace(/^\.\//, "")}`);

  assert.ok(localImports.length > 0, "app.mjs should import local modules");
  for (const importedModule of localImports) {
    assert.ok(
      shell.has(importedModule),
      `${importedModule} imported by app.mjs should be cached in APP_SHELL`
    );
  }
});

test("service worker does not cache URLs with payment or other query parameters", () => {
  const serviceWorker = read("sw.js");

  assert.match(serviceWorker, /requestUrl\.search/);
  assert.match(serviceWorker, /CACHEABLE_URLS\.has\(requestUrl\.href\)/);
  assert.match(serviceWorker, /cache-control/);
  assert.match(serviceWorker, /no-store/);
});

test("wallet history analyzes the selected transaction without jumping to the main form", () => {
  const app = read("js/app.mjs");
  const clickStart = app.indexOf('analyzeButton.addEventListener("click"');
  const clickEnd = app.indexOf("\n      });", clickStart);

  assert.match(
    app,
    /findRecentTransactions\([\s\S]*?address,[\s\S]*?elements\.walletNetwork\.value,[\s\S]*?getWalletHistoryLimit\(\)/
  );
  assert.notEqual(clickStart, -1, "wallet history should register an analyze action");
  assert.notEqual(clickEnd, -1, "wallet history analyze action should have a callback");

  const clickHandler = app.slice(clickStart, clickEnd);
  assert.match(clickHandler, /runAnalysis\(/);
  assert.match(clickHandler, /transaction\.hash/);
  assert.match(clickHandler, /transaction\.networkId/);
  assert.match(app, /setAnalysisControlsDisabled\(true\)/);
  assert.match(app, /updateTransactionActionLabels\(\)/);
  assert.match(app, /elements\.demoButton\.disabled\s*=\s*isDisabled/);
  assert.match(app, /elements\.walletSearchButton\.disabled\s*=\s*isDisabled/);
  assert.match(app, /analysisInProgress\s*\|\|\s*walletSearchInProgress/);
  assert.doesNotMatch(clickHandler, /elements\.form/);
  assert.doesNotMatch(clickHandler, /scrollIntoView/);
  assert.doesNotMatch(
    clickHandler,
    /consumeAnalysis/,
    "selecting a wallet transaction must not consume a credit directly"
  );
});

test("wallet history requires one network and offers a custom ordering control", () => {
  const index = read("index.html");
  const walletSelect = index.match(
    /<select id="wallet-network"[\s\S]*?<\/select>/
  )?.[0];

  assert.ok(walletSelect, "wallet network select should exist");
  assert.doesNotMatch(walletSelect, /value=["']auto["']/);
  for (const network of ["ethereum", "base", "arbitrum", "polygon"]) {
    assert.match(walletSelect, new RegExp(`value=["']${network}["']`));
  }
  assert.match(index, /class=["']select-control/);
  assert.match(index, /id=["']wallet-sort["']/);
  assert.match(index, /value=["']desc["']/);
  assert.match(index, /value=["']asc["']/);
  assert.match(index, /<option value=["']desc["']>Mais recentes<\/option>/);
  assert.match(index, /<option value=["']asc["']>Mais antigas<\/option>/);
  assert.doesNotMatch(index, /Mais recentes primeiro|Mais antigas primeiro/);
  assert.equal(
    [...index.matchAll(/data-wallet-premium-limit/g)].length,
    2,
    "premium wallet limit copy should be populated from config"
  );

  const app = read("js/app.mjs");
  const sortStart = app.indexOf('elements.walletSort.addEventListener("change"');
  const sortEnd = app.indexOf("\n});", sortStart);
  const sortHandler = app.slice(sortStart, sortEnd);
  assert.match(sortHandler, /renderWalletHistory\(currentWalletHistory,\s*false\)/);
  assert.doesNotMatch(sortHandler, /findRecentTransactions/);
  assert.match(app, /UNLOCKED_WALLET_HISTORY_LIMIT/);
  assert.match(app, /walletPremiumLimitLabels/);
});

test("local demo enforces free usage and simulates beta unlock without payment", () => {
  const app = read("js/app.mjs");
  const runAnalysis = app.slice(
    app.indexOf("async function runAnalysis("),
    app.indexOf("function activateBetaAccess(")
  );
  const activateBetaAccess = app.slice(
    app.indexOf("function activateBetaAccess("),
    app.indexOf("function beginCheckout(")
  );
  const beginCheckout = app.slice(
    app.indexOf("function beginCheckout("),
    app.indexOf("async function applyPaymentReturn(")
  );
  const applyPaymentReturn = app.slice(
    app.indexOf("async function applyPaymentReturn("),
    app.indexOf('elements.form.addEventListener("submit"')
  );
  const localPaymentBranch = applyPaymentReturn.slice(
    applyPaymentReturn.indexOf("if (IS_LOCAL_DEMO)"),
    applyPaymentReturn.indexOf("if (!PAYMENT_VERIFICATION_URL)")
  );
  const walletSearchHandler = app.slice(
    app.indexOf('elements.walletForm.addEventListener("submit"'),
    app.indexOf('elements.walletAddress.addEventListener("input"')
  );

  assert.match(app, /const IS_LOCAL_DEMO = isLocalTestEnvironment/);
  assert.ok(runAnalysis.indexOf("getRemaining") < runAnalysis.indexOf("findTransaction"));
  assert.match(
    runAnalysis,
    /getRemaining\(usage,\s*FREE_ANALYSES\) === 0[\s\S]*?openPaywall\(\);[\s\S]*?return;[\s\S]*?findTransaction/
  );
  assert.match(
    app,
    /demoButton\.addEventListener\("click", \(\) => showResult\(createDemoAnalysis\(\), true\)\)/
  );
  assert.doesNotMatch(walletSearchHandler, /consumeAnalysis/);
  assert.match(activateBetaAccess, /unlockBeta\(localStorage\)/);
  assert.match(activateBetaAccess, /updateUsageLabel\(\)/);
  assert.match(activateBetaAccess, /updateWalletLimitLabel\(\)/);
  assert.match(
    activateBetaAccess,
    /catch \{[\s\S]*?return false;[\s\S]*?return true;/
  );
  assert.match(beginCheckout, /if \(IS_LOCAL_DEMO\)[\s\S]*?activateBetaAccess\([\s\S]*?return;/);
  assert.match(beginCheckout, /if \(!CHECKOUT_URL\)[\s\S]*?window\.location\.assign\(CHECKOUT_URL\)/);
  assert.doesNotMatch(localPaymentBranch, /activateBetaAccess|unlockBeta/);
  assert.doesNotMatch(app, /priceSection\.hidden = true/);
  assert.match(app, /getRemaining\(usage,\s*FREE_ANALYSES\)/);
  assert.doesNotMatch(app, /getRemaining\(usage,\s*FREE_ANALYSES,\s*IS_LOCAL/);
  assert.match(app, /consumeAnalysis\(localStorage\)/);
  assert.doesNotMatch(app, /consumeAnalysis\(localStorage,\s*IS_LOCAL/);
  assert.match(
    app,
    /if \(IS_LOCAL_DEMO\) \{[\s\S]*?activateBetaAccess\("Beta desbloqueado · simulação local, sem pagamento\."\);[\s\S]*?return;/
  );
  assert.match(app, /function activateBetaAccess\(message\)[\s\S]*?unlockBeta\(localStorage\)/);
  assert.match(
    app,
    /function activateBetaAccess\(message\)[\s\S]*?catch \{[\s\S]*?return false;[\s\S]*?return true;/
  );
  assert.match(
    app,
    /const activated = activateBetaAccess\([\s\S]*?if \(!activated\) return;[\s\S]*?searchParams\.delete\("payment_id"\)/
  );
  assert.match(
    app,
    /if \(IS_LOCAL_DEMO\) \{[\s\S]*?url\.searchParams\.delete\("payment_id"\);[\s\S]*?return;/
  );
});

test("a new service worker takes control and refreshes an already controlled page once", () => {
  const app = read("js/app.mjs");
  const serviceWorker = read("sw.js");

  assert.match(app, /registration\.update\(\)/);
  assert.match(app, /serviceWorker\.addEventListener\(["']controllerchange["']/);
  assert.match(app, /isReloadingForUpdate/);
  assert.match(app, /window\.location\.reload\(\)/);
  assert.match(serviceWorker, /\.then\(\(\) => self\.skipWaiting\(\)\)/);
  assert.match(serviceWorker, /\.then\(\(\) => self\.clients\.claim\(\)\)/);
});

test("the result exposes decoded, movement and technical detail regions", () => {
  const index = read("index.html");
  const app = read("js/app.mjs");

  for (const id of ["decoded-grid", "movement-list", "technical-grid"]) {
    assert.match(index, new RegExp(`id=["']${id}["']`));
  }
  assert.match(app, /result\.decodedFields/);
  assert.match(app, /result\.movements/);
  assert.match(app, /result\.technicalDetails/);
});

test("detail help uses an accessible dialog with close actions and a safe fallback", () => {
  const index = read("index.html");
  const app = read("js/app.mjs");

  assert.match(
    index,
    /<dialog[\s\S]*?id=["']field-help-dialog["'][\s\S]*?aria-labelledby=["']field-help-title["'][\s\S]*?aria-describedby=["']field-help-text["']/
  );
  assert.match(index, /id=["']field-help-close["'][^>]*aria-label=["']Fechar explicação["']/);
  assert.match(index, /id=["']field-help-confirm["']/);
  assert.match(app, /helpButton\.setAttribute\(["']aria-label["'], `Entender o campo \$\{label\}`\)/);
  assert.match(app, /FIELD_HELP\[label\]\s*\?\?/);
  assert.match(app, /fieldHelpClose\.addEventListener\(["']click["']/);
  assert.match(app, /fieldHelpConfirm\.addEventListener\(["']click["']/);
  assert.match(app, /event\.target === elements\.fieldHelpDialog/);
});

test("addresses and the full transaction hash expose accessible copy actions", () => {
  const app = read("js/app.mjs");
  const css = read("css/app.css");

  assert.match(
    app,
    /const COPYABLE_DETAIL_LABELS = Object\.freeze\(\["De", "Para", "Hash completo"\]\)/
  );
  assert.match(app, /function isCopyableDetail\(label, value\)/);
  assert.match(app, /EVM_ADDRESS_PATTERN\.test\(text\)/);
  assert.match(app, /TRANSACTION_HASH_PATTERN\.test\(text\)/);
  assert.match(app, /copyButton\.setAttribute\("aria-label", copyLabel\)/);
  assert.match(app, /navigator\.clipboard\?\.writeText/);
  assert.match(app, /document\.execCommand\("copy"\)/);
  assert.match(app, /catch\s*\{[\s\S]*?return fallbackCopyText\(text\)/);
  assert.match(app, /previouslyFocused\?\.focus\?\.\(\{ preventScroll: true \}\)/);
  assert.match(app, /if \(copyInProgress\) return/);
  assert.match(app, /copyButton\.disabled = true/);
  assert.match(app, /copyButton\.disabled = false/);
  assert.match(app, /clearTimeout\(copyFeedbackTimer\)/);
  assert.match(
    app,
    /if \(!copied\) \{[\s\S]*?showToast\(`[^`]*copiar \$\{label\.toLocaleLowerCase\("pt-BR"\)\}\.`\)/
  );
  assert.match(app, /showToast\(`\$\{label\} copiado\.`\)/);
  assert.match(app, /copyFeedbackTimer = setTimeout\([\s\S]*?copyButton\.setAttribute\("aria-label", copyLabel\)[\s\S]*?1800/);
  assert.match(app, /<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">/);
  assert.match(css, /\.detail-item-value-row\s*\{[\s\S]*?minmax\(0,\s*1fr\) 44px/);
  assert.match(css, /\.copy-button\s*\{[\s\S]*?width:\s*44px[\s\S]*?height:\s*44px/);
  assert.match(css, /\.copy-button\.is-copied::before\s*\{[\s\S]*?content:\s*"✓"/);
});

test("every analyzer field has educational help and uses the reusable renderer", () => {
  const analyzer = read("js/analyzer.mjs");
  const app = read("js/app.mjs");
  const analyzerLabels = new Set(
    [...analyzer.matchAll(/\{\s*label:\s*"([^"]+)"/g)].map((match) => match[1])
  );
  for (const statusLabel of ["Pendente", "Confirmada", "Falhou"]) {
    analyzerLabels.delete(statusLabel);
  }
  const helpBlock = app.match(/const FIELD_HELP = Object\.freeze\(\{([\s\S]*?)\}\);/)?.[1];

  assert.ok(helpBlock, "FIELD_HELP should exist");
  const helpLabels = new Set(
    [...helpBlock.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1])
  );

  for (const label of analyzerLabels) {
    assert.ok(helpLabels.has(label), `${label} should have educational help`);
  }

  assert.match(app, /result\.details\.map\(createDetailItem\)/);
  assert.match(app, /result\.decodedFields\.map\(createDetailItem\)/);
  assert.match(app, /result\.technicalDetails\.map\(createDetailItem\)/);
});

test("detail spans collapse safely across mobile, tablet and desktop grids", () => {
  const analyzer = read("js/analyzer.mjs");
  const app = read("js/app.mjs");
  const css = read("css/app.css");

  assert.match(app, /item\.dataset\.span = String\(span\)/);
  assert.doesNotMatch(analyzer, /span:\s*(?:0|[5-9]|\d{2,})\b/);
  assert.match(css, /\.detail-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(min-width: 640px\)[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(min-width: 860px\)[\s\S]*?repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.detail-item\[data-span=["']4["']\][\s\S]*?grid-column:\s*span 4/);
});

test("wallet search remains a visible collapsible alternative below the hash flow", () => {
  const index = read("index.html");
  const app = read("js/app.mjs");
  const css = read("css/app.css");
  const explanationPosition = index.indexOf('class="explanation-section"');
  const pricePosition = index.indexOf('class="price-section"');
  const analyzerPosition = index.indexOf('id="analyzer-form"');
  const togglePosition = index.indexOf('id="wallet-toggle"');
  const walletPosition = index.indexOf('id="wallet-panel"');
  const walletTag = index.match(/<section class="wallet-panel"[^>]*id="wallet-panel"[^>]*>/)?.[0];

  assert.ok(analyzerPosition < togglePosition && togglePosition < walletPosition);
  assert.ok(pricePosition > -1 && pricePosition < explanationPosition);
  assert.ok(walletTag && /\shidden(?:\s|>)/.test(walletTag));
  assert.match(index, /id="wallet-toggle"[\s\S]*?aria-expanded="false"/);
  assert.match(index, /Não tem o hash\?[\s\S]*?Buscar pela carteira/);
  assert.match(app, /const willOpen = elements\.walletPanel\.hidden/);
  assert.match(app, /walletPanel\.hidden = !willOpen/);
  assert.match(app, /setAttribute\("aria-expanded", String\(willOpen\)\)/);
  assert.match(app, /if \(willOpen\) elements\.walletAddress\.focus\(\)/);
  assert.doesNotMatch(index, /analysis-options/);
  assert.doesNotMatch(app, /analysisOptions/);
  assert.doesNotMatch(css, /\.analysis-options\s*\{/);
  assert.match(css, /\.wallet-toggle\s*\{[\s\S]*?border:\s*1px solid rgb\(114 215 245 \/ 55%\)/);
  assert.match(css, /\.wallet-toggle\s*\{[\s\S]*?background:\s*rgb\(114 215 245 \/ 10%\)/);
  assert.match(css, /\.wallet-toggle\s*\{[\s\S]*?margin:\s*18px auto 0/);
  assert.match(css, /\.wallet-panel\s*\{[\s\S]*?margin:\s*18px auto 0/);
  assert.match(css, /\.explanation-section\s*\{[\s\S]*?margin:\s*32px auto 0/);
  assert.match(css, /footer\s*\{[\s\S]*?margin-top:\s*32px/);
  assert.match(css, /@media \(min-width: 640px\)[\s\S]*?\.hero\s*\{[\s\S]*?padding:\s*40px 0 32px/);
});
