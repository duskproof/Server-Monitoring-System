"""Disk collector: space usage per mount point plus per-device I/O rates."""

from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional, Tuple

import psutil

from .base import FAST, BaseCollector, rate_per_second, to_gb, to_mb

#: Pseudo filesystems that carry no meaningful capacity information.
IGNORED_FSTYPES = {
    "autofs",
    "binfmt_misc",
    "bpf",
    "cgroup",
    "cgroup2",
    "configfs",
    "debugfs",
    "devpts",
    "devtmpfs",
    "efivarfs",
    "fuse.gvfsd-fuse",
    "fuse.snapfuse",
    "fusectl",
    "hugetlbfs",
    "mqueue",
    "nsfs",
    "overlay",
    "proc",
    "pstore",
    "ramfs",
    "securityfs",
    "selinuxfs",
    "squashfs",
    "sysfs",
    "tmpfs",
    "tracefs",
}

#: Mount point prefixes that only duplicate other mounts.
IGNORED_MOUNT_PREFIXES = ("/snap/", "/var/lib/docker/", "/run/", "/sys/", "/proc/", "/dev/")


class DiskCollector(BaseCollector):
    """Collect filesystem usage and block device I/O counters."""

    name = "disk"
    tier = FAST

    def __init__(self, config) -> None:  # type: ignore[no-untyped-def]
        super().__init__(config)
        # device name -> (read_count, write_count, monotonic timestamp)
        self._prev_io: Dict[str, Tuple[int, int, float]] = {}

    def collect(self) -> Dict[str, Any]:
        io_counters = self._io_counters()
        now = time.monotonic()

        disks: List[Dict[str, Any]] = []
        for partition in self._partitions():
            entry = self._describe(partition)
            if entry is None:
                continue
            entry.update(self._io_for_device(partition.device, io_counters, now))
            disks.append(entry)

        if not disks:
            self.warn_once("no_partitions", "No usable filesystems found, omitting disk metrics")
            return {}
        return {"disk": disks}

    # ------------------------------------------------------------------
    def _partitions(self) -> List[Any]:
        try:
            partitions = psutil.disk_partitions(all=False)
        except Exception as exc:  # noqa: BLE001
            self.warn_once("partitions", "Cannot enumerate partitions: %s", exc)
            return []

        usable = []
        for partition in partitions:
            fstype = (partition.fstype or "").lower()
            mount = partition.mountpoint or ""
            if fstype in IGNORED_FSTYPES or not fstype:
                continue
            if mount.startswith(IGNORED_MOUNT_PREFIXES):
                continue
            usable.append(partition)
        return usable

    def _describe(self, partition: Any) -> Optional[Dict[str, Any]]:
        mount = partition.mountpoint
        try:
            usage = psutil.disk_usage(mount)
        except OSError as exc:
            # Unreadable or disconnected mounts are skipped rather than fatal.
            self.warn_once(f"usage:{mount}", "Cannot read usage of %s: %s", mount, exc)
            return None
        if not usage.total:
            return None
        return {
            "mount": mount,
            "device": partition.device,
            "fstype": partition.fstype,
            "total_gb": to_gb(usage.total),
            "used_gb": to_gb(usage.used),
            "free_gb": to_gb(usage.free),
            "used_percent": round(float(usage.percent), 2),
        }

    def _io_counters(self) -> Dict[str, Any]:
        try:
            counters = psutil.disk_io_counters(perdisk=True)
        except Exception as exc:  # noqa: BLE001 - unavailable in some containers
            self.warn_once("disk_io", "Disk I/O counters unavailable: %s", exc)
            return {}
        return counters or {}

    @staticmethod
    def _device_candidates(device: str) -> List[str]:
        """Map ``/dev/vda1`` to the keys psutil uses (``vda1``, then ``vda``)."""
        base = os.path.basename(device or "")
        if not base:
            return []
        candidates = [base]
        stripped = base.rstrip("0123456789")
        # nvme0n1p1 -> nvme0n1, sda1 -> sda
        if stripped.endswith("p") and stripped != base:
            stripped = stripped[:-1]
        if stripped and stripped != base:
            candidates.append(stripped)
        return candidates

    def _io_for_device(
        self, device: str, counters: Dict[str, Any], now: float
    ) -> Dict[str, float]:
        stats = None
        key = ""
        for candidate in self._device_candidates(device):
            if candidate in counters:
                stats = counters[candidate]
                key = candidate
                break
        if stats is None:
            return {
                "io_read_mb": 0.0,
                "io_write_mb": 0.0,
                "iops_read": 0.0,
                "iops_write": 0.0,
            }

        read_count = int(getattr(stats, "read_count", 0) or 0)
        write_count = int(getattr(stats, "write_count", 0) or 0)
        previous = self._prev_io.get(key)
        self._prev_io[key] = (read_count, write_count, now)

        iops_read = 0.0
        iops_write = 0.0
        if previous is not None:
            elapsed = now - previous[2]
            iops_read = rate_per_second(read_count, previous[0], elapsed)
            iops_write = rate_per_second(write_count, previous[1], elapsed)

        return {
            "io_read_mb": to_mb(getattr(stats, "read_bytes", 0) or 0),
            "io_write_mb": to_mb(getattr(stats, "write_bytes", 0) or 0),
            "iops_read": iops_read,
            "iops_write": iops_write,
        }
