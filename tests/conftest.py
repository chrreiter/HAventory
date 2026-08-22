"""Test configuration shared by both HAventory test modes.

HAventory has two, deliberately separate, backend test modes:

* **Offline (fast, default).** Home Assistant is *stubbed* — the fake modules
  installed below stand in for the real ``homeassistant`` package so the suite
  runs in milliseconds with no HA install. Invoke with plugin autoload disabled::

      PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 pytest -q

* **Integration (opt-in).** The integration runs inside a *real* in-process
  Home Assistant core provided by ``pytest-homeassistant-custom-component``
  (phacc), with plugin autoload ENABLED. Lives under ``tests/integration/`` and
  is invoked explicitly (see ``tests/integration/conftest.py``)::

      pytest -o asyncio_mode=auto tests/integration

This module must serve the offline suite without ever leaking its HA stubs into
the integration suite. It picks the mode from two signals: whether a real
``homeassistant`` package is importable, and whether plugin autoload is disabled.
Integration mode = real HA present *and* autoload enabled; every other case is
the offline suite and gets the stubs. As a result:

* the offline suite is byte-for-byte unchanged (stubs install exactly as before
  whenever the real package is absent, which is always true in the HA-free
  offline environment); and
* the phacc suite never sees the stubs (real HA is present and autoload is on),
  and is never collected by the offline run (``collect_ignore`` below).

The WebSocket stub validates: it applies each command's schema to a frame
before dispatch, as an ``ActiveConnection`` does, so an offline test cannot hand
a handler a payload no client could send. Write offline WS tests against frames
a real client would produce, and expect ``invalid_format`` for the rest.

It also re-enables sockets when pytest-socket is auto-loaded by an IDE, which
otherwise blocks the loopback the event loop sets itself up on.
"""

import asyncio
import dataclasses
import datetime
import json
import os
import sys
import tempfile
import types
from collections.abc import Mapping
from enum import Enum, StrEnum
from pathlib import Path

import voluptuous as vol
from voluptuous.humanize import humanize_error

# Ensure project root is on sys.path for module imports (both modes).
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_AUTOLOAD_DISABLED = os.environ.get("PYTEST_DISABLE_PLUGIN_AUTOLOAD") == "1"

# The offline environment never installs Home Assistant (it is stubbed); the
# integration environment (phacc) does. Use that as the primary discriminator.
try:
    import homeassistant as _real_homeassistant  # noqa: F401

    _REAL_HA_PRESENT = True
except ModuleNotFoundError:
    _REAL_HA_PRESENT = False

# Only skip the stubs when we are unambiguously in the phacc integration mode:
# a real HA core is importable AND plugin autoload is enabled. Anything else is
# the offline suite (including offline runs that happen inside an HA-equipped
# venv, which still expect the stubs).
_INTEGRATION_MODE = _REAL_HA_PRESENT and not _AUTOLOAD_DISABLED


