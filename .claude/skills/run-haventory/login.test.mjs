// The login bypass, checked without a browser.
//
// Every browser harness depends on this one entry being shaped the way Home
// Assistant's frontend reads it, and a wrong shape fails silently: the page
// loads, HA drops the entry, the run redirects to the login form and every
// selector times out. So the three properties that decide acceptance —
// `access_token`, a future `expires`, and `clientId` as the origin with its
// trailing slash — are asserted here rather than discovered in a timeout.

import assert from "node:assert/strict";
import test from "node:test";

import { LOGIN_REJECTED, atLoginPage, signIn } from "./login.mjs";

/** A Playwright page or context, reduced to the one call `signIn` makes. */
function recorder() {
  const calls = [];
  return {
    calls,
    async addInitScript(fn, args) {
      calls.push({ fn, args });
    },
  };
}

/** Run the recorded init script the way the browser would, and read the store. */
function storeAfter(target) {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    setItem: (key, value) => store.set(key, value),
  };
  try {
    const { fn, args } = target.calls[0];
    fn(args);
  } finally {
    globalThis.localStorage = previous;
  }
  return store;
}

test("the injected entry carries what the frontend checks before it trusts it", () => {
  const target = recorder();
  signIn(target, { base: "http://localhost:8123", token: "long-lived" });

  const tokens = JSON.parse(storeAfter(target).get("hassTokens"));

  assert.equal(tokens.access_token, "long-lived");
  assert.equal(tokens.hassUrl, "http://localhost:8123");
  // HA compares this against `${location.origin}/`; without the slash it drops
  // the whole entry and the run lands on the login form.
  assert.equal(tokens.clientId, "http://localhost:8123/");
  assert.ok(tokens.expires > Date.now(), "an expired entry is ignored");
});

test("Home Assistant's dark mode is set only when it is asked for", () => {
  const light = recorder();
  signIn(light, { base: "http://ha:8123", token: "t" });
  assert.equal(storeAfter(light).has("selectedTheme"), false);

  const dark = recorder();
  signIn(dark, { base: "http://ha:8123", token: "t", dark: true });
  assert.deepEqual(JSON.parse(storeAfter(dark).get("selectedTheme")), { dark: true });
});

test("a redirect to the authorize page is what a refused token looks like", () => {
  assert.equal(atLoginPage({ url: () => "http://ha:8123/auth/authorize?redirect=%2F" }), true);
  assert.equal(atLoginPage({ url: () => "http://ha:8123/haventory" }), false);
  assert.match(LOGIN_REJECTED, /HA_TOKEN/);
});
