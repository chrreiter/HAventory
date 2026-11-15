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
  `tests/test_frontend_registration.py` needs the fake but keeps its name, because the
  card's source cites it; it is ignored by name until batch 06 moves it.
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
| `MockResourceCollection`, `MockYamlResourceCollection` | the real `lovelace` component in storage or YAML mode (batch 06 decides how) |
| `RETIRED_RATE_LIMIT_OPTIONS` | moves, as a literal, into the file that uses it (batch 06) |
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
- **05, writes and storage (147):** `test_services` 25, `test_events` 34,
  `test_service_broadcast` 7, `test_delete_surfaces` 3, `test_failed_save_undo` 15,
  `test_storage` 40, `test_storage_concurrency` 2, `test_migrations` 6,
  `test_exception_translations` 15. `test_single_write_path` needs no fake and already runs
  on the real core.
- **06, setup and lifecycle (233):** `test_init` 38, `test_frontend_registration` 41,
  `test_entry_removal` 12, `test_entry_removal_refusal` 15, `test_entry_unload_refusal` 17,
  `test_runtime` 10, `test_stale_files` 35, `test_integration_lifecycle` 1, `test_logs` 29,
  `test_config_flow` 27, `test_diagnostics` 8.
- **07, features (299):** `test_import_export` 125, `test_media` 61, `test_todo_bridge` 20,
  `test_item_status` 29, `test_item_input_validation` 41, `test_serialized_shapes` 14,
  `test_local_day` 9. The sensor catalog needs no fake and already runs on the real core.
- **08:** delete the fake, `runtime_helpers.py`, `ws_helpers.py`, `lovelace_helpers.py`,
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
with the card built.

881 tests ran on the fake before batch 04, 657 after it. Moved one for one, they add about 70 s, so the whole run
lands near 90 s; rules 1 and 2 bring it lower. That is under two minutes, so the suite
stays in one process.

If it ever passes two minutes, `pytest-xdist` is already in phacc's stack (`-n auto`). Give
each worker its own `TMPDIR` first: Home Assistant's `file_upload` keeps uploads in
`<tmp>/home-assistant-file_upload`, one directory per machine, and each core deletes it when
it stops, so two cores running at once break each other's attachment tests.
