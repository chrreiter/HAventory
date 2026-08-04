# Item 70 — retire the scoping-only toolchain before 1.0

Status: **planned**, tracked as
[#216](https://github.com/chrreiter/HAventory/issues/216) and staged per
[#236](https://github.com/chrreiter/HAventory/issues/236) as mandatory before the first
public release. Ledger row: item 70.
Paste-ready prompt: [`v1_prompts.md`](v1_prompts.md#item-70).

## Why, and why last

A new contributor currently has to work out which half of `docs/` and `scripts/` is
live. The planning and one-off exploration artifacts were load-bearing while the work
was in flight and are dead weight once it ships. This item removes them — and it goes
**after** the things that still consume them: item 69 repairs the screenshot harness
that produces the README/announcement imagery, and the v0.2.0 run (item 79) is executed
from `release_testing_plan.md`. Retiring first would mean rebuilding.

## Triage list

Nothing here is a free delete — every entry has inbound references (CI,
`CONTRIBUTING.md`, `README.md`, `CLAUDE.md`, docstrings) that must go with it, and
whatever survives earns one line in `CONTRIBUTING.md` saying what it is for.

**Delivered plan docs (delete; references updated):**

- `dev/sidebar-panel.md` — delivered; linked only from the ledger.
- `dev/card_shipping_plan.md` — delivered; linked from `CLAUDE.md:57` and ledger rows.
- `dev/item38_area_display_plan.md` — delivered with #162.
- The v0.2.0-cycle plan docs once their items close: `item23_rename_version_plan.md`,
  `item46_area_preview_plan.md`, `v1_prompts.md`, `schema_exercise_plan.md`,
  `schema_collapse_plan.md` — and this file itself. Each retires when the work it
  stages is merged, not before.
- **Exception:** `dev/release_testing_plan.md` retires only after the v0.2.0 run is
  complete and its evidence (results log) is archived in the run's PR/issue — items 4
  (A1) and 60 (F3) are gated on it.

**Exploration scripts (triage keep/delete individually):**

- `scripts/stress_test.py`, `create_test_items.py`, `ws_probe.py`, `ws_subscribe.py`,
  `ws_init_haventory.py` — each referenced from README/CONTRIBUTING/CLAUDE.md;
  `create_test_items.py` also seeds the demo inventory for the README imagery (item 69's
  consumer), so it survives at least until those assets exist.
- Agent harnesses under `.claude/skills/`: `run-haventory` (`screenshot.mjs`,
  `visual_pass.mjs`, `log_sweep.py`, `driver.py`) and `test-haventory` (`stress.py`).
  These are the dogfood run's instrumentation — keep through item 79, then triage.
- `tests/test_ws_logging_offline.py:12` cites the release plan in a docstring — reword
  when the plan doc retires.

**Keep, documented:** `scripts/common.sh` (sourced by the others), `setup.sh`,
`lint.sh`, `test.sh`, `ci_local.sh`, `build_frontend.sh`, `test_integration.sh`,
`reload_addon.sh`, `check_release_zip.py`, `check_version_consistency.py` — the
operational set. One `CONTRIBUTING.md` line each (a short table is fine).

## Mechanics

- One PR, or two if the diff gets large (docs first, scripts second).
- Grep-verified: after each removal, `grep -rn "<name>"` over the repo (excluding
  `node_modules`, `.venv*`, git history) is empty.
- The ledger's own historical notes keep their references to retired docs — history is
  allowed to name what no longer exists; live tables and CLAUDE.md are not.
- Both gates green; no behavior change anywhere.
