// Screenshot the HAventory Lovelace card inside a real Home Assistant frontend.
//
// Bypasses the HA login form by injecting the long-lived token into the
// frontend's `hassTokens` localStorage entry before any page script runs.
//
// Usage (from the skill dir, .claude/skills/run-haventory/):
//   node screenshot.mjs [--out <file.png>] [--path <ha-url-path>] [--search <text>]
// Defaults: --out screenshot.png, --path /lovelace/default_view
// --search types into the card's search box before shooting (drives the real
// filter pipeline: card -> WS -> repository index -> filtered render).
//
// Reads HA_BASE_URL / HA_TOKEN from the environment or the repo-root .env.
// Prints browser console errors (the card logs there) — useful when the card
// renders blank.

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(skillDir, "..", "..", "..");

// --- config: env wins, .env fills the gaps -------------------------------
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

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const outFile = path.resolve(skillDir, flag("--out", "screenshot.png"));
const urlPath = flag("--path", "/lovelace/default_view");

// --- drive ---------------------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

// The HA frontend trusts hassTokens if `expires` is in the future; the
// long-lived token works as access_token. clientId must be `${origin}/`.
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

// Playwright selectors pierce shadow DOM: wait for the card element itself.
await page.waitForSelector("haventory-card", { timeout: 30000 });
await page.waitForTimeout(2500); // let the card's WS subscription deliver data

const searchText = flag("--search", null);
if (searchText !== null) {
  const search = page.locator('haventory-card input[placeholder="Search"]');
  await search.fill(searchText);
  await page.waitForTimeout(1500); // debounce + round-trip through the WS filter
}

await page.screenshot({ path: outFile, fullPage: false });
console.log(`screenshot: ${outFile}`);
if (consoleErrors.length) {
  console.log(`browser console errors (${consoleErrors.length}):`);
  for (const e of consoleErrors.slice(0, 10)) console.log(`  ${e}`);
}
await browser.close();
