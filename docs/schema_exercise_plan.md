# Schema exercise — the first real migration, proven on the live store (item 80)

Status: **planned**. Sequenced per the staging table in `open-items.md`: this ships as
the **next 0.x minor after the last feature release** — after v0.2.0 (and any further
feature minors) is validated and the dogfood plan runs clean. Tracker row: item 80.
Paste-ready prompt: [`v1_prompts.md`](v1_prompts.md#item-80).

## Purpose

Every migration shipped so far is a `setdefault`/no-op (`migrations.py`: `0→1`, `1→2`
ensure keys, `2→3` explicit no-op, `3→4` implicit no-op via the driver's
missing-step-means-no-op rule). The machinery — sequential steps, idempotency, the
downgrade refusal (#120), the `asyncio.Lock`-serialized write — has never moved real
data. Before the schema collapses to v1 (item 81) and before strangers' stores depend on
it, one deliberate **v4 → v5** migration runs against the owner's live production store.

The migration must be **real** (the payload's shape actually changes), **forward**, and
**idempotent** (re-applying yields the same result — the driver's contract).

## The shape change

No feature release moves the schema version (the feature payloads are deliberately
schema-neutral — the item `status` field, for example, shipped as a tolerant read: the
serializer always writes it, and a payload without it loads as `ok`). Default choice —
useful, minimal, honest:

- Add a top-level **`meta`** object to the store payload:
  `{"store_created_at": <ISO — backfilled as null when unknown>, "last_migration":
  {"from": 4, "to": 5, "at": <ISO>}}`.
- `migrate_4_to_5` creates it; the serializer writes it thereafter; loading tolerates
  its absence pre-migration and never drops it after.

If a genuinely useful shape change is pending by the time this runs (an items/locations
field change a post-v0.2.0 feature needs), it takes this slot instead — the point is the
rehearsal, not the `meta` block. One standing candidate: an explicit backfill of the item
`status` field (`migrate_4_to_5` stamping `"ok"` onto any item without one), which turns
that field's tolerant-read fallback into stored fact. The prompt asks before choosing.

## Delivery

1. **TDD offline:** migration unit tests (applies, idempotent re-apply, `0→5` chain from
   every prior version, downgrade still refused) + storage round-trip with the new key.
2. **Integration suite:** one real-HA case — store written at v4, integration boots,
   store on disk is v5 and `haventory/health` is healthy.
3. Bump `CURRENT_SCHEMA_VERSION` to 5. Ship as a `feat:` → release-please cuts the 0.x
   **minor** (versioning policy: MINOR = backward-compatible incl. automatic migrations).
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
