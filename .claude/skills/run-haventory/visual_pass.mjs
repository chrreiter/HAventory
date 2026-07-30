// Walk the card's surfaces at desktop and mobile widths, screenshotting each and
// reporting whether it actually opened.
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
//   node visual_pass.mjs                       # desktop + mobile into ./visual/
//   node visual_pass.mjs --out before          # ./before/  (then --out after to compare)
//   node visual_pass.mjs --only desktop        # or --only mobile
//   node visual_pass.mjs --surfaces list,search,full-view
//   node visual_pass.mjs --dark                # HA dark theme + dark OS scheme
//   node visual_pass.mjs --list                # print the surface names and exit
//
// Everything it drives is read-only: it opens panels, sheets and editors but
// never saves, imports or deletes. The one exception is the search box, which is
// cleared again before the next surface.
//
// Reads HA_BASE_URL / HA_TOKEN from the environment or the repo-root .env.

import { chromium, devices } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(skillDir, "..", "..", "..");

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

// --- surface recipes ------------------------------------------------------
// `open` is a list of steps run in order against the card:
//   ["click", <sel>]  ["hover", <sel>]  ["fill", <sel>, <text>]  ["key", <key>]  ["wait", <ms>]
// `expect` is the selector that must be visible once the recipe has run.
// Selectors pierce shadow DOM, so nested components address directly.
//
// Every recipe starts from a freshly loaded page. Chaining them instead would be
// faster, but a modal left standing puts a scrim over everything that follows
// and one failure then cascades into a dozen — which reads as a broken card
// rather than a broken recipe. That is why the full-view surfaces each re-open
// the full view rather than assuming the previous surface left it up.
//
// Surfaces are named after what a reader would call the screen, and prefixed
// d-/m- in the file name so a desktop and a mobile capture of the same surface
// sort next to each other.
//
// The card chooses its layout from ITS OWN width, not the viewport's, so the
// desktop pass runs on the `wide` dashboard view: in a normal dashboard column
// even a 1440px window gets the narrow branch, where the filter panel is a modal
// sheet and the full-view link is absent entirely.
const CARD = "haventory-card";
const OVERFLOW = `${CARD} [data-testid="card-overflow"] button`;
const menu = (id) => `${CARD} [data-testid="overflow-item"][data-id="${id}"]`;

// Opening the full view is a shared prefix, not a surface the later ones inherit.
const OPEN_FULL = [
  ["click", `${CARD} [data-testid="expand-toggle"]`],
  ["wait", 1500],
];

const DESKTOP_SURFACES = [
  { id: "01-list", open: [], expect: `${CARD} [data-testid="card-list"]` },
  {
    id: "02-filter-panel",
    open: [["click", `${CARD} [data-testid="filter-toggle"]`]],
    expect: `${CARD} [data-testid="filter-panel"]`,
  },
  {
    id: "03-search",
    open: [
      ["fill", `${CARD} [data-testid="search-input"]`, "box"],
      ["wait", 1500],
    ],
    expect: `${CARD} [data-testid="card-list"]`,
  },
  {
    id: "04-add-editor",
    open: [["click", `${CARD} [data-testid="add-item"]`]],
    expect: `${CARD} [data-testid="item-editor"]`,
  },
  {
    id: "05-row-editor",
    // The row's edit button lives in `.hover-actions` and is transparent until
    // the row is hovered, so it has to be revealed before it can be clicked.
    open: [
      ["hover", `${CARD} [data-testid="list-row"]`],
      ["click", `${CARD} [data-testid="list-row"] [data-testid="row-edit"]`],
    ],
    expect: `${CARD} [data-testid="item-editor"]`,
  },
  {
    id: "06-overflow",
    open: [["click", OVERFLOW]],
    expect: `${CARD} [data-testid="overflow-menu"]`,
  },
  {
    id: "07-organize",
    open: [
      ["click", OVERFLOW],
      ["click", menu("organize")],
      ["wait", 800],
    ],
    expect: `${CARD} [data-testid="organize-dialog"]`,
  },
  {
    id: "08-diagnostics",
    open: [
      ["click", OVERFLOW],
      ["click", menu("diagnostics")],
      ["wait", 800],
    ],
    // The panel host is a zero-size wrapper; its status line is what proves the
    // panel is actually open.
    expect: `${CARD} [data-testid="diagnostics-status"]`,
  },
  {
    id: "09-import",
    open: [
      ["click", OVERFLOW],
      ["click", menu("import")],
    ],
    expect: `${CARD} [data-testid="import-text"]`,
  },
  {
    id: "10-selection",
    // Selection mode is entered from the menu; the per-row checkboxes do not
    // exist until it is on.
    open: [
      ["click", OVERFLOW],
      ["click", menu("select-items")],
      ["wait", 700],
    ],
    expect: `${CARD} [data-testid="selection-bar"], ${CARD} [data-testid="bulk-bar"]`,
  },
  {
    id: "11-full-view",
    // `expand-toggle` is the app-bar control and exists at every width;
    // `open-full-view` is a footer link the narrow branch does not render.
    open: OPEN_FULL,
    expect: `${CARD} [data-testid="full-view"]`,
  },
  {
    id: "12-full-filters",
    open: [...OPEN_FULL, ["click", `${CARD} [data-testid="full-filters-toggle"]`], ["wait", 500]],
    expect: `${CARD} [data-testid="full-filter-panel"]`,
  },
  {
    id: "13-full-editor",
    open: [...OPEN_FULL, ["click", `${CARD} [data-testid="full-add-item"]`], ["wait", 600]],
    expect: `${CARD} [data-testid="item-editor"]`,
  },
  {
    id: "14-full-columns",
    open: [...OPEN_FULL, ["click", `${CARD} [data-testid="columns-expanded"]`], ["wait", 600]],
    expect: `${CARD} [data-testid="column-options"]`,
  },
];

