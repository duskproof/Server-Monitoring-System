"""SMART collector built on ``smartctl`` (smartmontools).

Requires the ``smartctl`` binary and raw device access, so it usually needs
either root or ``CAP_SYS_RAWIO``.  When permissions are missing the collector
logs one warning and the metric is omitted.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from .base import SLOW, BaseCollector

SMARTCTL_TIMEOUT = 30.0

#: ATA attribute ids used to derive the reported fields.
ATTR_REALLOCATED_SECTORS = 5
ATTR_WEAR_LEVELING = (177, 173, 231)


class SmartCollector(BaseCollector):
    """Collect SMART health data for every scannable block device."""

    name = "smart"
    tier = SLOW
    required_tools = ("smartctl",)

    def collect(self) -> Dict[str, Any]:
        devices = self._scan()
        if not devices:
            return {}

        entries: List[Dict[str, Any]] = []
        for device in devices:
            entry = self._device_health(device)
            if entry is not None:
                entries.append(entry)

        if not entries:
            return {}
        return {"smart": entries}

    # ------------------------------------------------------------------
    def _scan(self) -> List[Dict[str, str]]:
        result = self.run(["smartctl", "--scan-open", "-j"], timeout=SMARTCTL_TIMEOUT)
        payload = self._parse_json(result.stdout)
        if payload is None:
            self.warn_once(
                "scan",
                "smartctl --scan-open produced no usable output (exit %s): %s",
                result.exit_code,
                result.stderr.strip() or "no output",
            )
            return []

        devices: List[Dict[str, str]] = []
        for device in payload.get("devices") or []:
            name = str(device.get("name") or "")
            if not name:
                continue
            devices.append({"name": name, "type": str(device.get("type") or "auto")})
        if not devices:
            self.warn_once("scan_empty", "smartctl found no SMART-capable devices")
        return devices

    def _device_health(self, device: Dict[str, str]) -> Optional[Dict[str, Any]]:
        name = device["name"]
        result = self.run(
            ["smartctl", "-H", "-A", "-i", "-j", "-d", device["type"], name],
            timeout=SMARTCTL_TIMEOUT,
        )
        payload = self._parse_json(result.stdout)
        if payload is None:
            self.warn_once(
                f"device:{name}",
                "smartctl could not read %s (exit %s): %s",
                name,
                result.exit_code,
                result.stderr.strip() or "no output",
            )
            return None

        # smartctl uses a bit field exit status; bit 0/1 mean "command failed".
        if result.exit_code & 0b11 and not payload.get("smart_status"):
            self.warn_once(
                f"device_status:{name}",
                "smartctl reported a device error for %s (exit %s)",
                name,
                result.exit_code,
            )

        status = payload.get("smart_status") or {}
        passed = status.get("passed")
        health = "PASSED" if passed is True else "FAILED" if passed is False else "UNKNOWN"

        entry: Dict[str, Any] = {
            "device": name,
            "model": str(payload.get("model_name") or payload.get("device", {}).get("name") or ""),
            "health": health,
            "temperature": self._int_or_none((payload.get("temperature") or {}).get("current")),
            "power_on_hours": self._int_or_none(
                (payload.get("power_on_time") or {}).get("hours")
            ),
            "reallocated_sectors": self._attribute_raw(payload, (ATTR_REALLOCATED_SECTORS,)),
            "wear_leveling": self._wear_leveling(payload),
        }
        return entry

    def _parse_json(self, stdout: str) -> Optional[Dict[str, Any]]:
        text = (stdout or "").strip()
        if not text:
            return None
        try:
            parsed = json.loads(text)
        except ValueError as exc:
            self.log.debug("Cannot parse smartctl JSON output: %s", exc)
            return None
        return parsed if isinstance(parsed, dict) else None

    @staticmethod
    def _int_or_none(value: Any) -> Optional[int]:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _attributes(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        table = ((payload.get("ata_smart_attributes") or {}).get("table")) or []
        return [item for item in table if isinstance(item, dict)]

    def _attribute_raw(self, payload: Dict[str, Any], ids: Any) -> Optional[int]:
        for attribute in self._attributes(payload):
            if attribute.get("id") in ids:
                raw = attribute.get("raw") or {}
                return self._int_or_none(raw.get("value"))
        return None

    def _wear_leveling(self, payload: Dict[str, Any]) -> Optional[int]:
        """Return remaining endurance in percent (100 = brand new)."""
        nvme_log = payload.get("nvme_smart_health_information_log") or {}
        used = self._int_or_none(nvme_log.get("percentage_used"))
        if used is not None:
            return max(0, 100 - used)

        for attribute in self._attributes(payload):
            if attribute.get("id") in ATTR_WEAR_LEVELING:
                normalised = self._int_or_none(attribute.get("value"))
                if normalised is not None:
                    return normalised
        return None