def _install_offline_ha_stubs() -> None:  # noqa: PLR0915 - flat, intentional stub registrations
    """Install the minimal Home Assistant stub modules used by the offline suite."""

    def _ensure_stub(mod_name: str) -> types.ModuleType:
        mod = types.ModuleType(mod_name)
        sys.modules[mod_name] = mod
        return mod

    # Root module
    _ensure_stub("homeassistant")

    # homeassistant.const
    ha_const = types.ModuleType("homeassistant.const")
    ha_const.Platform = types.SimpleNamespace(SENSOR="sensor", CALENDAR="calendar")
    # Verbatim from HA: the to-do bridge compares an entity's state against these
    # two, and defers its first pass until Home Assistant says it has started.
    ha_const.EVENT_HOMEASSISTANT_STARTED = "homeassistant_started"
    ha_const.STATE_UNAVAILABLE = "unavailable"
    ha_const.STATE_UNKNOWN = "unknown"
    sys.modules["homeassistant.const"] = ha_const

    # homeassistant.core
    ha_core = types.ModuleType("homeassistant.core")

    class _Config:  # type: ignore[override]
        """Stand in for HA's ``hass.config``, for the paths under the config dir.

        The directory is created on first use rather than per instance: nearly
        every offline test constructs a ``HomeAssistant`` and only the ones
        touching attachment media ever ask for a path.
        """

        def __init__(self) -> None:
            self._config_dir: str | None = None

        @property
        def config_dir(self) -> str:
            if self._config_dir is None:
                self._config_dir = tempfile.mkdtemp(prefix="haventory-offline-")
            return self._config_dir

        def path(self, *parts: str) -> str:
            return os.path.join(self.config_dir, *parts)

    class _Bus:  # type: ignore[override]
        """Stand in for HA's event bus, recording what was fired and who listens.

        Real HA dispatches a fired event to its listeners; here the two records
        stay separate and a test drives a listener itself. That keeps `async_fire`
        synchronous — HA's is too — without the stub having to schedule the
        coroutine listeners the real bus runs as tasks.
        """

        def __init__(self) -> None:
            self.fired: list[tuple[str, dict]] = []
            self.listeners: list[tuple[str, object]] = []
            # Removals of a listener the bus no longer has. Real Home Assistant
            # answers one with `Unable to remove unknown job listener` at ERROR,
            # naming the caller's module — so a test asserting that a caller
            # never asks twice needs the attempt, which `listeners` cannot show.
            self.unknown_removals: list[str] = []

        def async_fire(self, event_type, event_data=None, *_args, **_kwargs) -> None:
            self.fired.append((event_type, dict(event_data or {})))

        def events_of(self, event_type: str) -> list[dict]:
            return [data for kind, data in self.fired if kind == event_type]

        def async_listen(self, event_type, listener, *_args, **_kwargs):
            entry = (event_type, listener)
            self.listeners.append(entry)

            def _remove() -> None:
                if entry in self.listeners:
                    self.listeners.remove(entry)
                else:
                    self.unknown_removals.append(event_type)

            return _remove

        # HA's one-shot listener removes itself once fired; nothing offline
        # fires through the bus, so recording it is the whole behaviour.
        async_listen_once = async_listen

        def listeners_for(self, event_type: str) -> list[object]:
            return [listener for kind, listener in self.listeners if kind == event_type]

    class _State:  # type: ignore[override]
        """The three fields anything offline reads off a state object.

        `attributes` carries `supported_features`, which is how the to-do bridge
        asks whether a list can delete its own lines — the same place Home
        Assistant reads it from before refusing the service.
        """

        def __init__(self, entity_id: str, state: str, attributes: dict | None = None) -> None:
            self.entity_id = entity_id
            self.state = state
            self.attributes = dict(attributes or {})

    class _States:  # type: ignore[override]
        """Stand in for HA's state machine, for the reads only.

        The to-do bridge asks whether the list it was pointed at is there and
        answering before it writes to it, so a test has to be able to say that
        it is not. Nothing offline sets state through this — the integration
        publishes state through entity platforms, which the offline suite does
        not run.
        """

        def __init__(self) -> None:
            self._states: dict[str, _State] = {}

        def get(self, entity_id: str):
            return self._states.get(entity_id)

        def async_set(self, entity_id: str, state: str, attributes=None, *_args, **_kwargs) -> None:
            self._states[entity_id] = _State(entity_id, state, attributes)

        def async_remove(self, entity_id: str) -> None:
            self._states.pop(entity_id, None)

    class _ConfigEntries:
        """Stand in for HA's config-entry registry, for the one lookup we do.

        Only `async_entries(domain)` — which is all `runtime.find_entry` calls,
        and which real HA answers including disabled and ignored entries.
        """

        def __init__(self) -> None:
            self._entries: list = []
            self.updates: list[dict] = []

        def async_entries(self, domain=None):
            if domain is None:
                return list(self._entries)
            return [e for e in self._entries if getattr(e, "domain", None) == domain]

        def add(self, entry) -> None:
            # Idempotent: single-instance means a reload sets the *same* entry
            # up again, and real HA keeps one registration for it.
            if entry not in self._entries:
                self._entries.append(entry)

        def async_update_entry(self, entry, *, options=None, **_kwargs) -> None:
            """Write options back, as setup does when it spends the repair opt-in."""

            if options is not None:
                entry.options = dict(options)
                self.updates.append(dict(options))

        def remove(self, entry) -> None:
            if entry in self._entries:
                self._entries.remove(entry)

    class HomeAssistant:  # type: ignore[override]
        def __init__(self) -> None:
            self.data = {}
            self.config = _Config()
            self.bus = _Bus()
            self.states = _States()
            # HA's own "startup is over" flag. Offline there is no startup, so
            # it starts true — which is what every test but the ones about
            # deferring the bridge's first pass wants.
            self.is_running = True
            self.dispatcher_sends: list[tuple[str, tuple]] = []
            self.dispatcher_connects: list[tuple[str, object]] = []
            # Real HA holds an entry's runtime on the entry, and every read
            # resolves it through here. A test that wants a loaded HAventory
            # calls `install_runtime(hass)`, which registers one.
            self.config_entries = _ConfigEntries()

        def async_create_background_task(self, target, name, eager_start=True):
            """Stand in for HA's tracked-task helper; the real one also cancels on shutdown."""
            return asyncio.create_task(target, name=name)

        async def async_add_executor_job(self, target, *args):
            """Stand in for HA's executor offload; the real one uses HA's own thread pool.

            Running the callable on a genuine worker thread keeps the offline suite
            honest about what does and does not touch the event loop thread.
            """
            return await asyncio.get_running_loop().run_in_executor(None, target, *args)

    class ServiceCall:  # type: ignore[override]
        """Stand in for HA's service-call payload.

        Offline this is annotation-only — ``services.py`` imports the name and the
        offline tests invoke handlers directly — so only the read-only ``data``
        mapping is modelled, not HA's full constructor.
        """

        def __init__(self, data=None) -> None:
            self.data = types.MappingProxyType(dict(data or {}))

    class SupportsResponse(StrEnum):  # type: ignore[override]
        """Stand in for HA's service-response classification.

        ``services.py`` imports it at module scope and hands it to
        ``async_register``, which the offline stub does not have — the member
        identities are all the offline suite can see.
        """

        NONE = "none"
        OPTIONAL = "optional"
        ONLY = "only"

    ha_core.HomeAssistant = HomeAssistant
    ha_core.ServiceCall = ServiceCall
    ha_core.SupportsResponse = SupportsResponse
    sys.modules["homeassistant.core"] = ha_core

    # homeassistant.exceptions
    ha_exceptions = types.ModuleType("homeassistant.exceptions")

    class HomeAssistantError(Exception):  # type: ignore[override]
        pass

    class ConfigEntryNotReady(HomeAssistantError):  # type: ignore[override]
        pass

    class ConfigEntryError(HomeAssistantError):  # type: ignore[override]
        pass

    ha_exceptions.HomeAssistantError = HomeAssistantError
    ha_exceptions.ConfigEntryNotReady = ConfigEntryNotReady
    ha_exceptions.ConfigEntryError = ConfigEntryError
    sys.modules["homeassistant.exceptions"] = ha_exceptions

    # homeassistant.config_entries
    ha_config_entries = types.ModuleType("homeassistant.config_entries")

    class ConfigEntryState(Enum):  # type: ignore[override]
        LOADED = "loaded"
        SETUP_ERROR = "setup_error"
        MIGRATION_ERROR = "migration_error"
        SETUP_RETRY = "setup_retry"
        NOT_LOADED = "not_loaded"
        FAILED_UNLOAD = "failed_unload"
        SETUP_IN_PROGRESS = "setup_in_progress"
        UNLOAD_IN_PROGRESS = "unload_in_progress"

    class ConfigEntry:  # type: ignore[override]
        # Real HA's ConfigEntry is generic in its runtime type, and
        # `runtime.HAventoryConfigEntry` subscripts it. The alias is a PEP 695
        # `type` statement, so it is never evaluated at import — this keeps the
        # mistake impossible rather than merely unhit.
        def __class_getitem__(cls, _item):
            return cls

        def __init__(
            self,
            *,
            options: dict | None = None,
            entry_id: str = "haventory-test-entry",
            domain: str = "haventory",
            state=None,
            disabled_by=None,
        ) -> None:
            self.options: dict = dict(options or {})
            self.entry_id = entry_id
            self.domain = domain
            self.state = state if state is not None else ConfigEntryState.LOADED
            # Home Assistant sets this before it unloads, which is how an unload
            # that is a disable is told from one that is half of a reload.
            self.disabled_by = disabled_by
            self._update_listeners: list = []
            self._on_unload: list = []

        def add_update_listener(self, listener):
            self._update_listeners.append(listener)

            def _remove() -> None:
                if listener in self._update_listeners:
                    self._update_listeners.remove(listener)

            return _remove

        def async_on_unload(self, func):
            self._on_unload.append(func)
            return func

    class ConfigFlow:  # type: ignore[override]
        def __init_subclass__(cls, **kwargs):  # accept e.g. domain=...
            return

        # Minimal helpers to satisfy integration code if used in tests later
        def async_abort(self, *, reason: str):
            return {"type": "abort", "reason": reason}

        # `options` mirrors the real ConfigFlow.async_create_entry, which seeds
        # the entry's options at creation time and always puts them (empty when
        # unset) in the flow result.
        def async_create_entry(self, *, title: str, data: dict, options: dict | None = None):
            return {
                "type": "create_entry",
                "title": title,
                "data": data,
                "options": dict(options or {}),
            }

        def async_show_form(self, *, step_id: str, data_schema=None, description_placeholders=None):
            return {
                "type": "form",
                "step_id": step_id,
                "data_schema": data_schema,
                "description_placeholders": description_placeholders,
            }

    class OptionsFlow:  # type: ignore[override]
        # The real OptionsFlow resolves config_entry via hass; tests assign it.
        config_entry: ConfigEntry | None = None

        def async_create_entry(self, *, title: str, data: dict):
            return {"type": "create_entry", "title": title, "data": data}

        def async_show_form(self, *, step_id: str, data_schema=None, description_placeholders=None):
            return {
                "type": "form",
                "step_id": step_id,
                "data_schema": data_schema,
                "description_placeholders": description_placeholders,
            }

    ha_config_entries.ConfigEntry = ConfigEntry
    ha_config_entries.ConfigEntryState = ConfigEntryState
    ha_config_entries.ConfigFlow = ConfigFlow
    ha_config_entries.OptionsFlow = OptionsFlow
    sys.modules["homeassistant.config_entries"] = ha_config_entries

    # homeassistant.data_entry_flow
    ha_data_entry_flow = types.ModuleType("homeassistant.data_entry_flow")

    class FlowResult(dict):  # type: ignore[override]
        pass

    class section:  # type: ignore[override]
        """Voluptuous validator wrapping a nested schema, as HA's does.

        Real HA hands the second argument (``{"collapsed": ...}``) to the
        frontend only; validation is the inner schema's, unchanged.
        """

        def __init__(self, schema, options=None) -> None:  # type: ignore[no-untyped-def]
            self.schema = schema
            self.options = options or {}

        def __call__(self, value):  # type: ignore[no-untyped-def]
            return self.schema(value)

    sys.modules["homeassistant.data_entry_flow"] = ha_data_entry_flow
    ha_data_entry_flow.FlowResult = FlowResult
    ha_data_entry_flow.section = section

    # homeassistant.helpers and homeassistant.helpers.storage
    ha_helpers = types.ModuleType("homeassistant.helpers")
    sys.modules["homeassistant.helpers"] = ha_helpers

    ha_helpers_cv = types.ModuleType("homeassistant.helpers.config_validation")

    def empty_config_schema(_domain: str):  # type: ignore[override]
        return lambda cfg=None: {}

    def platform_only_config_schema(_domain: str):  # type: ignore[override]
        return lambda cfg=None: {}

    def config_entry_only_config_schema(_domain: str):  # type: ignore[override]
        return lambda cfg=None: {}

    ha_helpers_cv.empty_config_schema = empty_config_schema
    ha_helpers_cv.platform_only_config_schema = platform_only_config_schema
    ha_helpers_cv.config_entry_only_config_schema = config_entry_only_config_schema
    # Verbatim from HA's config_validation; the WebSocket base command schema
    # below validates every frame's `id` with it.
    ha_helpers_cv.positive_int = vol.All(vol.Coerce(int), vol.Range(min=0))
    sys.modules["homeassistant.helpers.config_validation"] = ha_helpers_cv

    # homeassistant.helpers.selector — only the select selector, which the
    # options flow uses for the quick-filter pills. Validation mirrors HA's:
    # nothing outside the offered options gets through, and a `multiple`
    # selector takes and returns a list.
    ha_helpers_selector = types.ModuleType("homeassistant.helpers.selector")

    class SelectSelectorMode(StrEnum):  # type: ignore[override]
        LIST = "list"
        DROPDOWN = "dropdown"

    # A TypedDict in HA, so it is called by name like a class.
    def SelectSelectorConfig(**kwargs):  # type: ignore[override]
        return dict(kwargs)

    class SelectSelector:  # type: ignore[override]
        def __init__(self, config) -> None:  # type: ignore[no-untyped-def]
            self.config = dict(config)

        def __call__(self, value):  # type: ignore[no-untyped-def]
            offered = [
                entry["value"] if isinstance(entry, dict) else entry
                for entry in self.config.get("options") or ()
            ]
            values = value if self.config.get("multiple") else [value]
            if not isinstance(values, list):
                raise vol.Invalid("expected a list")
            for entry in values:
                if entry not in offered:
                    raise vol.Invalid(f"{entry!r} is not one of {offered}")
            return list(values) if self.config.get("multiple") else value

    # A TypedDict in HA, like SelectSelectorConfig above.
    def EntitySelectorConfig(**kwargs):  # type: ignore[override]
        return dict(kwargs)

    # Ditto, and the nested one the entity picker's `filter` key takes.
    def EntityFilterSelectorConfig(**kwargs):  # type: ignore[override]
        return dict(kwargs)

    class EntitySelector:  # type: ignore[override]
        """Stand in for HA's entity picker, validating the domain it restricts to.

        Enough to hold the shopping-list field to `todo.*` entities: HA's own
        selector checks the entity id's shape and its domain, and the option is
        stored as whatever string comes back.
        """

        def __init__(self, config=None) -> None:  # type: ignore[no-untyped-def]
            self.config = dict(config or {})

        def __call__(self, value):  # type: ignore[no-untyped-def]
            if not isinstance(value, str) or value.count(".") != 1:
                raise vol.Invalid(f"{value!r} is not an entity id")
            domain = self.config.get("domain") or (self.config.get("filter") or {}).get("domain")
            if domain and value.split(".")[0] != domain:
                raise vol.Invalid(f"{value!r} is not in the {domain} domain")
            return value

    ha_helpers_selector.EntityFilterSelectorConfig = EntityFilterSelectorConfig
    ha_helpers_selector.EntitySelector = EntitySelector
    ha_helpers_selector.EntitySelectorConfig = EntitySelectorConfig
    ha_helpers_selector.SelectSelector = SelectSelector
    ha_helpers_selector.SelectSelectorConfig = SelectSelectorConfig
    ha_helpers_selector.SelectSelectorMode = SelectSelectorMode
    ha_helpers.selector = ha_helpers_selector
    sys.modules["homeassistant.helpers.selector"] = ha_helpers_selector

    ha_helpers_storage = types.ModuleType("homeassistant.helpers.storage")

    # Simple in-memory store keyed by storage key
    _IN_MEMORY_STORE: dict[str, object] = {}

    class Store:  # type: ignore[override]
        def __init__(self, _hass: HomeAssistant, _version: int, _key: str) -> None:
            self.version = _version
            self.key = _key

        async def async_load(self):
            return _IN_MEMORY_STORE.get(self.key)

        async def async_save(self, data):
            _IN_MEMORY_STORE[self.key] = data

        async def async_remove(self):
            """Delete the stored payload, as HA's `Store.async_remove` does.

            The backing dict is module-global and outlives a test, so a suite
            whose subject *loads* at setup needs a way to start from nothing.
            """
            _IN_MEMORY_STORE.pop(self.key, None)

    ha_helpers_storage.Store = Store
    sys.modules["homeassistant.helpers.storage"] = ha_helpers_storage

    # homeassistant.helpers.dispatcher — the signal the sensors repaint on.
    # Offline there is no entity platform to receive it, so the stub only has to
    # let `events.notify_mutation` run; `hass` records the sends for tests.
    ha_helpers_dispatcher = types.ModuleType("homeassistant.helpers.dispatcher")

    def async_dispatcher_send(hass, signal, *args):  # type: ignore[override]
        hass.dispatcher_sends.append((signal, args))

    def async_dispatcher_connect(hass, signal, target):  # type: ignore[override]
        hass.dispatcher_connects.append((signal, target))

        def _remove() -> None:
            hass.dispatcher_connects.remove((signal, target))

        return _remove

    ha_helpers_dispatcher.async_dispatcher_send = async_dispatcher_send
    ha_helpers_dispatcher.async_dispatcher_connect = async_dispatcher_connect
    ha_helpers.dispatcher = ha_helpers_dispatcher
    sys.modules["homeassistant.helpers.dispatcher"] = ha_helpers_dispatcher

    # homeassistant.util.dt — the household's own day, which is what every date a
    # user reads or writes is measured in. `DEFAULT_TIME_ZONE` is a module
    # attribute here exactly as it is in Home Assistant, so a test can move the
    # instance west of Greenwich and see what a household there would.
    ha_util = types.ModuleType("homeassistant.util")
    ha_util_dt = types.ModuleType("homeassistant.util.dt")
    ha_util_dt.DEFAULT_TIME_ZONE = datetime.UTC

    def _now(time_zone=None):  # type: ignore[no-untyped-def]
        return datetime.datetime.now(time_zone or ha_util_dt.DEFAULT_TIME_ZONE)

    def _utcnow():  # type: ignore[no-untyped-def]
        return datetime.datetime.now(datetime.UTC)

    def _as_local(value):  # type: ignore[no-untyped-def]
        return value.astimezone(ha_util_dt.DEFAULT_TIME_ZONE)

    ha_util_dt.now = _now
    ha_util_dt.utcnow = _utcnow
    ha_util_dt.as_local = _as_local
    ha_util.dt = ha_util_dt
    sys.modules["homeassistant.util"] = ha_util
    sys.modules["homeassistant.util.dt"] = ha_util_dt

    # homeassistant.components.websocket_api
    ha_components = types.ModuleType("homeassistant.components")
    sys.modules.setdefault("homeassistant.components", ha_components)

    ha_ws = types.ModuleType("homeassistant.components.websocket_api")

    # What real HA extends every dict command schema with before validating. Its
    # default PREVENT_EXTRA is what refuses a field the command never declared.
    BASE_COMMAND_MESSAGE_SCHEMA = vol.Schema({vol.Required("id"): ha_helpers_cv.positive_int})

    # The code HA answers with for a frame that never reaches a handler.
    ERR_INVALID_FORMAT = "invalid_format"

    # How many keys a frame for a type-only command may carry: `id` and `type`.
    TYPE_ONLY_FRAME_KEYS = 2

    def websocket_command(schema):  # type: ignore[override]
        """Tag a handler with its command name and compiled schema, as HA does.

        ``_ws_command`` carries the command string — the key real HA registers
        the handler under, and so the one a test looks a handler up by.
        ``_ws_schema`` carries what the connection applies to a frame before
        dispatch, with ``False`` standing for a schema that declares nothing but
        its ``type``: such a frame may carry no key beyond ``id`` and ``type``.
        """
        is_dict = isinstance(schema, dict)
        command = schema["type"] if is_dict else schema.validators[0].schema["type"]

        def decorator(func):
            if is_dict and len(schema) == 1:
                func._ws_schema = False
            elif is_dict:
                func._ws_schema = BASE_COMMAND_MESSAGE_SCHEMA.extend(schema)
            else:
                # vol.All: extend the leading mapping, keep the trailing
                # cross-field validators, which is where a cap or a
                # mutually-exclusive-fields refusal lives.
                func._ws_schema = vol.All(
                    schema.validators[0].extend(BASE_COMMAND_MESSAGE_SCHEMA.schema),
                    *schema.validators[1:],
                )
            func._ws_command = command
            return func

        return decorator

    def async_response(func):  # type: ignore[override]
        func._ws_async_response = True
        return func

    def result_message(_id: int, result=None):  # type: ignore[override]
        return {"id": _id, "type": "result", "success": True, "result": result}

    def error_message(_id: int, code: str, message: str, data: dict | None = None):  # type: ignore[override]
        error = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        return {"id": _id, "type": "result", "success": False, "error": error}

    def _validate_frame(handler, msg):
        """Apply what an ``ActiveConnection`` applies to a frame before dispatch.

        Returns ``(validated_msg, None)`` for a frame that would have reached the
        handler on a real connection, and ``(None, error_envelope)`` for one it
        would have refused — the handler body never runs for the latter. Without
        this the offline suite would let handlers see payloads no client can
        send, and any refusal expressed as a schema constraint would be invisible
        to it.
        """
        # HA checks id and type before it even looks the command up: an id that
        # is a positive int of exactly that type (so ``True`` is not an id), and
        # a non-empty string type.
        iden = msg.get("id") if isinstance(msg, dict) else None
        type_ = msg.get("type") if isinstance(msg, dict) else None
        if type(iden) is not int or iden <= 0 or type(type_) is not str or not type_:
            return None, error_message(iden, ERR_INVALID_FORMAT, "Message incorrectly formatted.")

        schema = handler._ws_schema
        try:
            if schema is False:
                if len(msg) > TYPE_ONLY_FRAME_KEYS:
                    raise vol.Invalid("extra keys not allowed")
                return msg, None
            return schema(msg), None
        except vol.Invalid as err:
            return None, error_message(iden, ERR_INVALID_FORMAT, humanize_error(msg, err))

    def async_register_command(hass: HomeAssistant, handler):  # type: ignore[override]
        registry = hass.data.setdefault("__ws_commands__", [])

        if not hasattr(handler, "_ws_schema"):
            # Real HA reads the same attributes off the handler and fails here
            # too. Refusing loudly keeps an undecorated handler from becoming the
            # one command in the suite that skips validation.
            raise ValueError("handler is not decorated with @websocket_command")

        async def _wrapped(hass: HomeAssistant, conn, msg):  # type: ignore[override]
            local_conn = conn
            stub = None
            if local_conn is None:

                class _StubConn:  # simple capture stub used in offline tests
                    def __init__(self) -> None:
                        self.last = None

                    def send_message(self, m):
                        self.last = m

                stub = _StubConn()
                local_conn = stub
            validated, refusal = _validate_frame(handler, msg)
            if refusal is not None:
                # HA answers a refused frame on the connection and stops there.
                send = getattr(local_conn, "send_message", None)
                if callable(send):
                    send(refusal)
                return refusal
            res = await handler(hass, local_conn, validated)
            if res is not None:
                return res
            # Prefer captured message from our stub, then from provided conn if it collects messages
            if stub is not None and getattr(stub, "last", None) is not None:
                return stub.last
            try:
                msgs = getattr(local_conn, "messages", None)
                if isinstance(msgs, list) and msgs:
                    return msgs[-1]
            except Exception:
                pass
            return None

        # Preserve HA websocket metadata so tests can discover handlers by command
        for attr in ("_ws_schema", "_ws_command", "_ws_async_response"):
            try:
                setattr(_wrapped, attr, getattr(handler, attr, None))
            except Exception:
                pass

        registry.append(_wrapped)

    ha_ws.BASE_COMMAND_MESSAGE_SCHEMA = BASE_COMMAND_MESSAGE_SCHEMA
    ha_ws.ERR_INVALID_FORMAT = ERR_INVALID_FORMAT
    ha_ws.websocket_command = websocket_command
    ha_ws.async_response = async_response
    ha_ws.result_message = result_message
    ha_ws.error_message = error_message
    ha_ws.async_register_command = async_register_command
    sys.modules["homeassistant.components.websocket_api"] = ha_ws

    # homeassistant.components.http
    ha_http = types.ModuleType("homeassistant.components.http")

    @dataclasses.dataclass
    class StaticPathConfig:  # type: ignore[override]
        """One entry of what ``hass.http.async_register_static_paths`` takes."""

        url_path: str
        path: str
        cache_headers: bool = True

    ha_http.StaticPathConfig = StaticPathConfig
    sys.modules["homeassistant.components.http"] = ha_http

    # homeassistant.components.frontend
    ha_frontend = types.ModuleType("homeassistant.components.frontend")

    DATA_EXTRA_MODULE_URL = "frontend_extra_module_url"

    class UrlManager:  # type: ignore[override]
        """The extra-module URL set the frontend keeps in ``hass.data``.

        Removal of a URL that is not registered is a no-op, as in real HA
        (which recomputes the frozenset by difference).
        """

        def __init__(self, urls: list[str] | None = None) -> None:
            self.urls: set[str] = set(urls or [])

        def add(self, url: str) -> None:
            self.urls.add(url)

        def remove(self, url: str) -> None:
            self.urls.discard(url)

    def add_extra_js_url(hass: HomeAssistant, url: str) -> None:  # type: ignore[override]
        """Register an extra frontend module URL.

        The manager is created by the frontend component's own setup, so this
        raises ``KeyError`` on a hass whose frontend never set up — exactly what
        a minimal harness looks like, and what callers have to survive.
        """
        hass.data[DATA_EXTRA_MODULE_URL].add(url)

    def remove_extra_js_url(hass: HomeAssistant, url: str) -> None:  # type: ignore[override]
        hass.data[DATA_EXTRA_MODULE_URL].remove(url)

    # The frontend's panel registry, keyed by URL path exactly as in real HA.
    DATA_PANELS = "frontend_panels"

    def async_remove_panel(  # type: ignore[override]
        hass: HomeAssistant, frontend_url_path: str, *, warn_if_unknown: bool = True
    ) -> None:
        """Drop a panel, tolerating one that was never registered.

        Real HA only logs a warning for an unknown path, so removal is never an
        error here either — which is what makes remove-before-register safe.
        """
        hass.data.setdefault(DATA_PANELS, {}).pop(frontend_url_path, None)

    ha_frontend.DATA_EXTRA_MODULE_URL = DATA_EXTRA_MODULE_URL
    ha_frontend.DATA_PANELS = DATA_PANELS
    ha_frontend.UrlManager = UrlManager
    ha_frontend.add_extra_js_url = add_extra_js_url
    ha_frontend.remove_extra_js_url = remove_extra_js_url
    ha_frontend.async_remove_panel = async_remove_panel
    sys.modules["homeassistant.components.frontend"] = ha_frontend

    # homeassistant.components.panel_custom
    ha_panel_custom = types.ModuleType("homeassistant.components.panel_custom")

    # PLR0913 and PLR0917 are separate rules and both fire here: HA takes these
    # positionally, so the stub cannot make them keyword-only without diverging.
    async def async_register_panel(  # type: ignore[override]  # noqa: PLR0913, PLR0917
        hass: HomeAssistant,
        frontend_url_path: str,
        webcomponent_name: str,
        sidebar_title: str | None = None,
        sidebar_icon: str | None = None,
        js_url: str | None = None,
        module_url: str | None = None,
        embed_iframe: bool = False,
        trust_external: bool = False,
        config: dict | None = None,
        require_admin: bool = False,
        config_panel_domain: str | None = None,
    ) -> None:
        """Register a custom panel the way HA's helper does.

        Reproduces the two behaviours callers have to live with: the panel is
        stored as a ``component_name="custom"`` entry whose config carries the
        ``_panel_custom`` block (module URL and element name included), and a
        second registration for a path already taken raises rather than
        replacing — the trap an idempotent registration exists to avoid.
        """
        if js_url is None and module_url is None:
            raise ValueError("Either js_url, module_url or html_url is required.")
        if config is not None and not isinstance(config, dict):
            raise ValueError("Config needs to be a dictionary.")

        custom: dict = {
            "name": webcomponent_name,
            "embed_iframe": embed_iframe,
            "trust_external": trust_external,
        }
        if js_url is not None:
            custom["js_url"] = js_url
        if module_url is not None:
            custom["module_url"] = module_url

        panel_config = dict(config or {})
        panel_config["_panel_custom"] = custom

        panels = hass.data.setdefault(DATA_PANELS, {})
        if frontend_url_path in panels:
            raise ValueError(f"Overwriting panel {frontend_url_path}")

        panels[frontend_url_path] = types.SimpleNamespace(
            component_name="custom",
            sidebar_title=sidebar_title,
            sidebar_icon=sidebar_icon,
            sidebar_default_visible=True,
            show_in_sidebar=True,
            frontend_url_path=frontend_url_path,
            config=panel_config,
            require_admin=require_admin,
            config_panel_domain=config_panel_domain,
        )
        # Every call, not just the ones that stick: a test asserting "registered
        # exactly once" needs the attempts, which the registry alone cannot show.
        hass.data.setdefault("__panel_registrations__", []).append(frontend_url_path)

    ha_panel_custom.async_register_panel = async_register_panel
    sys.modules["homeassistant.components.panel_custom"] = ha_panel_custom

    # homeassistant.helpers.area_registry
    ha_helpers_area_registry = types.ModuleType("homeassistant.helpers.area_registry")

    class _AreaRegistry:  # type: ignore[override]
        def __init__(self) -> None:
            self._areas: dict[str, object] = {}

        def _add(self, area_id: str, name: str):
            entry = types.SimpleNamespace(id=area_id, name=name)
            self._areas[area_id] = entry
            return entry

        def async_get_area(self, area_id: str):
            return self._areas.get(area_id)

        def async_get_area_by_name(self, name: str):
            for area in self._areas.values():
                if getattr(area, "name", None) == name:
                    return area
            return None

        def async_list_areas(self):
            return list(self._areas.values())

    async def async_get(hass: HomeAssistant):  # type: ignore[override]
        registry = hass.data.get("__area_registry__")
        if registry is None:
            registry = _AreaRegistry()
            hass.data["__area_registry__"] = registry
        return registry

    ha_helpers_area_registry.async_get = async_get
    sys.modules["homeassistant.helpers.area_registry"] = ha_helpers_area_registry

    # homeassistant.helpers.issue_registry — `__init__.py` imports it at module
    # scope to raise the setup refusals in Settings -> Repairs. The stub records
    # what was raised and cleared, keyed the way HA keys it, so an offline test
    # can assert both without a registry to read.
    ha_helpers_issue_registry = types.ModuleType("homeassistant.helpers.issue_registry")

    class IssueSeverity(StrEnum):  # type: ignore[override]
        CRITICAL = "critical"
        ERROR = "error"
        WARNING = "warning"

    def _issues(hass: HomeAssistant) -> dict:  # type: ignore[override]
        return hass.data.setdefault("__issue_registry__", {})

    def async_create_issue(  # type: ignore[override]
        hass: HomeAssistant, domain: str, issue_id: str, **kwargs
    ) -> None:
        _issues(hass)[(domain, issue_id)] = dict(kwargs)

    def async_delete_issue(hass: HomeAssistant, domain: str, issue_id: str) -> None:  # type: ignore[override]
        _issues(hass).pop((domain, issue_id), None)

    ha_helpers_issue_registry.IssueSeverity = IssueSeverity
    ha_helpers_issue_registry.async_create_issue = async_create_issue
    ha_helpers_issue_registry.async_delete_issue = async_delete_issue
    ha_helpers.issue_registry = ha_helpers_issue_registry
    sys.modules["homeassistant.helpers.issue_registry"] = ha_helpers_issue_registry

    # homeassistant.components.diagnostics — `diagnostics.py` imports the
    # redaction helper at module scope. Verbatim from HA's `diagnostics/util.py`
    # down to the two skips (a `None` and an empty string are left alone), so an
    # offline assertion about what the payload leaks means what it says.
    ha_diagnostics = types.ModuleType("homeassistant.components.diagnostics")
    REDACTED = "**REDACTED**"

    def async_redact_data(data, to_redact):  # type: ignore[override]
        if not isinstance(data, (Mapping, list)):
            return data
        if isinstance(data, list):
            return [async_redact_data(val, to_redact) for val in data]

        redacted = {**data}
        for key, value in redacted.items():
            if value is None:
                continue
            if isinstance(value, str) and not value:
                continue
            if key in to_redact:
                redacted[key] = REDACTED
            elif isinstance(value, Mapping):
                redacted[key] = async_redact_data(value, to_redact)
            elif isinstance(value, list):
                redacted[key] = [async_redact_data(item, to_redact) for item in value]
        return redacted

    ha_diagnostics.REDACTED = REDACTED
    ha_diagnostics.async_redact_data = async_redact_data
    sys.modules["homeassistant.components.diagnostics"] = ha_diagnostics

    # homeassistant.loader
    ha_loader = types.ModuleType("homeassistant.loader")

    _SHIPPED_MANIFEST = json.loads(
        (ROOT / "custom_components" / "haventory" / "manifest.json").read_text(encoding="utf-8")
    )

    class IntegrationNotFound(Exception):  # type: ignore[override]
        def __init__(self, domain: str) -> None:
            super().__init__(f"Integration '{domain}' not found.")
            self.domain = domain

    class Integration:  # type: ignore[override]
        def __init__(self, domain: str, manifest: dict) -> None:
            self.domain = domain
            self.manifest = manifest

    async def async_get_integration(hass: HomeAssistant, domain: str):  # type: ignore[override]
        """Hand back the manifest HA parsed at load time, doing no file I/O.

        Tests override per-hass through ``hass.data["__integration_manifests__"]``;
        mapping a domain to None makes the lookup raise, the way it does in real HA
        for an integration that is not installed.
        """
        overrides = getattr(hass, "data", None)
        if isinstance(overrides, dict) and domain in (
            overrides.get("__integration_manifests__") or {}
        ):
            manifest = overrides["__integration_manifests__"][domain]
        elif domain == _SHIPPED_MANIFEST.get("domain"):
            manifest = _SHIPPED_MANIFEST
        else:
            manifest = None

        if manifest is None:
            raise IntegrationNotFound(domain)
        return Integration(domain, manifest)

    ha_loader.IntegrationNotFound = IntegrationNotFound
    ha_loader.Integration = Integration
    ha_loader.async_get_integration = async_get_integration
    sys.modules["homeassistant.loader"] = ha_loader


