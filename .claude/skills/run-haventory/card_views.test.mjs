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

import { cardViewsOf, holdsCard, parsePathOverrides, pickView } from "./card_views.mjs";

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
    { urlPath: "/dashboard-dev/0", shape: "column", viewType: "sections", label: "dev › view 0" },
    { urlPath: "/dashboard-dev/wide", shape: "wide", viewType: "panel", label: "dev › wide" },
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
    label: "d › view 0",
  });
  assert.deepEqual(cardViewsOf({ strategy: { type: "map" } }, "map"), []);
  assert.deepEqual(cardViewsOf(undefined, "d"), []);
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
