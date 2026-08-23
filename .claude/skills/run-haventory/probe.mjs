// DOM probe: open an HAventory surface in the real Home Assistant frontend,
// drive it, and read the DOM back as JSON.
//
// screenshot.mjs answers "what does it look like"; this answers "what are the
// numbers" — the rect a chip really occupies, the computed style a rule really
// produced, the state a component really holds. It logs in the same way
// (the long-lived token injected into `hassTokens` before any page script runs)
// and takes the same shape of arguments, so a measurement and a screenshot of
// the same screen are two commands that differ in one flag.
//
// Usage (from the skill dir, .claude/skills/run-haventory/):
//   node probe.mjs [--path <ha-url-path>] [--element <selector>]
//                  [--mobile | --viewport <WxH> [--touch]]
//                  [--locale <bcp47>] [--dark] [--settle <ms>]
//                  [--search <text>] [--click <selector>] [--tap <selector>]
//                  [--fill '<selector>=><value>'] [--press <key>] [--wait <ms>]
//                  [--eval '<js expression>'] [--out <file.png>] [--full]
//                  [--help|-h]
//
// Defaults: the sidebar panel (`/haventory`, root `haventory-panel`) at
// 1280x900 with no touch. `--element haventory-card` without a `--path` asks
// card_views.mjs which dashboard view holds the card, the same as every other
// harness.
//
// --search/--click/--tap/--fill/--press/--wait run in the order given on the
// command line, so a probe can search, open a row and then measure it. --eval
// always runs last, once the page has settled.
//
// --eval takes ONE JavaScript expression (not statements) and may `await`. Two
// helpers are in scope: deepQuery(sel) / deepQueryAll(sel) walk every open
// shadow root, which ordinary `querySelector` will not cross. The value has to
// survive `JSON.stringify` — return `el.getBoundingClientRect().toJSON()` or a
// plain object of numbers, never a DOM node. Injecting a `<style>` into a
// shadow root from here is how a CSS hypothesis is tried on the running card
// before it is written into the source.
//
// The JSON result is the only thing on stdout; the resolved target, the actions
// and any console error go to stderr, so `node probe.mjs --eval … | jq` works.
//
// Viewport, deliberately unlike screenshot.mjs: --viewport alone changes the
// window size and nothing else. Playwright's `isMobile` makes Home Assistant
// switch to its narrow, sidebar-collapsed layout, which is a different layout
// from a desktop window of the same width — measuring one while meaning the
// other is the mistake this split exists to prevent. --touch adds the phone
// emulation, --mobile is the whole iPhone 15 descriptor.
//
// Reads HA_BASE_URL / HA_TOKEN from the environment or the repo-root .env.
// [Windows/Git Bash] prefix the command with MSYS_NO_PATHCONV=1: `--path
// /haventory` is exactly the leading-slash value Git Bash rewrites.

import { fileURLToPath } from "node:url";
import path from "node:path";

import { cardPath, haConfig } from "./card_views.mjs";

const skillDir = path.dirname(fileURLToPath(import.meta.url));

const PANEL_PATH = "/haventory";
const MOBILE_DEVICE = "iPhone 15";
const DEFAULT_VIEWPORT = { width: 1280, height: 900 };
const DEFAULT_SETTLE_MS = 2500;
const FILL_SEPARATOR = "=>";

/** Flags that drive the page, in command-line order. */
export const ACTION_FLAGS = new Set(["--search", "--click", "--tap", "--fill", "--press", "--wait"]);
const VALUE_FLAGS = new Set(["--path", "--element", "--viewport", "--locale", "--settle", "--eval", "--out"]);
const BOOLEAN_FLAGS = new Set(["--mobile", "--touch", "--dark", "--full", "--help", "-h"]);

/** Every flag the parser accepts; the usage block above is held to it by a test. */
export const KNOWN_FLAGS = new Set([...VALUE_FLAGS, ...ACTION_FLAGS, ...BOOLEAN_FLAGS]);

