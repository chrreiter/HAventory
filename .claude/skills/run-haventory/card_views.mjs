// Where the HAventory card lives on the instance a harness is pointed at, plus
// the credentials every harness needs to get there.
//
// A hard-coded dashboard path makes "works out of the box" a claim about one
// instance: rename the dashboard, or install the card somewhere else, and every
// harness fails identically — a 30 s wait for `haventory-card` that reads like a
// card which failed to register. So the path is discovered: walk
// `lovelace/dashboards/list`, read each dashboard's config, and keep the views
// that really hold a `custom:haventory-card`.
//
// Two view shapes matter, because the card picks its layout from ITS OWN
// rendered width rather than the window's:
//
//   wide    a `type: panel` view — the card gets the whole content area, which
//           is the only place its desktop branch appears.
//   column  anything else (sections, masonry) — the narrow column a card
//           normally sits in, where even a 1440px window gets the narrow branch.
//
// Discovery is best-effort. An instance that is down, a token without admin
// rights, or a dashboard set with no HAventory card at all falls back to the
// constants below and says so, so the harness still fails with its own error
// message rather than this module's.
//
// Run it directly to see what an instance actually offers:
//   node card_views.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(skillDir, "..", "..", "..");

/**
 * The dev dashboard SKILL.md describes. Reached only when discovery finds no
 * HAventory card at all: a documented path that may be wrong beats no path,
 * because the harness's own "root never appeared" error names the surface it
 * was waiting for and this module cannot.
 */
export const FALLBACK_PATHS = { wide: "/dashboard-dev/wide", column: "/dashboard-dev/0" };

const CARD_TYPE = "custom:haventory-card";
const WS_TIMEOUT_MS = 10000;

// --- credentials ----------------------------------------------------------

let cachedConfig = null;

/** HA base URL + long-lived token: real env vars win, the repo-root .env fills the gaps. */
export function haConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    for (const line of readFileSync(path.join(repoRoot, ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env — rely on real env vars */
  }
  cachedConfig = {
    base: (process.env.HA_BASE_URL ?? "http://localhost:8123").replace(/\/$/, ""),
    token: process.env.HA_TOKEN,
  };
  return cachedConfig;
}

// --- reading a dashboard config ------------------------------------------

/**
 * Whether a `custom:haventory-card` sits anywhere inside this slice of a
 * Lovelace config.
 *
 * Walking every value rather than the known containers is both shorter and
 * proof against Home Assistant adding another one: a card can hang off a
 * view's `cards`, a sections view's `sections[].cards`, a stack's `cards`, a
 * conditional's `card`, and each of those can nest.
 */
export function holdsCard(node) {
  if (Array.isArray(node)) return node.some(holdsCard);
  if (node === null || typeof node !== "object") return false;
  if (node.type === CARD_TYPE) return true;
  return Object.values(node).some(holdsCard);
}

/**
 * The views of one dashboard config that hold the card, in view order.
 *
 * `urlPath` addresses a view by its `path` when it has one and by index when it
 * does not, which is Home Assistant's own rule and the reason the dev
 * dashboard's first view is `/0`. A dashboard whose config is a strategy (the
 * generated Map dashboard, for one) has no `views` at all and contributes
 * nothing.
 */
export function cardViewsOf(config, dashPath, dashTitle = dashPath) {
  const views = Array.isArray(config?.views) ? config.views : [];
  const found = [];
  views.forEach((view, index) => {
    if (!holdsCard(view)) return;
    const viewType = view.type ?? "masonry";
    found.push({
      urlPath: `/${dashPath}/${view.path ?? index}`,
      shape: viewType === "panel" ? "wide" : "column",
      viewType,
      label: `${dashTitle} › ${view.title ?? view.path ?? `view ${index}`}`,
    });
  });
  return found;
}

/**
 * The view a pass of the given shape should open.
 *
 * A view of the wrong shape is still returned when it is all there is — the
 * caller is told, and a recipe failing on the layout it did not ask for says
 * far more than a 404 on a path nothing has.
 */
export function pickView(found, shape) {
  const exact = found.find((v) => v.shape === shape);
  if (exact) return { view: exact, exact: true };
  return { view: found[0] ?? null, exact: false };
}

// --- talking to the instance ----------------------------------------------

async function connect(base, token) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/websocket");
  const waiters = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no auth_ok from ${base} within ${WS_TIMEOUT_MS} ms`)), WS_TIMEOUT_MS);
    const fail = (message) => {
      clearTimeout(timer);
      reject(new Error(message));
    };
    ws.addEventListener("error", () => fail(`cannot reach ${base}`), { once: true });
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: token }));
      else if (msg.type === "auth_ok") {
        clearTimeout(timer);
        resolve();
      } else if (msg.type === "auth_invalid") fail(`WS auth failed: ${msg.message}`);
      else if (msg.type === "result") {
        waiters.get(msg.id)?.(msg);
        waiters.delete(msg.id);
      }
    });
  });

  return {
    call(payload) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, ...payload }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${payload.type}`)), WS_TIMEOUT_MS);
        waiters.set(id, (msg) => {
          clearTimeout(timer);
          if (msg.success) resolve(msg.result);
          else reject(new Error(msg.error?.code ?? "error"));
        });
      });
    },
    close: () => ws.close(),
  };
}

