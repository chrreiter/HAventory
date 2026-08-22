// Unit cover for the parts of card_views.mjs that decide where a harness looks.
//
// Discovery itself needs a running Home Assistant, but everything it decides
// afterwards — is there a card in this view, which URL addresses it, which
// shape does a pass get, what did --path ask for — is pure, and a mistake in
// any of it silently repoints every harness at the wrong screen.
//
// Run: node --test   (from .claude/skills/run-haventory/)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  cardViewsOf,
  filterByDashboard,
  holdsCard,
  parsePathOverrides,
  pickView,
  resolveTarget,
} from "./card_views.mjs";
import {
  DESKTOP_SURFACES,
  MOBILE_SURFACES,
  PANEL_MOBILE_SURFACES,
} from "./surfaces.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// The dev dashboard's real config, as `lovelace/config` returns it.
const DEV_DASHBOARD = {
  views: [
    {
      type: "sections",
      sections: [
        { type: "grid", cards: [{ type: "heading", heading: "New section" }, { type: "custom:haventory-card" }] },
      ],
    },
    { title: "wide", path: "wide", type: "panel", cards: [{ type: "custom:haventory-card" }] },
  ],
};

test("holdsCard finds a card nested inside a sections grid", () => {
  assert.equal(holdsCard(DEV_DASHBOARD.views[0]), true);
});

test("holdsCard finds a card inside a stack and behind a conditional", () => {
  const stacked = { cards: [{ type: "vertical-stack", cards: [{ type: "custom:haventory-card" }] }] };
  const conditional = { cards: [{ type: "conditional", card: { type: "custom:haventory-card" } }] };
  assert.equal(holdsCard(stacked), true);
  assert.equal(holdsCard(conditional), true);
});

test("holdsCard says no to a view of other cards and to a strategy dashboard", () => {
  assert.equal(holdsCard({ type: "sections", sections: [{ cards: [{ type: "markdown" }] }] }), false);
  assert.equal(holdsCard({ strategy: { type: "map" } }), false);
  assert.equal(holdsCard(null), false);
});

test("cardViewsOf reads both dev-dashboard views with their shapes", () => {
  assert.deepEqual(cardViewsOf(DEV_DASHBOARD, "dashboard-dev", "dev"), [
    {
      urlPath: "/dashboard-dev/0",
      shape: "column",
      viewType: "sections",
      dashPath: "dashboard-dev",
      dashTitle: "dev",
      label: "dev › view 0",
    },
    {
      urlPath: "/dashboard-dev/wide",
      shape: "wide",
      viewType: "panel",
      dashPath: "dashboard-dev",
      dashTitle: "dev",
      label: "dev › wide",
    },
  ]);
});

test("cardViewsOf addresses a view by index only when it has no path", () => {
  const config = {
    views: [
      { type: "panel", cards: [{ type: "markdown" }] },
      { path: "stuff", cards: [{ type: "custom:haventory-card" }] },
      { cards: [{ type: "custom:haventory-card" }] },
    ],
  };
  // The index is the view's own, not its position among the matches: skipping
  // the first view must not shift the third one to /1.
  assert.deepEqual(
    cardViewsOf(config, "d").map((v) => v.urlPath),
    ["/d/stuff", "/d/2"],
  );
});

test("cardViewsOf treats a view with no type as a column and a strategy config as empty", () => {
  assert.deepEqual(cardViewsOf({ views: [{ cards: [{ type: "custom:haventory-card" }] }] }, "d")[0], {
    urlPath: "/d/0",
    shape: "column",
    viewType: "masonry",
    // With no title given, the url path is the dashboard's only name.
    dashPath: "d",
    dashTitle: "d",
    label: "d › view 0",
  });
  assert.deepEqual(cardViewsOf({ strategy: { type: "map" } }, "map"), []);
  assert.deepEqual(cardViewsOf(undefined, "d"), []);
});

// --- choosing between dashboards -------------------------------------------
//
// Discovery returns every view on the instance that holds the card, in
// `lovelace/dashboards/list` order. On an instance with the card on two
// dashboards that order is the only thing deciding which one a pass opens, and
// nothing about it says which was meant.

