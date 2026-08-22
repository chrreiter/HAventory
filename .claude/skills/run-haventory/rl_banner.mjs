// Drive the card's rate-limit degraded-banner lifecycle against a real Home
// Assistant, with the WebSocket traffic that caused each state recorded next to
// the banner it produced.
//
// The card's response to a refused `subscribe` is invisible from the outside:
// a `rate_limited` refusal makes it back off and retry (SUBSCRIBE_RETRY_ATTEMPTS
// = 4, 400/800/1600/3200 ms), and only after the budget is spent does it give up
// and offer a manual Refresh. Both halves live in a shadow root inside another
// shadow root, and both are timing-dependent, so the only honest way to check
// them is to squeeze the real server and watch what the real card renders.
//
// Usage (from the skill dir, .claude/skills/run-haventory/):
//   node rl_banner.mjs                       # both scenarios, then leaves limiting OFF
//   node rl_banner.mjs --scenario retrying   # refuse the first round, let a retry win
//   node rl_banner.mjs --scenario exhausted  # refuse every retry, then Refresh
//   node rl_banner.mjs --observe 30          # watch only; never touches the options flow
//   node rl_banner.mjs --out rl               # screenshot prefix
//
// With no --path it opens whichever dashboard view is discovered to hold the
// card in a normal column (card_views.mjs); the banner is not width-dependent,
// so any view that renders the card will do.
//
// Scenarios (both drive the options flow over REST, exactly as the integration's
// own config flow does, and always reset rate limiting to OFF on the way out):
//   retrying   per-conn budget that refills fast enough for a retry to win, so
//              the banner must appear as "Retrying automatically" and then clear
//              itself with no user action -> degraded.liveUpdates live again.
//   exhausted  per-conn budget that refills slower than the whole retry window,
//              so all four attempts are refused: the banner must switch to the
//              "until you refresh" wording and grow a Refresh button, and
//              pressing it (after limiting is lifted) must restore live updates.
//
// A scenario that never provoked its state is reported as INCONCLUSIVE, not as a
// pass: the budgets below are tuned against the card's fixed backoff schedule and
// a slow host can miss the window.
//
// Reads HA_BASE_URL / HA_TOKEN from the environment or the repo-root .env.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { cardPath, haConfig } from "./card_views.mjs";

const skillDir = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

const { base, token } = haConfig();
if (!token) {
  console.error("Missing HA_TOKEN (env or repo-root .env)");
  process.exit(2);
}

const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

// `--dashboard <url path or title>` narrows discovery when the instance holds
// the card on more than one dashboard; `--path` still wins outright.
const dashboard = flag("--dashboard", null);
const urlPath = flag("--path", null) ?? (await cardPath("column", { dashboard }));
const outPrefix = flag("--out", "rl");
const observeSecs = args.includes("--observe") ? Number(flag("--observe", "30")) : null;
const scenarioArg = flag("--scenario", null);
const shot = (name) => path.resolve(skillDir, `${outPrefix}-${name}.png`);

// --- options-flow control (same REST path the HA UI uses) ----------------
const rest = async (method, apiPath, body) => {
  const res = await fetch(base + apiPath, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _status: res.status, _text: text };
  }
};

// The options flow validates the whole form, so every key has to be sent even
// when only the per-connection command budget is being changed.
const RL_DEFAULTS = {
  rate_limit_commands_per_second: 20.0,
  rate_limit_commands_burst: 60.0,
  rate_limit_global_commands_per_second: 100.0,
  rate_limit_global_commands_burst: 200.0,
  rate_limit_events_per_second: 50.0,
  rate_limit_events_burst: 200.0,
  rate_limit_global_events_per_second: 500.0,
  rate_limit_global_events_burst: 1000.0,
};

