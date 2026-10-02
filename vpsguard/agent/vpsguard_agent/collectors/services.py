"""systemd service collector.

``systemctl`` is an external process, so results are cached for
``[agent] subprocess_refresh_seconds`` (60 s by default).  The collector still
belongs to the fast tier — every payload carries service state — but the fast
path itself stays free of process spawning most of the time.
"""

from __future__ import annotations

from typing import Any, Dict, List

from .base import FAST, BaseCollector

#: Upper bound on reported units, protecting the payload size on busy hosts.
MAX_SERVICES = 200

ENABLED_STATES = ("enabled", "enabled-runtime", "static", "generated", "alias")


class ServiceCollector(BaseCollector):
    """Report the state of loaded systemd service units."""

    name = "services"
    tier = FAST
    required_tools = ("systemctl",)

    def __init__(self, config) -> None:  # type: ignore[no-untyped-def]
        super().__init__(config)
        self.min_interval = float(config.subprocess_refresh_seconds)

    def collect(self) -> Dict[str, Any]:
        units = self.run(
            [
                "systemctl",
                "list-units",
                "--type=service",
                "--no-legend",
                "--no-pager",
                "--plain",
            ]
        )
        if units.failed:
            self.warn_once(
                "list_units",
                "systemctl list-units failed (exit %s): %s",
                units.exit_code,
                units.stderr.strip() or "no output",
            )
            return {}

        enabled_map = self._enabled_map()
        services: List[Dict[str, Any]] = []
        for line in units.stdout.splitlines():
            parsed = self._parse_unit_line(line)
            if parsed is None:
                continue
            parsed["enabled"] = enabled_map.get(parsed["name"], False)
            services.append(parsed)

        if not services:
            self.warn_once("no_units", "systemctl reported no service units")
            return {}

        # Surface problems first so truncation never hides a failed unit.
        services.sort(key=lambda item: (item["active"] != "failed", item["name"]))
        return {"services": services[:MAX_SERVICES]}

    # ------------------------------------------------------------------
    def _enabled_map(self) -> Dict[str, bool]:
        result = self.run(
            [
                "systemctl",
                "list-unit-files",
                "--type=service",
                "--no-legend",
                "--no-pager",
                "--plain",
            ]
        )
        if result.failed:
            self.log.debug("systemctl list-unit-files failed: %s", result.stderr.strip())
            return {}

        enabled: Dict[str, bool] = {}
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) < 2:
                continue
            enabled[parts[0]] = parts[1].lower() in ENABLED_STATES
        return enabled

    @staticmethod
    def _parse_unit_line(line: str) -> Dict[str, Any]:
        # Failed units are prefixed with a status bullet in some locales.
        cleaned = line.strip().lstrip("*\u25cf\u2718\u2192 ").strip()
        if not cleaned:
            return None  # type: ignore[return-value]
        parts = cleaned.split(None, 4)
        if len(parts) < 4 or not parts[0].endswith(".service"):
            return None  # type: ignore[return-value]
        return {
            "name": parts[0],
            "active": parts[2].lower(),
            "sub": parts[3].lower(),
        }