if _INTEGRATION_MODE:
    # Integration mode: a real Home Assistant core (via phacc) drives the tests
    # and plugin autoload is enabled. Install no stubs and let
    # tests/integration/conftest.py handle the fixtures.
    pass
else:
    # Offline mode: stub Home Assistant.

    # Only load pytest-asyncio explicitly when plugin auto-loading is disabled.
    # This avoids duplicate plugin registration under VS Code/Cursor test discovery.
    if _AUTOLOAD_DISABLED:
        pytest_plugins = ("pytest_asyncio.plugin",)

    # Never collect the phacc-based integration suite in the offline run: it needs
    # the real Home Assistant core that the stubs below deliberately replace.
    collect_ignore = ["integration"]

    # Re-enable sockets if a plugin disabled them (e.g., pytest-socket via IDE)
    try:  # pragma: no cover - safety for IDE-driven runs
        from pytest_socket import enable_socket  # type: ignore

        enable_socket()
    except Exception:
        pass

    _install_offline_ha_stubs()

    # Pytest fixtures for testing

    # Import project storage module after HA stubs are installed
    import pytest
    from custom_components.haventory import storage as storage_mod

    @pytest.fixture
    def immediate_persist(monkeypatch):
        """Fixture that makes persistence immediate instead of debounced for faster tests."""
        # Replace async_request_persist with async_persist_repo to make it immediate
        monkeypatch.setattr(storage_mod, "async_request_persist", storage_mod.async_persist_repo)
