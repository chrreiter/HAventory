# Schema exercise — the first real migration, proven on the live store (item 80)

Status: **planned**, tracked as
[#226](https://github.com/chrreiter/HAventory/issues/226) and staged per
[#236](https://github.com/chrreiter/HAventory/issues/236): a 0.x minor that ships after the
feature work it has to migrate, once the validation run is clean. Ledger row: item 80.
Paste-ready prompt: [`v1_prompts.md`](v1_prompts.md#item-80).

## Purpose

The first real migration exists: **`migrate_4_to_5`** backfills the per-item `status`
field (the item-status feature, #189) — every step before it is a `setdefault`/no-op
(`migrations.py`: `0→1`, `1→2` ensure keys, `2→3` explicit no-op, `3→4` implicit no-op
via the driver's missing-step-means-no-op rule). But the machinery — sequential steps,
idempotency, the downgrade refusal (#120), the `asyncio.Lock`-serialized write — has
still only moved data in tests, never on the owner's live production store. Before the
schema collapses to v1 (item 81) and before strangers' stores depend on it, that is what
this item proves.

The migration is **real** (the payload's shape actually changes), **forward**, and
**idempotent** (re-applying yields the same result — the driver's contract).

## The shape change

Taken by the item-status feature: `migrate_4_to_5` stamps `"ok"` onto any item without a
known `status`, and `CURRENT_SCHEMA_VERSION` moved to 5 in the same release. The `meta`
block this plan once sketched as a fallback shape change is not needed — the point was
always the rehearsal, and the rehearsal now has real data to move.

## Delivery

Steps 1–3 shipped with the status feature (#189): offline migration tests (applies,
idempotent re-apply, `0→5` chain, downgrade still refused), storage round-trip with the
new field, and the `CURRENT_SCHEMA_VERSION` bump on a `feat:` release (versioning
policy: MINOR = backward-compatible incl. automatic migrations). Remaining:

4. **Live verification on the production install** (owner in the loop):
   - Before upgrading: JSON export + note `haventory/stats` counts.
   - Upgrade via HACS; restart.
   - After: `schema_version: 5` on disk, counts identical, spot-check items/locations,
     JSON export diff against the pre-upgrade export shows **only** the expected delta.
5. **Watch window**, defined up front (owner sets N days of normal daily use with zero
   new Blocker/Major findings), closes before item 81 starts.

## Exit

Migration ran cleanly on the live store; integrity verified (counts, spot checks, export
diff); watch window closed; the collapse (item 81) is unblocked.
