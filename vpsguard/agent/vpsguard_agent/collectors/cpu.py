"""CPU collector: load average, utilisation breakdown, frequency, temperature."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

import psutil

from .base import FAST, BaseCollector

#: Sensor names that usually expose the CPU package temperature.
CPU_SENSOR_HINTS = ("coretemp", "k10temp", "zenpower", "cpu_thermal", "acpitz", "soc_thermal")


class CpuCollector(BaseCollector):
    """Collect CPU metrics without ever blocking the event loop.

    ``psutil.cpu_percent(interval=None)`` is delta based: it compares against
    the previous call instead of sleeping, which keeps the fast tier cheap.
    """

    name = "cpu"
    tier = FAST

    def __init__(self, config) -> None:  # type: ignore[no-untyped-def]
        super().__init__(config)
        self._prev_times: Optional[Any] = None
        self._prev_monotonic: float = 0.0
        # Prime psutil's internal per-core counters so the first real sample is
        # a delta rather than a meaningless zero.
        try:
            psutil.cpu_percent(interval=None, percpu=True)
            self._prev_times = psutil.cpu_times()
            self._prev_monotonic = time.monotonic()
        except Exception as exc:  # noqa: BLE001 - priming is best effort
            self.log.debug("Could not prime CPU counters: %s", exc)

    def collect(self) -> Dict[str, Any]:
        cpu: Dict[str, Any] = {}
        cpu.update(self._load_average())
        cpu.update(self._utilisation())

        cores = self._per_core()
        cpu["cores"] = cores
        cpu["core_count"] = psutil.cpu_count(logical=True) or len(cores)

        frequency = self._frequency_mhz()
        if frequency is not None:
            cpu["frequency_mhz"] = frequency

        temperature = self._temperature()
        if temperature is not None:
            cpu["temperature"] = temperature

        return {"cpu": cpu}

    # ------------------------------------------------------------------
    def _load_average(self) -> Dict[str, float]:
        try:
            load_1m, load_5m, load_15m = psutil.getloadavg()
        except (AttributeError, OSError) as exc:
            self.warn_once("loadavg", "Load average unavailable: %s", exc)
            return {}
        return {
            "load_1m": round(float(load_1m), 2),
            "load_5m": round(float(load_5m), 2),
            "load_15m": round(float(load_15m), 2),
        }

    def _utilisation(self) -> Dict[str, float]:
        """Compute the utilisation breakdown from a CPU time delta."""
        try:
            current = psutil.cpu_times()
        except Exception as exc:  # noqa: BLE001
            self.warn_once("cpu_times", "CPU times unavailable: %s", exc)
            return {}

        now = time.monotonic()
        previous = self._prev_times
        self._prev_times = current
        self._prev_monotonic = now

        if previous is None:
            return {}

        def delta(field: str) -> float:
            return max(0.0, float(getattr(current, field, 0.0) or 0.0) - float(getattr(previous, field, 0.0) or 0.0))

        fields = [name for name in current._fields if hasattr(previous, name)]
        total = sum(delta(name) for name in fields)
        if total <= 0:
            return {}

        idle = delta("idle")
        iowait = delta("iowait")
        busy = max(0.0, total - idle - iowait)

        return {
            "percent": round(busy / total * 100.0, 2),
            "percent_user": round((delta("user") + delta("nice")) / total * 100.0, 2),
            "percent_system": round(
                (delta("system") + delta("irq") + delta("softirq")) / total * 100.0, 2
            ),
            "percent_iowait": round(iowait / total * 100.0, 2),
            "percent_idle": round(idle / total * 100.0, 2),
        }

    def _per_core(self) -> List[float]:
        try:
            values = psutil.cpu_percent(interval=None, percpu=True)
        except Exception as exc:  # noqa: BLE001
            self.warn_once("percpu", "Per-core CPU usage unavailable: %s", exc)
            return []
        return [round(float(value), 2) for value in values]

    def _frequency_mhz(self) -> Optional[float]:
        try:
            freq = psutil.cpu_freq()
        except Exception as exc:  # noqa: BLE001 - not exposed in every container
            self.warn_once("cpu_freq", "CPU frequency unavailable: %s", exc)
            return None
        if not freq or not getattr(freq, "current", None):
            return None
        return round(float(freq.current), 2)

    def _temperature(self) -> Optional[float]:
        sensors = getattr(psutil, "sensors_temperatures", None)
        if sensors is None:
            return None
        try:
            readings = sensors() or {}
        except Exception as exc:  # noqa: BLE001
            self.warn_once("cpu_temp", "CPU temperature unavailable: %s", exc)
            return None

        candidates: List[float] = []
        for chip, entries in readings.items():
            if not any(hint in chip.lower() for hint in CPU_SENSOR_HINTS):
                continue
            for entry in entries:
                current = getattr(entry, "current", None)
                if current is None:
                    continue
                label = (getattr(entry, "label", "") or "").lower()
                # "package"/"tdie" is the whole-socket reading; prefer it.
                if "package" in label or "tdie" in label or "tctl" in label:
                    return round(float(current), 1)
                candidates.append(float(current))
        if not candidates:
            return None
        return round(max(candidates), 1)
