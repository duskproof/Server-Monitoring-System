"""Network collector: per-interface counters, derived speeds, socket states."""

from __future__ import annotations

import time
from typing import Any, Dict, Tuple

import psutil

from .base import FAST, BaseCollector, rate_per_second

#: Interfaces that carry no external traffic and only add payload noise.
IGNORED_PREFIXES = ("lo", "docker", "br-", "veth", "virbr", "cni", "flannel", "kube-ipvs")


class NetworkCollector(BaseCollector):
    """Collect interface traffic counters and TCP connection state counts."""

    name = "network"
    tier = FAST

    def __init__(self, config) -> None:  # type: ignore[no-untyped-def]
        super().__init__(config)
        # interface -> (rx_bytes, tx_bytes, monotonic timestamp)
        self._prev: Dict[str, Tuple[int, int, float]] = {}

    def collect(self) -> Dict[str, Any]:
        fragment: Dict[str, Any] = {}

        interfaces = self._interfaces()
        if interfaces:
            fragment["network"] = interfaces

        connections = self._connections()
        if connections is not None:
            fragment["connections"] = connections

        return fragment

    # ------------------------------------------------------------------
    def _interfaces(self) -> Dict[str, Dict[str, Any]]:
        try:
            counters = psutil.net_io_counters(pernic=True) or {}
        except Exception as exc:  # noqa: BLE001
            self.warn_once("net_io", "Network counters unavailable: %s", exc)
            return {}

        now = time.monotonic()
        result: Dict[str, Dict[str, Any]] = {}
        for name, stats in counters.items():
            if self._is_ignored(name):
                continue

            rx_bytes = int(stats.bytes_recv)
            tx_bytes = int(stats.bytes_sent)
            previous = self._prev.get(name)
            self._prev[name] = (rx_bytes, tx_bytes, now)

            rx_speed = 0.0
            tx_speed = 0.0
            if previous is not None:
                elapsed = now - previous[2]
                rx_speed = rate_per_second(rx_bytes, previous[0], elapsed)
                tx_speed = rate_per_second(tx_bytes, previous[1], elapsed)

            result[name] = {
                "rx_bytes": rx_bytes,
                "tx_bytes": tx_bytes,
                "rx_packets": int(stats.packets_recv),
                "tx_packets": int(stats.packets_sent),
                "rx_errors": int(getattr(stats, "errin", 0) or 0),
                "tx_errors": int(getattr(stats, "errout", 0) or 0),
                "rx_dropped": int(getattr(stats, "dropin", 0) or 0),
                "tx_dropped": int(getattr(stats, "dropout", 0) or 0),
                "rx_speed_bps": rx_speed,
                "tx_speed_bps": tx_speed,
            }
        return result

    @staticmethod
    def _is_ignored(name: str) -> bool:
        lowered = name.lower()
        if lowered == "lo":
            return True
        return lowered.startswith(IGNORED_PREFIXES) and not lowered.startswith("loop")

    def _connections(self):
        try:
            connections = psutil.net_connections(kind="inet")
        except (psutil.AccessDenied, PermissionError) as exc:
            self.warn_once(
                "connections_denied",
                "Connection table requires more privileges (%s), omitting connection counts",
                exc,
            )
            return None
        except Exception as exc:  # noqa: BLE001
            self.warn_once("connections", "Connection table unavailable: %s", exc)
            return None

        counts = {"established": 0, "listen": 0, "time_wait": 0, "total": 0}
        for connection in connections:
            counts["total"] += 1
            status = (connection.status or "").upper()
            if status == "ESTABLISHED":
                counts["established"] += 1
            elif status == "LISTEN":
                counts["listen"] += 1
            elif status == "TIME_WAIT":
                counts["time_wait"] += 1
        return counts
