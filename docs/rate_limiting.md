# WebSocket rate limiting

Rate limiting caps how fast one client may talk to HAventory. It is **off by default**, and
most installations should leave it off. This page explains what it protects against, when
turning it on is worth it, and what each setting in **Settings → Devices & services →
HAventory → Configure** actually does.

Developer-facing semantics (error envelope, drop accounting, `haventory/health` fields) live
in [`backend_api_contract.md`](backend_api_contract.md#rate-limiting).

## What it protects against

The card and the `haventory.*` services reach the integration over Home Assistant's
WebSocket connection. Nothing in that path is naturally throttled, so a client can send as
fast as it can loop — and every write re-serializes the whole inventory and rewrites the
store file. A runaway writer therefore does not just spam HAventory; it competes with the
rest of Home Assistant for the event loop and the disk.

Rate limiting puts a ceiling on that. When a client crosses it, its commands are refused
with a `rate_limited` error instead of executed, and surplus live-update events are dropped
instead of sent. Home Assistant keeps running normally; only the client that is over budget
is slowed.

## When to enable it

Turn it on if any of these describe you:

- **A client you don't fully control talks to HAventory** — a wall panel that reconnects in
  a loop, a shared tablet, a household member's script, a third-party client you are
  evaluating.
- **You are writing or debugging a client** and want a safety net so an accidental
  `while true` loop cannot bog down Home Assistant before you notice.
- **Your Home Assistant instance is reachable from outside your network** and you want one
  more bound on what an authenticated-but-misbehaving session can do.

Leave it off if:

- **Only the HAventory card uses it.** Normal card usage — browsing, filtering, editing,
  bulk operations — stays far below the defaults, so the limiter would never fire and only
  adds a way to misconfigure things.
- **You run large imports, bulk edits, or the stress tooling** (`scripts/stress_test.py`).
  These deliberately go fast and will trip the limits.

It is off by default because the failure mode of a limit set too tight is worse than the
problem it solves: a refused command surfaces as an error in the card, and dropped events
make a list quietly stop updating. (The card notices the second case — it retries a refused
subscription up to four times, then shows **Live updates paused** with a Refresh button, so
a stale list is never mistaken for a quiet one.)

## How the settings work

Every limit is a **token bucket**: a bucket holds tokens, each request spends one, and the
bucket refills at a steady rate. That gives two numbers per limit.

| Setting | Meaning |
| --- | --- |
| **…per second** | The sustained rate — how many requests per second refill the bucket. This is the long-run ceiling. |
| **…burst** | The bucket size — how many requests may arrive back-to-back after an idle moment before the sustained rate takes over. |

So "20 per second, burst 60" means: a client that has been quiet may fire 60 commands at
once, after which it is held to 20 per second. Burst absorbs the normal shape of UI traffic
(a page load or a bulk edit issues a clump of commands, then goes quiet); the rate is what
stops a loop.

Each limit exists in two scopes:

| Scope | Applies to |
| --- | --- |
| **per connection** | One browser tab, app, or script session. Stops a single misbehaving client without touching the others. |
| **global** | All clients together. A backstop for "many clients, each individually polite". |

And in two directions:

| Direction | What crossing the limit does |
| --- | --- |
| **Commands** | Requests *into* HAventory — list, create, update, delete, import. Over budget: the command is **not executed** and the client gets a `rate_limited` error. Nothing is lost; the client can retry. |
| **Events** | Live-update broadcasts *out* to subscribed clients. Over budget: the event is **dropped**. State is not lost — the client just does not hear about that change until it reloads. |

That is the full grid: `{commands, events} × {per connection, global} × {rate, burst}` — the
eight numbers on the options page.

## Defaults

| Limit | Per second | Burst |
| --- | --- | --- |
| Commands, per connection | 20 | 60 |
| Commands, global | 100 | 200 |
| Events, per connection | 50 | 200 |
| Events, global | 500 | 1000 |

These are chosen so normal card usage never reaches them — enable the limiter and change
nothing, and you should not notice it. Tighten them only if you have a specific client to
rein in, and measure before you do (see below).

Minimums the form enforces: a rate must be greater than 0, and a burst must be at least 1. A
bucket smaller than one token can never hand out a token, so a burst below 1 would block
*all* traffic; the form rejects it, and a stored value below 1 falls back to the default.

## Checking whether it is firing

- **Card diagnostics** — the ⋮ menu → **Diagnostics** panel shows the limiter state and the
  drop counters, and badges itself when something is wrong.
- **`haventory/health`** — reports `rate_limit: {enabled, dropped_commands, dropped_events}`.
- **Home Assistant log** — drops emit a throttled warning (at most one per kind every 30 s)
  so an abusive client cannot flood the log.

Drop counters reset to zero whenever you change a rate-limit option: saving the form rebuilds
the limiter, refills every bucket, and clears the counts. So to measure, save the options
first, then reproduce the load, then read the counters.
