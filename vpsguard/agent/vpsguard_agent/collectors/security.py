"""Security collector: SSH brute-force attempts, firewall, ports, last logins."""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import psutil

from .base import SLOW, BaseCollector, tool_available

#: Candidate authentication logs (Debian/Ubuntu first, then RHEL family).
AUTH_LOG_CANDIDATES = ("/var/log/auth.log", "/var/log/secure")

#: Only the tail of the auth log is inspected to keep the collector cheap.
AUTH_LOG_TAIL_BYTES = 2 * 1024 * 1024

FAILURE_MARKERS = (
    "failed password",
    "failed publickey",
    "invalid user",
    "authentication failure",
    "maximum authentication attempts exceeded",
)

_SYSLOG_TS = re.compile(r"^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})")
_ISO_TS = re.compile(r"^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:?\d{2}|Z)?)")

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

MAX_LAST_LOGINS = 10
MAX_OPEN_PORTS = 200


class SecurityCollector(BaseCollector):
    """Aggregate host security indicators."""

    name = "security"
    tier = SLOW

    def available(self) -> bool:
        return True

    def collect(self) -> Dict[str, Any]:
        security: Dict[str, Any] = {}

        total, last_hour = self._failed_ssh()
        if total is not None:
            security["failed_ssh_attempts"] = total
            security["failed_ssh_last_hour"] = last_hour

        status, backend = self._firewall()
        security["firewall_status"] = status
        security["firewall_backend"] = backend

        security["open_ports"] = self._open_ports()
        security["last_logins"] = self._last_logins()

        return {"security": security}

    # ------------------------------------------------------------------
    # SSH failures
    # ------------------------------------------------------------------
    def _failed_ssh(self) -> Tuple[Optional[int], int]:
        lines = self._auth_log_lines()
        if lines is None:
            return None, 0

        now = datetime.now(timezone.utc)
        one_hour_ago = now - timedelta(hours=1)
        total = 0
        recent = 0
        for line in lines:
            lowered = line.lower()
            if not any(marker in lowered for marker in FAILURE_MARKERS):
                continue
            total += 1
            timestamp = self._parse_log_timestamp(line, now)
            if timestamp is not None and timestamp >= one_hour_ago:
                recent += 1
        return total, recent

    def _auth_log_lines(self) -> Optional[List[str]]:
        for path in AUTH_LOG_CANDIDATES:
            if not os.path.isfile(path):
                continue
            try:
                with open(path, "rb") as handle:
                    handle.seek(0, os.SEEK_END)
                    size = handle.tell()
                    handle.seek(max(0, size - AUTH_LOG_TAIL_BYTES))
                    chunk = handle.read()
            except OSError as exc:
                self.warn_once(f"auth_log:{path}", "Cannot read %s: %s", path, exc)
                continue
            text = chunk.decode("utf-8", errors="replace")
            lines = text.splitlines()
            # The first line may be truncated when we seeked into the middle.
            return lines[1:] if size > AUTH_LOG_TAIL_BYTES and lines else lines

        return self._journal_lines()

    def _journal_lines(self) -> Optional[List[str]]:
        if not tool_available("journalctl"):
            self.warn_once(
                "no_auth_log",
                "No authentication log found (%s) and journalctl is unavailable",
                ", ".join(AUTH_LOG_CANDIDATES),
            )
            return None
        result = self.run(
            [
                "journalctl",
                "-u", "ssh",
                "-u", "sshd",
                "--since", "-24h",
                "--no-pager",
                "-o", "short-iso",
            ],
            timeout=20.0,
        )
        if result.failed:
            self.warn_once(
                "journalctl",
                "journalctl could not read SSH logs (exit %s): %s",
                result.exit_code,
                result.stderr.strip() or "no output",
            )
            return None
        return result.stdout.splitlines()

    @staticmethod
    def _parse_log_timestamp(line: str, now: datetime) -> Optional[datetime]:
        """Parse syslog or ISO timestamps found at the start of a log line."""
        iso_match = _ISO_TS.match(line)
        if iso_match:
            raw = iso_match.group(1).replace(" ", "T").replace("Z", "+00:00")
            if re.search(r"[+-]\d{2}\d{2}$", raw):
                raw = raw[:-2] + ":" + raw[-2:]
            try:
                parsed = datetime.fromisoformat(raw)
            except ValueError:
                return None
            if parsed.tzinfo is None:
                parsed = parsed.astimezone()
            return parsed.astimezone(timezone.utc)

        syslog_match = _SYSLOG_TS.match(line)
        if not syslog_match:
            return None
        month_name, day, hour, minute, second = syslog_match.groups()
        month = _MONTHS.get(month_name.lower())
        if not month:
            return None
        local_now = now.astimezone()
        try:
            candidate = datetime(
                local_now.year, month, int(day), int(hour), int(minute), int(second),
                tzinfo=local_now.tzinfo,
            )
        except ValueError:
            return None
        # Syslog omits the year: a future date means the entry is from last year.
        if candidate - local_now > timedelta(days=1):
            try:
                candidate = candidate.replace(year=local_now.year - 1)
            except ValueError:
                return None
        return candidate.astimezone(timezone.utc)

    # ------------------------------------------------------------------
    # Firewall
    # ------------------------------------------------------------------
    def _firewall(self) -> Tuple[str, str]:
        if tool_available("ufw"):
            result = self.run(["ufw", "status"])
            if result.ok:
                active = "status: active" in result.stdout.lower()
                return ("active" if active else "inactive"), "ufw"
            self.warn_once(
                "ufw", "Cannot read ufw status (exit %s), root is usually required", result.exit_code
            )

        if tool_available("firewall-cmd"):
            result = self.run(["firewall-cmd", "--state"])
            state = (result.stdout or result.stderr).strip().lower()
            if state:
                return ("active" if "running" in state else "inactive"), "firewalld"

        if tool_available("nft"):
            result = self.run(["nft", "list", "ruleset"])
            if result.ok:
                has_rules = any(
                    line.strip().startswith(("chain", "rule")) for line in result.stdout.splitlines()
                )
                return ("active" if has_rules else "inactive"), "nftables"

        if tool_available("iptables"):
            result = self.run(["iptables", "-S"])
            if result.ok:
                rules = [line for line in result.stdout.splitlines() if line.startswith("-A")]
                return ("active" if rules else "inactive"), "iptables"

        self.warn_once("firewall", "No supported firewall front-end detected")
        return "unknown", "none"

    # ------------------------------------------------------------------
    # Listening ports
    # ------------------------------------------------------------------
    def _open_ports(self) -> List[int]:
        ports = set()
        try:
            for connection in psutil.net_connections(kind="inet"):
                if (connection.status or "").upper() != "LISTEN":
                    continue
                laddr = connection.laddr
                port = getattr(laddr, "port", None)
                if port:
                    ports.add(int(port))
        except (psutil.AccessDenied, PermissionError) as exc:
            self.log.debug("Listening sockets require more privileges: %s", exc)
        except Exception as exc:  # noqa: BLE001
            self.log.debug("Cannot enumerate listening sockets: %s", exc)

        if not ports:
            ports.update(self._open_ports_from_ss())
        return sorted(ports)[:MAX_OPEN_PORTS]

    def _open_ports_from_ss(self) -> List[int]:
        if not tool_available("ss"):
            return []
        result = self.run(["ss", "-lntuH"])
        if result.failed:
            return []
        ports: List[int] = []
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) < 5:
                continue
            local = parts[4]
            _, _, port_text = local.rpartition(":")
            try:
                ports.append(int(port_text))
            except ValueError:
                continue
        return ports

    # ------------------------------------------------------------------
    # Last logins
    # ------------------------------------------------------------------
    def _last_logins(self) -> List[Dict[str, str]]:
        if not tool_available("last"):
            self.warn_once("last", "'last' is not installed, login history unavailable")
            return []
        result = self.run(["last", "-i", "-F", "-n", str(MAX_LAST_LOGINS)])
        if result.failed:
            self.warn_once(
                "last_failed",
                "'last' failed (exit %s): %s",
                result.exit_code,
                result.stderr.strip() or "no output",
            )
            return []

        logins: List[Dict[str, str]] = []
        for line in result.stdout.splitlines():
            entry = self._parse_last_line(line)
            if entry is not None:
                logins.append(entry)
            if len(logins) >= MAX_LAST_LOGINS:
                break
        return logins

    def _parse_last_line(self, line: str) -> Optional[Dict[str, str]]:
        parts = line.split()
        # user tty host <Www Mmm DD HH:MM:SS YYYY> ...
        if len(parts) < 8 or parts[0] in ("reboot", "wtmp", "shutdown", "btmp"):
            return None
        user, host = parts[0], parts[2]
        stamp = " ".join(parts[3:8])
        try:
            parsed = datetime.strptime(stamp, "%a %b %d %H:%M:%S %Y")
        except ValueError:
            self.log.debug("Cannot parse 'last' timestamp: %s", stamp)
            return None
        local = parsed.replace(tzinfo=datetime.now(timezone.utc).astimezone().tzinfo)
        return {
            "user": user,
            "from": host if host and host != "0.0.0.0" else "local",
            "at": local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
