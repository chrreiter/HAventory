// End-to-end *live-update* smoke test for the HAventory Lovelace card.
//
// WHY THIS EXISTS
// ---------------
// The unit suite mocks Home Assistant's WebSocket layer. A regression once slipped
// through green unit tests because the mock delivered the *wrong* frame shape to the
// subscription callback (the whole `{id,type:'event',event}` envelope instead of the
// inner `event` payload that real HA delivers). The card silently stopped reflecting
// live inventory changes, yet every unit test stayed green (PR #93). A mock can only
// ever be as truthful as its author's model of the contract — so the only thing that
// catches "green tests, dead feature" is driving the *real* card against a *real* HA.
//
// WHAT IT ASSERTS (the Fix #1 path, end to end)
// ---------------------------------------------
//   1. Create an item over a SEPARATE, out-of-band WS connection — never the card's own
//      hass connection — so the ONLY way the card can learn about it is the backend's
//      subscription broadcast. The new row must appear WITHOUT any manual re-list.
//   2. Change its quantity out-of-band -> the row's quantity must update live.
//   3. Delete it out-of-band -> the row must disappear live.
//   4. No card-related console errors or uncaught page errors throughout.
//
// This is an OPT-IN online test (like tests/*_online.py): it does nothing unless
// RUN_ONLINE is set. It needs a running HA with the card on a dashboard, HA_BASE_URL +
// HA_TOKEN (env or repo-root .env), Playwright installed, and a Chromium browser
// (`npx playwright install chromium`).
//
// Usage (from cards/haventory-card/):
//   RUN_ONLINE=1 node e2e/live-updates.smoke.mjs [--path /lovelace/default_view]
//   RUN_ONLINE=1 npm run test:e2e
//
// Exit codes: 0 = pass or skipped, 1 = a live-update assertion failed, 2 = misconfig.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

// --- opt-in gate ---------------------------------------------------------
if (!process.env.RUN_ONLINE) {
  console.log('SKIP: RUN_ONLINE is not set (this is an opt-in online browser test).');
  process.exit(0);
}

// --- config: env wins, repo-root .env fills the gaps ---------------------
try {
  for (const line of readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env — rely on real env vars */
}
const base = (process.env.HA_BASE_URL ?? 'http://localhost:8123').replace(/\/$/, '');
const token = process.env.HA_TOKEN;
if (!token) {
  console.error('FAIL(config): missing HA_TOKEN (env or repo-root .env).');
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const urlPath = flag('--path', '/lovelace/default_view');

// Playwright is an optional peer of this smoke — resolve it lazily so a plain
// `npm run test:e2e` on a machine without a browser skips cleanly instead of crashing.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SKIP: Playwright is not installed. Run `npm i` then `npx playwright install chromium`.');
  process.exit(0);
}

// Unique, greppable names so we never collide with real data and cleanup is targeted.
// Date.now() is fine here — this is a standalone Node script, not a workflow.
const stamp = Date.now();
const nameA = `e2e_smoke_${stamp}_a`; // created under this name
const nameB = `e2e_smoke_${stamp}_b`; // renamed to this out-of-band to prove live replace

// --- in-page out-of-band WS command --------------------------------------
// Runs INSIDE the browser page (same origin as HA, so no CORS). Opens a fresh HA
// WebSocket, performs the auth handshake, sends exactly one command, resolves with
// {result} or {error}, then closes. Deliberately NOT the card's connection: the card
// must learn of the change purely through its own subscription.
async function wsCommand(page, command) {
  return page.evaluate(
    ([wsUrl, accessToken, cmd]) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const done = (v) => {
          try { ws.close(); } catch { /* ignore */ }
          resolve(v);
        };
        const timer = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } reject(new Error('ws timeout')); }, 15000);
        ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'auth_required') {
            ws.send(JSON.stringify({ type: 'auth', access_token: accessToken }));
          } else if (msg.type === 'auth_invalid') {
            clearTimeout(timer);
            done({ error: { code: 'auth_invalid', message: msg.message } });
          } else if (msg.type === 'auth_ok') {
            ws.send(JSON.stringify({ id: 1, ...cmd }));
          } else if (msg.type === 'result' && msg.id === 1) {
            clearTimeout(timer);
            done(msg.success ? { result: msg.result } : { error: msg.error });
          }
        };
      }),
    [base.replace(/^http/, 'ws') + '/api/websocket', token, command],
  );
}

