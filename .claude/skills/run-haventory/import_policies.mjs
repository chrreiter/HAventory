// Check that the card's import sheet describes the conflict policy the backend
// actually applies — for all three policies, against the same document.
//
// `drive_import.mjs` drives one policy and leaves the judgement to the eye. This
// runs each policy twice: once through `haventory/import/preview` on a direct WS
// connection (the ground truth) and once through the card's own sheet, then
// compares the four bucket counts the sheet renders against the ones the server
// returned, and checks the conflict sentence names the right resolution. A sheet
// that says "Merge keeps the file's values" over counts computed under `skip`
// would pass every unit test and still mislead every user.
//
// Nothing is ever written: preview is a server-side dry run, and --apply is
// deliberately not offered here.
//
// Usage (from the skill dir, .claude/skills/run-haventory/):
//   node import_policies.mjs                    # synthesize a document from live data
//   node import_policies.mjs --doc backup.json  # use a document of your own
//   node import_policies.mjs --items 8          # how many live items to build on
//   node import_policies.mjs --out policies     # screenshot prefix
//
// The synthesized document is built by exporting the live inventory and cutting
// it down to a handful of entities, then deriving one of each classification
// from them: some entries left byte-identical (`unchanged`), some with an edited
// field (`update` under merge/replace, `conflict` under skip) and one carrying a
// fresh uuid (`add`). Exercising the policies needs a document that disagrees
// with the inventory in a controlled way, and deriving it from the real data is
// the only way to get ids that are genuinely already present.
//
// Reads HA_BASE_URL / HA_TOKEN from the environment or the repo-root .env.

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(skillDir, "..", "..", "..");

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

try {
  for (const line of readFileSync(path.join(repoRoot, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env — rely on real env vars */
}
const base = (process.env.HA_BASE_URL ?? "http://localhost:8123").replace(/\/$/, "");
const token = process.env.HA_TOKEN;
if (!token) {
  console.error("Missing HA_TOKEN (env or repo-root .env)");
  process.exit(2);
}

const urlPath = flag("--path", "/lovelace/default_view");
const outPrefix = flag("--out", "policies");
const sampleSize = Number(flag("--items", "6"));
const docPath = flag("--doc", null);
const shot = (name) => path.resolve(skillDir, `${outPrefix}-${name}.png`);

const POLICIES = ["merge", "replace", "skip"];
// The sentence the sheet is required to print next to a non-zero conflict count.
const CONFLICT_WORDING = {
  merge: /Merge keeps the file's values\./,
  replace: /Replace overwrites them\./,
  skip: /Skip leaves them as they are\./,
};

// --- WS ground truth ------------------------------------------------------
// Node's global WebSocket is enough for a request/response client; the frontend
// protocol is one authenticated socket with monotonic ids.
class HaWs {
  #ws;
  #id = 1;
  #waiters = new Map();

  static async connect() {
    const self = new HaWs();
    const wsUrl = base.replace(/^http/, "ws") + "/api/websocket";
    self.#ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      self.#ws.addEventListener("error", reject, { once: true });
      self.#ws.addEventListener("open", resolve, { once: true });
    });
    return new Promise((resolve, reject) => {
      self.#ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "auth_required") {
          self.#ws.send(JSON.stringify({ type: "auth", access_token: token }));
        } else if (msg.type === "auth_ok") {
          resolve(self);
        } else if (msg.type === "auth_invalid") {
          reject(new Error(`WS auth failed: ${msg.message}`));
        } else if (msg.type === "result") {
          self.#waiters.get(msg.id)?.(msg);
          self.#waiters.delete(msg.id);
        }
      });
    });
  }

  call(payload) {
    const id = this.#id++;
    this.#ws.send(JSON.stringify({ id, ...payload }));
    return new Promise((resolve, reject) => {
      this.#waiters.set(id, (msg) => (msg.success ? resolve(msg.result) : reject(new Error(JSON.stringify(msg.error)))));
      setTimeout(() => reject(new Error(`timeout waiting for ${payload.type}`)), 120000);
    });
  }

  close() {
    this.#ws.close();
  }
}

/**
 * Cut a full export down to `n` items plus every location on their ancestry, so
 * the subset stays referentially self-consistent — an item whose `location_id`
 * points at a location the document omits is a different test (invalid input),
 * not this one.
 */
