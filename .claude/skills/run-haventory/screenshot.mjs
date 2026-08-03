// Screenshot / drive an HAventory surface — the Lovelace card or the sidebar
// panel — inside a real Home Assistant frontend.
//
// Bypasses the HA login form by injecting the long-lived token into the
// frontend's `hassTokens` localStorage entry before any page script runs.
//
// Usage (from the skill dir, .claude/skills/run-haventory/):
//   node screenshot.mjs [--out <file.png>] [--path <ha-url-path>] [--full]
//                       [--element <selector>]
//                       [--device <name> | --mobile | --viewport <WxH>] [--dsf <n>]
//                       [--dark] [--scheme light|dark]
//                       [--search <text>] [--tap <selector>]
//                       [--swipe <dir>[@<selector>]] [--wait <ms>]
//
// Defaults: --out screenshot.png, --path /dashboard-dev/0, desktop 1280x900.
//
// --element names the root the run waits for and scopes --search/--swipe to. The
// dashboard card is the default; the sidebar panel at /haventory renders
// <haventory-panel> and no card at all, so shooting it needs
// `--path /haventory --element haventory-panel`.
//
// Mobile view + touch:
//   --mobile            shorthand for --device "iPhone 15"
//   --device <name>     any Playwright device descriptor ("Pixel 8", "iPad Mini",
//                       "Galaxy S24", "iPhone 15 Pro landscape", ...). Sets viewport,
//                       device pixel ratio, mobile UA and — importantly — hasTouch,
//                       so the page takes the touch/coarse-pointer code paths and HA
//                       itself switches to its narrow (sidebar-collapsed) layout.
//   --viewport 390x844  raw size with touch enabled, when no descriptor fits.
//   `node screenshot.mjs --devices` lists the descriptor names.
//
// --search/--tap/--swipe run in the order given on the command line, so you can
// chain them (e.g. --tap open a sheet, then --swipe down to dismiss it). With touch
// emulation on, --tap dispatches a real tap and --swipe dispatches a genuine
// touchStart/touchMove*/touchEnd sequence over CDP (fling velocity included), which
// is what scroll containers, `touch-action` rules and any gesture handler actually see.
//
// Reads HA_BASE_URL / HA_TOKEN from the environment or the repo-root .env.
// Prints browser console errors (the card logs there) — useful when the card
// renders blank.

import { chromium, devices } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(skillDir, "..", "..", "..");

const args = process.argv.slice(2);

