// Screenshot HAventory's *setup* dialog in whatever language the Home Assistant
// profile is set to, and optionally submit it.
//
// The config flow has no URL of its own, but HA's own `my` redirect opens it:
// /_my_redirect/config_flow_start?domain=haventory. It only starts when no
// entry exists — the integration is single-instance — so the caller has to
// remove the entry first and put it back afterwards.
//
// Usage (from the skill dir):
//   node shot_config_flow.mjs [--out <prefix>] [--submit]
//
// --submit presses the form's submit button and shoots the "created" screen too.

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

const { base, token } = haConfig();
if (!token) {
  console.error("Missing HA_TOKEN (env or repo-root .env)");
  process.exit(2);
}
const prefix = flag("--out", "config-flow");
const submit = args.includes("--submit");

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  serviceWorkers: "block",
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.error(`console: ${m.text()}`);
});

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

await page.goto(base + "/_my_redirect/config_flow_start?domain=haventory", {
  waitUntil: "domcontentloaded",
});
if (page.url().includes("/auth/authorize")) {
  console.error("Redirected to the login page — is HA_TOKEN valid?");
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(4000);
// HA asks "Do you want to set up <integration>?" first; that is its own
// dialog, not the integration's step.
const confirm = page.getByRole("button", { name: /^(OK|Ja|Yes)$/ }).first();
if (await confirm.count()) {
  await confirm.click();
  await page.waitForTimeout(4000);
}
await page.screenshot({ path: path.join(skillDir, `${prefix}-step.png`) });

if (submit) {
  const button = page.getByRole("button", { name: /^(Absenden|Submit|Bestätigen|OK|Weiter|Next)$/i }).first();
  await button.click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(skillDir, `${prefix}-created.png`) });
}

await browser.close();
console.log(`wrote ${prefix}-step.png${submit ? ` and ${prefix}-created.png` : ""}`);
