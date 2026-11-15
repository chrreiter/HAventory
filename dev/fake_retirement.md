# Retiring the Home Assistant fake

The offline suite runs against `tests/conftest.py`, a hand-written stand-in for Home
Assistant. This plan moves its tests onto the real core in four batches, then deletes the
fake. The pull request that deletes the fake deletes this file too.

## End state

One pytest run, in one environment, against the real Home Assistant at the declared floor:

```bash
scripts/test.sh    # today's scripts/test_integration.sh, renamed
# which is: .venv-integration/bin/python -m pytest -q tests   (asyncio_mode = auto in pytest.ini)
```

- **The environment is `.venv-integration`**, built from `requirements-integration.txt`. The
  `uv` project environment keeps ruff, mypy and pre-commit and loses its test packages.
  The project environment does not get Home Assistant, because:
  - phacc pins pytest and its plugins to exact versions, and `uv.lock` would have to resolve
    all of Home Assistant's dependencies for every platform;
  - the floor would gain two more copies (`pyproject.toml`, `uv.lock`) for
    `tests/test_min_ha_version.py` to register;
  - `ha-latest.yml` swaps the core by installing the newest phacc into that venv. It keeps
    working unchanged.

  Dependabot already leaves the Home Assistant pins alone in both updaters, so nothing
  changes there.
- **Layout:**

  ```
  tests/conftest.py               the index check after every test; nothing else
  tests/repository_invariants.py, date_helpers.py, fixtures/
  tests/test_<subject>.py         needs no hass: pure logic and repository checks
  tests/integration/conftest.py   the fixtures below
  tests/integration/test_<subject>.py   drives the integration through a real hass
  ```

  A test that needs `hass` lives in `tests/integration/`. Basenames are unique across both
  directories, because pytest's default import mode refuses two test modules with the same
  basename in one run.
- **Names:** a file gets its final name when it moves: the subject, with no `_offline`
  suffix. Until the fake is gone, `_offline` means "needs the fake", and the real-core run
  collects everything else (`collect_ignore_glob` in `tests/conftest.py`).
  `tests/test_frontend_registration.py` kept its name, because the card's source cites
  it; since batch 06 it needs no hass and runs in both modes.
- **CI** still runs the in-process job on `tests/integration` alone, so the files that need
  no hass are checked on the real core only by `scripts/test_integration.sh`. Pointing the
  job at `tests` is a one-line `ci:` change that any batch can carry.

## Helpers

The fixtures in `tests/integration/conftest.py` are factories. A test seeds storage, patches
a module or listens on the bus first, then calls them.

| Offline helper | On the real core |
|---|---|
| `ws_hass()` | `await setup_entry()`, then `ws = await ws_connect()` (connect after setup) |
| `install_runtime(repository=repo)` | `await setup_entry(stored=repo)`; a raw store dict also works |
| `install_runtime(options=...)` | `await setup_entry(options)` |
| `install_runtime(state=...)`, `unload_runtime`, `unload_entry` | `hass.config_entries.async_unload(entry.entry_id)` |
| `install_runtime(store=...)` failing store | `fail_next_save()` before the command; again to fail two |
| a recording store held open on an event | `fail_next_save(started=ev, until=ev2)`: set as the save starts, raises once `ev2` is set |
| `setup_entry(hass, entry)` (offline) | the `setup_entry` fixture |
| `remove_entry` | `hass.config_entries.async_remove(entry.entry_id)` |
| `installed_entry` | the entry `setup_entry` returned |
| `runtime_of`, `repo_of` | `entry.runtime_data`, only where no command, entity or `hass_storage` shows it |
| `ws_send(hass, id, type, **p)` | `await ws.send(type, **p)`; ids are assigned |
| `RecordingConn.events(topic=)` | `await ws.subscribe(topic)`, then `ws.events(topic)` |
| `RecordingConn.subscription_ids` | `frame["id"]` of `ws.event_frames` |
| `core_unsubscribe_events` / `close` | `ws.send("unsubscribe_events", subscription=id)` / `ws.socket.close()` |
| `ws_handler` + `ws_call` after unload | `ws.send` after the unload: the command stays registered |
| `monkeypatch(events_mod.broadcast_event)` | subscribe and read `ws.events`; after a service call, `await ws.drain()` |
| bus listener on the fake | `async_capture_events(hass, "haventory_item_changed")` from phacc |
| a service through the fake registry | `await call_service("item_create", name="Drill")` returns the response |
| the fake area registry | `add_areas("Garage")` returns `{"Garage": area_id}` |
| `MockResourceCollection` | seed `hass_storage["lovelace_resources"]` before setup; read `hass.data["lovelace"].resources.async_items()` (the collection saves late, so not `hass_storage`) |
| `MockYamlResourceCollection` | `async_setup_component(hass, "lovelace", {"lovelace": {"resource_mode": "yaml", "resources": [...]}})` before setup |
| `RETIRED_RATE_LIMIT_OPTIONS` | a literal in `tests/integration/test_config_flow.py` |
| the index check | unchanged: `tests/conftest.py` runs it in both modes |

