"""Temperature collector: hwmon sensors, ``sensors -j`` and ``nvidia-smi``.

Runs in the slow tier because the fallbacks spawn external tools.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import psutil

from .base import SLOW, BaseCollector, tool_available

NVIDIA_QUERY = "index,name,temperature.gpu"


class TemperatureCollector(BaseCollector):
    """Collect every temperature reading the host exposes."""

    name = "temperature"
    tier = SLOW

    def available(self) -> bool:
        # psutil reads hwmon directly; the CLI tools are optional extras.
        return True

    def collect(self) -> Dict[str, Any]:
        readings: List[Dict[str, Any]] = list(self._from_psutil())
        if not readings:
            readings.extend(self._from_sensors_cli())
        readings.extend(self._from_nvidia_smi())

        if not readings:
            self.warn_once(
                "no_sensors",
                "No temperature sensors found (no hwmon data, no 'sensors', no 'nvidia-smi')",
            )
            return {}
        return {"temperatures": readings}

    # ------------------------------------------------------------------
    def _from_psutil(self) -> List[Dict[str, Any]]:
        sensors = getattr(psutil, "sensors_temperatures", None)
        if sensors is None:
            return []
        try:
            data = sensors() or {}
        except Exception as exc:  # noqa: BLE001
            self.log.debug("psutil temperature sensors unavailable: %s", exc)
            return []

        readings: List[Dict[str, Any]] = []
        for chip, entries in data.items():
            for index, entry in enumerate(entries):
                current = getattr(entry, "current", None)
                if current is None:
                    continue
                readings.append(
                    {
                        "sensor": chip,
                        "label": getattr(entry, "label", "") or f"sensor{index}",
                        "current": round(float(current), 1),
                        "high": self._optional_float(getattr(entry, "high", None)),
                        "critical": self._optional_float(getattr(entry, "critical", None)),
                    }
                )
        return readings

    def _from_sensors_cli(self) -> List[Dict[str, Any]]:
        if not tool_available("sensors"):
            return []
        result = self.run(["sensors", "-j"])
        if result.failed or not result.stdout.strip():
            self.log.debug("sensors -j failed: %s", result.stderr.strip())
            return []
        try:
            data = json.loads(result.stdout)
        except ValueError as exc:
            self.log.debug("Cannot parse sensors -j output: %s", exc)
            return []

        readings: List[Dict[str, Any]] = []
        for chip, labels in (data or {}).items():
            if not isinstance(labels, dict):
                continue
            for label, values in labels.items():
                if not isinstance(values, dict):
                    continue
                current = high = critical = None
                for key, value in values.items():
                    if not isinstance(value, (int, float)):
                        continue
                    if key.endswith("_input"):
                        current = float(value)
                    elif key.endswith("_max"):
                        high = float(value)
                    elif key.endswith("_crit"):
                        critical = float(value)
                if current is None:
                    continue
                readings.append(
                    {
                        "sensor": chip,
                        "label": label,
                        "current": round(current, 1),
                        "high": self._optional_float(high),
                        "critical": self._optional_float(critical),
                    }
                )
        return readings

    def _from_nvidia_smi(self) -> List[Dict[str, Any]]:
        if not tool_available("nvidia-smi"):
            return []
        result = self.run(
            [
                "nvidia-smi",
                f"--query-gpu={NVIDIA_QUERY}",
                "--format=csv,noheader,nounits",
            ]
        )
        if result.failed:
            self.warn_once(
                "nvidia_smi",
                "nvidia-smi failed (exit %s): %s",
                result.exit_code,
                result.stderr.strip() or "no output",
            )
            return []

        readings: List[Dict[str, Any]] = []
        for line in result.stdout.splitlines():
            parts = [part.strip() for part in line.split(",")]
            if len(parts) < 3:
                continue
            try:
                temperature = float(parts[2])
            except ValueError:
                continue
            readings.append(
                {
                    "sensor": "nvidia-gpu",
                    "label": f"GPU {parts[0]} {parts[1]}".strip(),
                    "current": round(temperature, 1),
                    "high": None,
                    "critical": None,
                }
            )
        return readings

    @staticmethod
    def _optional_float(value: Any) -> Optional[float]:
        if value is None:
            return None
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return None
        return round(numeric, 1) if numeric else None