const SECOND_DASHBOARD = {
  views: [{ title: "Household", path: "wide", type: "panel", cards: [{ type: "custom:haventory-card" }] }],
};
const TWO_DASHBOARDS = [
  ...cardViewsOf(DEV_DASHBOARD, "dashboard-dev", "dev"),
  ...cardViewsOf(SECOND_DASHBOARD, "lovelace-home", "Home"),
];

test("filterByDashboard picks by url path or by title, case-insensitively", () => {
  assert.deepEqual(
    filterByDashboard(TWO_DASHBOARDS, "dashboard-dev").map((v) => v.urlPath),
    ["/dashboard-dev/0", "/dashboard-dev/wide"],
  );
  assert.deepEqual(
    filterByDashboard(TWO_DASHBOARDS, "DEV").map((v) => v.urlPath),
    ["/dashboard-dev/0", "/dashboard-dev/wide"],
  );
  assert.deepEqual(
    filterByDashboard(TWO_DASHBOARDS, "home").map((v) => v.urlPath),
    ["/lovelace-home/wide"],
  );
});

test("filterByDashboard returns nothing for a name no dashboard answers to", () => {
  // The caller turns this into an error rather than falling through to
  // pickView: opening some other dashboard's card is the failure the flag
  // exists to remove.
  assert.deepEqual(filterByDashboard(TWO_DASHBOARDS, "dashboard-dev-2"), []);
  assert.deepEqual(filterByDashboard([], "dev"), []);
});

test("filtering first stops a shape reaching across dashboards", () => {
  // Unfiltered, the dev dashboard's panel view answers "wide" — so a pass that
  // named the other dashboard would silently open this one.
  assert.equal(pickView(TWO_DASHBOARDS, "wide").view.urlPath, "/dashboard-dev/wide");
  assert.equal(
    pickView(filterByDashboard(TWO_DASHBOARDS, "Home"), "wide").view.urlPath,
    "/lovelace-home/wide",
  );
});

test("pickView prefers the asked-for shape wherever it sits", () => {
  const found = cardViewsOf(DEV_DASHBOARD, "dashboard-dev", "dev");
  assert.deepEqual(pickView(found, "wide"), { view: found[1], exact: true });
  assert.deepEqual(pickView(found, "column"), { view: found[0], exact: true });
});

test("pickView falls back to the wrong shape rather than to nothing, and says so", () => {
  const columnOnly = cardViewsOf({ views: [{ cards: [{ type: "custom:haventory-card" }] }] }, "d");
  assert.deepEqual(pickView(columnOnly, "wide"), { view: columnOnly[0], exact: false });
  assert.deepEqual(pickView([], "wide"), { view: null, exact: false });
});

const PASSES = ["desktop", "mobile", "panel", "panel-mobile"];

test("parsePathOverrides targets one pass per --path and takes several", () => {
  const { overrides, error } = parsePathOverrides(
    ["--path", "desktop=/a/wide", "--out", "x", "--path", "panel-mobile=/haventory"],
    PASSES,
    null,
  );
  assert.equal(error, null);
  assert.deepEqual(overrides, { desktop: "/a/wide", "panel-mobile": "/haventory" });
});

test("parsePathOverrides rejects a bare --path across a whole run", () => {
  const { error } = parsePathOverrides(["--path", "/a/wide"], PASSES, null);
  assert.match(error, /which pass/);
});

test("parsePathOverrides accepts a bare --path once --only names the pass", () => {
  const { overrides, error } = parsePathOverrides(["--only", "desktop", "--path", "/a/wide"], PASSES, "desktop");
  assert.equal(error, null);
  assert.deepEqual(overrides, { desktop: "/a/wide" });
});

test("parsePathOverrides rejects a pass name it does not have", () => {
  const { error } = parsePathOverrides(["--path", "tablet=/a/wide"], PASSES, null);
  assert.match(error, /unknown pass "tablet"/);
});

