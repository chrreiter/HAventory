"""Minimal Home Assistant stubs for offline type checking.

Only the three names the integration reads. `DEFAULT_TIME_ZONE` is a module
attribute in Home Assistant too, and a test that moves the instance's zone
rebinds it, so it is typed here rather than hidden behind a getter.
"""

from datetime import datetime, tzinfo

DEFAULT_TIME_ZONE: tzinfo

def now(time_zone: tzinfo | None = None) -> datetime: ...
def utcnow() -> datetime: ...
def as_local(value: datetime) -> datetime: ...
