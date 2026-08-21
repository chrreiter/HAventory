// Does a reload — and an options change — leave the card and the panel working?
//
// Two tabs, one on the dashboard card and one on the sidebar panel, both left
// alone throughout. The entry is reloaded over WebSocket (what Settings ->
// Devices & services -> Reload sends) and then its options are rewritten through
// the real options flow and rewritten back. What is being watched is that the
// subscription teardown notice arrives, that the card re-subscribes on its own,
// that a mutation afterwards still repaints it, and that the sidebar entry is
// still there at the end.
//
// Usage (from the skill dir):
//   node reload_probe.mjs [--out reload]

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
const outPrefix = flag("--out", "reload");
const PROBE = `reload probe ${Math.floor(Date.now() / 1000)}`;

function haWs() {
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

const rest = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
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
      for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
        const event = message?.event;
        if (message?.type === "event" && event?.domain === "haventory") {
          seen.push(`${event.topic}/${event.action}`);
        }
      }
    });
  });
  return seen;
}

async function openTab(urlPath, root) {
  const page = await context.newPage();
  const events = watch(page);
  await page.goto(base + urlPath, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(root, { timeout: 30000 });
  await page.waitForTimeout(2500);
  return { page, events, root };
}

const card = await openTab(await cardPath("wide"), "haventory-card");
const panel = await openTab("/haventory", "haventory-panel");

const entries = await rest("GET", "/api/config/config_entries/entry");
const entry = entries.find((e) => e.domain === "haventory");
console.log(`entry: ${entry.entry_id}  state=${entry.state}  title=${JSON.stringify(entry.title)}`);

const sidebarBefore = await panel.page.evaluate(() =>
  Boolean(document.querySelector("home-assistant")?.hass?.panels?.haventory),
);

// --- the reload ------------------------------------------------------------
for (const tab of [card, panel]) tab.events.length = 0;
await rest("POST", `/api/config/config_entries/entry/${entry.entry_id}/reload`);
await card.page.waitForTimeout(12000);

const afterReload = await rest("GET", "/api/config/config_entries/entry");
const reloadedState = afterReload.find((e) => e.domain === "haventory").state;

// A mutation from a third connection: does the card repaint on its own again?
const driver = haWs();
await driver.ready;
const created = await driver.send({ type: "haventory/item/create", name: PROBE });
if (!created.success) {
  console.error("create failed after reload:", JSON.stringify(created));
  process.exit(1);
}
await card.page.waitForTimeout(3000);

const cardEvents = [...card.events];
const panelEvents = [...panel.events];
const panelUrlAfterReload = panel.page.url();
const panelAfterReload = await panel.page.locator("haventory-panel").count();

// --- the options change ----------------------------------------------------
// One step, every section key required, and a fresh flow_id per POST.
async function openOptionsForm() {
  return rest("POST", "/api/config/config_entries/options/flow", { handler: entry.entry_id });
}
function valuesFrom(form) {
  const values = {};
  for (const field of form.data_schema ?? []) {
    if (field.type === "expandable") continue;
    values[field.name] = field.description?.suggested_value ?? field.default;
  }
  // The two collapsed sections: empty means "leave them as they are".
  return { ...values, todo: {}, rate_limit: {} };
}
async function submit(values) {
  const form = await openOptionsForm();
  return rest("POST", `/api/config/config_entries/options/flow/${form.flow_id}`, values);
}

const baseline = valuesFrom(await openOptionsForm());
for (const tab of [card, panel]) tab.events.length = 0;

const optionsResult = await submit({ ...baseline, card_title: "Reload probe title" });
await card.page.waitForTimeout(8000);
const panelDuring = await panel.page.locator("haventory-panel").count();
const restored = await submit(baseline);
await card.page.waitForTimeout(8000);

// --- what is still standing ------------------------------------------------
const cardAlive = (await card.page.locator("haventory-card").count()) > 0;
const panelAlive = (await panel.page.locator("haventory-panel").count()) > 0;
const sidebarAfter = await panel.page.evaluate(() =>
  Boolean(document.querySelector("home-assistant")?.hass?.panels?.haventory),
);
const rowsAfter = await card.page.locator("haventory-card hv-list-row").count();

await card.page.screenshot({ path: path.resolve(skillDir, `${outPrefix}-card.png`) });
await panel.page.screenshot({ path: path.resolve(skillDir, `${outPrefix}-panel.png`) });

console.log(`entry after reload : ${reloadedState}`);
console.log(`card events        : ${cardEvents.join(", ") || "(none)"}`);
console.log(`panel events       : ${panelEvents.join(", ") || "(none)"}`);
console.log(`options baseline   : ${JSON.stringify(baseline)}`);
console.log(`options flow       : ${optionsResult.type} -> restored ${restored.type}`);
console.log(`panel after reload : ${panelAfterReload} element(s) at ${panelUrlAfterReload}`);
console.log(`panel mid-change   : ${panelDuring} element(s); panel url now ${panel.page.url()}`);
console.log(`sidebar panel      : before=${sidebarBefore} after=${sidebarAfter}`);
console.log(`rows visible       : ${rowsAfter}`);

const checks = [
  ["the entry is LOADED again", reloadedState === "loaded"],
  ["the card was told its subscription stopped", cardEvents.includes("items/unavailable")],
  ["the panel was told too", panelEvents.includes("items/unavailable")],
  ["the card re-subscribed and saw the new item", cardEvents.includes("items/created")],
  ["the panel re-subscribed and saw it too", panelEvents.includes("items/created")],
  ["the options change was accepted and undone", optionsResult.type === "create_entry" && restored.type === "create_entry"],
  ["the card element survived the options change", cardAlive],
  ["the panel survived the reload", panelAfterReload > 0],
  ["the panel element survived the options change", panelAlive],
  ["the sidebar entry survived it", sidebarBefore && sidebarAfter],
  ["the card is showing rows", rowsAfter > 0],
];
let ok = true;
for (const [label, passed] of checks) {
  console.log(`${passed ? "[PASS]" : "[FAIL]"} ${label}`);
  ok = ok && passed;
}

const removed = await driver.send({ type: "haventory/item/delete", item_id: created.result.id });
console.log(`probe deleted: ${removed.success}`);
driver.close();
await browser.close();
process.exit(ok && removed.success ? 0 : 1);
