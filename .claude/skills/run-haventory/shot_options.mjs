// Screenshot HAventory's options screen (and, with --config, a fresh config
// flow) in whatever language the Home Assistant profile is set to.
//
// Both dialogs are opened by clicking through HA's own UI, because neither has
// a URL of its own — the options flow is a dialog on the integration page and
// the config flow is one on the integrations list.
//
// Usage (from the skill dir):
//   node shot_options.mjs [--out <prefix>] [--dark] [--scheme light|dark]
//
// Reads HA_BASE_URL / HA_TOKEN from the environment or the repo-root .env.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { haConfig } from "./card_views.mjs";

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const has = (name) => args.includes(name);

const { base, token } = haConfig();
if (!token) {
  console.error("Missing HA_TOKEN (env or repo-root .env)");
  process.exit(2);
}

const prefix = flag("--out", "options");
const haDark = has("--dark");
const colorScheme = flag("--scheme", haDark ? "dark" : "light");

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  serviceWorkers: "block",
  colorScheme,
});
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

await page.addInitScript(
  ([hassUrl, accessToken, dark]) => {
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
    if (dark) localStorage.setItem("selectedTheme", JSON.stringify({ dark: true }));
  },
  [base, token, haDark],
);

await page.goto(base + "/config/integrations/integration/haventory", {
  waitUntil: "domcontentloaded",
});
if (page.url().includes("/auth/authorize")) {
  console.error("Redirected to the login page — is HA_TOKEN valid?");
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(skillDir, `${prefix}-entry.png`) });

// The entry card's "Configure" / "Konfigurieren" link. Role selectors pierce
// shadow DOM, and the label is whatever language the profile is in — so match
// on either spelling rather than on one.
const configure = page.getByRole("link", { name: /Konfigurieren|Configure/i }).first();
const configureButton = page.getByRole("button", { name: /Konfigurieren|Configure/i }).first();
const target = (await configure.count()) ? configure : configureButton;
await target.click();
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(skillDir, `${prefix}-options.png`) });

// The full step text lives inside a scrolling dialog, so grab what it rendered
// as well — a screenshot cuts off the long section descriptions.
const text = await page.evaluate(() => {
  const seen = new Set();
  const out = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll("*")) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
    const dialog = root.querySelector?.("ha-dialog, dialog");
    if (dialog) out.push(dialog.textContent);
  };
  walk(document);
  return out.join("\n----\n");
});
console.log(text.replace(/\n{3,}/g, "\n\n").slice(0, 6000));

for (const e of consoleErrors.slice(0, 10)) console.error(`console: ${e}`);
await browser.close();
console.log(`\nwrote ${prefix}-entry.png and ${prefix}-options.png`);
