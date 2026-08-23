// Unit cover for the parts of probe.mjs that decide what a probe run does.
//
// The run itself needs a browser and a real Home Assistant, but everything it
// decides before opening one is pure: which actions run and in which order,
// which viewport the numbers were measured at, what a broken `--eval` says.
// A mistake in any of that reports a measurement of the wrong screen, which is
// worse than no measurement — so those parts are held here.
//
// Run: node --test   (from .claude/skills/run-haventory/)

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  KNOWN_FLAGS,
  USAGE,
  buildContextOptions,
  defaultPathFor,
  describeEvalFailure,
  parseArgs,
} from "./probe.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// Enough of a Playwright device descriptor for the context builder; the real
// map comes from playwright, which these tests deliberately do not need.
const DEVICES = {
  "iPhone 15": {
    viewport: { width: 393, height: 659 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone)",
  },
};

// --- what runs, and in which order ----------------------------------------

test("actions keep the order they were typed in", () => {
  const { actions } = parseArgs(["--search", "sponge", "--tap", "#a", "--wait", "500", "--click", "#b"]);
  assert.deepEqual(actions, [
    { kind: "search", value: "sponge" },
    { kind: "tap", value: "#a" },
    { kind: "wait", value: "500" },
    { kind: "click", value: "#b" },
  ]);
});

test("a value that looks like a flag is a value, not a second action", () => {
  const { actions, options } = parseArgs(["--fill", "#q=>--tap", "--eval", "1 + 1"]);
  assert.deepEqual(actions, [{ kind: "fill", value: "#q=>--tap" }]);
  assert.equal(options.evalExpr, "1 + 1");
});

test("an action flag with nothing after it is refused", () => {
  assert.throws(() => parseArgs(["--tap"]), /--tap/);
});

test("a mistyped flag is refused rather than silently ignored", () => {
  // `--elment haventory-panel` used to fall through to the default root and
  // then time out for a reason the message never mentioned.
  assert.throws(() => parseArgs(["--elment", "haventory-panel"]), /--elment/);
  assert.throws(() => parseArgs(["haventory-panel"]), /haventory-panel/);
});

test("--wait and --settle insist on a number", () => {
  assert.throws(() => parseArgs(["--wait", "soon"]), /--wait/);
  assert.throws(() => parseArgs(["--settle", "a while"]), /--settle/);
  assert.equal(parseArgs(["--settle", "400"]).options.settle, 400);
});

test("--fill insists on the selector=>value form", () => {
  assert.throws(() => parseArgs(["--fill", "#q"]), /--fill/);
});

test("--viewport insists on WxH", () => {
  assert.throws(() => parseArgs(["--viewport", "390"]), /WxH|390x844/);
  assert.deepEqual(parseArgs(["--viewport", "390x844"]).options.viewport, { width: 390, height: 844 });
});

test("--help wins over everything else on the line", () => {
  assert.equal(parseArgs(["--help", "--eval", "boom"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
});

// --- which screen the numbers came from -----------------------------------

test("the default is a stated desktop viewport with the service worker blocked", () => {
  const { contextOptions, label } = buildContextOptions(parseArgs([]).options, DEVICES);
  assert.deepEqual(contextOptions.viewport, { width: 1280, height: 900 });
  assert.equal(contextOptions.serviceWorkers, "block");
  assert.ok(!contextOptions.hasTouch);
  assert.equal(contextOptions.colorScheme, "light");
  assert.match(label, /1280x900/);
});

test("--mobile takes the iPhone 15 descriptor, touch and all", () => {
  const { contextOptions, label } = buildContextOptions(parseArgs(["--mobile"]).options, DEVICES);
  assert.deepEqual(contextOptions.viewport, DEVICES["iPhone 15"].viewport);
  assert.equal(contextOptions.hasTouch, true);
  assert.equal(contextOptions.isMobile, true);
  assert.match(label, /iPhone 15/);
});

test("--viewport measures the desktop layout unless --touch asks for a phone", () => {
  // HA switches to its narrow, sidebar-collapsed layout on `isMobile`, so a
  // measurement of the desktop layout at a narrow window must not set it.
  const plain = buildContextOptions(parseArgs(["--viewport", "900x800"]).options, DEVICES);
  assert.deepEqual(plain.contextOptions.viewport, { width: 900, height: 800 });
  assert.ok(!plain.contextOptions.hasTouch);
  assert.ok(!plain.contextOptions.isMobile);

  const touched = buildContextOptions(parseArgs(["--viewport", "900x800", "--touch"]).options, DEVICES);
  assert.equal(touched.contextOptions.hasTouch, true);
  assert.equal(touched.contextOptions.isMobile, true);
});

test("--dark and --locale reach the context", () => {
  const { contextOptions } = buildContextOptions(
    parseArgs(["--dark", "--locale", "de-DE"]).options,
    DEVICES,
  );
  assert.equal(contextOptions.colorScheme, "dark");
  assert.equal(contextOptions.locale, "de-DE");
});

test("the panel is its own path, and the card is asked about", () => {
  assert.equal(defaultPathFor("haventory-panel"), "/haventory");
  assert.equal(defaultPathFor("haventory-card"), null);
  assert.equal(defaultPathFor('haventory-card [data-testid="row-secondary"]'), null);
});

// --- a run that fails says why --------------------------------------------

test("a failing --eval names the message and the expression, not a stack", () => {
  const error = new TypeError("Cannot read properties of null (reading 'getBoundingClientRect')");
  error.stack = `${error.name}: ${error.message}\n    at eval (evaluate:1:1)\n    at run (probe.mjs:1:1)`;
  const said = describeEvalFailure("deepQuery('.hv-area-chip').getBoundingClientRect()", error);
  assert.match(said, /Cannot read properties of null/);
  assert.match(said, /hv-area-chip/);
  assert.doesNotMatch(said, /\n\s+at /);
});

// --- the usage block is the documentation ---------------------------------

test("the usage block names every flag the parser takes", () => {
  for (const name of KNOWN_FLAGS) {
    assert.ok(USAGE.includes(name), `${name} is parsed but missing from the usage block`);
  }
});

test("--help prints the usage and exits 0 without a token", () => {
  const run = spawnSync(process.execPath, [path.join(here, "probe.mjs"), "--help"], {
    encoding: "utf8",
    env: { ...process.env, HA_TOKEN: "", HA_BASE_URL: "", HAVENTORY_IGNORE_ENV_FILE: "1" },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /node probe\.mjs/);
  assert.match(run.stdout, /--eval/);
});

test("SKILL.md documents the probe with a runnable example", () => {
  const skill = readFileSync(path.join(here, "SKILL.md"), "utf8");
  assert.match(skill, /node probe\.mjs[^\n]*--eval/);
  assert.match(skill, /--locale/);
});