test("parsePathOverrides finds nothing to do when --path is absent", () => {
  assert.deepEqual(parsePathOverrides(["--only", "mobile", "--dark"], PASSES, "mobile"), {
    overrides: {},
    error: null,
  });
});

// --- every harness asks, none assumes -------------------------------------
//
// A harness that writes its own dashboard URL is right until the instance is
// rearranged, and then it fails as "haventory-card never appeared" — which reads
// like a card that stopped registering, not like a URL that stopped existing.
// The live-update smoke sat on `/lovelace/default_view` and failed exactly that
// way. So the rule is the whole point of this module: harnesses ask it.
//
// The card's e2e smoke is in the card package rather than beside the others,
// which is precisely why it drifted unnoticed — it is checked here with them.
const HARNESSES = [
  ...readdirSync(here)
    .filter((f) => f.endsWith(".mjs") && !f.startsWith("card_views"))
    .map((f) => path.join(here, f)),
  path.resolve(here, "..", "..", "..", "cards", "haventory-card", "e2e", "live-updates.smoke.mjs"),
];

// Only `//` comments appear in these files, so dropping those lines leaves the
// code — a path named in prose is documentation, not a destination.
const codeOf = (file) =>
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

// A harness that opens Home Assistant's own pages — the integration's settings
// entry, the config flow behind a `my` redirect — has no card to find and nothing
// to ask this module for. It is held to the second half of the rule only: it
// must not name a dashboard either.
const opensTheCard = (code) => /haventory-card|cardPath/.test(code);

for (const file of HARNESSES.filter((f) => codeOf(f).includes("page.goto("))) {
  const name = path.basename(file);
  test(`${name} takes its URL from card_views, never its own`, () => {
    const code = codeOf(file);
    if (opensTheCard(code)) {
      assert.match(code, /import \{[^}]*\bcardPath\b[^}]*\} from ["'][^"']*card_views\.mjs["']/);
    }
    assert.doesNotMatch(code, /["'`][^"'`]*\/(lovelace|dashboard-)[^"'`]*["'`]/);
  });
}

// --- which instance a harness is pointed at -------------------------------
//
// A shell profile exporting HA_BASE_URL for one instance must not outrank the
// .env in the worktree the harness was started from: the harnesses that import
// data or drive two tabs write, and writing into someone else's inventory is
// the failure this precedence exists to remove.

const ENV_A = "HA_BASE_URL=http://instance-a:8123\nHA_TOKEN=token-a\n";

test("the .env beside the checkout beats an inherited export", () => {
  const target = resolveTarget({
    envText: ENV_A,
    env: { HA_BASE_URL: "http://instance-b:8123", HA_TOKEN: "token-b" },
    envFile: "/wt/.env",
  });

  assert.equal(target.base, "http://instance-a:8123");
  assert.equal(target.token, "token-a");
  assert.equal(target.source, "/wt/.env");
  assert.deepEqual(target.overrode, ["HA_BASE_URL=http://instance-b:8123", "HA_TOKEN"]);
});

test("the displaced token is named but never printed", () => {
  const target = resolveTarget({ envText: ENV_A, env: { HA_TOKEN: "token-b" }, envFile: "/wt/.env" });

  assert.deepEqual(target.overrode, ["HA_TOKEN"]);
});

test("HAVENTORY_IGNORE_ENV_FILE hands the decision back to the environment", () => {
  const target = resolveTarget({
    envText: ENV_A,
    env: { HA_BASE_URL: "http://release-host:8123", HAVENTORY_IGNORE_ENV_FILE: "1" },
    envFile: "/wt/.env",
  });

  assert.equal(target.base, "http://release-host:8123");
  assert.deepEqual(target.overrode, []);
  assert.match(target.source, /HAVENTORY_IGNORE_ENV_FILE/);
});

