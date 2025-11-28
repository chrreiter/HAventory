r"""Backend stress test for HAventory persistence and concurrency fixes.

This script validates the debounced persistence, concurrent operation handling,
and bulk operation reliability in a Docker-based Home Assistant backend.

Usage (PowerShell):
    $env:HA_CONTAINER = 'home-assistant'
    $env:HA_BASE_URL = 'http://localhost:8123'
    $env:HA_TOKEN = '<your-long-lived-token>'
    python .\scripts\stress_test.py

Options:
    --skip-deploy    Skip deployment step (code already deployed)
    --no-cleanup     Keep test data for manual inspection
    --verbose        Show detailed log output
    --skip-confirm   Skip user confirmation prompt (for CI)

Environment variables:
    HA_CONTAINER: Docker container name (required)
    HA_BASE_URL: Home Assistant base URL (default: http://localhost:8123)
    HA_TOKEN: Long-lived access token (required)
"""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import subprocess
import sys
import threading
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from itertools import count
from typing import Any

import aiohttp

# -----------------------------------------------------------------------------
# Constants
# -----------------------------------------------------------------------------

STRESS_TEST_PREFIX = "stress_test_"
DEBOUNCE_DELAY_S = 1.0
CONNECT_TIMEOUT_S = 10.0
RECV_TIMEOUT_S = 30.0
RESTART_POLL_INTERVAL_S = 2.0
RESTART_MAX_WAIT_S = 60.0
INTEGRATION_INIT_WAIT_S = 30.0

# Test scenario constants
MAX_PERSIST_COMPLETES = 3  # Expected max persists for debounce test
BURST_TIMEOUT_S = 10.0  # Max time for concurrent burst
WORKLOAD_TIMEOUT_S = 15.0  # Max time for mixed workload
MAX_WORKLOAD_PERSISTS = 20  # Max persists for mixed workload
SUCCESS_TOLERANCE = 10  # Tolerance for bulk operation success count
CHECK_IO_PROBABILITY = 0.5  # Probability of check-out vs check-in

# Operation distribution for mixed workload (per user, 20 ops total)
OP_CREATE_END = 8  # ops 0-7: create
OP_UPDATE_END = 12  # ops 8-11: update
OP_DELETE_END = 14  # ops 12-13: delete
OP_ADJUST_END = 17  # ops 14-16: adjust_qty
# ops 17-19: check_io

# Bulk operation constants
BULK_CHECKOUT_LIMIT = 40  # Don't check out items that will be deleted

# ANSI color codes
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"


# -----------------------------------------------------------------------------
# Data classes
# -----------------------------------------------------------------------------


@dataclass
class LogMetrics:
    """Metrics collected from Docker log monitoring."""

    debounce_requests: int = 0
    debounce_cancels: int = 0
    persist_starts: int = 0
    persist_completes: int = 0
    persist_failures: int = 0
    bulk_op_failures: int = 0
    persist_timestamps: list[tuple[str, float]] = field(default_factory=list)

    def reset(self) -> None:
        self.debounce_requests = 0
        self.debounce_cancels = 0
        self.persist_starts = 0
        self.persist_completes = 0
        self.persist_failures = 0
        self.bulk_op_failures = 0
        self.persist_timestamps.clear()


@dataclass
class ScenarioResult:
    """Result of a single test scenario."""

    name: str
    passed: bool
    duration_s: float
    details: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


# -----------------------------------------------------------------------------
# Utilities
# -----------------------------------------------------------------------------


def _ws_url_from_base(base_url: str) -> str:
    """Convert an HTTP(S) base URL to a WS(S) endpoint."""
    base_url = base_url.rstrip("/")
    if base_url.startswith("https://"):
        return f"wss://{base_url[len('https://') :]}/api/websocket"
    if base_url.startswith("http://"):
        return f"ws://{base_url[len('http://') :]}/api/websocket"
    return f"ws://{base_url}/api/websocket"


def print_status(msg: str, status: str = "info") -> None:
    """Print a status message with color coding."""
    # Use ASCII-safe symbols for Windows compatibility
    if status == "pass":
        print(f"{GREEN}[OK] {msg}{RESET}")
    elif status == "fail":
        print(f"{RED}[FAIL] {msg}{RESET}")
    elif status == "warn":
        print(f"{YELLOW}[WARN] {msg}{RESET}")
    elif status == "info":
        print(f"{CYAN}[INFO] {msg}{RESET}")
    elif status == "header":
        print(f"\n{BOLD}{CYAN}{'=' * 60}{RESET}")
        print(f"{BOLD}{CYAN}{msg}{RESET}")
        print(f"{BOLD}{CYAN}{'=' * 60}{RESET}")
    else:
        print(msg)


def print_progress(current: int, total: int, prefix: str = "") -> None:
    """Print inline progress indicator."""
    pct = int(100 * current / total) if total > 0 else 0
    bar_len = 30
    filled = int(bar_len * current / total) if total > 0 else 0
    # Use ASCII-safe characters for Windows compatibility
    bar = "#" * filled + "-" * (bar_len - filled)
    print(f"\r{prefix}[{bar}] {current}/{total} ({pct}%)", end="", flush=True)


# -----------------------------------------------------------------------------
# Docker log monitoring
# -----------------------------------------------------------------------------