function subsetDocument(full, n) {
  const items = full.items.slice(0, n);
  const keep = new Set();
  for (const item of items) for (const id of item.location_path?.id_path ?? []) keep.add(id);
  return { ...full, items, locations: full.locations.filter((l) => keep.has(l.id)) };
}

/**
 * Derive a document that lands entries in every bucket: the first two items are
 * left untouched, the next two carry an edited field, and one is a copy with a
 * fresh uuid. Identity is the id and only the id, so re-idding an entry is what
 * makes it read as new.
 */
function deriveMixed(doc) {
  const items = doc.items.map((it) => ({ ...it }));
  const edited = [];
  for (let i = 2; i < Math.min(4, items.length); i++) {
    items[i] = { ...items[i], description: `import-policy probe ${randomUUID().slice(0, 8)}` };
    edited.push(items[i].id);
  }
  const added = items.length ? { ...items[0], id: randomUUID(), name: `${items[0].name} (policy probe)` } : null;
  if (added) items.push(added);
  return {
    document: { ...doc, items },
    expectation: { unchanged: Math.min(2, doc.items.length), edited: edited.length, added: added ? 1 : 0 },
  };
}

const ws = await HaWs.connect();
let documentJson;
let expectation = null;
if (docPath) {
  documentJson = readFileSync(docPath, "utf8");
  console.log(`document: ${docPath} (${(documentJson.length / 1024).toFixed(0)} KiB)`);
} else {
  const full = await ws.call({ type: "haventory/export" });
  const subset = subsetDocument(full, sampleSize);
  const mixed = deriveMixed(subset);
  expectation = mixed.expectation;
  documentJson = JSON.stringify(mixed.document);
  console.log(
    `document: synthesized from live export — ${mixed.document.items.length} items, ` +
      `${mixed.document.locations.length} locations ` +
      `(${expectation.unchanged} untouched, ${expectation.edited} edited, ${expectation.added} re-idded)`,
  );
}

// Ground truth first: one preview per policy, straight from the server.
const serverPreview = {};
for (const policy of POLICIES) {
  const preview = await ws.call({
    type: "haventory/import/preview",
    document: JSON.parse(documentJson),
    policy,
  });
  serverPreview[policy] = preview;
  if (!preview.valid) {
    console.error(`server rejected the document under ${policy}: ${JSON.stringify(preview.errors).slice(0, 300)}`);
    ws.close();
    process.exit(1);
  }
  console.log(`  server ${policy.padEnd(7)} items=${JSON.stringify(preview.counts.items)} locations=${JSON.stringify(preview.counts.locations)}`);
}
ws.close();

// --- the card's own sheet -------------------------------------------------
const browser = await chromium.launch();
// HA's service worker reloads the page 30-90 s into a fresh context; three
// previews of a real document sit well inside that window.
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

await page.addInitScript(
  ([hassUrl, accessToken]) => {
    localStorage.setItem(
      "hassTokens",
      JSON.stringify({
        access_token: accessToken,
        token_type: "Bearer",
        refresh_token: "unused-long-lived",
        expires_in: 1800,
        expires: Date.now() + 365 * 24 * 3600 * 1000,
        hassUrl,
        clientId: hassUrl + "/",
      }),
    );
  },
  [base, token],
);

await page.goto(base + urlPath, { waitUntil: "domcontentloaded" });
if (page.url().includes("/auth/authorize")) {
  console.error("Redirected to the login page — hassTokens injection was rejected. Is HA_TOKEN valid?");
  await browser.close();
  process.exit(1);
}
await page.waitForSelector("haventory-card", { timeout: 30000 });
await page.waitForTimeout(2500);

/** Read the four bucket counts the sheet rendered, keyed as the sheet keys them. */
const renderedCounts = () =>
  page.locator("hv-import-sheet").first().evaluate((el) => {
    const out = {};
    for (const row of el.shadowRoot?.querySelectorAll("[data-testid='import-count']") ?? []) {
      const spans = row.querySelectorAll("span");
      out[row.getAttribute("data-key")] = Number(spans[1]?.textContent.replace("+", "").trim() ?? "NaN");
    }
    return out;
  });

const sheetText = async () =>
  (await page.locator("hv-import-sheet").first().evaluate((el) => el.shadowRoot?.textContent ?? ""))
    .replace(/\s+/g, " ")
    .trim();