// The narrow layout is a different component tree, not a reflow: the filter
// panel becomes a sheet, the row opens a detail sheet, and the editor arrives as
// a bottom sheet. Recipes that only exist here live in their own list.
const MOBILE_SURFACES = [
  { id: "01-list", open: [], expect: `${CARD} [data-testid="card-list"]` },
  {
    id: "02-filter-sheet",
    open: [
      ["click", `${CARD} [data-testid="filter-toggle"]`],
      ["wait", 600],
    ],
    // `filter-sheet` is the bottom-sheet host and has no box of its own, so the
    // sheet's own footer button is what proves it came up.
    expect: `${CARD} [data-testid="sheet-cancel"]`,
    // A modal sheet is not dismissed by pressing its opener again — leaving it
    // up would put a scrim over every surface that follows.
  },
  {
    id: "03-detail-sheet",
    open: [
      ["click", `${CARD} [data-testid="list-row"] [data-testid="row-name"]`],
      ["wait", 700],
    ],
    expect: `${CARD} [data-testid="sheet-name"]`,
  },
  {
    id: "04-add-sheet",
    open: [
      ["click", `${CARD} [data-testid="add-item"]`],
      ["wait", 700],
    ],
    expect: `${CARD} [data-testid="item-editor"]`,
  },
  {
    id: "05-overflow",
    open: [["click", OVERFLOW]],
    expect: `${CARD} [data-testid="overflow-menu"]`,
  },
  {
    id: "06-organize",
    open: [
      ["click", OVERFLOW],
      ["click", menu("organize")],
      ["wait", 900],
    ],
    expect: `${CARD} [data-testid="organize-dialog"]`,
  },
  {
    id: "07-diagnostics",
    open: [
      ["click", OVERFLOW],
      ["click", menu("diagnostics")],
      ["wait", 800],
    ],
    expect: `${CARD} [data-testid="diagnostics-status"]`,
  },
  {
    id: "08-full-view",
    open: [
      ["click", `${CARD} [data-testid="expand-toggle"]`],
      ["wait", 1500],
    ],
    expect: `${CARD} [data-testid="full-view"]`,
  },
];

if (args.includes("--list")) {
  console.log("desktop:", DESKTOP_SURFACES.map((s) => s.id).join(", "));
  console.log("mobile: ", MOBILE_SURFACES.map((s) => s.id).join(", "));
  process.exit(0);
}

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

const outDir = path.resolve(skillDir, flag("--out", "visual"));
// Per-pass by default; --path forces one view for both, which is how you check
// a single dashboard layout rather than the two the card is designed for.
const urlPathOverride = flag("--path", null);
const haDark = args.includes("--dark");
const only = flag("--only", null);
const wanted = flag("--surfaces", null)?.split(",").map((s) => s.trim());
mkdirSync(outDir, { recursive: true });

const PASSES = [
  {
    key: "desktop",
    prefix: "d",
    surfaces: DESKTOP_SURFACES,
    urlPath: "/lovelace/wide",
    contextOptions: { viewport: { width: 1440, height: 900 } },
  },
  {
    key: "mobile",
    prefix: "m",
    surfaces: MOBILE_SURFACES,
    urlPath: "/lovelace/default_view",
    contextOptions: { ...devices["iPhone 15"], deviceScaleFactor: 2 },
  },
].filter((p) => !only || p.key === only);

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

  const url = base + (urlPathOverride ?? pass.urlPath);
  const loadCard = async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/auth/authorize")) {
      console.error("Redirected to the login page — hassTokens injection was rejected. Is HA_TOKEN valid?");
      await browser.close();
      process.exit(1);
    }
    await page.waitForSelector(CARD, { timeout: 30000 });
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

  for (const surface of pass.surfaces) {
    if (wanted && !wanted.some((w) => surface.id.includes(w))) continue;
    const name = `${pass.prefix}-${surface.id}`;
    const file = path.join(outDir, `${name}.png`);
    try {
      await loadCard();
      for (const s of surface.open) await step(s);
      await page.waitForSelector(surface.expect, { timeout: 10000 });
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
