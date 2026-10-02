"""Collector base class and shared helpers.

Every collector returns a *fragment* of the ``metrics`` object: a mapping of
top-level metric names to their values (for example ``{"cpu": {...}}``).  The
payload builder merges those fragments.  A collector that fails, or whose
external tool is missing, logs a warning and returns an empty fragment so the
metric is simply omitted from the payload.
"""

from __future__ import annotations

import shutil
import subprocess
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from ..config import Config
from ..logging_setup import get_logger

FAST = "fast"
SLOW = "slow"

#: Default timeout for the external tools some collectors shell out to.
DEFAULT_TOOL_TIMEOUT = 10.0


@dataclass
class ToolResult:
    """Outcome of an external command invocation."""

    ok: bool
    exit_code: int
    stdout: str
    stderr: str

    @property
    def failed(self) -> bool:
        return not self.ok


def tool_available(name: str) -> bool:
    """Return whether an executable is present in ``PATH``."""
    return shutil.which(name) is not None


def run_tool(
    argv: Sequence[str],
    timeout: float = DEFAULT_TOOL_TIMEOUT,
    logger_name: str = "collectors",
) -> ToolResult:
    """Run an external command without a shell and capture its output.

    Never raises: failures are folded into the returned :class:`ToolResult`.
    """
    log = get_logger(logger_name)
    argv = [str(part) for part in argv]
    try:
        completed = subprocess.run(  # noqa: S603 - argv list, shell=False
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError:
        log.warning("Command not found: %s", argv[0])
        return ToolResult(False, 127, "", f"{argv[0]}: command not found")
    except subprocess.TimeoutExpired:
        log.warning("Command timed out after %.0fs: %s", timeout, " ".join(argv))
        return ToolResult(False, 124, "", f"{argv[0]}: timed out")
    except OSError as exc:
        log.warning("Command failed to start (%s): %s", exc, " ".join(argv))
        return ToolResult(False, 126, "", str(exc))

    stdout = completed.stdout.decode("utf-8", errors="replace") if completed.stdout else ""
    stderr = completed.stderr.decode("utf-8", errors="replace") if completed.stderr else ""
    return ToolResult(completed.returncode == 0, completed.returncode, stdout, stderr)


def to_mb(value_bytes: float) -> float:
    """Convert bytes to megabytes, rounded to two decimals."""
    return round(float(value_bytes) / (1024.0 * 1024.0), 2)


def to_gb(value_bytes: float) -> float:
    """Convert bytes to gigabytes, rounded to two decimals."""
    return round(float(value_bytes) / (1024.0 * 1024.0 * 1024.0), 2)


def percentage(part: float, whole: float) -> float:
    """Return ``part / whole`` as a percentage, guarding against zero."""
    if not whole:
        return 0.0
    return round(float(part) / float(whole) * 100.0, 2)


def rate_per_second(current: float, previous: float, elapsed: float) -> float:
    """Return the per-second rate between two counter samples.

    Counter resets (interface flap, container restart) yield ``0.0`` rather than
    a negative spike.
    """
    if elapsed <= 0:
        return 0.0
    delta = float(current) - float(previous)
    if delta < 0:
        return 0.0
    return round(delta / elapsed, 2)


class BaseCollector:
    """Base class for all metric collectors.

    Subclasses set :attr:`name` and :attr:`tier` and implement :meth:`collect`.
    """

    #: Metric name, matching the key used in the ``[metrics]`` config section.
    name: str = ""
    #: ``fast`` collectors run every ``interval``, ``slow`` every ``slow_interval``.
    tier: str = FAST
    #: When set, results are cached for this many seconds.  Used by collectors
    #: that must shell out to external tools but live in the fast tier.
    min_interval: float = 0.0
    #: External executables the collector depends on (any one of them is enough).
    required_tools: Sequence[str] = ()

    def __init__(self, config: Config) -> None:
        self.config = config
        self.log = get_logger(f"collectors.{self.name or self.__class__.__name__}")
        self._cache: Optional[Dict[str, Any]] = None
        self._cache_monotonic: float = 0.0
        self._warned: Set[str] = set()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def available(self) -> bool:
        """Return whether this collector can run on the current host."""
        if not self.required_tools:
            return True
        return any(tool_available(tool) for tool in self.required_tools)

    def collect(self) -> Dict[str, Any]:
        """Collect metrics and return a fragment of the ``metrics`` object."""
        raise NotImplementedError

    def safe_collect(self) -> Dict[str, Any]:
        """Run :meth:`collect` defensively.

        Returns an empty dict when the collector is unavailable or raises, which
        makes the payload builder omit the metric entirely.
        """
        now = time.monotonic()
        if (
            self.min_interval > 0
            and self._cache is not None
            and (now - self._cache_monotonic) < self.min_interval
        ):
            return self._cache

        if not self.available():
            self.warn_once(
                "unavailable",
                "Collector '%s' is unavailable on this host (missing: %s), skipping",
                self.name,
                ", ".join(self.required_tools) or "n/a",
            )
            self._cache = {}
            self._cache_monotonic = now
            return {}

        started = time.monotonic()
        try:
            fragment = self.collect() or {}
        except Exception as exc:  # noqa: BLE001 - collectors must never crash the agent
            self.log.warning("Collector '%s' failed: %s", self.name, exc, exc_info=self.log.isEnabledFor(10))
            self._cache = {}
            self._cache_monotonic = now
            return {}

        if not isinstance(fragment, dict):
            self.log.warning(
                "Collector '%s' returned %s instead of a dict, skipping",
                self.name,
                type(fragment).__name__,
            )
            fragment = {}

        elapsed_ms = (time.monotonic() - started) * 1000.0
        self.log.debug("Collector '%s' finished in %.1f ms", self.name, elapsed_ms)
        self._cache = fragment
        self._cache_monotonic = now
        return fragment

    # ------------------------------------------------------------------
    # Helpers for subclasses
    # ------------------------------------------------------------------
    def warn_once(self, key: str, message: str, *args: Any) -> None:
        """Log a warning the first time, then downgrade repeats to debug."""
        if key in self._warned:
            self.log.debug(message, *args)
            return
        self._warned.add(key)
        self.log.warning(message, *args)

    def run(self, argv: Sequence[str], timeout: Optional[float] = None) -> ToolResult:
        """Run an external tool with the collector's logger attached."""
        return run_tool(
            argv,
            timeout=timeout if timeout is not None else DEFAULT_TOOL_TIMEOUT,
            logger_name=f"collectors.{self.name}",
        )

    def read_text(self, path: str, limit: int = 65536) -> str:
        """Read a (small) text file, returning ``""`` when unreadable."""
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                return handle.read(limit)
        except OSError as exc:
            self.log.debug("Cannot read %s: %s", path, exc)
            return ""


def sorted_by_usage(items: Iterable[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    """Sort process-like dicts by CPU then memory usage and truncate."""
    ordered = sorted(
        items,
        key=lambda item: (
            float(item.get("cpu_percent") or 0.0),
            float(item.get("mem_percent") or 0.0),
        ),
        reverse=True,
    )
    return ordered[: max(0, int(limit))]
