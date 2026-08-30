// Standing in front of the Home Assistant login form, once, for every harness.
//
// The HA frontend accepts a `hassTokens` localStorage entry in place of a login:
// the long-lived token goes in as `access_token`, `expires` has to be in the
// future, and `clientId` has to be the origin with a trailing slash — HA compares
// it against `${location.origin}/` and drops the whole entry when it does not
// match, which shows up as a plain redirect to the login page rather than as an
// error. That combination is the reason this is worth writing once.
//
// The entry has to be in place before any page script runs, so it goes in through
// `addInitScript`, which both a Playwright `page` and a `context` take. Pass the
// context when several pages have to be signed in (two_tab, reload_probe).

/** The message every harness prints when the injection was not accepted. */
export const LOGIN_REJECTED =
  "Redirected to the login page — hassTokens injection was rejected. Is HA_TOKEN valid?";

/**
 * Sign a page or a whole browser context in before it navigates.
 *
 * `dark` is Home Assistant's own dark mode, which is a separate switch from the
 * OS colour scheme: a harness testing a dark card has to set both, and the one it
 * cannot set through `emulateMedia` is this one.
 */
export async function signIn(target, { base, token, dark = false }) {
  await target.addInitScript(
    ([hassUrl, accessToken, wantDark]) => {
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
      if (wantDark) localStorage.setItem("selectedTheme", JSON.stringify({ dark: true }));
    },
    [base, token, dark],
  );
}

/**
 * True when Home Assistant sent this page to its login form.
 *
 * An unaccepted token is not an error anywhere — the page loads, and every
 * selector a harness waits for times out — so each run asks this right after its
 * first navigation and says so rather than reporting a missing element.
 */
export function atLoginPage(page) {
  return page.url().includes("/auth/authorize");
}
