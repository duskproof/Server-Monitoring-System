"""Log file scanner.

Each configured file is scanned incrementally: the agent remembers where the
previous scan stopped and only reads what was appended since, so ``matches``
represents *new* occurrences per slow-tier cycle rather than an ever growing
total.  Rotation (inode change or truncation) is detected and handled by
restarting from the tail of the new file.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Tuple

from .base import SLOW, BaseCollector

#: Hard cap on the bytes read from a single file per cycle.
MAX_READ_BYTES = 8 * 1024 * 1024
#: Average line length used to size the initial tail read.
AVERAGE_LINE_BYTES = 256
#: Number of matching lines attached as evidence per pattern.
MAX_SAMPLES = 3
#: Sample lines are truncated to keep the payload small.
MAX_SAMPLE_LENGTH = 500
#: Bytes from the start of the file used to detect a rewrite when inode is unreliable.
PREFIX_LEN = 64


class LogCollector(BaseCollector):
    """Count pattern occurrences in the configured log files."""

    name = "logs"
    tier = SLOW

    def __init__(self, config) -> None:  # type: ignore[no-untyped-def]
        super().__init__(config)
        # path -> (inode, offset, prefix)
        self._positions: Dict[str, Tuple[int, int, bytes]] = {}

    def available(self) -> bool:
        if not self.config.log_files:
            self.warn_once("no_files", "No files configured in [logs] files, skipping log scan")
            return False
        if not self.config.log_patterns:
            self.warn_once("no_patterns", "No patterns configured in [logs] patterns")
            return False
        return True

    def collect(self) -> Dict[str, Any]:
        entries: List[Dict[str, Any]] = []
        for path in self.config.log_files:
            entries.extend(self._scan_file(path))
        return {"logs": entries}

    # ------------------------------------------------------------------
    def _scan_file(self, path: str) -> List[Dict[str, Any]]:
        lines = self._read_new_lines(path)
        if not lines:
            return []

        patterns = [pattern.lower() for pattern in self.config.log_patterns]
        counts = {pattern: 0 for pattern in patterns}
        samples: Dict[str, List[str]] = {pattern: [] for pattern in patterns}

        for line in lines:
            lowered = line.lower()
            for pattern in patterns:
                if pattern in lowered:
                    counts[pattern] += 1
                    if len(samples[pattern]) < MAX_SAMPLES:
                        samples[pattern].append(line.strip()[:MAX_SAMPLE_LENGTH])

        entries: List[Dict[str, Any]] = []
        for original in self.config.log_patterns:
            pattern = original.lower()
            if not counts.get(pattern):
                continue
            entries.append(
                {
                    "file": path,
                    "pattern": original,
                    "matches": counts[pattern],
                    "samples": samples[pattern],
                }
            )
        return entries

    def _read_new_lines(self, path: str) -> List[str]:
        try:
            stat = os.stat(path)
        except OSError as exc:
            self.warn_once(f"stat:{path}", "Cannot access log file %s: %s", path, exc)
            return []

        inode = int(getattr(stat, "st_ino", 0) or 0)
        size = int(stat.st_size)
        prefix = self._read_prefix(path)
        previous = self._positions.get(path)

        if previous is None:
            # First scan: look at the tail only, bounded by [logs] max_lines.
            start = max(0, size - min(MAX_READ_BYTES, self.config.log_max_lines * AVERAGE_LINE_BYTES))
            skip_partial = start > 0
        else:
            prev_inode, prev_offset, prev_prefix = previous
            inode_changed = prev_inode != 0 and inode != 0 and prev_inode != inode
            truncated = size < prev_offset
            rewritten = prefix != prev_prefix
            if inode_changed or truncated or rewritten:
                self.log.info("Log file %s was rotated, restarting scan from the beginning", path)
                start = max(0, size - MAX_READ_BYTES)
                skip_partial = start > 0
            else:
                start = prev_offset
                skip_partial = False
                if start >= size:
                    self._positions[path] = (inode, size, prefix)
                    return []

        if size - start > MAX_READ_BYTES:
            start = size - MAX_READ_BYTES
            skip_partial = True

        try:
            with open(path, "rb") as handle:
                handle.seek(start)
                chunk = handle.read(max(0, size - start))
        except OSError as exc:
            self.warn_once(f"read:{path}", "Cannot read log file %s: %s", path, exc)
            return []

        self._positions[path] = (inode, start + len(chunk), prefix)

        text = chunk.decode("utf-8", errors="replace")
        lines = text.splitlines()
        if skip_partial and lines:
            lines = lines[1:]
        if len(lines) > self.config.log_max_lines:
            lines = lines[-self.config.log_max_lines :]
        return lines

    def _read_prefix(self, path: str) -> bytes:
        try:
            with open(path, "rb") as handle:
                return handle.read(PREFIX_LEN)
        except OSError:
            return b""
