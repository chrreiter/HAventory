// Does a mutation nobody in the browser made repaint every open card?
//
// Two `context.newPage()` tabs are two independent HA WebSocket connections. The
// mutation goes out over a THIRD connection — by default as a core `call_service`
// frame, which is exactly what Developer Tools -> Actions sends — so neither tab
// is the one that made the change and both have to repaint on their own. Each tab
// searches for the probe name first, so the oracle is a row appearing out of
// nothing rather than a number nobody can attribute.
//
// Usage (from the skill dir):
//   node two_tab.mjs [--ws] [--path /dashboard-dev/wide] [--out two-tab]
//
// --ws sends `haventory/item/create` instead of the service call: the control for
// anything observed here that is not specific to the service path.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { cardPath, haConfig } from "./card_views.mjs";

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const { base, token } = haConfig();
// `--dashboard <url path or title>` narrows discovery when the instance holds
// the card on more than one dashboard; `--path` still wins outright.
const dashboard = flag("--dashboard", null);
const urlPath = flag("--path", null) ?? (await cardPath("wide", { dashboard }));
const outPrefix = flag("--out", "two-tab");
const PROBE = `two-tab probe ${Math.floor(Date.now() / 1000)}`;

// --- a third connection, standing in for Developer Tools -> Actions ---------
function haWs() {
  // Node's own global WebSocket (>= 22), so the harness needs no dependency
  // beyond the Playwright the skill already installs.
  const socket = new WebSocket(base.replace(/^http/, "ws") + "/api/websocket");
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("error", () => reject(new Error("websocket error")));
    socket.addEventListener("message", (ev) => {
      const frame = JSON.parse(ev.data);
      if (frame.type === "auth_required") socket.send(JSON.stringify({ type: "auth", access_token: token }));
      else if (frame.type === "auth_ok") resolve();
      else if (frame.type === "auth_invalid") reject(new Error("auth_invalid"));
      else if (frame.type === "result" && pending.has(frame.id)) {
        pending.get(frame.id)(frame);
        pending.delete(frame.id);
      }
    });
  });
  return {
    ready,
    send: (message) =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, ...message }));
      }),
    close: () => socket.close(),
  };
}

// --- two tabs --------------------------------------------------------------
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: "block",
});
await context.addInitScript(
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

/** Every haventory event frame this tab received, oldest first. */
function watch(page) {
  const seen = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", ({ payload }) => {
      let parsed;
      try {
        parsed = JSON.parse(payload.toString());
      } catch {
        return;
      }
      // HA batches messages into a JSON array per frame.
      for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
        // The envelope is {type:"event", id, event:{domain, topic, action}} —
        // there is no `event.type`, and a filter looking for one matches nothing.
        const event = message?.event;
        if (message?.type === "event" && event?.domain === "haventory") {
          seen.push({ topic: event.topic, action: event.action, name: event.item?.name ?? null });
        }
      }
    });
  });
  return seen;
}

async function openTab(label) {
  const page = await context.newPage();
  const events = watch(page);
  await page.goto(base + urlPath, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("haventory-card", { timeout: 30000 });
  await page.waitForTimeout(2500);
  return { label, page, events };
}

const tabA = await openTab("tab A");
const tabB = await openTab("tab B");

/** How many rows the card is showing, read through the shadow root. */
async function rowCount(tab) {
  return tab.page.locator('haventory-card hv-list-row').count();
}

/** Narrow both tabs to the probe name, so the oracle is a row that appears. */
async function searchFor(tab, text) {
  const box = tab.page.locator('haventory-card [data-testid="search-input"]').first();
  await box.click();
  await box.fill(text);
  await tab.page.waitForTimeout(1200);
}

for (const tab of [tabA, tabB]) await searchFor(tab, PROBE);
const before = { a: await rowCount(tabA), b: await rowCount(tabB) };
for (const tab of [tabA, tabB]) tab.events.length = 0;

// --- the mutation, from neither tab ---------------------------------------
const driver = haWs();
await driver.ready;
// --ws sends the WebSocket command instead, which is the control for anything
// this harness observes that is not about the service path.
const viaWs = args.includes("--ws");
const called = await driver.send(
  viaWs
    ? { type: "haventory/item/create", name: PROBE, quantity: 2 }
    : {
        type: "call_service",
        domain: "haventory",
        service: "item_create",
        service_data: { name: PROBE, quantity: 2 },
        return_response: true,
      },
);
if (!called.success) {
  console.error("mutation failed:", JSON.stringify(called));
  process.exit(1);
}
const probeId = viaWs ? called.result.id : called.result.response.item.id;

// No clicking, no typing, no reload: whatever changes now changed on its own.
await tabA.page.waitForTimeout(3000);
const after = { a: await rowCount(tabA), b: await rowCount(tabB) };

await tabA.page.screenshot({ path: path.resolve(skillDir, `${outPrefix}-a.png`) });
await tabB.page.screenshot({ path: path.resolve(skillDir, `${outPrefix}-b.png`) });

// --- report ----------------------------------------------------------------
const summarise = (events) =>
  events.map((e) => `${e.topic}/${e.action}${e.name ? ` (${e.name})` : ""}`).join(", ") || "(none)";

console.log(`probe item: ${PROBE}`);
console.log(`view      : ${urlPath}`);
console.log(`tab A events: ${summarise(tabA.events)}`);
console.log(`tab B events: ${summarise(tabB.events)}`);
console.log(`rows tab A : ${before.a} -> ${after.a}`);
console.log(`rows tab B : ${before.b} -> ${after.b}`);

const hasEvent = (events, topic, action) => events.some((e) => e.topic === topic && e.action === action);
const checks = [
  ["tab A received items/created", hasEvent(tabA.events, "items", "created")],
  ["tab B received items/created", hasEvent(tabB.events, "items", "created")],
  ["tab A received stats/counts", hasEvent(tabA.events, "stats", "counts")],
  ["tab B received stats/counts", hasEvent(tabB.events, "stats", "counts")],
  ["tab A repainted with no interaction", after.a === before.a + 1],
  ["tab B repainted with no interaction", after.b === before.b + 1],
];
let ok = true;
for (const [label, passed] of checks) {
  console.log(`${passed ? "[PASS]" : "[FAIL]"} ${label}`);
  ok = ok && passed;
}

// Leave the instance as it was found.
const removed = await driver.send({ type: "haventory/item/delete", item_id: probeId });
console.log(`probe deleted: ${removed.success}`);
driver.close();
await browser.close();
process.exit(ok && removed.success ? 0 : 1);