test("no .env leaves the environment alone, and no HA_BASE_URL falls back to localhost", () => {
  const exported = resolveTarget({ envText: null, env: { HA_BASE_URL: "http://b:8123/" }, envFile: "/wt/.env" });
  assert.equal(exported.base, "http://b:8123");
  assert.deepEqual(exported.values, {});

  const bare = resolveTarget({ envText: null, env: {}, envFile: "/wt/.env" });
  assert.equal(bare.base, "http://localhost:8123");
});

test("a value the environment already agrees with is not reported as overridden", () => {
  const target = resolveTarget({
    envText: ENV_A,
    env: { HA_BASE_URL: "http://instance-a:8123" },
    envFile: "/wt/.env",
  });

  assert.deepEqual(target.overrode, []);
});

// --- the desktop surfaces tell the two layout branches apart ---------------
//
// The card picks its layout from its own width, so a desktop pass that lands in
// a normal dashboard column runs the narrow branch — and a recipe whose
// selectors exist on both branches passes there without noticing. #178's
// `d-layout` check covers the pass as a whole; these two surfaces are the ones
// that reuse a component the narrow branch also mounts, so each carries its own
// discriminator.

const selectorsOf = (surface) => [
  ...[surface.expect ?? []].flat(),
  ...[surface.hidden ?? []].flat(),
];
const surfaceById = (table, id) => table.find((s) => s.id === id);

test("the desktop filter panel asserts the sheet's Apply button is absent", () => {
  const desktop = surfaceById(DESKTOP_SURFACES, "02-filter-panel");
  assert.match(desktop.hidden, /sheet-apply/);
  // Both branches mount the same hv-filter-panel, which is why `filter-panel`
  // alone could not tell them apart.
  assert.match([desktop.expect].flat().join(" "), /filter-panel/);
});

test("the desktop full view asserts what the card's own branch decides", () => {
  const desktop = surfaceById(DESKTOP_SURFACES, "11-full-view");
  const expected = [desktop.expect].flat().join(" ");
  // The full view is a modal at any width and sizes its sidebar off the window,
  // so neither `full-view` nor `full-sidebar` can tell a narrow card in a wide
  // window from a wide one. The shell's footer link is rendered only on the
  // desktop branch, and the shell stays in the DOM under the modal.
  assert.match(expected, /open-full-view/);
  assert.match(expected, /full-sidebar/);
});

test("every selector a desktop surface hides is one a narrow surface expects", () => {
  // A `hidden` selector that matches nothing anywhere passes forever — a typo in
  // one is invisible. Anchoring each to a narrow-branch surface that asserts the
  // same element visible is what keeps it from going vacuous.
  const narrow = new Set(
    [...MOBILE_SURFACES, ...PANEL_MOBILE_SURFACES]
      .flatMap((s) => [s.expect ?? []].flat())
      .map((sel) => sel.replace(/^\S+\s/, "")),
  );
  const hiddens = DESKTOP_SURFACES.flatMap((s) => [s.hidden ?? []].flat());
  assert.ok(hiddens.length > 0, "no desktop surface discriminates by absence");
  for (const sel of hiddens) {
    assert.ok(narrow.has(sel.replace(/^\S+\s/, "")), `nothing narrow expects ${sel}`);
  }
});

test("every selector the panel-mobile surfaces hide is one a wide surface expects", () => {
  const wide = new Set(
    DESKTOP_SURFACES.flatMap((s) => [s.expect ?? []].flat()).map((sel) => sel.replace(/^\S+\s/, "")),
  );
  const hiddens = PANEL_MOBILE_SURFACES.flatMap((s) => [s.hidden ?? []].flat());
  assert.ok(hiddens.length > 0, "no panel-mobile surface discriminates by absence");
  for (const sel of hiddens) {
    assert.ok(wide.has(sel.replace(/^\S+\s/, "")), `nothing wide expects ${sel}`);
  }
});

test("no surface asserts the same selector both visible and hidden", () => {
  for (const table of [DESKTOP_SURFACES, MOBILE_SURFACES, PANEL_MOBILE_SURFACES]) {
    for (const surface of table) {
      const all = selectorsOf(surface);
      assert.equal(new Set(all).size, all.length, `${surface.id} repeats a selector`);
    }
  }
});
