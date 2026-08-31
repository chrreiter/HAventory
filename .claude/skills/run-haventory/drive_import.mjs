// Drive the card's "Import backup" sheet end to end against a real Home
// Assistant, and capture what the user actually sees at each step.
//
// Pastes a document into the sheet, picks a conflict policy, presses Preview,
// screenshots the preview, and — only with --apply — presses Import. Without
// --apply nothing is written: the server-side dry run is the whole point.
//
// Usage (from the skill dir, .claude/skills/run-haventory/):
//   node drive_import.mjs <document.json> [--policy merge|replace|skip]
//                         [--apply] [--out <prefix>] [--path <ha-url-path>]
//
// Defaults: --policy merge, --out import, and — without --path — the panel-mode
// dashboard view discovered to hold the card (card_views.mjs).
//
// The document is pasted verbatim and is NOT validated here — driving the
// card's own parse-error and server-rejection paths is a supported use, so
// malformed input is passed through on purpose.
//
// --apply MUTATES the instance it is pointed at. Import is all-or-nothing and
// there is no undo; export a backup first.
//
// Reads HA_BASE_URL / HA_TOKEN from the environment or the repo-root .env.
// Prints browser console errors (the card logs there).

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { cardPath, haConfig } from "./card_views.mjs";
import { LOGIN_REJECTED, atLoginPage, signIn } from "./login.mjs";

const skillDir = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

const { base, token } = haConfig();
if (!token) {
  console.error("Missing HA_TOKEN (env or repo-root .env)");
  process.exit(2);
}

// --- args ----------------------------------------------------------------
const VALUE_FLAGS = new Set(["--policy", "--out", "--path", "--dashboard"]);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

// Collect positionals by skipping each value flag together with its value, so
// the document path may appear anywhere on the command line.
const positionals = [];
for (let i = 0; i < args.length; i++) {
  if (VALUE_FLAGS.has(args[i])) i++;
  else if (!args[i].startsWith("--")) positionals.push(args[i]);
}

const docPath = positionals[0];
if (!docPath) {
  console.error("Usage: node drive_import.mjs <document.json> [--policy merge|replace|skip]");
  console.error("                             [--apply] [--out <prefix>] [--path <ha-url-path>]");
  console.error("                             [--dashboard <url path or title>]");
  process.exit(2);
}

const policy = flag("--policy", "merge");
if (!["merge", "replace", "skip"].includes(policy)) {
  console.error(`--policy must be merge, replace or skip (got "${policy}")`);
  process.exit(2);
}

const outPrefix = flag("--out", "import");
// The import sheet is a wide surface: with no --path, ask the instance for a
// panel-mode view so the sheet gets the room its preview table needs.
const urlPathArg = flag("--path", null);
// `--dashboard <url path or title>` narrows discovery when the instance holds
// the card on more than one dashboard; `--path` still wins outright.
const dashboard = flag("--dashboard", null);
const apply = args.includes("--apply");
const shot = (suffix) => path.resolve(skillDir, `${outPrefix}-${suffix}.png`);

let documentJson;
try {
  documentJson = readFileSync(docPath, "utf8");
} catch (err) {
  console.error(`Cannot read document: ${err.message}`);
  process.exit(2);
}
console.log(
  `document: ${docPath} (${(documentJson.length / 1024).toFixed(0)} KiB) · policy=${policy}` +
    (apply ? " · APPLY (this writes)" : " · preview only"),
);

const urlPath = urlPathArg ?? (await cardPath("wide", { dashboard }));

// --- drive ---------------------------------------------------------------
const browser = await chromium.launch();
// HA's service worker activates ~30-90s into a fresh context and reloads the
// page, which kills the JS execution context mid-run. An import run is long
// enough to sit inside that window, so block it — at the cost of one harmless
// `navigator.serviceWorker` console error from HA's own bundle.
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: "block",
});
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

await signIn(page, { base, token });

await page.goto(base + urlPath, { waitUntil: "domcontentloaded" });

if (atLoginPage(page)) {
  console.error(LOGIN_REJECTED);
  await browser.close();
  process.exit(1);
}

// Playwright selectors pierce shadow DOM, so the card and the sheet inside it
// are addressable directly.
await page.waitForSelector("haventory-card", { timeout: 30000 });
await page.waitForTimeout(2500); // let the card's WS subscription deliver data

// Selectors pierce shadow DOM but text extraction does not: `innerText` on a
// shadow host reads its light DOM, which is empty here. Go through shadowRoot.
const sheetText = async () =>
  (
    await page
      .locator("hv-import-sheet")
      .first()
      .evaluate((el) => el.shadowRoot?.textContent ?? "")
  )
    .replace(/\s+/g, " ")
    .trim();

// Import lives behind the card's overflow menu.
await page.click('haventory-card [data-testid="card-overflow"] button');
await page.click('haventory-card [data-testid="overflow-item"][data-id="import"]');
await page.waitForSelector('hv-import-sheet [data-testid="import-text"]', { timeout: 10000 });

// Set the value and fire `input` — the event the sheet actually listens for —
// rather than using fill(). fill() types through the input pipeline, and a
// full-inventory export (~1 MB) does not finish inside three minutes that way;
// passing the string as one evaluate argument is a single round trip.
console.log("pasting…");
await page.locator('hv-import-sheet [data-testid="import-text"]').evaluate((el, text) => {
  el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, documentJson);

if (policy !== "merge") {
  await page.locator(`hv-import-sheet [data-testid="import-policy"][data-policy="${policy}"]`).first().click();
}
await page.screenshot({ path: shot("step1") });

await page.locator('hv-import-sheet [data-testid="import-preview"]').click();
// Either step 2, or one of the failure surfaces: a client-side JSON parse
// error, the server's structured list of invalid paths, or a transport error.
await page.waitForSelector(
  'hv-import-sheet [data-testid="import-execute"], hv-import-sheet [data-testid="import-nothing-to-do"],' +
    ' hv-import-sheet [data-testid="import-parse-error"], hv-import-sheet [data-testid="import-errors"],' +
    ' hv-import-sheet [data-testid="import-error"]',
  { timeout: 60000 },
);
await page.waitForTimeout(400); // let the counts finish rendering
await page.screenshot({ path: shot("preview") });
console.log(`\npreview step reads:\n  ${await sheetText()}`);

if (apply) {
  const execute = page.locator('hv-import-sheet [data-testid="import-execute"]');
  if ((await execute.count()) === 0) {
    console.error("\nNothing to import: the preview offered no Import button.");
    await browser.close();
    process.exit(1);
  }
  await execute.click();
  await page.waitForSelector(
    'hv-import-sheet [data-testid="import-done"], hv-import-sheet [data-testid="import-error"]',
    { timeout: 120000 },
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("applied") });
  console.log(`\nafter Import:\n  ${await sheetText()}`);
}

console.log(`\nscreenshots: ${shot("step1")}, ${shot("preview")}${apply ? `, ${shot("applied")}` : ""}`);
// Blocking the service worker makes HA's own bundle touch `navigator.serviceWorker`
// when it is undefined. Flag it rather than hide it, so a real card error stands out.
const SW_BLOCK_NOISE = /serviceWorker|reading 'addEventListener'/;
if (consoleErrors.length) {
  console.log(`browser console errors (${consoleErrors.length}):`);
  for (const e of consoleErrors.slice(0, 10)) {
    console.log(`  ${e}${SW_BLOCK_NOISE.test(e) ? "   <- expected: HA bundle, service worker blocked" : ""}`);
  }
} else {
  console.log("no browser console errors");
}
await browser.close();
