"""Offline smoke test: ensure stubs load and basic constants exist."""

import importlib


def test_smoke_imports() -> None:
    """Load integration modules without errors."""
    importlib.import_module("custom_components.haventory.__init__")
    importlib.import_module("custom_components.haventory.config_flow")