let discovery = null;

/**
 * Every dashboard view on the instance that holds the card.
 *
 * Memoized per process: a harness with several passes asks more than once, and
 * the answer cannot change inside one run.
 */
export function discoverCardViews() {
  discovery ??= (async () => {
    const { base, token } = haConfig();
    const notes = [];
    if (!token) return { found: [], notes: ["no HA_TOKEN, so no discovery"] };

    let ws;
    try {
      ws = await connect(base, token);
    } catch (err) {
      return { found: [], notes: [`discovery skipped: ${err.message}`] };
    }
    try {
      // The default dashboard carries no `url_path` and is absent from the
      // list. On an instance whose default is Home Assistant's generated one
      // there is no stored config to read, which comes back as
      // `config_not_found` and is a normal answer, not a failure.
      const targets = [{ urlPath: null, dashPath: "lovelace", title: "default" }];
      let list = [];
      try {
        list = await ws.call({ type: "lovelace/dashboards/list" });
      } catch (err) {
        // Listing dashboards is an admin command; a non-admin token gets this
        // far and no further, which is worth saying out loud.
        notes.push(`lovelace/dashboards/list failed (${err.message}) — only the default dashboard was searched`);
      }
      for (const d of list) {
        if (d?.url_path) targets.push({ urlPath: d.url_path, dashPath: d.url_path, title: d.title ?? d.url_path });
      }

      const found = [];
      for (const target of targets) {
        let config;
        try {
          config = await ws.call(
            target.urlPath === null
              ? { type: "lovelace/config" }
              : { type: "lovelace/config", url_path: target.urlPath },
          );
        } catch {
          continue; // no stored config: generated or strategy-only
        }
        found.push(...cardViewsOf(config, target.dashPath, target.title));
      }
      return { found, notes };
    } finally {
      ws.close();
    }
  })();
  return discovery;
}

let notesPrinted = false;

/**
 * The URL path a harness should open for the given shape, announced on stdout
 * so a run says which view it chose and why. `label` names the caller's own
 * notion of the pass when it has one; the shape is the sensible default.
 *
 * @param {string} shape
 * @param {{ override?: string | null, label?: string }} [options]
 * @returns {Promise<string>}
 */
export async function cardPath(shape, { override = null, label = shape } = {}) {
  if (override) {
    console.log(`view (${label}): ${override}  ← --path override`);
    return override;
  }
  const { found, notes } = await discoverCardViews();
  if (!notesPrinted) {
    notesPrinted = true;
    for (const note of notes) console.log(`  (${note})`);
  }
  const { view, exact } = pickView(found, shape);
  if (!view) {
    const fallback = FALLBACK_PATHS[shape];
    console.log(`view (${label}): ${fallback}  ← nothing holds a ${CARD_TYPE}; using the documented default`);
    return fallback;
  }
  const why = exact
    ? `${view.label} (${view.viewType})`
    : `${view.label} (${view.viewType}) — WARNING: no ${shape === "wide" ? "type: panel" : "non-panel"} view holds the card, so this runs on the wrong layout`;
  console.log(`view (${label}): ${view.urlPath}  ← ${why}`);
  return view.urlPath;
}

// --- per-pass --path overrides -------------------------------------------

/**
 * Parse repeatable `--path` arguments for a harness that opens several URLs in
 * one run.
 *
 * `--path <pass>=<url>` targets one pass. A bare `--path <url>` cannot say which
 * of them it means, so it is accepted only when the run has already been
 * narrowed to a single pass — otherwise it would quietly force one URL onto
 * passes that need a different view shape, or a different route entirely.
 *
 * Returns `{ overrides, error }`; the caller owns how an error is reported.
 */
export function parsePathOverrides(args, passKeys, only) {
  const overrides = {};
  const specs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--path" && args[i + 1] !== undefined) specs.push(args[++i]);
  }
  for (const spec of specs) {
    const m = spec.match(/^([A-Za-z][\w-]*)=(.+)$/);
    if (!m) {
      if (!only) {
        return {
          overrides,
          error:
            `--path ${spec}: which pass? Name it — --path <pass>=<url> (${passKeys.join(", ")}) — ` +
            "or narrow the run with --only <pass> first.",
        };
      }
      overrides[only] = spec;
      continue;
    }
    if (!passKeys.includes(m[1])) {
      return { overrides, error: `--path ${spec}: unknown pass "${m[1]}" (expected ${passKeys.join(", ")})` };
    }
    overrides[m[1]] = m[2];
  }
  return { overrides, error: null };
}

// --- CLI ------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { found, notes } = await discoverCardViews();
  for (const note of notes) console.log(`(${note})`);
  console.log(`${found.length} view(s) hold ${CARD_TYPE}:`);
  for (const v of found) {
    console.log(`  ${v.shape.padEnd(7)} ${v.urlPath.padEnd(24)} ${v.viewType.padEnd(9)} ${v.label}`);
  }
  for (const shape of ["wide", "column"]) {
    const { view, exact } = pickView(found, shape);
    const chosen = view ? view.urlPath : `${FALLBACK_PATHS[shape]} (fallback)`;
    console.log(`${shape.padEnd(7)} -> ${chosen}${view && !exact ? "  (wrong shape — nothing better exists)" : ""}`);
  }
}