const results = [];
for (const policy of POLICIES) {
  console.log(`\n== card sheet: ${policy} ==`);
  await page.click('haventory-card [data-testid="card-overflow"] button');
  await page.click('haventory-card [data-testid="overflow-item"][data-id="import"]');
  await page.waitForSelector('hv-import-sheet [data-testid="import-text"]', { timeout: 10000 });

  // Set the value and fire `input` rather than fill(): a real backup types for
  // minutes through the input pipeline and blows past Playwright's timeout.
  await page.locator('hv-import-sheet [data-testid="import-text"]').evaluate((el, text) => {
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, documentJson);

  if (policy !== "merge") {
    await page.locator(`hv-import-sheet [data-testid="import-policy"][data-policy="${policy}"]`).first().click();
  }
  await page.locator('hv-import-sheet [data-testid="import-preview"]').click();
  await page.waitForSelector(
    'hv-import-sheet [data-testid="import-execute"], hv-import-sheet [data-testid="import-nothing-to-do"],' +
      ' hv-import-sheet [data-testid="import-parse-error"], hv-import-sheet [data-testid="import-errors"]',
    { timeout: 120000 },
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot(policy) });

  const rendered = await renderedCounts();
  const text = await sheetText();
  const server = serverPreview[policy];
  const expectedRender = {
    "items-add": server.counts.items.add ?? 0,
    "items-update": server.counts.items.update ?? 0,
    "items-conflict": server.counts.items.conflict ?? 0,
    "items-unchanged": server.counts.items.unchanged ?? 0,
    "locations-add": server.counts.locations.add ?? 0,
    "locations-update": server.counts.locations.update ?? 0,
    "locations-conflict": server.counts.locations.conflict ?? 0,
    "locations-unchanged": server.counts.locations.unchanged ?? 0,
  };
  const mismatches = Object.entries(expectedRender).filter(([k, v]) => rendered[k] !== v);

  // The policy the sheet names must be the one the counts were computed under —
  // the preview is invalidated when the policy changes precisely so these agree.
  const namesPolicy = new RegExp(`policy\\s*${policy}`, "i").test(text);
  const conflicts = (server.counts.items.conflict ?? 0) + (server.counts.locations.conflict ?? 0);
  const wordingOk = conflicts === 0 ? null : CONFLICT_WORDING[policy].test(text);

  console.log(`  rendered: ${JSON.stringify(rendered)}`);
  console.log(`  server:   ${JSON.stringify(expectedRender)}`);
  console.log(`  names the policy: ${namesPolicy} · conflicts: ${conflicts} · wording: ${wordingOk ?? "n/a (no conflicts)"}`);

  results.push({
    policy,
    ok: mismatches.length === 0 && namesPolicy && wordingOk !== false,
    detail:
      mismatches.length === 0
        ? namesPolicy
          ? wordingOk === false
            ? `conflict sentence does not match ${policy}`
            : "counts and wording agree with the server"
          : "sheet does not name the policy it previewed"
        : `count mismatch: ${mismatches.map(([k, v]) => `${k} sheet=${rendered[k]} server=${v}`).join(", ")}`,
  });

  await page.locator('hv-import-sheet [data-testid="import-cancel"]').click();
  await page.waitForTimeout(400);
}

// A document that produced no conflicts under `skip` never exercised the
// wording at all — say so rather than reporting a pass the run did not earn.
const skipConflicts =
  (serverPreview.skip.counts.items.conflict ?? 0) + (serverPreview.skip.counts.locations.conflict ?? 0);
if (skipConflicts === 0) {
  console.log("\nNOTE: this document produced no conflicts, so the conflict wording was not exercised.");
}

console.log("\n== verdict ==");
for (const r of results) console.log(`  ${r.policy.padEnd(8)} ${r.ok ? "PASS" : "FAIL"}  ${r.detail}`);

const SW_BLOCK_NOISE = /serviceWorker|reading 'addEventListener'/;
const realErrors = consoleErrors.filter((e) => !SW_BLOCK_NOISE.test(e));
if (realErrors.length) {
  console.log(`\nbrowser console errors (${realErrors.length}):`);
  for (const e of realErrors.slice(0, 10)) console.log(`  ${e}`);
}

console.log(`\nscreenshots: ${POLICIES.map((p) => shot(p)).join(", ")}`);
await browser.close();
process.exit(results.every((r) => r.ok) && !realErrors.length ? 0 : 1);