if (args.includes("--devices")) {
  console.log(Object.keys(devices).join("\n"));
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

// --- args ----------------------------------------------------------------
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const has = (name) => args.includes(name);

const outFile = path.resolve(skillDir, flag("--out", "screenshot.png"));
// The default dashboard is HA's generated one and carries no HAventory card, so
// the card lives on a `dev` dashboard: view 0 is a sections grid, which is the
// narrow column a card normally sits in. Views without a `path` are addressed by
// index. See SKILL.md for the dashboard the dev instance is expected to have.
const urlPath = flag("--path", "/dashboard-dev/0");
const rootElement = flag("--element", "haventory-card");
const fullPage = has("--full");
const haDark = has("--dark");
const colorScheme = flag("--scheme", haDark ? "dark" : "light");

// Ordered action list, so --tap/--swipe/--search/--wait compose left to right.
const ACTION_FLAGS = new Set(["--search", "--tap", "--swipe", "--wait"]);
const actions = [];
for (let i = 0; i < args.length; i++) {
  if (ACTION_FLAGS.has(args[i]) && args[i + 1] !== undefined) {
    actions.push({ kind: args[i].slice(2), value: args[i + 1] });
    i++;
  }
}

// --- viewport / touch emulation ------------------------------------------
let contextOptions = { viewport: { width: 1280, height: 900 }, serviceWorkers: "block" };
let emulationLabel = "desktop 1280x900 (no touch)";

const deviceName = has("--mobile") ? "iPhone 15" : flag("--device", null);
const viewportArg = flag("--viewport", null);

if (deviceName) {
  const descriptor = devices[deviceName];
  if (!descriptor) {
    const near = Object.keys(devices).filter((d) =>
      d.toLowerCase().includes(deviceName.toLowerCase().split(" ")[0]),
    );
    console.error(`Unknown device "${deviceName}".` + (near.length ? ` Did you mean: ${near.slice(0, 8).join(", ")}` : ""));
    console.error("Full list: node screenshot.mjs --devices");
    process.exit(2);
  }
  contextOptions = { ...descriptor, ...contextOptions, viewport: descriptor.viewport };
  emulationLabel = `${deviceName} ${descriptor.viewport.width}x${descriptor.viewport.height} @${descriptor.deviceScaleFactor}x (touch)`;
} else if (viewportArg) {
  const m = viewportArg.match(/^(\d+)x(\d+)$/);
  if (!m) {
    console.error(`--viewport expects WxH, e.g. 390x844 (got "${viewportArg}")`);
    process.exit(2);
  }
  contextOptions = {
    ...contextOptions,
    viewport: { width: Number(m[1]), height: Number(m[2]) },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  };
  emulationLabel = `${m[1]}x${m[2]} (touch)`;
}

const dsf = flag("--dsf", null);
if (dsf) contextOptions.deviceScaleFactor = Number(dsf);
contextOptions.colorScheme = colorScheme;

const touchEnabled = Boolean(contextOptions.hasTouch);

// --- drive ---------------------------------------------------------------
// `hasTouch` alone gives navigator.maxTouchPoints=1 and `(pointer: coarse)`, but
// leaves `'ontouchstart' in window` FALSE — code that feature-detects touch that
// way would take the desktop path. --touch-events=enabled installs the global.
const browser = await chromium.launch({ args: touchEnabled ? ["--touch-events=enabled"] : [] });
// HA's service worker activates ~30-90s into a fresh context and reloads the
// page, which kills the JS execution context mid-run and looks exactly like a
// card crash. Blocking it costs one harmless `navigator.serviceWorker` console
// error from HA's own bundle.
const context = await browser.newContext(contextOptions);
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

// The HA frontend trusts hassTokens if `expires` is in the future; the
// long-lived token works as access_token. clientId must be `${origin}/`.
// HA's own dark mode is independent of the OS colour scheme — it reads the
// `selectedTheme` localStorage entry, so set both to test a real dark card.
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

await page.goto(base + urlPath, { waitUntil: "domcontentloaded" });

if (page.url().includes("/auth/authorize")) {
  console.error("Redirected to the login page — hassTokens injection was rejected. Is HA_TOKEN valid?");
  await browser.close();
  process.exit(1);
}

// Playwright selectors pierce shadow DOM: wait for the root element itself.
try {
  await page.waitForSelector(rootElement, { timeout: 30000 });
} catch {
  // A root that never appears is the one failure with two very different
  // causes — the wrong root for this path, or a page whose bundle never
  // loaded — so say which root and which path, and hand over the console.
  console.error(`Timed out waiting for "${rootElement}" on ${urlPath}.`);
  console.error('The dashboard card is "haventory-card"; the sidebar panel at /haventory is "haventory-panel".');
  for (const e of consoleErrors.slice(0, 10)) console.error(`  ${e}`);
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(2500); // let the root's WS subscription deliver data

// --- touch gestures ------------------------------------------------------
// Playwright's public API has tap() but no drag-with-a-finger, so swipes go
// through CDP. These are real touch events: the DOM sees
// touchstart/touchmove*/touchend and the browser scrolls the container, which is
// what `touch-action: pan-y` and any gesture handler react to.
// Measured caveat: ~36px of the travel is eaten by Chromium's touch-slop
// threshold before scrolling starts, and there is NO fling momentum after
// touchEnd (scrollTop stops dead). Distances are therefore approximate and
// momentum-dependent behaviour needs a real device.
let cdp = null;
async function dispatchTouch(type, points) {
  cdp ??= await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}
const finger = (x, y) => [{ x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1, id: 1 }];

async function swipe(spec) {
  // spec: "<up|down|left|right>[@<selector>][:<distance-px>]"
  const [dirPart, selPart] = spec.split("@");
  const [dir, distStr] = dirPart.split(":");
  const selector = selPart || rootElement;
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`--swipe target not visible: ${selector}`);

  const vp = page.viewportSize();
  const cx = Math.min(Math.max(box.x + box.width / 2, 4), vp.width - 4);
  const cy = Math.min(Math.max(box.y + box.height / 2, 4), vp.height - 4);
  const span = { up: box.height, down: box.height, left: box.width, right: box.width }[dir];
  if (span === undefined) throw new Error(`--swipe direction must be up|down|left|right (got "${dir}")`);
  // Stay inside the viewport: half the visible extent, capped.
  const limit = dir === "up" || dir === "down" ? Math.min(cy, vp.height - cy) : Math.min(cx, vp.width - cx);
  const distance = Number(distStr) || Math.min(span * 0.6, limit - 8);

  const delta = {
    up: { x: 0, y: -distance },
    down: { x: 0, y: distance },
    left: { x: -distance, y: 0 },
    right: { x: distance, y: 0 },
  }[dir];

  const steps = 16;
  await dispatchTouch("touchStart", finger(cx, cy));
  for (let i = 1; i <= steps; i++) {
    await dispatchTouch("touchMove", finger(cx + (delta.x * i) / steps, cy + (delta.y * i) / steps));
    await page.waitForTimeout(16); // ~60fps -> realistic fling velocity
  }
  await dispatchTouch("touchEnd", []);
  await page.waitForTimeout(400); // momentum / animation settle
  console.log(`swipe ${dir} ${Math.round(distance)}px on ${selector}`);
}

// --- run the requested actions in order ----------------------------------
for (const action of actions) {
  if (action.kind === "search") {
    // The card's list search is [data-testid="search-input"]; the full view and
    // the panel own a different box, and every one of them has a dynamic
    // placeholder ("Search 560 matching items…") that starts with "Search".
    const search = page
      .locator(`${rootElement} [data-testid="search-input"], ${rootElement} input[placeholder^="Search"]`)
      .first();
    await search.fill(action.value);
    await page.waitForTimeout(1500); // debounce + round-trip through the WS filter
  } else if (action.kind === "tap") {
    const target = page.locator(action.value).first();
    await target.waitFor({ state: "visible", timeout: 10000 });
    if (touchEnabled) await target.tap();
    else await target.click();
    await page.waitForTimeout(600);
    console.log(`${touchEnabled ? "tap" : "click"}: ${action.value}`);
  } else if (action.kind === "swipe") {
    if (!touchEnabled) {
      console.error("--swipe needs touch emulation: add --mobile, --device <name> or --viewport WxH");
      await browser.close();
      process.exit(2);
    }
    await swipe(action.value);
  } else if (action.kind === "wait") {
    await page.waitForTimeout(Number(action.value));
  }
}

await page.screenshot({ path: outFile, fullPage });
console.log(`screenshot: ${outFile}  [${emulationLabel}, scheme=${colorScheme}${haDark ? ", HA theme=dark" : ""}]`);
if (consoleErrors.length) {
  console.log(`browser console errors (${consoleErrors.length}):`);
  for (const e of consoleErrors.slice(0, 10)) console.log(`  ${e}`);
}
await browser.close();
