# Item 23 — location rename must not bump subtree item versions

Status: **planned** (pre-v1.0, ships in v0.2.0). Tracker row: `open-items.md` item 23.
Paste-ready prompt: [`v1_prompts.md`](v1_prompts.md#item-23).

## The defect

Renaming or re-parenting a location rewrites the denormalized `location_path` of every
item in its subtree — and `Repository._update_items_location_paths_for_locations`
(`repository.py:801`) bumps each item's `version` and `updated_at` while doing it. A
client holding a stale `expected_version` for an *unrelated* field then gets a spurious
`conflict`: rename a room with 500 items in it, and 500 optimistic-concurrency tokens
die at once. Indexes stay consistent — this is a UX surprise, not corruption.

## The decision

`location_path` is **derived data**: the backend computes it from the location tree, no
client can write it, and its value is fully determined by state outside the item. The
`version` field exists to detect conflicting *item* mutations. A derived-data refresh is
not an item mutation, so:

- The path-only rewrite updates `location_path` and the path-derived search tokens.
- It does **not** bump `version` and does **not** touch `updated_at`. (Leaving
  `updated_at` alone is deliberate too: a rename re-stamping 500 items would shuffle the
  "recently updated" sort with rows the user never touched.)
- Everything else about `update_location` is unchanged — the generation counter still
  increments, hierarchy indexes still rebuild, area propagation still re-buckets.

## Why the card stays correct

The card does not learn about renamed paths through item versions. A `location/update`
broadcasts a `locations` event; the store refetches the tree and flat list on it, and the
item list's paths come back fresh on the next list/refetch. Verify during implementation
that subscription payloads for *items* are not the delivery channel for path changes
(check what `ws.py` broadcasts on `location/update`) — if any surface turns out to rely
on an item event per rewritten item, that surface's refresh path is in scope.

## Contract touch points

Both docs state the version semantics; both must say the new rule in one place each:

- `docs/data_shapes.md` — `location_path` is derived; its rewrite on location
  rename/move does not bump `version` or `updated_at`.
- `docs/backend_api_contract.md` — same sentence where `version` /
  `expected_version` semantics are defined.
- `CLAUDE.md` mentions the version invariant ("bumped on each mutation") — sharpen to
  "bumped on each *item* mutation; derived `location_path` rewrites excluded".

## Tests (TDD)

Offline, alongside the existing repository tests:

1. Rename a location → every subtree item's `location_path.display_path` changes,
   `version` and `updated_at` are byte-identical to before.
2. Client-with-stale-token scenario: read item (version N) → rename its location →
   `update_item(expected_version=N)` **succeeds**.
3. Re-parent (subtree move) → same invariants as (1).
4. A real item mutation after a rename still bumps from N to N+1 (the rewrite didn't
   desynchronize the counter).
5. Area change on a tree (propagation) — items untouched entirely, as today
   (`effective_area_id` is resolved at serialization, not stored).

One integration-suite case (`tests/integration/`) mirroring (2) against real HA, since
this is exactly the optimistic-concurrency behavior a stub could get wrong silently.

## Out of scope

- Item 14 (batch-aware monotonic bumps on back-to-back moves) — unrelated slow path.
- Item 19 (whole-store rewrite per mutation) — persistence cost, not version semantics.
