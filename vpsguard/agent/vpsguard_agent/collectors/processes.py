"""Process collector: top consumers plus a state summary."""

from __future__ import annotations

from typing import Any, Dict, List

import psutil

from .base import FAST, BaseCollector, sorted_by_usage, to_mb

PROCESS_ATTRS = (
    "pid",
    "name",
    "username",
    "cpu_percent",
    "memory_percent",
    "memory_info",
    "status",
)


class ProcessCollector(BaseCollector):
    """Collect the top processes by CPU/memory and aggregate process states.

    ``psutil.process_iter`` keeps an internal process cache, so repeated calls
    reuse the same :class:`psutil.Process` objects and ``cpu_percent`` stays
    delta based (no blocking sleep, no re-reading of ``/proc`` metadata).
    """

    name = "processes"
    tier = FAST

    def collect(self) -> Dict[str, Any]:
        entries: List[Dict[str, Any]] = []
        summary = {"total": 0, "running": 0, "sleeping": 0, "zombie": 0}

        for process in psutil.process_iter(attrs=PROCESS_ATTRS, ad_value=None):
            info = process.info
            summary["total"] += 1

            status = (info.get("status") or "unknown").lower()
            if status == psutil.STATUS_RUNNING:
                summary["running"] += 1
            elif status in (psutil.STATUS_SLEEPING, psutil.STATUS_DISK_SLEEP):
                summary["sleeping"] += 1
            elif status == psutil.STATUS_ZOMBIE:
                summary["zombie"] += 1

            memory_info = info.get("memory_info")
            rss = getattr(memory_info, "rss", 0) if memory_info else 0

            entries.append(
                {
                    "pid": int(info.get("pid") or 0),
                    "name": info.get("name") or "unknown",
                    "user": info.get("username") or "unknown",
                    "cpu_percent": round(float(info.get("cpu_percent") or 0.0), 2),
                    "mem_percent": round(float(info.get("memory_percent") or 0.0), 2),
                    "mem_rss_mb": to_mb(rss),
                    "status": status,
                }
            )

        if not summary["total"]:
            self.warn_once("empty", "Process table came back empty, omitting process metrics")
            return {}

        return {
            "processes": sorted_by_usage(entries, self.config.top_processes),
            "process_summary": summary,
        }
