"""Payload assembly.

The builder owns the collector instances, keeps the slow-tier results in a
cache, and merges everything into the JSON document expected by
``POST /api/v1/ingest``.  Slow metrics are merged into *every* payload so each
packet the server receives is complete.
"""

from __future__ import annotations

import json
import os
import socket
import time
from typing import Any, Dict, List, Optional, Sequence

import psutil

from . import __version__
from .collectors import FAST, SLOW, BaseCollector, build_collectors
from .config import Config
from .logging_setup import get_logger

logger = get_logger("payload")


def read_server_id(path: str) -> Optional[str]:
    """Read the persisted server id, returning ``None`` when not yet assigned."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = handle.read().strip()
    except FileNotFoundError:
        return None
    except OSError as exc:
        logger.warning("Cannot read server id from %s: %s", path, exc)
        return None
    return value or None


def write_server_id(path: str, server_id: str) -> bool:
    """Persist the server id assigned by the central server."""
    try:
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(server_id.strip() + "\n")
        os.chmod(path, 0o600)
    except OSError as exc:
        logger.warning("Cannot persist server id to %s: %s", path, exc)
        return False
    return True


def uptime_seconds() -> int:
    """Return the host uptime in seconds."""
    try:
        return max(0, int(time.time() - psutil.boot_time()))
    except Exception as exc:  # noqa: BLE001 - boot time is unavailable in odd sandboxes
        logger.debug("Cannot determine uptime: %s", exc)
        return 0


class PayloadBuilder:
    """Assemble metric payloads from the enabled collectors."""

    def __init__(
        self,
        config: Config,
        collectors: Optional[Sequence[BaseCollector]] = None,
        hostname: Optional[str] = None,
    ) -> None:
        self.config = config
        self.collectors: List[BaseCollector] = list(
            collectors if collectors is not None else build_collectors(config)
        )
        self.fast_collectors = [c for c in self.collectors if c.tier == FAST]
        self.slow_collectors = [c for c in self.collectors if c.tier == SLOW]
        self.hostname = hostname or socket.gethostname()
        self.server_id: Optional[str] = read_server_id(config.server_id_path)
        self._slow_cache: Dict[str, Any] = {}
        self._slow_refreshed_at: Optional[float] = None

        if self.server_id:
            logger.info("Using persisted server_id %s", self.server_id)
        else:
            logger.info("No server_id yet, the central server will assign one on first contact")

    # ------------------------------------------------------------------
    # Server identity
    # ------------------------------------------------------------------
    def adopt_server_id(self, server_id: Optional[str]) -> bool:
        """Store a server id received from the central server.

        Returns:
            ``True`` when the id was new and has been persisted.
        """
        if not server_id or server_id == self.server_id:
            return False
        self.server_id = str(server_id)
        logger.info("Central server assigned server_id %s", self.server_id)
        write_server_id(self.config.server_id_path, self.server_id)
        return True

    # ------------------------------------------------------------------
    # Collection
    # ------------------------------------------------------------------
    def slow_due(self, now: Optional[float] = None) -> bool:
        """Return whether the slow tier should run again."""
        if self._slow_refreshed_at is None:
            return True
        current = now if now is not None else time.monotonic()
        return (current - self._slow_refreshed_at) >= self.config.slow_interval

    def refresh_slow(self) -> Dict[str, Any]:
        """Run the slow-tier collectors and refresh the cache."""
        if not self.slow_collectors:
            self._slow_refreshed_at = time.monotonic()
            self._slow_cache = {}
            return {}

        started = time.monotonic()
        merged: Dict[str, Any] = {}
        for collector in self.slow_collectors:
            merged.update(collector.safe_collect())
        self._slow_cache = merged
        self._slow_refreshed_at = time.monotonic()
        logger.debug(
            "Slow tier refreshed in %.0f ms (%d metric group(s))",
            (self._slow_refreshed_at - started) * 1000.0,
            len(merged),
        )
        return merged

    def collect_fast(self) -> Dict[str, Any]:
        """Run the fast-tier collectors."""
        merged: Dict[str, Any] = {}
        for collector in self.fast_collectors:
            merged.update(collector.safe_collect())
        return merged

    def build(self, refresh_slow: Optional[bool] = None) -> Dict[str, Any]:
        """Build a complete payload.

        Args:
            refresh_slow: Force (``True``) or skip (``False``) the slow tier.
                ``None`` refreshes only when ``slow_interval`` has elapsed.
        """
        should_refresh = self.slow_due() if refresh_slow is None else refresh_slow
        if should_refresh:
            self.refresh_slow()

        metrics: Dict[str, Any] = {}
        metrics.update(self.collect_fast())
        # Cached slow metrics are merged last so a stale value never overwrites
        # a fresh fast-tier reading of the same name.
        for key, value in self._slow_cache.items():
            metrics.setdefault(key, value)

        return {
            "api_key": self.config.api_key,
            "server_id": self.server_id,
            "hostname": self.hostname,
            "agent_version": __version__,
            "timestamp": int(time.time()),
            "uptime_seconds": uptime_seconds(),
            "metrics": metrics,
        }

    def build_json(self, refresh_slow: Optional[bool] = None, pretty: bool = False) -> str:
        """Build a payload and serialise it to JSON."""
        payload = self.build(refresh_slow=refresh_slow)
        return serialise(payload, pretty=pretty)


def serialise(payload: Dict[str, Any], pretty: bool = False) -> str:
    """Serialise a payload to JSON, keeping the output compact by default."""
    if pretty:
        return json.dumps(payload, indent=2, sort_keys=False, default=str)
    return json.dumps(payload, separators=(",", ":"), default=str)