class DockerLogMonitor:
    """Monitor Docker container logs for persistence events."""

    def __init__(self, container_name: str, verbose: bool = False):
        self.container_name = container_name
        self.verbose = verbose
        self.metrics = LogMetrics()
        self._process: subprocess.Popen | None = None
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

    def start(self) -> None:
        """Start monitoring Docker logs in a background thread."""
        self._stop_event.clear()
        self.metrics.reset()

        # Start docker logs with --follow and --tail 0 to only get new logs
        # S603/S607: subprocess with trusted input (container name from env var)
        self._process = subprocess.Popen(  # noqa: S603
            ["docker", "logs", "-f", "--tail", "0", self.container_name],  # noqa: S607
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        self._thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._thread.start()

    def stop(self) -> LogMetrics:
        """Stop monitoring and return collected metrics."""
        self._stop_event.set()
        if self._process:
            self._process.terminate()
            try:
                self._process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self._process.kill()
            self._process = None
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

        with self._lock:
            return LogMetrics(
                debounce_requests=self.metrics.debounce_requests,
                debounce_cancels=self.metrics.debounce_cancels,
                persist_starts=self.metrics.persist_starts,
                persist_completes=self.metrics.persist_completes,
                persist_failures=self.metrics.persist_failures,
                bulk_op_failures=self.metrics.bulk_op_failures,
                persist_timestamps=list(self.metrics.persist_timestamps),
            )

    def _monitor_loop(self) -> None:
        """Background thread that reads and parses log lines."""
        if not self._process or not self._process.stdout:
            return

        for line in self._process.stdout:
            if self._stop_event.is_set():
                break
            self._parse_line(line.strip())

    def _parse_line(self, line: str) -> None:
        """Parse a log line and update metrics."""
        if self.verbose and "haventory" in line.lower():
            print(f"  {YELLOW}[LOG]{RESET} {line}")

        ts = time.time()

        with self._lock:
            if "Persist requested, debouncing" in line:
                self.metrics.debounce_requests += 1
            elif "Cancelled pending persist task" in line:
                self.metrics.debounce_cancels += 1
            elif "Persisting repository state" in line or "persist_start" in line:
                self.metrics.persist_starts += 1
                self.metrics.persist_timestamps.append(("start", ts))
            elif "Repository persisted successfully" in line or "persist_complete" in line:
                self.metrics.persist_completes += 1
                self.metrics.persist_timestamps.append(("complete", ts))
            elif "Failed to persist repository" in line or "persist_failed" in line:
                self.metrics.persist_failures += 1
            elif "Bulk operation failed" in line:
                self.metrics.bulk_op_failures += 1


# -----------------------------------------------------------------------------
# WebSocket client
# -----------------------------------------------------------------------------


class HAWebSocketClient:
    """WebSocket client for Home Assistant."""

    def __init__(self, base_url: str, token: str):
        self.base_url = base_url
        self.token = token
        self.ws_url = _ws_url_from_base(base_url)
        self._session: aiohttp.ClientSession | None = None
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._id_counter = count(start=1)
        self._connected = False

    async def connect(self) -> bool:
        """Establish WebSocket connection and authenticate."""
        try:
            self._session = aiohttp.ClientSession()
            timeout = aiohttp.ClientTimeout(total=CONNECT_TIMEOUT_S)
            self._ws = await self._session.ws_connect(self.ws_url, timeout=timeout)

            # Receive hello
            await asyncio.wait_for(self._ws.receive_json(), timeout=RECV_TIMEOUT_S)

            # Authenticate
            await self._ws.send_json({"type": "auth", "access_token": self.token})
            auth_result = await asyncio.wait_for(self._ws.receive_json(), timeout=RECV_TIMEOUT_S)

            if auth_result.get("type") == "auth_ok":
                self._connected = True
                return True
            return False
        except Exception as e:
            print_status(f"WebSocket connection failed: {e}", "fail")
            return False

    async def disconnect(self) -> None:
        """Close WebSocket connection."""
        self._connected = False
        if self._ws:
            await self._ws.close()
            self._ws = None
        if self._session:
            await self._session.close()
            self._session = None

    async def send(self, msg_type: str, **payload: Any) -> dict[str, Any]:
        """Send a WebSocket message and wait for result."""
        if not self._ws or not self._connected:
            raise RuntimeError("WebSocket not connected")

        msg_id = next(self._id_counter)
        msg = {"id": msg_id, "type": msg_type, **payload}
        await self._ws.send_json(msg)

        # Wait for matching result
        while True:
            response = await asyncio.wait_for(self._ws.receive_json(), timeout=RECV_TIMEOUT_S)
            if response.get("id") == msg_id and response.get("type") == "result":
                return response
            # Skip event messages
            if response.get("type") == "event":
                continue

        return response

    async def send_no_wait(self, msg_type: str, **payload: Any) -> int:
        """Send a WebSocket message without waiting for result. Returns msg_id."""
        if not self._ws or not self._connected:
            raise RuntimeError("WebSocket not connected")

        msg_id = next(self._id_counter)
        msg = {"id": msg_id, "type": msg_type, **payload}
        await self._ws.send_json(msg)
        return msg_id

    async def receive_result(self, expected_id: int | None = None) -> dict[str, Any]:
        """Receive the next result message, optionally filtering by id."""
        if not self._ws or not self._connected:
            raise RuntimeError("WebSocket not connected")

        while True:
            response = await asyncio.wait_for(self._ws.receive_json(), timeout=RECV_TIMEOUT_S)
            if response.get("type") == "result":
                if expected_id is None or response.get("id") == expected_id:
                    return response
            # Skip event messages


# -----------------------------------------------------------------------------
# Pre-test setup
# -----------------------------------------------------------------------------


async def check_container_running(container_name: str) -> bool:
    """Check if Docker container is running."""
    try:
        # ASYNC221: Blocking subprocess is acceptable here (short-lived check)
        # S603/S607: subprocess with trusted input (container name from env var)
        result = subprocess.run(  # noqa: ASYNC221, S603
            ["docker", "inspect", "-f", "{{.State.Running}}", container_name],  # noqa: S607
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout.strip().lower() == "true"
    except Exception:
        return False


async def deploy_code(container_name: str) -> bool:
    """Deploy latest code to container using reload_addon.ps1."""
    print_status("Deploying latest code to container...", "info")
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        repo_root = os.path.dirname(script_dir)
        reload_script = os.path.join(repo_root, "scripts", "reload_addon.ps1")

        # ASYNC221: Blocking subprocess is acceptable here (deployment step)
        # S603/S607: subprocess with trusted input (known script path)
        result = subprocess.run(  # noqa: ASYNC221, S603
            [  # noqa: S607
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                reload_script,
                "-ContainerName",
                container_name,
                "-UseDevConfig:$true",
                "-TailLogs:$false",
                "-SleepSecondsAfterRestart",
                "8",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            print_status(f"Deployment failed: {result.stderr}", "fail")
            return False
        print_status("Code deployed successfully", "pass")
        return True
    except Exception as e:
        print_status(f"Deployment error: {e}", "fail")
        return False


async def get_haventory_state(client: HAWebSocketClient) -> dict[str, Any]:
    """Get current HAventory stats and generation."""
    stats_resp = await client.send("haventory/stats")
    if not stats_resp.get("success"):
        return {"error": "Failed to get stats"}

    # Get version/generation info
    version_resp = await client.send("haventory/version")
    if not version_resp.get("success"):
        return {"error": "Failed to get version"}

    stats = stats_resp.get("result", {})
    version_info = version_resp.get("result", {})

    # Get generation from health endpoint
    health_resp = await client.send("haventory/health")
    generation = 0
    if health_resp.get("success"):
        generation = health_resp.get("result", {}).get("generation", 0)

    return {
        "items_total": stats.get("items_total", 0),
        "locations_total": stats.get("locations_total", 0),
        "low_stock_count": stats.get("low_stock_count", 0),
        "checked_out_count": stats.get("checked_out_count", 0),
        "generation": generation,
        "version": version_info.get("version", "unknown"),
    }


async def seed_reference_data(client: HAWebSocketClient) -> tuple[list[str], list[str]]:
    """Seed baseline locations and items if repository is empty."""
    location_ids: list[str] = []
    item_ids: list[str] = []

    # Create 5 locations
    print_status("Seeding 5 baseline locations...", "info")
    for i in range(5):
        resp = await client.send(
            "haventory/location/create",
            name=f"{STRESS_TEST_PREFIX}location_{i}",
        )
        if resp.get("success"):
            loc_id = resp.get("result", {}).get("id")
            if loc_id:
                location_ids.append(loc_id)

    # Create 10 items
    print_status("Seeding 10 baseline items...", "info")
    for i in range(10):
        loc_id = location_ids[i % len(location_ids)] if location_ids else None
        resp = await client.send(
            "haventory/item/create",
            name=f"{STRESS_TEST_PREFIX}item_{i}",
            quantity=10,
            location_id=loc_id,
        )
        if resp.get("success"):
            item_id = resp.get("result", {}).get("id")
            if item_id:
                item_ids.append(item_id)

    print_status(f"Seeded {len(location_ids)} locations and {len(item_ids)} items", "pass")
    return location_ids, item_ids


async def cleanup_test_data(client: HAWebSocketClient) -> int:
    """Delete all test data (items and locations with stress_test_ prefix)."""
    deleted = 0

    # Get all items and delete test ones
    items_resp = await client.send("haventory/item/list")
    if items_resp.get("success"):
        items = items_resp.get("result", {}).get("items", [])
        for item in items:
            if item.get("name", "").startswith(STRESS_TEST_PREFIX):
                del_resp = await client.send("haventory/item/delete", item_id=item["id"])
                if del_resp.get("success"):
                    deleted += 1

    # Get all locations and delete test ones
    # Note: location/list returns a flat list directly, not wrapped in {"locations": [...]}
    locs_resp = await client.send("haventory/location/list")
    if locs_resp.get("success"):
        result = locs_resp.get("result")
        # Handle both list (direct) and dict (wrapped) response formats
        if isinstance(result, list):
            locs = result
        elif isinstance(result, dict):
            locs = result.get("locations", [])
        else:
            locs = []
        for loc in locs:
            if isinstance(loc, dict) and loc.get("name", "").startswith(STRESS_TEST_PREFIX):
                del_resp = await client.send("haventory/location/delete", location_id=loc["id"])
                if del_resp.get("success"):
                    deleted += 1

    return deleted


# -----------------------------------------------------------------------------
# Test Scenarios
# -----------------------------------------------------------------------------


async def scenario_1_rapid_sequential(  # noqa: PLR0915
    client: HAWebSocketClient, log_monitor: DockerLogMonitor
) -> ScenarioResult:
    """Scenario 1: Rapid Sequential Mutations (Debounce Validation).

    Create 50 items with 10ms delay between requests to test debouncing.
    """
    print_status("Scenario 1: Rapid Sequential Mutations (Debounce Validation)", "header")
    start_time = time.time()
    errors: list[str] = []
    created_ids: list[str] = []

    # Get baseline generation
    state_before = await get_haventory_state(client)
    gen_before = state_before.get("generation", 0)
    print_status(f"Baseline generation: {gen_before}", "info")

    # Reset log metrics
    log_monitor.metrics.reset()

    # Create 50 items with 10ms delay
    num_items = 50
    print_status(f"Creating {num_items} items with 10ms delay between requests...", "info")

    for i in range(num_items):
        resp = await client.send(
            "haventory/item/create",
            name=f"{STRESS_TEST_PREFIX}rapid_{i}_{uuid.uuid4().hex[:6]}",
            quantity=1,
        )
        if resp.get("success"):
            item_id = resp.get("result", {}).get("id")
            if item_id:
                created_ids.append(item_id)
        else:
            errors.append(f"Item {i} creation failed: {resp.get('error', {}).get('message')}")
        print_progress(i + 1, num_items, "Creating items: ")
        await asyncio.sleep(0.01)  # 10ms delay

    print()  # New line after progress bar

    # Wait for debounce to complete
    print_status("Waiting for debounce delay (1.5s)...", "info")
    await asyncio.sleep(DEBOUNCE_DELAY_S + 0.5)

    # Get metrics
    metrics = log_monitor.stop()
    log_monitor.start()  # Restart for next scenario

    # Get final state
    state_after = await get_haventory_state(client)
    gen_after = state_after.get("generation", 0)

    # Verify all items exist
    items_resp = await client.send("haventory/item/list")
    existing_ids = set()
    if items_resp.get("success"):
        for item in items_resp.get("result", {}).get("items", []):
            existing_ids.add(item.get("id"))

    # Check criteria
    all_created = len(created_ids) == num_items
    gen_increment = gen_after - gen_before
    gen_correct = gen_increment == num_items
    all_retrievable = all(item_id in existing_ids for item_id in created_ids)
    few_persists = metrics.persist_completes <= MAX_PERSIST_COMPLETES

    duration = time.time() - start_time

    # Report results
    print_status(
        f"Items created: {len(created_ids)}/{num_items}", "pass" if all_created else "fail"
    )
    print_status(
        f"Generation increment: {gen_increment} (expected {num_items})",
        "pass" if gen_correct else "fail",
    )
    print_status(f"All items retrievable: {all_retrievable}", "pass" if all_retrievable else "fail")
    print_status(f"Debounce requests: {metrics.debounce_requests}", "info")
    print_status(f"Debounce cancels: {metrics.debounce_cancels}", "info")
    print_status(
        f"Actual persists: {metrics.persist_completes} (expected 1-3)",
        "pass" if few_persists else "warn",
    )

    if not all_created:
        errors.append(f"Only {len(created_ids)}/{num_items} items created")
    if not gen_correct:
        errors.append(f"Generation increment was {gen_increment}, expected {num_items}")
    if not all_retrievable:
        missing = [i for i in created_ids if i not in existing_ids]
        errors.append(f"Missing items: {missing[:5]}...")
    if not few_persists:
        errors.append(f"Too many persists: {metrics.persist_completes} (expected 1-3)")

    passed = all_created and gen_correct and all_retrievable and few_persists and not errors

    return ScenarioResult(
        name="Rapid Sequential Mutations",
        passed=passed,
        duration_s=duration,
        details={
            "items_created": len(created_ids),
            "generation_before": gen_before,
            "generation_after": gen_after,
            "debounce_requests": metrics.debounce_requests,
            "debounce_cancels": metrics.debounce_cancels,
            "persist_completes": metrics.persist_completes,
        },
        errors=errors,
    )


async def scenario_2_concurrent_burst(  # noqa: PLR0912, PLR0915
    client: HAWebSocketClient, log_monitor: DockerLogMonitor
) -> ScenarioResult:
    """Scenario 2: Concurrent Burst Operations (Lock Validation).

    Launch 20 concurrent item creation requests to test lock serialization.
    Uses fire-and-forget sends followed by batch receives to avoid concurrent receive() calls.
    """
    print_status("Scenario 2: Concurrent Burst Operations (Lock Validation)", "header")
    start_time = time.time()
    errors: list[str] = []

    # Get baseline
    state_before = await get_haventory_state(client)
    gen_before = state_before.get("generation", 0)
    print_status(f"Baseline generation: {gen_before}", "info")

    # Reset log metrics
    log_monitor.metrics.reset()

    # Create 20 concurrent requests using fire-and-forget pattern
    num_concurrent = 20
    print_status(f"Launching {num_concurrent} concurrent item creation requests...", "info")

    # Send all requests as fast as possible (fire-and-forget)
    op_start = time.time()
    sent_ids: list[int] = []
    for idx in range(num_concurrent):
        msg_id = await client.send_no_wait(
            "haventory/item/create",
            name=f"{STRESS_TEST_PREFIX}concurrent_{idx}_{uuid.uuid4().hex[:6]}",
            quantity=1,
        )
        sent_ids.append(msg_id)

    # Now collect all responses
    results: list[dict[str, Any]] = []
    received_ids: set[int] = set()
    while len(received_ids) < num_concurrent:
        try:
            response = await client.receive_result()
            msg_id = response.get("id")
            if msg_id in sent_ids and msg_id not in received_ids:
                received_ids.add(msg_id)
                results.append(response)
        except TimeoutError:
            break

    op_duration = time.time() - op_start

    # Wait for any pending persistence
    await asyncio.sleep(DEBOUNCE_DELAY_S + 0.5)

    # Get metrics
    metrics = log_monitor.stop()
    log_monitor.start()

    # Analyze results
    successes = 0
    created_ids: list[str] = []
    for i, result in enumerate(results):
        if isinstance(result, dict) and result.get("success"):
            successes += 1
            item_id = result.get("result", {}).get("id")
            if item_id:
                created_ids.append(item_id)
        elif isinstance(result, dict):
            errors.append(f"Item {i} failed: {result.get('error', {}).get('message', 'unknown')}")

    # Check if we got all responses
    if len(results) < num_concurrent:
        errors.append(f"Only received {len(results)}/{num_concurrent} responses")

    # Check for timeouts
    timeout_detected = op_duration > BURST_TIMEOUT_S

    # Get final state
    state_after = await get_haventory_state(client)
    gen_after = state_after.get("generation", 0)
    gen_increment = gen_after - gen_before

    # Check for duplicate IDs
    unique_ids = set(created_ids)
    duplicates = len(created_ids) - len(unique_ids)

    # Check persistence serialization
    serialized = True
    timestamps = metrics.persist_timestamps
    for i in range(len(timestamps) - 1):
        if timestamps[i][0] == "start" and timestamps[i + 1][0] == "start":
            serialized = False
            break

    duration = time.time() - start_time

    # Report results
    all_succeeded = successes == num_concurrent
    gen_correct = gen_increment == num_concurrent
    no_duplicates = duplicates == 0
    no_storage_errors = metrics.persist_failures == 0

    print_status(
        f"Operations succeeded: {successes}/{num_concurrent}", "pass" if all_succeeded else "fail"
    )
    print_status(
        f"Operation duration: {op_duration:.2f}s", "pass" if not timeout_detected else "fail"
    )
    print_status(
        f"Generation increment: {gen_increment} (expected {num_concurrent})",
        "pass" if gen_correct else "fail",
    )
    print_status(f"Duplicate IDs: {duplicates}", "pass" if no_duplicates else "fail")
    print_status(
        f"Storage errors: {metrics.persist_failures}", "pass" if no_storage_errors else "fail"
    )
    print_status(f"Persistence serialized: {serialized}", "pass" if serialized else "warn")

    if not all_succeeded:
        errors.append(f"Only {successes}/{num_concurrent} operations succeeded")
    if timeout_detected:
        errors.append(f"Operation took {op_duration:.2f}s, possible deadlock")
    if not gen_correct:
        errors.append(f"Generation increment was {gen_increment}, expected {num_concurrent}")
    if duplicates > 0:
        errors.append(f"Found {duplicates} duplicate item IDs")
    if not no_storage_errors:
        errors.append(f"Storage errors: {metrics.persist_failures}")

    passed = (
        all_succeeded
        and gen_correct
        and no_duplicates
        and no_storage_errors
        and not timeout_detected
    )

    return ScenarioResult(
        name="Concurrent Burst Operations",
        passed=passed,
        duration_s=duration,
        details={
            "successes": successes,
            "op_duration_s": op_duration,
            "generation_increment": gen_increment,
            "duplicates": duplicates,
            "storage_errors": metrics.persist_failures,
            "serialized": serialized,
        },
        errors=errors,
    )


async def scenario_3_bulk_operations(  # noqa: PLR0912, PLR0915
    client: HAWebSocketClient, log_monitor: DockerLogMonitor
) -> ScenarioResult:
    """Scenario 3: Bulk Operations Under Load.

    Send a bulk request with 100 mixed operations including intentional failures.
    """
    print_status("Scenario 3: Bulk Operations Under Load", "header")
    start_time = time.time()
    errors: list[str] = []

    # First create some items for update/delete/adjust operations
    print_status("Creating 50 items for bulk operations...", "info")
    setup_ids: list[str] = []
    for i in range(50):
        resp = await client.send(
            "haventory/item/create",
            name=f"{STRESS_TEST_PREFIX}bulk_setup_{i}_{uuid.uuid4().hex[:6]}",
            quantity=10,
        )
        if resp.get("success"):
            item_id = resp.get("result", {}).get("id")
            if item_id:
                setup_ids.append(item_id)
        print_progress(i + 1, 50, "Setup items: ")

    print()

    # Wait for persistence
    await asyncio.sleep(DEBOUNCE_DELAY_S + 0.5)

    # Get versions for conflict testing
    item_versions: dict[str, int] = {}
    for item_id in setup_ids[:20]:
        resp = await client.send("haventory/item/get", item_id=item_id)
        if resp.get("success"):
            item_versions[item_id] = resp.get("result", {}).get("version", 1)

    # Reset log metrics
    log_monitor.metrics.reset()

    # Build bulk operations
    operations: list[dict[str, Any]] = []
    op_id = 0

    # 40 item creates (all valid)
    for i in range(40):
        operations.append(
            {
                "op_id": f"create_{op_id}",
                "kind": "item_update",  # We'll use item_update with new items
                "payload": {
                    "item_id": setup_ids[i % len(setup_ids)] if setup_ids else str(uuid.uuid4()),
                    "name": f"{STRESS_TEST_PREFIX}bulk_created_{i}",
                },
            }
        )
        op_id += 1

    # 20 item updates (10 valid, 10 with invalid IDs)
    for i in range(10):
        if i < len(setup_ids):
            operations.append(
                {
                    "op_id": f"update_valid_{op_id}",
                    "kind": "item_update",
                    "payload": {"item_id": setup_ids[i], "quantity": 20},
                }
            )
        op_id += 1

    for _i in range(10):
        operations.append(
            {
                "op_id": f"update_invalid_{op_id}",
                "kind": "item_update",
                "payload": {"item_id": str(uuid.uuid4()), "quantity": 99},  # Invalid ID
            }
        )
        op_id += 1

    # 20 quantity adjustments (15 valid, 5 with version conflicts)
    for i in range(15):
        if i < len(setup_ids):
            operations.append(
                {
                    "op_id": f"adjust_valid_{op_id}",
                    "kind": "item_adjust_quantity",
                    "payload": {
                        "item_id": setup_ids[20 + i] if 20 + i < len(setup_ids) else setup_ids[i],
                        "delta": 5,
                    },
                }
            )
        op_id += 1

    for i in range(5):
        if i < len(setup_ids):
            operations.append(
                {
                    "op_id": f"adjust_conflict_{op_id}",
                    "kind": "item_adjust_quantity",
                    "payload": {
                        "item_id": setup_ids[i],
                        "delta": 1,
                        "expected_version": 999,  # Wrong version for conflict
                    },
                }
            )
        op_id += 1

    # 10 deletes (valid)
    for i in range(10):
        if 40 + i < len(setup_ids):
            operations.append(
                {
                    "op_id": f"delete_{op_id}",
                    "kind": "item_delete",
                    "payload": {"item_id": setup_ids[40 + i]},
                }
            )
        op_id += 1

    # 10 check-out operations (valid)
    for i in range(10):
        idx = 30 + i
        # Don't check out items that will be deleted (indices >= 40)
        if idx < len(setup_ids) and idx < BULK_CHECKOUT_LIMIT:
            operations.append(
                {
                    "op_id": f"checkout_{op_id}",
                    "kind": "item_check_out",
                    "payload": {"item_id": setup_ids[idx]},
                }
            )
        op_id += 1

    print_status(f"Sending bulk request with {len(operations)} operations...", "info")

    # Send bulk request
    bulk_resp = await client.send("haventory/items/bulk", operations=operations)

    # Wait for persistence
    await asyncio.sleep(DEBOUNCE_DELAY_S + 0.5)

    # Get metrics
    metrics = log_monitor.stop()
    log_monitor.start()

    # Analyze results
    results = bulk_resp.get("result", {}).get("results", {})
    successes = sum(1 for r in results.values() if r.get("success"))
    failures = sum(1 for r in results.values() if not r.get("success"))

    # Check error codes
    error_codes: dict[str, int] = defaultdict(int)
    for _op_id_key, r in results.items():
        if not r.get("success"):
            code = r.get("error", {}).get("code", "unknown")
            error_codes[code] += 1

    duration = time.time() - start_time

    # Expected: ~85 successes, ~15 failures
    expected_successes = 85
    expected_failures = 15
    success_in_range = abs(successes - expected_successes) <= SUCCESS_TOLERANCE
    has_all_op_ids = len(results) == len(operations)

    print_status(f"Total operations: {len(operations)}", "info")
    print_status(
        f"Successes: {successes} (expected ~{expected_successes})",
        "pass" if success_in_range else "warn",
    )
    print_status(f"Failures: {failures} (expected ~{expected_failures})", "info")
    print_status(f"All op_ids in results: {has_all_op_ids}", "pass" if has_all_op_ids else "fail")
    print_status(f"Error codes: {dict(error_codes)}", "info")
    print_status(f"Bulk failures logged: {metrics.bulk_op_failures}", "info")

    if not has_all_op_ids:
        errors.append(f"Missing op_ids in results: expected {len(operations)}, got {len(results)}")

    passed = has_all_op_ids and success_in_range

    return ScenarioResult(
        name="Bulk Operations Under Load",
        passed=passed,
        duration_s=duration,
        details={
            "total_operations": len(operations),
            "successes": successes,
            "failures": failures,
            "error_codes": dict(error_codes),
            "bulk_failures_logged": metrics.bulk_op_failures,
        },
        errors=errors,
    )


async def scenario_4_mixed_workload(  # noqa: PLR0912, PLR0915
    client: HAWebSocketClient, log_monitor: DockerLogMonitor
) -> ScenarioResult:
    """Scenario 4: Mixed Workload Stress Test.

    Simulates 5 users with 20 operations each, interleaved sequentially.
    Operations are shuffled to simulate realistic concurrent-like access patterns.
    """
    print_status("Scenario 4: Mixed Workload Stress Test", "header")
    start_time = time.time()
    errors: list[str] = []

    # Create some items for operations
    print_status("Creating 30 items for mixed workload...", "info")
    setup_ids: list[str] = []
    for i in range(30):
        resp = await client.send(
            "haventory/item/create",
            name=f"{STRESS_TEST_PREFIX}mixed_setup_{i}_{uuid.uuid4().hex[:6]}",
            quantity=10,
        )
        if resp.get("success"):
            item_id = resp.get("result", {}).get("id")
            if item_id:
                setup_ids.append(item_id)
        print_progress(i + 1, 30, "Setup items: ")

    print()
    await asyncio.sleep(DEBOUNCE_DELAY_S + 0.5)

    # Get baseline
    state_before = await get_haventory_state(client)
    gen_before = state_before.get("generation", 0)

    # Reset log metrics
    log_monitor.metrics.reset()

    # Track operations
    op_results: list[tuple[str, bool]] = []
    created_in_test: list[str] = []

    # Build operation queue for all 5 users (100 total ops)
    # Each user: 8 creates, 4 updates, 2 deletes, 3 qty adjustments, 3 check-in/out
    operations_queue: list[tuple[int, int, str]] = []  # (user_id, op_idx, op_type)
    for user_id in range(5):
        for op_idx in range(20):
            if op_idx < OP_CREATE_END:
                op_type = "create"
            elif op_idx < OP_UPDATE_END:
                op_type = "update"
            elif op_idx < OP_DELETE_END:
                op_type = "delete"
            elif op_idx < OP_ADJUST_END:
                op_type = "adjust_qty"
            else:
                op_type = "check_io"
            operations_queue.append((user_id, op_idx, op_type))

    # Shuffle to simulate interleaved access (S311: random is fine for test data)
    random.shuffle(operations_queue)

    print_status(f"Running {len(operations_queue)} interleaved operations...", "info")

    workload_start = time.time()

    for i, (user_id, op_idx, op_type) in enumerate(operations_queue):
        success = False
        try:
            # S311: random is fine for test data, not crypto
            if op_type == "create":
                resp = await client.send(
                    "haventory/item/create",
                    name=f"{STRESS_TEST_PREFIX}user{user_id}_op{op_idx}_{uuid.uuid4().hex[:6]}",
                    quantity=random.randint(1, 20),  # noqa: S311
                )
                success = resp.get("success", False)
                if success:
                    item_id = resp.get("result", {}).get("id")
                    if item_id:
                        created_in_test.append(item_id)

            elif op_type == "update":
                target_id = random.choice(setup_ids) if setup_ids else None  # noqa: S311
                if target_id:
                    resp = await client.send(
                        "haventory/item/update",
                        item_id=target_id,
                        quantity=random.randint(1, 50),  # noqa: S311
                    )
                    success = resp.get("success", False)

            elif op_type == "delete":
                # Delete from created_in_test if available
                if created_in_test:
                    target_id = created_in_test.pop()
                    resp = await client.send("haventory/item/delete", item_id=target_id)
                    success = resp.get("success", False)
                else:
                    success = True  # Skip if nothing to delete

            elif op_type == "adjust_qty":
                target_id = random.choice(setup_ids) if setup_ids else None  # noqa: S311
                if target_id:
                    resp = await client.send(
                        "haventory/item/adjust_quantity",
                        item_id=target_id,
                        delta=random.choice([-2, -1, 1, 2]),  # noqa: S311
                    )
                    success = resp.get("success", False)

            elif op_type == "check_io":
                target_id = random.choice(setup_ids) if setup_ids else None  # noqa: S311
                if target_id:
                    if random.random() < CHECK_IO_PROBABILITY:  # noqa: S311
                        resp = await client.send("haventory/item/check_out", item_id=target_id)
                    else:
                        resp = await client.send("haventory/item/check_in", item_id=target_id)
                    success = resp.get("success", False)

            op_results.append((f"user{user_id}_{op_type}_{op_idx}", success))

        except Exception as e:
            op_results.append((f"user{user_id}_{op_type}_{op_idx}", False))
            errors.append(f"User {user_id} op {op_idx} exception: {e}")

        # Small delay between operations (10-50ms) to simulate realistic timing
        await asyncio.sleep(random.uniform(0.01, 0.05))  # noqa: S311

        # Progress update every 10 ops
        if (i + 1) % 10 == 0:
            print_progress(i + 1, len(operations_queue), "Operations: ")

    print()
    workload_duration = time.time() - workload_start

    # Wait for persistence
    await asyncio.sleep(DEBOUNCE_DELAY_S + 0.5)

    # Get metrics
    metrics = log_monitor.stop()
    log_monitor.start()

    # Get final state
    state_after = await get_haventory_state(client)
    gen_after = state_after.get("generation", 0)
    gen_increment = gen_after - gen_before

    # Calculate results
    total_ops = len(op_results)
    successes = sum(1 for _, s in op_results if s)
    expected_ops = 100  # 5 users * 20 ops

    duration = time.time() - start_time

    # Check criteria
    completed_in_time = workload_duration < WORKLOAD_TIMEOUT_S
    all_completed = total_ops == expected_ops
    high_success_rate = successes >= expected_ops * 0.9  # Allow 10% failures
    no_storage_errors = metrics.persist_failures == 0
    reasonable_persists = metrics.persist_completes <= MAX_WORKLOAD_PERSISTS

    print_status(
        f"Workload duration: {workload_duration:.2f}s (limit: 15s)",
        "pass" if completed_in_time else "fail",
    )
    print_status(
        f"Operations completed: {total_ops}/{expected_ops}", "pass" if all_completed else "fail"
    )
    print_status(f"Successes: {successes}/{total_ops}", "pass" if high_success_rate else "warn")
    print_status(f"Generation increment: {gen_increment}", "info")
    print_status(
        f"Storage errors: {metrics.persist_failures}", "pass" if no_storage_errors else "fail"
    )
    print_status(
        f"Persist operations: {metrics.persist_completes} (limit: 20)",
        "pass" if reasonable_persists else "warn",
    )

    if not completed_in_time:
        errors.append(f"Workload took {workload_duration:.2f}s, possible deadlock")
    if not all_completed:
        errors.append(f"Only {total_ops}/{expected_ops} operations completed")
    if not no_storage_errors:
        errors.append(f"Storage errors: {metrics.persist_failures}")

    passed = completed_in_time and all_completed and high_success_rate and no_storage_errors

    return ScenarioResult(
        name="Mixed Workload Stress Test",
        passed=passed,
        duration_s=duration,
        details={
            "workload_duration_s": workload_duration,
            "total_operations": total_ops,
            "successes": successes,
            "generation_increment": gen_increment,
            "persist_completes": metrics.persist_completes,
            "storage_errors": metrics.persist_failures,
        },
        errors=errors,
    )


async def scenario_5_persistence_verification(  # noqa: PLR0912, PLR0915
    client: HAWebSocketClient, container_name: str
) -> ScenarioResult:
    """Scenario 5: Persistence Verification.

    Verify data survives container restart.
    """
    print_status("Scenario 5: Persistence Verification", "header")
    start_time = time.time()
    errors: list[str] = []

    # Get pre-restart state
    print_status("Capturing pre-restart state...", "info")
    state_before = await get_haventory_state(client)
    items_before = state_before.get("items_total", 0)
    gen_before = state_before.get("generation", 0)

    # Get sample items
    items_resp = await client.send("haventory/item/list")
    sample_items: list[dict[str, Any]] = []
    if items_resp.get("success"):
        all_items = items_resp.get("result", {}).get("items", [])
        # Take up to 3 random samples (S311: random is fine for test data)
        if all_items:
            sample_items = random.sample(all_items, min(3, len(all_items)))

    print_status(f"Pre-restart: {items_before} items, generation {gen_before}", "info")

    # Disconnect before restart
    await client.disconnect()

    # Restart container
    print_status(f"Restarting container '{container_name}'...", "info")
    try:
        # ASYNC221: Blocking subprocess is acceptable here (restart step)
        # S603/S607: subprocess with trusted input (container name from env var)
        result = subprocess.run(  # noqa: ASYNC221, S603
            ["docker", "restart", container_name],  # noqa: S607
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            errors.append(f"Container restart failed: {result.stderr}")
            return ScenarioResult(
                name="Persistence Verification",
                passed=False,
                duration_s=time.time() - start_time,
                errors=errors,
            )
    except Exception as e:
        errors.append(f"Container restart exception: {e}")
        return ScenarioResult(
            name="Persistence Verification",
            passed=False,
            duration_s=time.time() - start_time,
            errors=errors,
        )

    # Wait for HA to restart (poll WebSocket)
    print_status("Waiting for Home Assistant to restart...", "info")
    reconnected = False
    poll_start = time.time()

    while time.time() - poll_start < RESTART_MAX_WAIT_S:
        await asyncio.sleep(RESTART_POLL_INTERVAL_S)
        try:
            if await client.connect():
                reconnected = True
                break
        except Exception:  # noqa: S110 - expected during restart polling
            pass
        print_progress(
            int(time.time() - poll_start),
            int(RESTART_MAX_WAIT_S),
            "Waiting: ",
        )

    print()

    if not reconnected:
        errors.append(f"Failed to reconnect after {RESTART_MAX_WAIT_S}s")
        return ScenarioResult(
            name="Persistence Verification",
            passed=False,
            duration_s=time.time() - start_time,
            errors=errors,
        )

    print_status("Reconnected to Home Assistant", "pass")

    # Wait for HAventory integration to be fully loaded
    # The WebSocket connects before config entries are fully set up
    print_status("Waiting for HAventory integration to initialize...", "info")
    integration_ready = False
    init_start = time.time()

    while time.time() - init_start < INTEGRATION_INIT_WAIT_S:
        try:
            # Try to get stats - if it works, integration is ready
            test_state = await get_haventory_state(client)
            if test_state.get("items_total", 0) > 0 or "error" not in test_state:
                # Integration is responding and has data (or is empty but working)
                integration_ready = True
                break
        except Exception:  # noqa: S110 - expected during init polling
            pass
        await asyncio.sleep(2.0)
        print_progress(
            int(time.time() - init_start),
            int(INTEGRATION_INIT_WAIT_S),
            "Init wait: ",
        )

    print()

    if not integration_ready:
        errors.append("HAventory integration did not initialize after restart")
        return ScenarioResult(
            name="Persistence Verification",
            passed=False,
            duration_s=time.time() - start_time,
            errors=errors,
        )

    print_status("HAventory integration ready", "pass")

    # Additional stabilization delay to ensure storage is fully loaded
    await asyncio.sleep(3.0)

    # Get post-restart state
    print_status("Capturing post-restart state...", "info")
    state_after = await get_haventory_state(client)
    items_after = state_after.get("items_total", 0)
    gen_after = state_after.get("generation", 0)

    print_status(f"Post-restart: {items_after} items, generation {gen_after}", "info")

    # Verify sample items
    samples_match = True
    for sample in sample_items:
        sample_id = sample.get("id")
        if sample_id:
            resp = await client.send("haventory/item/get", item_id=sample_id)
            if resp.get("success"):
                retrieved = resp.get("result", {})
                if retrieved.get("name") != sample.get("name"):
                    samples_match = False
                    errors.append(f"Sample item {sample_id} name mismatch")
                if retrieved.get("quantity") != sample.get("quantity"):
                    samples_match = False
                    errors.append(f"Sample item {sample_id} quantity mismatch")
            else:
                samples_match = False
                errors.append(f"Sample item {sample_id} not found after restart")

    duration = time.time() - start_time

    # Check criteria
    items_match = items_before == items_after
    # Generation is expected to increment after load (repository.load_state increments it)
    # So we just verify it's >= the pre-restart value (data wasn't lost/reset)
    gen_preserved = gen_after >= gen_before

    print_status(f"Items match: {items_before} == {items_after}", "pass" if items_match else "fail")
    print_status(
        f"Generation preserved: {gen_after} >= {gen_before}", "pass" if gen_preserved else "fail"
    )
    print_status(f"Sample items verified: {len(sample_items)}", "pass" if samples_match else "fail")

    if not items_match:
        errors.append(f"Item count changed: {items_before} -> {items_after}")
    if not gen_preserved:
        errors.append(f"Generation reset: {gen_before} -> {gen_after}")

    passed = items_match and gen_preserved and samples_match

    return ScenarioResult(
        name="Persistence Verification",
        passed=passed,
        duration_s=duration,
        details={
            "items_before": items_before,
            "items_after": items_after,
            "generation_before": gen_before,
            "generation_after": gen_after,
            "samples_verified": len(sample_items),
        },
        errors=errors,
    )


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------


def print_summary(results: list[ScenarioResult]) -> None:
    """Print final summary table."""
    print_status("STRESS TEST SUMMARY", "header")

    total = len(results)
    passed = sum(1 for r in results if r.passed)

    print(f"\n{'Scenario':<40} {'Status':<10} {'Duration':<12}")
    print("-" * 62)

    for r in results:
        status = f"{GREEN}PASS{RESET}" if r.passed else f"{RED}FAIL{RESET}"
        print(f"{r.name:<40} {status:<20} {r.duration_s:.2f}s")
        if r.errors:
            for err in r.errors[:3]:  # Show first 3 errors
                print(f"  {RED}-> {err}{RESET}")

    print("-" * 62)
    overall = f"{GREEN}PASSED{RESET}" if passed == total else f"{RED}FAILED{RESET}"
    print(f"{'Overall':<40} {overall:<20} {passed}/{total} scenarios")


async def main() -> int:  # noqa: PLR0911, PLR0912, PLR0915
    parser = argparse.ArgumentParser(description="HAventory backend stress test")
    parser.add_argument("--skip-deploy", action="store_true", help="Skip deployment step")
    parser.add_argument("--no-cleanup", action="store_true", help="Keep test data")
    parser.add_argument("--verbose", action="store_true", help="Show detailed log output")
    parser.add_argument("--skip-confirm", action="store_true", help="Skip user confirmation")
    args = parser.parse_args()

    # Get environment variables
    container_name = os.environ.get("HA_CONTAINER")
    base_url = os.environ.get("HA_BASE_URL", "http://localhost:8123")
    token = os.environ.get("HA_TOKEN")

    if not container_name:
        print_status("Missing HA_CONTAINER environment variable", "fail")
        return 2
    if not token:
        print_status("Missing HA_TOKEN environment variable", "fail")
        return 2

    print_status("HAventory Backend Stress Test", "header")
    print_status(f"Container: {container_name}", "info")
    print_status(f"Base URL: {base_url}", "info")

    # Step 1: Deploy code
    if not args.skip_deploy:
        if not await deploy_code(container_name):
            return 2
    else:
        print_status("Skipping deployment (--skip-deploy)", "info")

    # Step 2: Verify container running
    if not await check_container_running(container_name):
        print_status(f"Container '{container_name}' is not running", "fail")
        return 2
    print_status("Container is running", "pass")

    # Step 3: Connect to WebSocket
    client = HAWebSocketClient(base_url, token)
    if not await client.connect():
        print_status("Failed to connect to Home Assistant WebSocket", "fail")
        return 2
    print_status("WebSocket connected and authenticated", "pass")

    # Step 4: Get current state
    state = await get_haventory_state(client)
    if "error" in state:
        print_status(f"Failed to get HAventory state: {state['error']}", "fail")
        await client.disconnect()
        return 2

    items_count = state["items_total"]
    locs_count = state["locations_total"]
    gen_count = state["generation"]
    print_status(
        f"Current state: {items_count} items, {locs_count} locations, gen={gen_count}", "info"
    )

    # Step 5: Seed data if needed
    if state["items_total"] == 0:
        await seed_reference_data(client)
        state = await get_haventory_state(client)

    # Step 6: User confirmation
    if not args.skip_confirm:
        print()
        print_status("Pre-test setup complete. Current state:", "info")
        print(f"  Items: {state['items_total']}")
        print(f"  Locations: {state['locations_total']}")
        print(f"  Generation: {state['generation']}")
        print(f"  Version: {state['version']}")
        print()
        confirm = input(f"{BOLD}Ready to start stress test? [y/N]: {RESET}").strip().lower()
        if confirm != "y":
            print_status("Stress test cancelled by user", "warn")
            await client.disconnect()
            return 0

    # Start Docker log monitoring
    log_monitor = DockerLogMonitor(container_name, verbose=args.verbose)
    log_monitor.start()

    # Run scenarios
    results: list[ScenarioResult] = []

    try:
        # Scenario 1: Rapid Sequential Mutations
        result1 = await scenario_1_rapid_sequential(client, log_monitor)
        results.append(result1)

        # Scenario 2: Concurrent Burst Operations
        result2 = await scenario_2_concurrent_burst(client, log_monitor)
        results.append(result2)

        # Scenario 3: Bulk Operations Under Load
        result3 = await scenario_3_bulk_operations(client, log_monitor)
        results.append(result3)

        # Scenario 4: Mixed Workload Stress Test
        result4 = await scenario_4_mixed_workload(client, log_monitor)
        results.append(result4)

        # Scenario 5: Persistence Verification
        result5 = await scenario_5_persistence_verification(client, container_name)
        results.append(result5)

    finally:
        log_monitor.stop()

    # Cleanup
    if not args.no_cleanup:
        print_status("Cleaning up test data...", "info")
        deleted = await cleanup_test_data(client)
        print_status(f"Deleted {deleted} test items/locations", "pass")

    await client.disconnect()

    # Print summary
    print_summary(results)

    # Return exit code
    all_passed = all(r.passed for r in results)
    return 0 if all_passed else 1


if __name__ == "__main__":
    try:
        code = asyncio.run(main())
    except KeyboardInterrupt:
        print_status("\nStress test interrupted by user", "warn")
        code = 130
    sys.exit(code)
