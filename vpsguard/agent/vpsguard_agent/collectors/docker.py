"""Docker collector: per-container resource usage and health.

Three ``docker`` invocations are needed (``ps``, ``stats``, ``inspect``), so the
result is cached for ``[agent] subprocess_refresh_seconds`` and reused by the
faster metric cycles.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from .base import FAST, BaseCollector

DOCKER_TIMEOUT = 20.0

_SIZE_PATTERN = re.compile(r"^\s*([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)\s*$")

#: Docker mixes SI units (network/block I/O) and binary units (memory).
_SIZE_UNITS = {
    "": 1.0,
    "b": 1.0,
    "kb": 1000.0,
    "mb": 1000.0**2,
    "gb": 1000.0**3,
    "tb": 1000.0**4,
    "kib": 1024.0,
    "mib": 1024.0**2,
    "gib": 1024.0**3,
    "tib": 1024.0**4,
    "k": 1000.0,
    "m": 1000.0**2,
    "g": 1000.0**3,
}

_INSPECT_FORMAT = (
    "{{.Id}}\t{{.State.StartedAt}}\t"
    "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}"
)


def parse_size(text: str) -> float:
    """Parse a Docker size string such as ``12.5MiB`` into bytes."""
    match = _SIZE_PATTERN.match(str(text or ""))
    if not match:
        return 0.0
    value, unit = match.groups()
    multiplier = _SIZE_UNITS.get(unit.lower())
    if multiplier is None:
        return 0.0
    return float(value) * multiplier


def parse_percent(text: str) -> float:
    """Parse a Docker percentage string such as ``3.45%``."""
    try:
        return round(float(str(text or "0").strip().rstrip("%") or 0.0), 2)
    except ValueError:
        return 0.0


def parse_pair(text: str) -> Tuple[float, float]:
    """Parse ``"1.2MiB / 3.4MiB"`` into a ``(first, second)`` byte tuple."""
    parts = str(text or "").split("/")
    if len(parts) != 2:
        return 0.0, 0.0
    return parse_size(parts[0]), parse_size(parts[1])


def parse_docker_timestamp(text: str) -> Optional[datetime]:
    """Parse Docker's RFC3339 timestamps (nanosecond precision included)."""
    raw = str(text or "").strip()
    if not raw or raw.startswith("0001-01-01"):
        return None
    raw = raw.replace("Z", "+00:00")
    # Python only understands up to microseconds; trim extra digits.
    match = re.match(r"^(.*\.\d{1,6})\d*([+-]\d{2}:\d{2})$", raw)
    if match:
        raw = match.group(1) + match.group(2)
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


class DockerCollector(BaseCollector):
    """Collect container statistics from the local Docker daemon."""

    name = "docker"
    tier = FAST
    required_tools = ("docker",)

    def __init__(self, config) -> None:  # type: ignore[no-untyped-def]
        super().__init__(config)
        self.min_interval = float(config.subprocess_refresh_seconds)

    def collect(self) -> Dict[str, Any]:
        containers = self._list_containers()
        if containers is None:
            return {}
        if not containers:
            return {"docker": []}

        stats = self._stats()
        details = self._inspect([entry["container_id"] for entry in containers])

        result: List[Dict[str, Any]] = []
        for entry in containers:
            full_id = entry["container_id"]
            short_id = full_id[:12]
            usage = stats.get(short_id) or stats.get(entry["name"]) or {}
            detail = details.get(full_id, {})
            merged = {
                "container_id": short_id,
                "name": entry["name"],
                "image": entry["image"],
                "cpu_percent": usage.get("cpu_percent", 0.0),
                "mem_percent": usage.get("mem_percent", 0.0),
                "mem_usage_mb": usage.get("mem_usage_mb", 0.0),
                "net_rx_mb": usage.get("net_rx_mb", 0.0),
                "net_tx_mb": usage.get("net_tx_mb", 0.0),
                "block_read_mb": usage.get("block_read_mb", 0.0),
                "block_write_mb": usage.get("block_write_mb", 0.0),
                "status": entry["status"],
                "health": detail.get("health", "none"),
                "uptime_seconds": detail.get("uptime_seconds", 0),
            }
            result.append(merged)

        result.sort(key=lambda item: item["cpu_percent"], reverse=True)
        return {"docker": result}

    # ------------------------------------------------------------------
    def _list_containers(self) -> Optional[List[Dict[str, str]]]:
        result = self.run(
            ["docker", "ps", "-a", "--no-trunc", "--format", "{{json .}}"],
            timeout=DOCKER_TIMEOUT,
        )
        if result.failed:
            self.warn_once(
                "docker_ps",
                "Cannot query the Docker daemon (exit %s): %s",
                result.exit_code,
                result.stderr.strip() or "no output",
            )
            return None

        containers: List[Dict[str, str]] = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except ValueError:
                self.log.debug("Skipping unparsable docker ps line: %s", line[:120])
                continue
            container_id = str(record.get("ID") or "")
            if not container_id:
                continue
            containers.append(
                {
                    "container_id": container_id,
                    "name": str(record.get("Names") or "").split(",")[0],
                    "image": str(record.get("Image") or ""),
                    "status": str(record.get("State") or record.get("Status") or "").lower(),
                }
            )
        return containers

    def _stats(self) -> Dict[str, Dict[str, Any]]:
        result = self.run(
            ["docker", "stats", "--no-stream", "--format", "{{json .}}"],
            timeout=DOCKER_TIMEOUT,
        )
        if result.failed:
            self.warn_once(
                "docker_stats",
                "docker stats failed (exit %s), reporting containers without usage: %s",
                result.exit_code,
                result.stderr.strip() or "no output",
            )
            return {}

        stats: Dict[str, Dict[str, Any]] = {}
        for line in result.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except ValueError:
                continue

            mem_used, _mem_limit = parse_pair(record.get("MemUsage"))
            net_rx, net_tx = parse_pair(record.get("NetIO"))
            block_read, block_write = parse_pair(record.get("BlockIO"))
            entry = {
                "cpu_percent": parse_percent(record.get("CPUPerc")),
                "mem_percent": parse_percent(record.get("MemPerc")),
                "mem_usage_mb": round(mem_used / (1024.0 * 1024.0), 2),
                "net_rx_mb": round(net_rx / (1024.0 * 1024.0), 2),
                "net_tx_mb": round(net_tx / (1024.0 * 1024.0), 2),
                "block_read_mb": round(block_read / (1024.0 * 1024.0), 2),
                "block_write_mb": round(block_write / (1024.0 * 1024.0), 2),
            }
            container_key = str(record.get("Container") or "")[:12]
            if container_key:
                stats[container_key] = entry
            name = str(record.get("Name") or "")
            if name:
                stats[name] = entry
        return stats

    def _inspect(self, container_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        if not container_ids:
            return {}
        result = self.run(
            ["docker", "inspect", "--format", _INSPECT_FORMAT] + container_ids,
            timeout=DOCKER_TIMEOUT,
        )
        if result.failed and not result.stdout.strip():
            self.log.debug("docker inspect failed: %s", result.stderr.strip())
            return {}

        now = datetime.now(timezone.utc)
        details: Dict[str, Dict[str, Any]] = {}
        for line in result.stdout.splitlines():
            parts = line.strip().split("\t")
            if len(parts) < 3:
                continue
            container_id, started_at, health = parts[0], parts[1], parts[2]
            started = parse_docker_timestamp(started_at)
            uptime = int(max(0.0, (now - started).total_seconds())) if started else 0
            details[container_id] = {
                "uptime_seconds": uptime,
                "health": (health or "none").strip().lower() or "none",
            }
        return details