## Moving a test

1. If an in-process test already checks the behaviour, delete the offline test.
2. If the test checks the fake, or a private detail no caller can observe, delete it.
3. Otherwise move it, by extending an existing in-process table or file where one fits.
4. A moved test drives the integration the way Home Assistant does: a config entry set up
   through `hass.config_entries`, commands over a WebSocket client, services through
   `hass.services.async_call`. It does not call handlers directly.
5. The offline file is deleted in the same commit that lands its replacement.

Inject a failure with `hass_storage` or `fail_next_save`, not by reaching into the runtime.
The pull request says which tests rules 1 and 2 deleted, and why.

## Batches

Collected tests per file, before each batch moves them. Each name is
`tests/<name>_offline.py`, except `tests/test_frontend_registration.py`.

- **04, WebSocket commands (224): done.** `test_ws_areas` 1, `_bulk` 6, `_distinct_values` 9,
  `_effective_area` 21, `_error_mapping` 12, `_guard` 7, `_items` 34, `_locations` 8,
  `_logging` 17, `_reminders` 30, `_schema_validation` 14, `_storage_error` 21,
  `_subscriptions` 24, `_utils` 12, `_wrappers` 5, and `test_wire_shapes` 3.
  `test_ws_statuses` moved in session 03. 146 behaviours moved into 86 real-core tests, 52
  tests were already covered and 26 checked the fake or a private detail. No helper was
  added. What the next batches can use:
  - Several subscriptions on one connection are told apart by the `id` of each frame in
    `ws.event_frames`. A `reloaded` event comes from `haventory/export` imported back with
    `policy="replace"`; the `unavailable` notice from a real unload, read with
    `ws.socket.receive_json()` because `drain()` pings, which refuses once unloaded.
  - A command runs as a background task that a client disconnect does not cancel; only
    Home Assistant stopping does. A test that cancels a command models nothing real.
  - A service call missing a required field is refused by Home Assistant's own service
    schema before the integration runs, and the integration logs nothing.
  - Batch 05 overlaps what moved here: every mutation shape's failed save is
    `test_a_failed_write_is_not_announced` (`test_ws_errors.py`), and the bulk delete's
    file rule under a failed save is in `test_attachments.py`.
  - Combined coverage gave up `subscriptions.py` 210-211 (a real connection's
    `send_message` raises for no single connection: a closed one is a logged no-op and a
    full queue cancels it) and 259-261 (the counts broadcast with no loaded entry, reachable
    only by calling it bare). `timestamps.py` 36 is now covered.
