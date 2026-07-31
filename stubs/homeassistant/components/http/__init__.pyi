from dataclasses import dataclass
from typing import Any

@dataclass
class StaticPathConfig:
    url_path: str
    path: str
    cache_headers: bool = True

def __getattr__(name: str) -> Any: ...
