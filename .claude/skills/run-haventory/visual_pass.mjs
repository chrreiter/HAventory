// Walk HAventory's surfaces — the card and the sidebar panel, each at a desktop
// and a phone width — screenshotting each and reporting whether it actually opened.
//
// A single screenshot proves one view renders; this proves the set of them do,
// which is what a UI change needs before and after. Each surface is a named
// recipe of clicks against the card's own `data-testid`s, so a rename in the
// card fails the recipe loudly instead of silently capturing the wrong screen.
//
// The pass is also a DOM check, not only a picture: every surface asserts that
// its root element exists in the shadow DOM after the recipe runs, and the run
// exits non-zero if any surface, at any width, failed to open.
//
// Usage (from the skill dir, .claude/skills/run-haventory/):
//   node visual_pass.mjs                       # every pass into ./visual/
//   node visual_pass.mjs --out before          # ./before/  (then --out after to compare)
//   node visual_pass.mjs --only desktop        # or mobile, panel, panel-mobile
//   node visual_pass.mjs --surfaces list,search,full-view
//   node visual_pass.mjs --dark                # HA dark theme + dark OS scheme
//   node visual_pass.mjs --list                # print the surface names and exit
//   node visual_pass.mjs --path desktop=/other/wide   # one pass onto another view
//   node visual_pass.mjs --dashboard household          # on an instance with two
//
// The four passes open three different URLs, so `--path` names the pass it
// applies to and may be repeated. A bare `--path <url>` is taken only alongside
// `--only`, where there is exactly one pass for it to mean.
//
// `--dashboard <url path or title>` narrows discovery to one dashboard for the
// whole run, for an instance holding the card on more than one; a `--path` names
// a URL outright and still wins for the pass it targets.
//
// Everything it drives is read-only: it opens panels, sheets and editors but
// never saves, imports or deletes. The one exception is the search box, which is
// cleared again before the next surface.
//
// Reads HA_BASE_URL / HA_TOKEN from the environment or the repo-root .env.

import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { cardPath, haConfig, parsePathOverrides } from "./card_views.mjs";
import {
  CARD,
  DESKTOP_SURFACES,
  MOBILE_SURFACES,
  PANEL,
  PANEL_MOBILE_SURFACES,
  PANEL_SURFACES,
} from "./surfaces.mjs";

const skillDir = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

if (args.includes("--list")) {
  console.log("desktop:     ", DESKTOP_SURFACES.map((s) => s.id).join(", "));
  console.log("mobile:      ", MOBILE_SURFACES.map((s) => s.id).join(", "));
  console.log("panel:       ", PANEL_SURFACES.map((s) => s.id).join(", "));
  console.log("panel-mobile:", PANEL_MOBILE_SURFACES.map((s) => s.id).join(", "));
  process.exit(0);
}

const { base, token } = haConfig();
if (!token) {
  console.error("Missing HA_TOKEN (env or repo-root .env)");
  process.exit(2);
}

const outDir = path.resolve(skillDir, flag("--out", "visual"));
const haDark = args.includes("--dark");
const only = flag("--only", null);
const dashboard = flag("--dashboard", null);
const wanted = flag("--surfaces", null)?.split(",").map((s) => s.trim());
mkdirSync(outDir, { recursive: true });

// The sidebar panel is Home Assistant's own route into the integration, so it
// needs no dashboard at all — and it gets the whole content area, which is why
// both panel passes use it at both widths.
const PANEL_ROUTE = "/haventory";

