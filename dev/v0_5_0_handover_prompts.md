# V0.5.0 — handovers to a local session

Cloud sessions have no Home Assistant. Each section below is one thing a cloud session
finished but could not verify, written for a local session driving the dev Docker instance
(`run-haventory` / `test-haventory`). Sections are appended in session order; the protocol
is `dev/V0_5_0_implementation.md` §5.

Delete this file with the plan when the milestone closes.

---

## H3 — #194 an area-filtered subscription only hears about its own area

**Branch / PR**: `claude/v0-5-0-w1b-subscribe-area` / #TBD
**Why this needs a real HA**: offline tests drive the matcher directly and the in-process
suite drives one connection. What neither shows is two live dashboards on one Home
Assistant, each holding its own `haventory/subscribe` round, and a mutation reaching only
one of them — the fan-out across connections, over a real socket, with real areas from the
area registry.

### Setup

    set -a; . ./.env; set +a
    bash scripts/reload_addon.sh --container home-assistant --sleep 30 --tail-logs

Seed two areas in HA (Settings → Areas, or reuse two that exist), then build a tree with a
root anchored in each and one item per root:

    uv run python scripts/ws_init_haventory.py     # if the instance is empty
    uv run python scripts/ws_probe.py              # for ad-hoc location/create + item/create calls

The shape that matters: `Kitchen` (area = the first area) → `Drawer`, `Garage` (area = the
second area), one item in `Drawer`, one item in `Garage`, and one item with **no** location.

### Steps

1. Open two browser tabs on the HAventory panel.
2. In tab A, filter to the kitchen area (area chip in the filter panel). Leave tab B unfiltered.
3. In tab B, edit the item that lives in `Garage` — rename it.
4. Watch tab A: the row count and the list must not flicker, and no toast or row change may
   appear for the garage item.
5. In tab B, edit the item in `Drawer`. Tab A must show the new name without a manual refresh.
6. In tab B, edit the item with no location. Tab A must not react.
7. With tab A still filtered to the kitchen, move `Drawer` under `Garage` (drag in the
   location tree, or `location/move_subtree`). Tab A is expected to re-list — it does that
   on the `locations` `moved` event — and the item must then be gone from its list. This is
   the documented behaviour, not a bug: no per-item departure event is emitted.
8. Optional, the same case the other way: reassign `Kitchen`'s own area in the location
   editor. Today that emits no `locations` event at all, so tab A keeps showing the items
   until something else makes it re-list. Note what you see; it is the follow-up below.

### What "pass" looks like

- Steps 3, 4 and 6: nothing moves in tab A. In the browser devtools WS frames, tab A's
  connection receives **no** `event` frame carrying the garage item or the location-less one.
- Step 5: tab A updates live, no refresh.
- Step 7: tab A re-lists once and the item disappears from it.
- `home-assistant.log` carries no `websocket_api` ERROR and no `haventory` warning across
  the whole run.

### What to send back

- The two tabs side by side after step 4 (screenshot), and the devtools WS frame list for
  tab A across steps 3–6.
- Whatever step 8 does, in one line — it decides whether the follow-up below is worth an issue.
- Paste the result as a comment on #194 and reply on the PR thread.