async function setRateLimit(enabled, overrides = {}) {
  const entries = await rest("GET", "/api/config/config_entries/entry");
  const entry = Array.isArray(entries) ? entries.find((e) => e.domain === "haventory") : null;
  if (!entry) throw new Error(`no haventory config entry: ${JSON.stringify(entries).slice(0, 200)}`);
  const flow = await rest("POST", "/api/config/config_entries/options/flow", {
    handler: entry.entry_id,
    show_advanced_options: false,
  });
  if (!flow.flow_id) throw new Error(`could not start options flow: ${JSON.stringify(flow).slice(0, 200)}`);
  // The knobs sit in one section of a form whose every top-level key is required, so
  // the submit echoes the whole form as it stands — each field's `default`, or the
  // `suggested_value` an optional field such as the to-do list entity carries — and
  // overlays the knobs onto the section that holds them. A field with no value is
  // left out rather than sent as null: the flow reads an absent optional key as unset.
  const valueOf = (field) => field.description?.suggested_value ?? field.default;
  const payload = {};
  for (const field of flow.data_schema ?? []) {
    if (field.type !== "expandable") {
      payload[field.name] = valueOf(field);
      continue;
    }
    const section = {};
    for (const inner of field.schema ?? []) {
      const value = valueOf(inner);
      if (value !== undefined && value !== null) section[inner.name] = value;
    }
    if ((field.schema ?? []).some((inner) => inner.name === "rate_limit_enabled")) {
      Object.assign(section, { rate_limit_enabled: enabled, ...RL_DEFAULTS, ...overrides });
    }
    payload[field.name] = section;
  }
  const res = await rest("POST", `/api/config/config_entries/options/flow/${flow.flow_id}`, payload);
  // A value the schema rejects comes back as the form again, with `errors` —
  // rate limiting then silently stays as it was and every later assertion in the
  // scenario measures nothing. The rates below sit above the flow's minimums
  // (0.1/s for a rate, 1 token for a burst); this catches it if they ever drift.
  if (res.type !== "create_entry") {
    throw new Error(`options flow did not save: type=${res.type} errors=${JSON.stringify(res.errors ?? {})}`);
  }
  return res;
}

// --- banner enumeration ---------------------------------------------------
// Nested shadow roots all the way down: the card sits inside HA's own dashboard
// components (so `document.querySelector` never reaches it), hv-card-shell
// renders <hv-banner> hosts, and each host keeps its heading and message inside
// its own root. `textContent` on any of those hosts reads the light DOM, which
// is empty. Every level has to be walked explicitly — this is the only way to
// see what the banner actually says.
const BANNER_PROBE = () => {
  const findCard = (root) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.tagName.toLowerCase() === "haventory-card") return el;
      if (el.shadowRoot) {
        const hit = findCard(el.shadowRoot);
        if (hit) return hit;
      }
    }
    return null;
  };
  const shell = findCard(document)?.shadowRoot?.querySelector("hv-card-shell");
  const root = shell?.shadowRoot;
  if (!root) return { present: false, banners: [] };
  const banners = [...root.querySelectorAll("[data-testid^='degraded-'], [data-testid='banner-entry']")]
    .filter((el) => el.tagName.toLowerCase() === "hv-banner")
    .map((el) => ({
      testid: el.getAttribute("data-testid"),
      kind: el.getAttribute("kind"),
      text: (el.shadowRoot?.textContent ?? "").replace(/\s+/g, " ").trim(),
      // Action buttons are slotted from the shell's root, not the banner's.
      actions: [...el.querySelectorAll("[slot='actions']")].map((b) => ({
        testid: b.getAttribute("data-testid"),
        label: b.textContent.replace(/\s+/g, " ").trim(),
      })),
    }));
  return { present: true, banners };
};

// --- main ----------------------------------------------------------------
const browser = await chromium.launch();
// HA's service worker reloads the page 30-90 s into a fresh context, which would
// look exactly like the card recovering on its own. A rate-limit run sits inside
// that window by construction, so the worker has to stay blocked.
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