// `shape` is what the pass needs of a dashboard view (see card_views.mjs); the
// panel passes name a route instead, because theirs is not a dashboard.
const ALL_PASSES = [
  {
    key: "desktop",
    prefix: "d",
    root: CARD,
    surfaces: DESKTOP_SURFACES,
    shape: "wide",
    layout: "desktop",
    contextOptions: { viewport: { width: 1440, height: 900 } },
  },
  {
    key: "mobile",
    prefix: "m",
    root: CARD,
    surfaces: MOBILE_SURFACES,
    shape: "column",
    layout: "mobile",
    contextOptions: { ...devices["iPhone 15"], deviceScaleFactor: 2 },
  },
  {
    key: "panel",
    prefix: "p",
    root: PANEL,
    surfaces: PANEL_SURFACES,
    route: PANEL_ROUTE,
    contextOptions: { viewport: { width: 1440, height: 900 } },
  },
  {
    // 375px is below `hv-full-view`'s own 700px breakpoint AND narrow enough for
    // Home Assistant to collapse its sidebar, which is what sets the panel's
    // `narrow` property — the two independent switches this pass exists to cover.
    key: "panel-mobile",
    prefix: "pm",
    root: PANEL,
    surfaces: PANEL_MOBILE_SURFACES,
    route: PANEL_ROUTE,
    contextOptions: {
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
    },
  },
];

const PASS_KEYS = ALL_PASSES.map((p) => p.key);
// An unrecognised --only would otherwise select no pass at all and the run would
// report 0/0 captured and exit 0 — a typo that reads as a clean run.
if (only && !PASS_KEYS.includes(only)) {
  console.error(`--only ${only}: unknown pass (expected ${PASS_KEYS.join(", ")})`);
  process.exit(2);
}

const { overrides, error } = parsePathOverrides(args, PASS_KEYS, only);
if (error) {
  console.error(error);
  process.exit(2);
}

const PASSES = ALL_PASSES.filter((p) => !only || p.key === only);
try {
  for (const pass of PASSES) {
    const override = overrides[pass.key] ?? null;
    if (pass.route && !override) {
      pass.urlPath = pass.route;
      console.log(`view (${pass.key}): ${pass.route}  ← the integration's own panel route`);
    } else {
      pass.urlPath = await cardPath(pass.shape, { override, label: pass.key, dashboard });
    }
  }
} catch (err) {
  // A --dashboard that names nothing belongs with the other rejected flags
  // above, as one line — not as an uncaught rejection with a stack.
  console.error(err.message);
  process.exit(2);
}

const results = [];
const browser = await chromium.launch({ args: ["--touch-events=enabled"] });