export const USAGE = [
  "node probe.mjs [--path <ha-url-path>] [--element <selector>]",
  "               [--mobile | --viewport <WxH> [--touch]]",
  "               [--locale <bcp47>] [--dark] [--settle <ms>]",
  "               [--search <text>] [--click <selector>] [--tap <selector>]",
  "               [--fill '<selector>=><value>'] [--press <key>] [--wait <ms>]",
  "               [--eval '<js expression>'] [--out <file.png>] [--full]",
  "               [--help|-h]",
  "",
  "Defaults: the sidebar panel (/haventory, root haventory-panel) at 1280x900,",
  "no touch. --element haventory-card with no --path asks card_views.mjs where",
  "the card is. Actions run in the order typed; --eval runs last and prints its",
  "JSON to stdout, everything else to stderr.",
  "",
  "In --eval, deepQuery(sel)/deepQueryAll(sel) walk every open shadow root, the",
  "expression may await, and the value must survive JSON.stringify.",
  "",
  "  node probe.mjs --eval 'deepQuery(\"hv-list\").getBoundingClientRect().toJSON()'",
  "  node probe.mjs --mobile --element haventory-card --search projector \\",
  "                 --tap '[data-testid=\"row-secondary\"]' --out row.png",
].join("\n");

const asMilliseconds = (flag, raw) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${flag} needs a number of milliseconds (got "${raw}")`);
  }
  return value;
};

/** `WxH` as a Playwright viewport, or an error naming the form it wanted. */
export function parseViewport(raw) {
  const match = /^(\d+)x(\d+)$/.exec(raw);
  if (!match) throw new Error(`--viewport expects WxH, e.g. 390x844 (got "${raw}")`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * The command line as options plus an ordered action list.
 *
 * Anything the parser does not know is an error rather than a default: a
 * mistyped `--elment` used to leave the run waiting on the default root and
 * then time out with a message about that root, which says nothing about the
 * typo that caused it.
 */
export function parseArgs(argv) {
  const options = {
    path: null,
    element: "haventory-panel",
    viewport: null,
    locale: null,
    dark: false,
    mobile: false,
    touch: false,
    full: false,
    settle: DEFAULT_SETTLE_MS,
    evalExpr: null,
    out: null,
  };
  const actions = [];

  if (argv.includes("--help") || argv.includes("-h")) return { help: true, options, actions };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    let value = null;
    if (ACTION_FLAGS.has(flag) || VALUE_FLAGS.has(flag)) {
      value = argv[i + 1];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      i += 1;
    }

    if (ACTION_FLAGS.has(flag)) {
      if (flag === "--wait") asMilliseconds(flag, value);
      if (flag === "--fill" && !value.includes(FILL_SEPARATOR)) {
        throw new Error(`--fill needs '<selector>${FILL_SEPARATOR}<value>' (got "${value}")`);
      }
      actions.push({ kind: flag.slice(2), value });
    } else if (flag === "--path") options.path = value;
    else if (flag === "--element") options.element = value;
    else if (flag === "--viewport") options.viewport = parseViewport(value);
    else if (flag === "--locale") options.locale = value;
    else if (flag === "--settle") options.settle = asMilliseconds(flag, value);
    else if (flag === "--eval") options.evalExpr = value;
    else if (flag === "--out") options.out = value;
    else if (BOOLEAN_FLAGS.has(flag)) options[flag.slice(2)] = true;
    else throw new Error(`unknown argument "${flag}"`);
  }

  return { help: false, options, actions };
}

/**
 * The path a root element is reached at without a `--path`, or null when the
 * instance has to be asked (card_views.mjs owns every dashboard URL).
 */
export function defaultPathFor(element) {
  return /haventory-card/.test(element) ? null : PANEL_PATH;
}

/**
 * Playwright context options for the emulation the flags asked for, plus the
 * label that says which screen the numbers came from.
 *
 * `devices` is passed in rather than imported so this stays testable without a
 * browser install.
 */
export function buildContextOptions(options, devices) {
  // HA's service worker activates 30-90 s into a fresh context and reloads the
  // page, which kills the JS execution context mid-run. Blocking it costs one
  // harmless `navigator.serviceWorker` console error from HA's own bundle.
  let contextOptions = {
    viewport: { ...DEFAULT_VIEWPORT },
    serviceWorkers: "block",
    colorScheme: options.dark ? "dark" : "light",
  };
  let label = `desktop ${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height} (no touch)`;

  if (options.mobile) {
    const descriptor = devices[MOBILE_DEVICE];
    if (!descriptor) throw new Error(`Playwright has no "${MOBILE_DEVICE}" device descriptor`);
    contextOptions = { ...descriptor, ...contextOptions, viewport: { ...descriptor.viewport } };
    label = `${MOBILE_DEVICE} ${descriptor.viewport.width}x${descriptor.viewport.height} (touch)`;
  } else if (options.viewport) {
    contextOptions.viewport = { ...options.viewport };
    if (options.touch) {
      contextOptions.hasTouch = true;
      contextOptions.isMobile = true;
    }
    label = `${options.viewport.width}x${options.viewport.height} (${options.touch ? "touch" : "no touch"})`;
  }

  // Chromium takes the host's locale, and HA falls back to the browser language
  // whenever the profile has none — so on a German host every surface comes up
  // German with nothing set. Naming the language only decides anything while
  // the profile's own language is unset; a profile that names one wins.
  if (options.locale) contextOptions.locale = options.locale;

  return { contextOptions, label };
}

/** What a broken `--eval` says: the message and the expression, no stack. */
export function describeEvalFailure(expr, error) {
  const message = String(error?.message ?? error).split("\n")[0];
  const shown = expr.length > 200 ? `${expr.slice(0, 200)}…` : expr;
  return `--eval failed: ${message}\n  expression: ${shown}`;
}

// --- the run --------------------------------------------------------------

// Runs in the page. `deepQueryAll` walks open shadow roots because a selector
// never crosses a shadow boundary on its own, and every HAventory component
// lives inside one.
const evaluateInPage = (expr) => {
  const deepQueryAll = (sel, root = document) => {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      if (node.querySelectorAll) for (const el of node.querySelectorAll(sel)) out.push(el);
      const kids = node.querySelectorAll ? node.querySelectorAll("*") : [];
      for (const el of kids) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(root);
    return out;
  };
  const deepQuery = (sel, root = document) => deepQueryAll(sel, root)[0] ?? null;
  // eslint-disable-next-line no-new-func
  const fn = new Function("deepQuery", "deepQueryAll", `return (async () => (${expr}))();`);
  return fn(deepQuery, deepQueryAll);
};

async function runActions(page, actions, { rootElement, touchEnabled }) {
  for (const action of actions) {
    if (action.kind === "search") {
      // The card's list search is [data-testid="search-input"]; the full view
      // and the panel own a different box, each with a placeholder that starts
      // with the localized word for "search".
      const search = page
        .locator(
          `${rootElement} [data-testid="search-input"], ${rootElement} input[type="search"], ` +
            `${rootElement} input[placeholder^="Search"], ${rootElement} input[placeholder^="Suche"]`,
        )
        .first();
      await search.waitFor({ state: "visible", timeout: 10000 });
      await search.fill(action.value);
      await page.waitForTimeout(1500); // debounce + round trip through the WS filter
    } else if (action.kind === "click" || action.kind === "tap") {
      const target = page.locator(action.value).first();
      await target.waitFor({ state: "visible", timeout: 10000 });
      if (touchEnabled && action.kind === "tap") await target.tap();
      else await target.click();
      await page.waitForTimeout(400);
    } else if (action.kind === "fill") {
      const at = action.value.indexOf(FILL_SEPARATOR);
      const selector = action.value.slice(0, at);
      const text = action.value.slice(at + FILL_SEPARATOR.length);
      const field = page.locator(selector).first();
      await field.waitFor({ state: "visible", timeout: 10000 });
      await field.fill(text);
      await page.waitForTimeout(300);
    } else if (action.kind === "press") {
      await page.keyboard.press(action.value);
      await page.waitForTimeout(300);
    } else if (action.kind === "wait") {
      await page.waitForTimeout(Number(action.value));
    }
    console.error(`[probe] ${action.kind}: ${action.value}`);
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`probe.mjs: ${error.message}`);
    console.error("node probe.mjs --help lists the flags.");
    process.exit(2);
  }
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  const { options, actions } = parsed;

  const { base, token } = haConfig(); // prints the [target] line
  if (!token) {
    console.error("Missing HA_TOKEN (env or repo-root .env)");
    process.exit(2);
  }

  // Imported here rather than at the top so `--help` and the argument errors
  // work in a checkout that has never installed the browser, and so the pure
  // half of this file can be unit-tested without one.
  let chromium;
  let devices;
  try {
    ({ chromium, devices } = await import("playwright"));
  } catch {
    console.error("probe.mjs: playwright is not installed in the skill dir.");
    console.error("  cd .claude/skills/run-haventory && npm install --no-audit --no-fund && npx playwright install chromium");
    process.exit(2);
  }
  let contextOptions;
  let label;
  try {
    ({ contextOptions, label } = buildContextOptions(options, devices));
  } catch (error) {
    console.error(`probe.mjs: ${error.message}`);
    process.exit(2);
  }
  const touchEnabled = Boolean(contextOptions.hasTouch);
  const rootElement = options.element;
  const urlPath = options.path ?? defaultPathFor(rootElement) ?? (await cardPath("column"));

  // `hasTouch` alone leaves `'ontouchstart' in window` false, so code that
  // feature-detects touch that way would take the desktop path.
  const browser = await chromium.launch({ args: touchEnabled ? ["--touch-events=enabled"] : [] });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // The HA frontend trusts hassTokens if `expires` is in the future; the
  // long-lived token works as access_token and clientId must be `${origin}/`.
  // HA's own dark mode is independent of the OS colour scheme — it reads the
  // `selectedTheme` entry — so a dark probe sets both.
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
    [base, token, options.dark],
  );

  console.error(`[probe] ${base}${urlPath} root=${rootElement} [${label}, scheme=${contextOptions.colorScheme}]`);
  await page.goto(base + urlPath, { waitUntil: "domcontentloaded" });
  if (page.url().includes("/auth/authorize")) {
    console.error("Redirected to the login page — hassTokens injection was rejected. Is HA_TOKEN valid?");
    await browser.close();
    process.exit(1);
  }

  try {
    await page.waitForSelector(rootElement, { timeout: 30000 });
  } catch {
    // A root that never appears has two very different causes — the wrong root
    // for this path, or a page whose bundle never loaded — so name both, and
    // hand over the console.
    console.error(`Timed out waiting for "${rootElement}" on ${urlPath}.`);
    console.error('The sidebar panel is "haventory-panel"; a dashboard card is "haventory-card".');
    for (const e of consoleErrors.slice(0, 10)) console.error(`  ${e}`);
    await browser.close();
    process.exit(1);
  }
  await page.waitForTimeout(options.settle); // let the root's WS subscription deliver data

  try {
    await runActions(page, actions, { rootElement, touchEnabled });
  } catch (error) {
    console.error(`probe.mjs: ${String(error?.message ?? error).split("\n")[0]}`);
    await browser.close();
    process.exit(1);
  }

  if (options.evalExpr) {
    let result;
    try {
      result = await page.evaluate(evaluateInPage, options.evalExpr);
    } catch (error) {
      console.error(describeEvalFailure(options.evalExpr, error));
      await browser.close();
      process.exit(1);
    }
    console.log(JSON.stringify(result ?? null, null, 2));
  }

  if (options.out) {
    const outFile = path.resolve(skillDir, options.out);
    await page.screenshot({ path: outFile, fullPage: options.full });
    console.error(`screenshot: ${outFile}`);
  }

  // HA's own bundle logs a service-worker complaint on every blocked context;
  // it says nothing about the surface under the probe.
  const filtered = consoleErrors.filter((e) => !/addEventListener|serviceWorker/.test(e));
  if (filtered.length) {
    console.error(`browser console errors (${filtered.length}):`);
    for (const e of filtered.slice(0, 8)) console.error(`  ${e}`);
  }
  await browser.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