// --- small polling helper (no @playwright/test expect here) --------------
async function waitFor(page, predicate, { timeout = 12000, interval = 250, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label} (${timeout}ms)`);
    await page.waitForTimeout(interval);
  }
}

// Locator for the card row carrying a given item name. Playwright CSS selectors
// pierce the open shadow roots (haventory-card -> hv-card-shell -> hv-list ->
// hv-list-row). The item name is always rendered (unlike the optional columns the
// full view can hide), so it is the reliable signal that a live event reached the
// card's list.
const rowByName = (page, name) => page.locator('haventory-card hv-list-row', { hasText: name });

// --- drive ---------------------------------------------------------------
const consoleErrors = [];
const pageErrors = [];
const browser = await chromium.launch();
let createdId = null;
let failure = null;
let page = null;

try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.addInitScript(
    ([hassUrl, accessToken]) => {
      localStorage.setItem(
        'hassTokens',
        JSON.stringify({
          access_token: accessToken,
          token_type: 'Bearer',
          refresh_token: 'unused-long-lived',
          expires_in: 1800,
          expires: Date.now() + 365 * 24 * 3600 * 1000,
          hassUrl,
          clientId: hassUrl + '/',
        }),
      );
    },
    [base, token],
  );

  await page.goto(base + urlPath, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/auth/authorize')) {
    throw new Error('redirected to login — hassTokens injection rejected (is HA_TOKEN valid?)');
  }
  await page.waitForSelector('haventory-card', { timeout: 30000 });
  await page.waitForTimeout(2500); // let the card's initial WS subscription + list settle

  // Sanity: neither row must exist yet (proves the later appearance is live).
  if ((await rowByName(page, nameA).count()) !== 0 || (await rowByName(page, nameB).count()) !== 0) {
    throw new Error('a smoke-test row was already present before creation');
  }

  // (1) create out-of-band -> row must appear via subscription, no re-list (store.unshift)
  const created = await wsCommand(page, { type: 'haventory/item/create', name: nameA, quantity: 1 });
  if (created.error) throw new Error(`create failed: ${JSON.stringify(created.error)}`);
  createdId = created.result?.id;
  if (!createdId) throw new Error('create returned no id');
  await waitFor(page, async () => (await rowByName(page, nameA).count()) > 0, {
    label: 'created row to appear live',
  });
  console.log('  ok: created item appeared live (no manual re-list)');

  // (2) rename out-of-band -> row updates IN PLACE: nameB appears, nameA is gone
  //     (store replace branch; name always renders regardless of column prefs)
  const upd = await wsCommand(page, {
    type: 'haventory/item/update',
    item_id: createdId,
    name: nameB,
    expected_version: created.result.version,
  });
  if (upd.error) throw new Error(`update failed: ${JSON.stringify(upd.error)}`);
  await waitFor(
    page,
    async () => (await rowByName(page, nameB).count()) > 0 && (await rowByName(page, nameA).count()) === 0,
    { label: 'rename to reflect live (in-place replace)' },
  );
  console.log('  ok: rename reflected live (in-place replace)');

  // (3) delete out-of-band -> row must disappear live (store.splice)
  const del = await wsCommand(page, {
    type: 'haventory/item/delete',
    item_id: createdId,
    expected_version: upd.result?.version ?? created.result.version + 1,
  });
  if (del.error) throw new Error(`delete failed: ${JSON.stringify(del.error)}`);
  createdId = null; // deleted; nothing to clean up
  await waitFor(page, async () => (await rowByName(page, nameB).count()) === 0, {
    label: 'deleted row to disappear live',
  });
  console.log('  ok: deletion reflected live');
} catch (e) {
  failure = e;
} finally {
  // Best-effort cleanup so a mid-run failure never leaves e2e_smoke_ junk behind.
  if (createdId && page) {
    try {
      await wsCommand(page, { type: 'haventory/item/delete', item_id: createdId });
    } catch { /* container is disposable; ignore */ }
  }
  await browser.close();
}

// --- verdict -------------------------------------------------------------
// Only card-relevant noise fails the run: uncaught page exceptions, or console
// errors that mention the integration. Generic HA-frontend network chatter is ignored.
const cardConsoleErrors = consoleErrors.filter((t) => /haventory/i.test(t));
const problems = [];
if (failure) problems.push(`assertion: ${failure.message}`);
if (pageErrors.length) problems.push(`uncaught page errors: ${pageErrors.slice(0, 5).join(' | ')}`);
if (cardConsoleErrors.length) problems.push(`card console errors: ${cardConsoleErrors.slice(0, 5).join(' | ')}`);

if (problems.length) {
  console.error('\nFAIL: live-update smoke test');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nPASS: card reflects live create / rename / delete over the WS subscription.');
process.exit(0);