- **05, writes and storage (147): done.** `test_services` 25, `test_events` 34,
  `test_service_broadcast` 7, `test_delete_surfaces` 3, `test_failed_save_undo` 15,
  `test_storage` 40, `test_storage_concurrency` 2, `test_migrations` 6,
  `test_exception_translations` 15. 63 moved onto the real core, 9 stayed pure
  (`tests/test_migrations.py`, `tests/test_exception_translations.py`), 56 were already
  covered and 19 checked the fake or a private detail. One helper grew: `fail_next_save`
  takes `started` and `until` (table above). What the next batches can use:
  - The failed-save table is `tests/integration/test_failed_save_undo.py`; a new write
    family is a row there. To line a second actor up behind a held save without sleeping,
    wrap the coroutine it enters (`ops.commit`, or the package's `async_persist_immediate`)
    so the wrapper sets an event: each runs to the write lock without yielding.
  - What setup does with each stored stamp, and the retry for a payload that is no mapping,
    is `tests/integration/test_schema_migration.py`; `test_config_entry.py` no longer holds
    store refusals. phacc's `hass_storage` replaces its entry on every write, so
    `hass_storage[STORAGE_KEY] is seeded` means nothing wrote the store.
  - Batch 06: `test_init`'s `test_the_files_of_dropped_items_survive_while_the_backup_exists`
    overlaps `test_attachments.py::test_setup_keeps_the_files_of_every_item_the_backup_holds_a_row_for`
    (which ids the backup holds); the restart and backup-removal sequence is still only
    offline.
  - Batch 07: a seed built with `AttachmentMeta` must use a kind the reader accepts
    (`picture`, `manual`). `Repository.add_attachment` takes any string and the fake never
    reloads, so an offline seed of `document` passed there and is refused as a corrupt
    store on the real core. An import's low-stock crossings are in `test_events.py`.
  - Batch 08: no test calls a `service_*` handler any more, but
    `tests/test_single_write_path.py` sweeps their source through `services.SERVICES`, and
    `tests/test_services_schema.py` imports the `SCHEMA_*` constants; both change with the
    handlers.
  - Combined coverage gave up `events.py` 87: a mutation announced after its entry tore
    down, reachable only if a teardown lands between a write's save and its announcement.
    `events.py` 284-285 and 289-292 are now covered on the real core by an import.
- **06, setup and lifecycle (233): done.** `test_init` 38, `test_frontend_registration` 41,
  `test_entry_removal` 12, `test_entry_removal_refusal` 15, `test_entry_unload_refusal` 17,
  `test_runtime` 10, `test_stale_files` 35, `test_integration_lifecycle` 1, `test_logs` 29,
  `test_config_flow` 27, `test_diagnostics` 8. 82 behaviours moved onto the real core, 42
  stayed pure (`tests/test_logs.py`, the cross-language checks in
  `tests/test_frontend_registration.py`, the shipped-list and translation-tree checks), 80
  were already covered and 29 checked the fake or a private detail. `lovelace_helpers.py` is
  deleted, and `runtime_helpers.py` lost every helper that drove setup, unload or removal.
  No fixture was added. What the next batches can use:
  - `test_config_entry.py::test_a_command_during_teardown_is_refused_and_a_failed_flush_still_unloads`
    is what fails if `loaded_runtime` and `find_runtime` are swapped in the client
    direction (the in-process suite caught nothing else); the persistence and
    failed-save tests catch the teardown direction.
  - A file the store cannot read at all is `hass_storage[key] = {"version": 99, ...}`:
    `Store` raises `UnsupportedStorageVersionError`, a `HomeAssistantError`.
  - The test config directory is shared between tests, so a test that leaves attachment
    files under `media_root(hass)` hands them to the next one; remove them in the test.
  - A second static path or a second view on the same URL does not raise on this core, and
    HA never freezes its router, so the integration's guards around those registrations
    are reachable only through a harness artefact. Neither is tested.
  - The options form's to-do selector does not refuse an entity outside the `todo` domain
    when a submission is validated; only the frontend's picker filters it.
  - Combined coverage gave up `__init__.py` 252-261 and `frontend_registration.py` 117-125
    and 413 (the route refusals above), `frontend_registration.py` 81, 90-94, 147-154,
    175-182, 378 and 426 (a resource with no URL string, and Lovelace or the frontend's URL
    manager missing, which the manifest dependencies rule out), `config_flow.py` 180 (the
    in-flow single-instance abort: Home Assistant aborts first because of
    `single_config_entry`), `stale_files.py` 88 (an empty retired list), and the
    `runtime is None` guards at `events.py` 47, `storage.py` 287 and `todo_bridge.py` 76
    and 85, reachable only by calling the function with no loaded entry. Session 08 can
    type these away.
- **07, features (299): done.** `test_import_export` 125, `test_media` 61, `test_todo_bridge`
  20, `test_item_status` 29, `test_item_input_validation` 41, `test_serialized_shapes` 14,
  `test_local_day` 9. Counted by test function, 194 in all: 100 stayed pure (most folded into
  tables in `tests/test_import_export_plan.py`, `test_media.py`, `test_item_status.py`,
  `test_item_input_validation.py`, `test_serialized_shapes.py`, and two rows in
  `test_repository_attachments.py`), 56 moved onto the real core, 28 were already covered
  and 10 checked the fake, a private detail or a test's own fixture. The 299 collected
  tests became 180 pure and 40 in-process ones. One helper changed: `ws_connect` mints its
  token when it connects, so a test can freeze the clock first. What the next batch can use:
  - No `*_offline.py` file is left, and nothing imports `runtime_helpers.py` or
    `ws_helpers.py`. The offline mode collects 745 tests, every one pure; the stubs are
    still what lets the files that import the integration's modules load there.
    `tests/test_exception_translations.py` imports `homeassistant` itself.
  - `test_events.py`'s `_frozen_clock_client` predates the `ws_connect` change and can
    become `ws_connect`.
  - The to-do tests use a to-do entity of the suite's own on the real `todo` component:
    `local_todo` needs `ical`, which `requirements-integration.txt` does not install.
    `todo_bridge.TODO_FEATURE_DELETE_ITEM` and `const.HaventorySensorDescription` are still
    there for session 08 to remove.
  - `tests/integration/test_attachments.py` empties the media root before and after every
    test (an autouse fixture), because the test config directory is shared. Two pytest
    processes running at once still break each other's attachment and failed-save tests,
    which is the `TMPDIR` note under "Time" applied to the config directory too.
  - Combined coverage gave up `import_export.py` 704 (`plan_import`'s own policy check: the
    command refuses a bad policy first, and `ws.py` 987, that refusal, is now covered),
    `media.py` 277 (a thumbnail of a missing original: the view checks the file first, so
    only a delete racing the request reaches it) and `todo_bridge.py` 131 (the `runtime is
    None` guard, like 76 and 85).
- **08:** delete the fake, `runtime_helpers.py`, `ws_helpers.py`,
  the mode switch and this file; drop the offline gate line and CI job; set
  `asyncio_mode = auto` in `pytest.ini`; rename the script.

## Coverage baseline

Line coverage of `custom_components/haventory/`, measured at `1d5ceee`, before any test
moved, with the card built. Offline is `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest`;
in-process is `tests/integration/` alone; combined is the two together. A later batch does
not lower a module's combined figure without naming the lines it gave up in its pull
request.

| Module | Stmts | Offline | In-process | Combined |
|---|---:|---:|---:|---:|
| `__init__.py` | 140 | 100.0 | 92.9 | 100.0 |
| `calendar.py` | 61 | 0.0 | 96.7 | 96.7 |
| `calendar_projection.py` | 110 | 99.1 | 89.1 | 99.1 |
| `config_flow.py` | 59 | 96.6 | 84.7 | 98.3 |
| `const.py` | 51 | 100.0 | 100.0 | 100.0 |
| `diagnostics.py` | 41 | 100.0 | 92.7 | 100.0 |
| `events.py` | 106 | 96.2 | 84.9 | 96.2 |
| `exceptions.py` | 43 | 97.7 | 97.7 | 97.7 |
| `frontend_registration.py` | 163 | 100.0 | 73.6 | 100.0 |
| `import_export.py` | 353 | 97.5 | 72.0 | 97.7 |
| `item_writes.py` | 165 | 100.0 | 95.8 | 100.0 |
| `load_report.py` | 29 | 100.0 | 96.6 | 100.0 |
| `location_paths.py` | 33 | 97.0 | 84.8 | 97.0 |
| `logs.py` | 30 | 100.0 | 96.7 | 100.0 |
| `media.py` | 252 | 81.7 | 89.7 | 96.0 |
| `migrations.py` | 11 | 100.0 | 54.5 | 100.0 |
| `models.py` | 213 | 97.2 | 88.3 | 97.2 |
| `ops.py` | 258 | 100.0 | 92.2 | 100.0 |
| `pagination.py` | 75 | 96.0 | 42.7 | 96.0 |
| `query.py` | 207 | 100.0 | 75.8 | 100.0 |
| `repair_issues.py` | 35 | 85.7 | 85.7 | 85.7 |
| `repairs.py` | 39 | 0.0 | 92.3 | 92.3 |
| `repository.py` | 618 | 98.1 | 73.6 | 98.4 |
| `runtime.py` | 53 | 98.1 | 98.1 | 98.1 |
| `sensor.py` | 47 | 0.0 | 100.0 | 100.0 |
| `serialization.py` | 13 | 100.0 | 100.0 | 100.0 |
| `services.py` | 69 | 100.0 | 100.0 | 100.0 |
| `stale_files.py` | 82 | 96.3 | 78.0 | 96.3 |
| `storage.py` | 122 | 99.2 | 91.8 | 99.2 |
| `subscriptions.py` | 122 | 95.9 | 73.0 | 95.9 |
| `text.py` | 12 | 100.0 | 75.0 | 100.0 |
| `timestamps.py` | 23 | 95.7 | 87.0 | 95.7 |
| `todo_bridge.py` | 165 | 93.9 | 82.4 | 93.9 |
| `validation.py` | 148 | 97.3 | 81.8 | 97.3 |
| `ws.py` | 398 | 98.2 | 83.9 | 98.2 |
| **Total** | 4346 | 93.8 | 83.0 | 98.0 |

The lines no test reaches today, combined:

- `calendar.py` (96.7%): 89, 100
- `calendar_projection.py` (99.1%): 175
- `config_flow.py` (98.3%): 55
- `events.py` (96.2%): 139, 218, 286, 288
- `exceptions.py` (97.7%): 114
- `import_export.py` (97.7%): 233, 518, 519, 520, 649, 828, 833, 884
- `location_paths.py` (97.0%): 52
- `media.py` (96.0%): 200, 201, 206, 331, 332, 362, 366, 477, 561, 571
- `models.py` (97.2%): 372, 381, 437, 532, 567, 568
- `pagination.py` (96.0%): 56, 108, 111
- `repair_issues.py` (85.7%): 103, 105, 106, 107, 108
- `repairs.py` (92.3%): 45, 70, 87
- `repository.py` (98.4%): 199, 254, 361, 386, 402, 428, 494, 871, 1045, 1174
- `runtime.py` (98.1%): 123
- `stale_files.py` (96.3%): 147, 148, 153
- `storage.py` (99.2%): 332
- `subscriptions.py` (95.9%): 162, 163, 164, 165, 193
- `timestamps.py` (95.7%): 36
- `todo_bridge.py` (93.9%): 138, 139, 232, 246, 361, 362, 367, 388, 394, 395
- `validation.py` (97.3%): 66, 97, 100, 161
- `ws.py` (98.2%): 177, 180, 190, 193, 195, 617, 987

To measure a batch against this (build the card first):

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 COVERAGE_FILE=.coverage.offline uv run pytest -q \
  -p pytest_cov --cov=custom_components/haventory --cov-report=
COVERAGE_FILE=.coverage.realcore .venv-integration/bin/python -m pytest -q \
  -o asyncio_mode=auto tests --cov=custom_components/haventory --cov-report=
.venv-integration/bin/python -m coverage combine --keep \
  --data-file=.coverage.combined .coverage.offline .coverage.realcore
.venv-integration/bin/python -m coverage report --data-file=.coverage.combined \
  --include='custom_components/haventory/*' --show-missing
```

## Time

Today the real-core run is 713 tests in about 16 s of pytest time (18 s wall): 193
in-process tests at about 80 ms each, and 520 that need no hass in about 3 s together. The
moved status file costs the same, 23 tests in 1.8 s.

After batch 04 the real-core run is 799 tests in about 25 s of pytest time (27 s wall),
with the card built. After batch 05 it is 848 tests in about 32 s (34 s wall), on a
machine where the 799 took 33 s. After batch 06 it is 937 tests in about 31 s (33 s wall).
After batch 07 it is 1157 tests in about 48 s (51 s wall), on a machine where the 937
took 48 s with coverage on.

881 tests ran on the fake before batch 04, 657 after it, 510 after batch 05, 299 after
batch 06 and none after batch 07. The whole run is under two minutes, so the suite stays in
one process.

If it ever passes two minutes, `pytest-xdist` is already in phacc's stack (`-n auto`). Give
each worker its own `TMPDIR` first: Home Assistant's `file_upload` keeps uploads in
`<tmp>/home-assistant-file_upload`, one directory per machine, and each core deletes it when
it stops, so two cores running at once break each other's attachment tests.
