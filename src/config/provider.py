"""
Configuration Provider with Dependency Injection support.

Modules receive config via constructor/function argument instead of
importing ConfigManager directly. This makes every module testable
with a mock config.
"""

from typing import Protocol

from config.loader import ConfigManager
from config.schema import AxiomConfig


class ConfigProvider(Protocol):
    """Interface for config injection."""

    def get_config(self) -> AxiomConfig: ...


class GlobalConfigProvider:
    """Default provider — wraps the existing singleton for backward compat."""

    def get_config(self) -> AxiomConfig:
        return ConfigManager.get()


async def get_config_dependency() -> AxiomConfig:
    """FastAPI dependency to inject config into route handlers."""
    return ConfigManager.get()
