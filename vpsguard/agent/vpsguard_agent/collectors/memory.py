"""Memory collector: RAM and swap usage, reported in megabytes."""

from __future__ import annotations

from typing import Any, Dict

import psutil

from .base import FAST, BaseCollector, percentage, to_mb


class MemoryCollector(BaseCollector):
    """Collect virtual and swap memory usage."""

    name = "memory"
    tier = FAST

    def collect(self) -> Dict[str, Any]:
        virtual = psutil.virtual_memory()

        memory: Dict[str, Any] = {
            "total": to_mb(virtual.total),
            "used": to_mb(getattr(virtual, "used", virtual.total - virtual.available)),
            "free": to_mb(getattr(virtual, "free", virtual.available)),
            "available": to_mb(virtual.available),
            "used_percent": round(float(virtual.percent), 2),
        }

        try:
            swap = psutil.swap_memory()
        except Exception as exc:  # noqa: BLE001 - swap may be absent in containers
            self.warn_once("swap", "Swap statistics unavailable: %s", exc)
        else:
            memory["swap_total"] = to_mb(swap.total)
            memory["swap_used"] = to_mb(swap.used)
            memory["swap_used_percent"] = (
                round(float(swap.percent), 2) if swap.total else percentage(swap.used, swap.total)
            )

        return {"memory": memory}
