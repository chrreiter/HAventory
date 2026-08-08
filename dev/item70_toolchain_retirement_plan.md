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

**Delivered plan docs — already deleted, nothing left to do here.**

`sidebar-panel.md`, `card_shipping_plan.md`, `item38_area_display_plan.md`,
`item23_rename_version_plan.md` and `item46_area_preview_plan.md` went with
[#286](https://github.com/chrreiter/HAventory/issues/286) item 4; their durable content
is in `docs/frontend_architecture.md` and `docs/data_shapes.md`, and git history holds
the rest; `schema_exercise_plan.md` followed once the exercise shipped in v0.3.0. The
remaining plan docs stage work that has not shipped — `v1_prompts.md`,
`schema_collapse_plan.md`, and this file itself — and each retires in the PR that
merges the work it stages, not before.

- **Exception:** `dev/release_testing_plan.md` retires only after the validation run is
  complete and its evidence (results log) is archived in the run's PR/issue —
  [#196](https://github.com/chrreiter/HAventory/issues/196) (A1) and
  [#277](https://github.com/chrreiter/HAventory/issues/277) (F3) are gated on it, and
  [#276](https://github.com/chrreiter/HAventory/issues/276) is the run itself.

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
