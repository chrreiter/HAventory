# Schema collapse to v1 — the one deliberately breaking step (item 81)

Status: **planned**, tracked as
[#229](https://github.com/chrreiter/HAventory/issues/229) and staged per
[#236](https://github.com/chrreiter/HAventory/issues/236): another 0.x minor, **after** the
schema exercise (#226) and its watch window, and before any public install. Ledger row: item
81. Paste-ready prompt: [`v1_prompts.md`](v1_prompts.md#item-81).

> **This is the only intentionally breaking release in the staging.** It is safe solely
> because nothing 0.x is published beyond the owner's own install. After this ships, a
> 1.0 user's schema history starts clean at v1.

## What it does

- Collapse the dev-era migrations: `CURRENT_SCHEMA_VERSION` becomes **1**, whose shape
  is **exactly the post-exercise shape** (today's items/locations plus item 80's
  additions). A clean install starts at v1 with that shape.
- `migrations.py` empties to the driver only — no steps exist, because no pre-v1 store
  is supported.
- Storage keeps refusing stores with a **higher** version than it supports (#120). An
  existing 0.x store (at the exercise's version) is therefore *refused* by the collapsed
  build — which is the designed behavior, not an accident: the crossing is explicit.

## The crossing: JSON export → import

There is no in-place path across the break, by construction. The documented crossing for
every pre-collapse install (today: exactly one — the owner's):

1. **While still on the old version:** take a JSON export (`haventory/export`). This is
   the step that cannot be recovered afterwards — storage refuses downgrades, so a
   missed export means manual store surgery.
2. Remove the old store (README → Removing HAventory), install the collapsed release.
3. Import the export (`import/preview` first, then `import/execute`).

**Rehearse before shipping** — on a *copy* of the owner's real export in a throwaway
Docker HA: old version seeded from the export → simulate the crossing → verify counts,
spot checks, and an export diff that shows only expected metadata deltas. The rehearsal
is a gate; the release does not ship until it has passed.

## Delivery

1. TDD offline: clean install starts at v1 with the collapsed shape; higher-versioned
   store refused with the #120 behavior (store untouched on disk, `ConfigEntryError`,
   no retry loop); import of a current-format export lands intact.
2. Re-run release-tests **D7 / D8 / E3 / E4** (the storage lifecycle scenarios) against
   the collapsed schema.
3. Docs: storage/migration docs updated; release notes carry the one-time crossing
   instruction verbatim; README's install/upgrade section mentions it for the 0.x→1.x
   transition (removable after 1.0 settles).
4. Ship as the next 0.x minor via release-please. **Owner's explicit go before merge** —
   this PR does not merge on green gates alone.
5. Owner crosses the production store per the instruction; verify integrity afterwards
   (same counts/spot/diff protocol as item 80).
6. Watch window (owner-defined, as before). If it closes with zero new Blocker/Major
   findings, item 83 (the v1.0.0 cut) proceeds **with no further changes**.

## Exit

Collapsed schema live on the production store via the rehearsed crossing; D7/D8/E3/E4
green against v1; watch window closed; v1.0.0 is a pure version bump away.