// --- WS trace ------------------------------------------------------------
// Playwright surfaces HA's single frontend WebSocket, which multiplexes every
// command. Recording both directions is what makes a banner explainable: a
// "Live updates paused" with no refused subscribe in the trace is a card bug,
// with one it is the card doing its job.
const trace = [];
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
page.on("websocket", (ws) => {
  const pending = new Map(); // id -> command type, so a result can be named
  ws.on("framesent", ({ payload }) => {
    let msg;
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof msg.type !== "string") return;
    if (msg.type === "auth") return; // carries the token
    if (msg.id !== undefined) pending.set(msg.id, msg.type);
    if (/haventory|subscribe|unsubscribe/.test(msg.type)) {
      trace.push({ t: at(), dir: "->", type: msg.type, id: msg.id, sub: msg.subscription ?? msg.event_type });
    }
  });
  ws.on("framereceived", ({ payload }) => {
    let msg;
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    const name = pending.get(msg.id) ?? msg.type;
    if (msg.type === "result" && msg.success === false) {
      trace.push({ t: at(), dir: "<-", type: name, id: msg.id, error: msg.error?.code, message: msg.error?.message });
    } else if (msg.type === "result" && /haventory|subscribe/.test(String(name))) {
      trace.push({ t: at(), dir: "<-", type: name, id: msg.id, ok: true });
    }
  });
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

/** Poll the shadow DOM until `predicate` accepts a probe, recording every distinct state. */
async function watchBanners(seconds, predicate = null, timeline = []) {
  const deadline = Date.now() + seconds * 1000;
  let last = "";
  while (Date.now() < deadline) {
    const probe = await page.evaluate(BANNER_PROBE).catch(() => ({ present: false, banners: [] }));
    const key = JSON.stringify(probe.banners.map((b) => [b.testid, b.actions.map((a) => a.testid)]));
    if (key !== last) {
      last = key;
      timeline.push({ t: at(), banners: probe.banners });
      for (const b of probe.banners) {
        const acts = b.actions.length ? `  [${b.actions.map((a) => a.label).join(", ")}]` : "";
        console.log(`  ${at()}  ${b.testid} (${b.kind}): ${b.text}${acts}`);
      }
      if (!probe.banners.length) console.log(`  ${at()}  (no degraded banner)`);
    }
    if (predicate && predicate(probe, timeline)) return { hit: true, timeline };
    await page.waitForTimeout(150);
  }
  return { hit: false, timeline };
}

const seen = (timeline, testid) => timeline.some((s) => s.banners.some((b) => b.testid === testid));
const seenText = (timeline, testid, re) =>
  timeline.some((s) => s.banners.some((b) => b.testid === testid && re.test(b.text)));

async function loadCard() {
  await page.goto(base + urlPath, { waitUntil: "domcontentloaded" });
  if (page.url().includes("/auth/authorize")) {
    throw new Error("Redirected to the login page — hassTokens injection was rejected. Is HA_TOKEN valid?");
  }
  await page.waitForSelector("haventory-card", { timeout: 30000 });
}

const results = [];

/**
 * A budget that refills fast enough for one of the four backoff attempts
 * (400/800/1600/3200 ms) to find tokens again: the card must say it is retrying
 * and then recover with no user action, so the banner has to disappear on its
 * own. `retrying` deliberately renders no action button — offering a Refresh
 * while a retry is already scheduled would invite a redundant round trip.
 *
 * The numbers are tuned against what the card actually sends: about eight
 * commands on load, then three subscribes. A burst of 8 is spent before the
 * subscribes, and 8/s puts three tokens back within the second retry.
 */
async function scenarioRetrying() {
  console.log("\n== scenario: refused subscribe -> retrying -> recovered ==");
  await setRateLimit(true, {
    rate_limit_commands_per_second: 8.0,
    rate_limit_commands_burst: 8.0,
    rate_limit_global_commands_per_second: 1000.0,
    rate_limit_global_commands_burst: 2000.0,
  });
  await page.waitForTimeout(2500); // the limiter is rebuilt on options save
  // Mark before the load: the refusal this scenario is about happens during it.
  const traceMark = trace.length;
  await loadCard();

  const timeline = [];
  await watchBanners(12, (_p, tl) => seen(tl, "degraded-live-updates"), timeline);
  await page.screenshot({ path: shot("retrying") });
  // Recovery is the *live-updates* banner going away, not the card going quiet:
  // `degraded.rateLimited` is sticky until a refresh, so the lower-ranked
  // "Rate limited · some live updates may have been dropped" banner is expected
  // to remain. Treating its presence as a failure would fail a correct card.
  const recovered = await watchBanners(
    20,
    (p, tl) => seen(tl, "degraded-live-updates") && !p.banners.some((b) => b.testid === "degraded-live-updates"),
    timeline,
  );
  await page.screenshot({ path: shot("retrying-final") });

  const appeared = seen(timeline, "degraded-live-updates");
  const saidRetrying = seenText(timeline, "degraded-live-updates", /Retrying automatically/);
  const offeredNoButton = timeline
    .flatMap((s) => s.banners)
    .filter((b) => b.testid === "degraded-live-updates" && /Retrying automatically/.test(b.text))
    .every((b) => b.actions.length === 0);
  const refusals = trace.slice(traceMark).filter((e) => e.error === "rate_limited").length;

  // Spending all four attempts is correct behaviour, just not this scenario's:
  // the budget was tighter than intended, so there was no recovery to observe.
  const gaveUp = timeline.some((s) =>
    s.banners.some(
      (b) => b.testid === "degraded-live-updates" && b.actions.some((a) => a.testid === "degraded-live-refresh"),
    ),
  );

  await setRateLimit(false);
  results.push({
    scenario: "retrying",
    verdict: !appeared
      ? "INCONCLUSIVE (budget never refused a subscribe)"
      : !recovered.hit && gaveUp
        ? "INCONCLUSIVE (budget too tight; card exhausted its retries)"
        : saidRetrying && offeredNoButton && recovered.hit
          ? "PASS"
          : "FAIL",
    detail:
      `banner=${appeared} retrying-wording=${saidRetrying} no-action-button=${offeredNoButton} ` +
      `self-recovered=${recovered.hit} rate_limited-frames=${refusals}`,
  });
}

/**
 * A budget that cannot refill inside the whole retry window, so all four
 * attempts are refused and the card stops on its own. Then the wording must
 * change to the "until you refresh" reading and the Refresh action must appear —
 * that button is the only way back, so its absence would strand the card.
 *
 * The burst has to be spent exactly at the subscribes, not before them: the card
 * loads its data first (stats, health, areas, location tree, location list,
 * distinct values, version, item list — eight commands) and only opens the three
 * subscriptions once that has come back. Starve it earlier and the bootstrap
 * itself is refused, the card queues those commands instead, and the scenario
 * measures the "Busy — retrying" banner rather than the paused one. So: eight
 * tokens for the load, none for the subscribes, and 0.1/s — the flow's slowest —
 * so nothing refills inside the roughly six-second retry window.
 */
async function scenarioExhausted() {
  console.log("\n== scenario: every retry refused -> paused -> Refresh restores ==");
  await setRateLimit(true, {
    rate_limit_commands_per_second: 0.1,
    rate_limit_commands_burst: 8.0,
    rate_limit_global_commands_per_second: 1000.0,
    rate_limit_global_commands_burst: 2000.0,
  });
  await page.waitForTimeout(2500);
  await loadCard();

  const timeline = [];
  // 4 attempts at 400/800/1600/3200 ms plus the round trips: ~10 s to give up.
  const paused = await watchBanners(
    30,
    (p) =>
      p.banners.some(
        (b) => b.testid === "degraded-live-updates" && b.actions.some((a) => a.testid === "degraded-live-refresh"),
      ),
    timeline,
  );
  await page.screenshot({ path: shot("exhausted-paused") });

  const saidRefresh = seenText(timeline, "degraded-live-updates", /until you refresh/);
  let refreshRestored = false;
  if (paused.hit) {
    // Lift the squeeze first: Refresh is the user's way back, and it can only
    // work once the server is answering again.
    await setRateLimit(false);
    await page.waitForTimeout(3000);
    const shell = page.locator("haventory-card").locator("hv-card-shell");
    await shell.locator("[data-testid='degraded-live-refresh']").click();
    // Live updates are restored when the paused banner goes; the error the card
    // queued when it gave up stays until the user dismisses it, which is the
    // contract — it is the only record that updates were missed.
    const cleared = await watchBanners(
      20,
      (p) => !p.banners.some((b) => b.testid === "degraded-live-updates"),
      timeline,
    );
    refreshRestored = cleared.hit;
  }
  await page.screenshot({ path: shot("exhausted-final") });

  await setRateLimit(false);
  results.push({
    scenario: "exhausted",
    verdict: !paused.hit
      ? "INCONCLUSIVE (card never exhausted its retries)"
      : saidRefresh && refreshRestored
        ? "PASS"
        : "FAIL",
    detail: `paused-with-action=${paused.hit} refresh-wording=${saidRefresh} refresh-restored-live=${refreshRestored}`,
  });
}

let exitCode = 0;
try {
  if (observeSecs !== null) {
    console.log(`== observe only: ${observeSecs}s, rate limiting untouched ==`);
    await loadCard();
    await watchBanners(observeSecs);
  } else {
    if (!scenarioArg || scenarioArg === "retrying") await scenarioRetrying();
    if (!scenarioArg || scenarioArg === "exhausted") await scenarioExhausted();
  }
} catch (err) {
  console.error(`\nharness error: ${err.message}`);
  exitCode = 1;
} finally {
  // Rate limiting is off by default and every other harness assumes that, so it
  // is reset even when this run threw halfway through a scenario.
  if (observeSecs === null) {
    try {
      await setRateLimit(false);
    } catch (err) {
      console.error(`WARN: could not reset rate limiting off: ${err.message}`);
      exitCode = 1;
    }
  }
}

console.log(`\n== WS trace (${trace.length} frames) ==`);
for (const e of trace) {
  const tail = e.error ? `ERROR ${e.error}: ${e.message ?? ""}` : e.ok ? "ok" : (e.sub ?? "");
  console.log(`  ${e.t.padStart(6)} ${e.dir} ${String(e.type).padEnd(34)} ${tail}`);
}

if (results.length) {
  console.log("\n== verdict ==");
  for (const r of results) console.log(`  ${r.scenario.padEnd(10)} ${r.verdict.padEnd(12)} ${r.detail}`);
  if (results.some((r) => r.verdict === "FAIL")) exitCode = 1;
}

// Blocking the service worker makes HA's own bundle touch `navigator.serviceWorker`
// when it is undefined. Flag it rather than hide it, so a real card error stands out.
const SW_BLOCK_NOISE = /serviceWorker|reading 'addEventListener'/;
if (consoleErrors.length) {
  console.log(`\nbrowser console errors (${consoleErrors.length}):`);
  for (const e of consoleErrors.slice(0, 10)) {
    console.log(`  ${e}${SW_BLOCK_NOISE.test(e) ? "   <- expected: HA bundle, service worker blocked" : ""}`);
  }
}

await browser.close();
process.exit(exitCode);
