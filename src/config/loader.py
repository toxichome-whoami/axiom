import asyncio
import os
import sys
import tomllib
from typing import List, Optional

import structlog
from pydantic import ValidationError

from config.defaults import generate_default_config
from config.schema import AxiomConfig
from logger.setup import setup_logging

logger = structlog.get_logger()

HOT_RELOAD_CALLBACKS = []

_ENV = os.environ.get("AXIOM_ENV", "development")

# ─────────────────────────────────────────────────────────────────────────────
# Helper Procedures
# ─────────────────────────────────────────────────────────────────────────────


def _ensure_file_exists(path: str) -> None:
    """Forces generation of scaffolding structure natively if absent."""
    if not os.path.exists(path):
        logger.info("Config file not found, generating default.", path=path)
        generate_default_config(path)


def _resolve_config_paths(base_path: str) -> List[str]:
    paths = [base_path]
    env_path = base_path.replace(".toml", f".{_ENV}.toml")
    if os.path.exists(env_path):
        paths.append(env_path)
    return paths


def _parse_toml_file(path: str, exit_on_error: bool = True) -> dict:
    """Safely decodes raw disk bytes preventing corrupted config structures."""
    try:
        with open(path, "rb") as file:
            return tomllib.load(file)
    except tomllib.TOMLDecodeError as toml_error:
        if exit_on_error:
            logger.error("Failed to parse config.toml syntax", error=str(toml_error))
            sys.exit(1)
        raise toml_error


def _load_merged_config(paths: List[str], exit_on_error: bool = True) -> dict:
    """Load base config + environment override (latter wins)."""
    merged = {}
    for p in paths:
        data = _parse_toml_file(p, exit_on_error)
        merged.update(
            data
        )  # Simple merge; consider deep merge for dicts later if needed
    return merged


def _validate_schema(config_dict: dict, path: str) -> AxiomConfig:
    """Applies strict Pydantic parsing ensuring zero runtime mapping failures."""
    try:
        validated_config = AxiomConfig(**config_dict)
        logger.info("Config loaded successfully", path=path)
        return validated_config
    except ValidationError as strict_error:
        logger.error("Config schema validation failed", errors=strict_error.errors())
        sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# Core Loader Class
# ─────────────────────────────────────────────────────────────────────────────


class ConfigManager:
    """Acts as a global memory singleton holding validated configurations."""

    _instance = None
    _config: Optional[AxiomConfig] = None
    _config_path: str = ""

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConfigManager, cls).__new__(cls)
        return cls._instance

    @classmethod
    def load(cls, path: Optional[str] = None) -> AxiomConfig:
        """Hydrates the singleton from local variables sequentially."""
        if path is None:
            if len(sys.argv) > 1 and sys.argv[1] == "--config":
                path = sys.argv[2]
            else:
                path = "config.toml"

        cls._config_path = path

        _ensure_file_exists(path)
        paths = _resolve_config_paths(path)
        config_payload = _load_merged_config(paths)

        cls._config = _validate_schema(config_payload, path)

        # Call setup_logging automatically after config is successfully loaded
        try:
            setup_logging(cls._config.logging)
        except Exception:
            pass

        return cls._config

    @classmethod
    def get(cls) -> AxiomConfig:
        """Retrieves active schema implicitly boosting reliability on missed injects."""
        if cls._config is None:
            return cls.load()
        return cls._config

    @classmethod
    async def watch(cls, interval: int = 5):
        """Poll-based config watcher — no inotify, no thread panics."""
        if not cls._config_path:
            return

        logger.info("Starting config watcher daemon", path=cls._config_path)

        paths = _resolve_config_paths(cls._config_path)
        last_mtimes = {p: os.path.getmtime(p) for p in paths if os.path.exists(p)}

        try:
            while True:
                await asyncio.sleep(interval)
                changed = False
                for p in paths:
                    try:
                        current_mtime = os.path.getmtime(p)
                        if current_mtime != last_mtimes.get(p):
                            last_mtimes[p] = current_mtime
                            changed = True
                    except (OSError, FileNotFoundError):
                        pass

                if changed:
                    logger.info("Config file modification detected, refreshing")
                    await cls._handle_hot_reload()

        except asyncio.CancelledError:
            logger.info("Config watcher daemon stopped gracefully")

    @classmethod
    async def _handle_hot_reload(cls):
        """Attempts isolated validation bypass of new file state before replacing memory."""
        try:
            paths = _resolve_config_paths(cls._config_path)
            new_payload = await asyncio.to_thread(_load_merged_config, paths, False)
            new_validated = AxiomConfig(**new_payload)

            cls._config = new_validated

            # Refresh module-level feature flags in dependent modules
            for cb in HOT_RELOAD_CALLBACKS:
                try:
                    cb()
                except Exception:
                    pass

            # Call setup_logging automatically on hot reload
            try:
                setup_logging(cls._config.logging)
            except Exception:
                pass

            logger.info("Config hot-reloaded successfully on-the-fly")
        except Exception as runtime_error:
            logger.error(
                "Failed to hot-reload configuration file", error=str(runtime_error)
            )