for (const pass of PASSES) {
  console.log(`\n== ${pass.key} ==`);
  // HA's service worker reloads the page 30-90 s into a fresh context, which
  // would destroy the run mid-surface. A full pass is longer than that window.
  const context = await browser.newContext({
    ...pass.contextOptions,
    serviceWorkers: "block",
    colorScheme: haDark ? "dark" : "light",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  // A 404 reaches the console as an untraceable "Failed to load resource".
  // Recording the URLs is the only way to tell an HA-bundle 404 (it asks for
  // @babel/runtime helpers that are not shipped) from a missing card asset.
  const notFound = [];
  page.on("response", (res) => {
    if (res.status() === 404) notFound.push(res.url());
  });

  // The HA frontend trusts hassTokens if `expires` is in the future. HA's own
  // dark mode is a separate switch from the OS colour scheme, so --dark sets both.
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

  const url = base + pass.urlPath;
  const loadRoot = async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/auth/authorize")) {
      console.error("Redirected to the login page — hassTokens injection was rejected. Is HA_TOKEN valid?");
      await browser.close();
      process.exit(1);
    }
    await page.waitForSelector(pass.root, { timeout: 30000 });
    await page.waitForTimeout(2500); // let the WS subscription deliver the first page
  };

  const touch = Boolean(pass.contextOptions.hasTouch);
  const step = async ([kind, target, value]) => {
    if (kind === "wait") return page.waitForTimeout(Number(target));
    if (kind === "key") return page.keyboard.press(target);
    const el = page.locator(target).first();
    // A hover target is revealed by the hover itself, so it is attached but not
    // yet visible — waiting for visibility would deadlock.
    await el.waitFor({ state: kind === "hover" ? "attached" : "visible", timeout: 10000 });
    if (kind === "fill") return el.fill(value);
    if (kind === "hover") return el.hover();
    if (touch) return el.tap();
    return el.click();
  };

  // A view of the wrong shape still renders the card, and enough testids are
  // shared between the two branches that the recipes below would pass while
  // photographing the other layout — the failure this pass exists to rule out.
  // The shell reflects the branch it measured itself into, so ask it once, up
  // front, and fail the pass instead of the reader's trust.
  if (pass.layout) {
    const name = `${pass.prefix}-layout`;
    try {
      await loadRoot();
      const mobile = await page
        .locator(CARD)
        .first()
        .evaluate((el) => el.shadowRoot?.querySelector("hv-card-shell")?.hasAttribute("mobile") ?? null);
      if (mobile !== (pass.layout === "mobile")) {
        throw new Error(
          `card took its ${mobile ? "narrow" : "desktop"} branch on ${pass.urlPath}, but this pass needs the ${pass.layout} one`,
        );
      }
      console.log(`  PASS  ${name} (${pass.layout} branch on ${pass.urlPath})`);
      results.push({ name, ok: true });
    } catch (err) {
      console.log(`  FAIL  ${name}: ${err.message.split("\n")[0]}`);
      results.push({ name, ok: false, error: err.message.split("\n")[0] });
    }
  }

  for (const surface of pass.surfaces) {
    if (wanted && !wanted.some((w) => surface.id.includes(w))) continue;
    const name = `${pass.prefix}-${surface.id}`;
    const file = path.join(outDir, `${name}.png`);
    try {
      await loadRoot();
      for (const s of surface.open) await step(s);
      for (const sel of [surface.expect].flat()) {
        await page.waitForSelector(sel, { timeout: 10000 });
      }
      // A layout defined by what it drops needs the absence asserted too, or the
      // recipe passes on the branch it was written to rule out.
      if (surface.hidden) await page.waitForSelector(surface.hidden, { state: "hidden", timeout: 10000 });
      await page.waitForTimeout(500); // let transitions settle before the capture
      await page.screenshot({ path: file });
      console.log(`  PASS  ${name}`);
      results.push({ name, ok: true });
    } catch (err) {
      // Capture the failure too: a screenshot of the wrong screen is the fastest
      // way to see why a recipe stopped matching.
      await page.screenshot({ path: file }).catch(() => {});
      console.log(`  FAIL  ${name}: ${err.message.split("\n")[0]}`);
      results.push({ name, ok: false, error: err.message.split("\n")[0] });
    }
  }

  // Blocking the service worker makes HA's own bundle touch
  // `navigator.serviceWorker` when it is undefined; HA also requests
  // @babel/runtime helpers it does not ship. Neither is the card's doing, and
  // both are constant, so they are named rather than counted as failures.
  const SW_BLOCK_NOISE = /serviceWorker|reading 'addEventListener'/;
  const haBundle404 = notFound.filter((u) => /@babel\/runtime|\/unknown\//.test(u));
  const cardMissing = notFound.filter((u) => /haventory/.test(u));
  const resourceNoise = haBundle404.length && /Failed to load resource/;
  const real = consoleErrors.filter(
    (e) => !SW_BLOCK_NOISE.test(e) && !(resourceNoise && resourceNoise.test(e)),
  );
  if (haBundle404.length) console.log(`  (${haBundle404.length} HA-bundle 404s, e.g. ${haBundle404[0]})`);
  if (cardMissing.length) {
    console.log(`  MISSING card assets (${cardMissing.length}):`);
    for (const u of cardMissing.slice(0, 5)) console.log(`    ${u}`);
    results.push({ name: `${pass.key} assets`, ok: false, error: `${cardMissing.length} card 404s` });
  }
  if (real.length) {
    console.log(`  browser console errors (${real.length}):`);
    for (const e of real.slice(0, 10)) console.log(`    ${e}`);
    results.push({ name: `${pass.key} console`, ok: false, error: `${real.length} console errors` });
  }
  await context.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} surfaces captured into ${outDir}`);
if (failed.length) {
  console.log("failed:");
  for (const f of failed) console.log(`  ${f.name}: ${f.error}`);
}
process.exit(failed.length ? 1 : 0);
