"""SQLite-backed offline buffer.

When the central server is unreachable, payloads are persisted here and
replayed (oldest first) as soon as connectivity returns.  The store is bounded
both by row count (``buffer_size``) and by age (``buffer_retention_hours``) so
that a long outage can never fill up the disk.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from typing import List, Optional, Sequence, Tuple

from .logging_setup import get_logger

logger = get_logger("buffer")

SCHEMA = """
CREATE TABLE IF NOT EXISTS payloads (
    id INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL,
    body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payloads_created_at ON payloads (created_at);
"""

#: Maximum number of buffered payloads replayed per successful cycle.
FLUSH_BATCH_SIZE = 50


class PayloadBuffer:
    """Thread-safe FIFO queue of JSON payloads persisted in SQLite."""

    def __init__(
        self,
        path: str,
        max_rows: int = 1000,
        retention_hours: int = 24,
    ) -> None:
        self.path = path
        self.max_rows = max(1, int(max_rows))
        self.retention_hours = max(1, int(retention_hours))
        self._lock = threading.Lock()
        self._conn: Optional[sqlite3.Connection] = None
        self._connect()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def _connect(self) -> None:
        if self.path != ":memory:":
            parent = os.path.dirname(self.path)
            if parent:
                os.makedirs(parent, exist_ok=True)
        # check_same_thread=False plus an explicit lock: the scheduler thread and
        # the command worker thread may both touch the buffer.
        self._conn = sqlite3.connect(self.path, check_same_thread=False, timeout=10.0)
        self._conn.row_factory = sqlite3.Row
        with self._conn:
            try:
                self._conn.execute("PRAGMA journal_mode=WAL")
            except sqlite3.DatabaseError as exc:  # in-memory DBs reject WAL
                logger.debug("WAL mode unavailable for %s: %s", self.path, exc)
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.executescript(SCHEMA)
        logger.debug("Offline buffer ready at %s", self.path)

    @property
    def connection(self) -> sqlite3.Connection:
        """Return the live SQLite connection, reconnecting if necessary."""
        if self._conn is None:
            self._connect()
        assert self._conn is not None
        return self._conn

    def close(self) -> None:
        """Close the underlying SQLite connection."""
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.close()
                finally:
                    self._conn = None

    def __enter__(self) -> "PayloadBuffer":
        return self

    def __exit__(self, *_exc_info: object) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Queue operations
    # ------------------------------------------------------------------
    def enqueue(self, body: str, created_at: Optional[int] = None) -> int:
        """Append a serialised payload and return its row id."""
        timestamp = int(created_at if created_at is not None else time.time())
        with self._lock:
            conn = self.connection
            with conn:
                cursor = conn.execute(
                    "INSERT INTO payloads (created_at, body) VALUES (?, ?)",
                    (timestamp, body),
                )
                row_id = int(cursor.lastrowid or 0)
            dropped = self._evict_locked(conn)
        if dropped:
            logger.warning(
                "Offline buffer full (%d rows), dropped %d oldest payload(s)",
                self.max_rows,
                dropped,
            )
        return row_id

    def fetch_batch(self, limit: int = FLUSH_BATCH_SIZE) -> List[Tuple[int, str]]:
        """Return up to ``limit`` buffered payloads, oldest first."""
        with self._lock:
            rows = self.connection.execute(
                "SELECT id, body FROM payloads ORDER BY id ASC LIMIT ?",
                (max(1, int(limit)),),
            ).fetchall()
        return [(int(row["id"]), str(row["body"])) for row in rows]

    def delete(self, row_ids: Sequence[int]) -> int:
        """Delete the given rows and return how many were removed."""
        ids = [int(row_id) for row_id in row_ids]
        if not ids:
            return 0
        placeholders = ",".join("?" for _ in ids)
        with self._lock:
            conn = self.connection
            with conn:
                cursor = conn.execute(
                    f"DELETE FROM payloads WHERE id IN ({placeholders})", ids
                )
            return int(cursor.rowcount or 0)

    def count(self) -> int:
        """Return the number of buffered payloads."""
        with self._lock:
            row = self.connection.execute("SELECT COUNT(*) AS n FROM payloads").fetchone()
        return int(row["n"]) if row else 0

    def oldest_created_at(self) -> Optional[int]:
        """Return the creation timestamp of the oldest buffered payload."""
        with self._lock:
            row = self.connection.execute(
                "SELECT MIN(created_at) AS oldest FROM payloads"
            ).fetchone()
        if not row or row["oldest"] is None:
            return None
        return int(row["oldest"])

    def clear(self) -> int:
        """Remove every buffered payload and return the number deleted."""
        with self._lock:
            conn = self.connection
            with conn:
                cursor = conn.execute("DELETE FROM payloads")
            return int(cursor.rowcount or 0)

    # ------------------------------------------------------------------
    # Maintenance
    # ------------------------------------------------------------------
    def purge_expired(self, now: Optional[int] = None) -> int:
        """Delete payloads older than ``retention_hours`` and return the count."""
        cutoff = int(now if now is not None else time.time()) - self.retention_hours * 3600
        with self._lock:
            conn = self.connection
            with conn:
                cursor = conn.execute("DELETE FROM payloads WHERE created_at < ?", (cutoff,))
            removed = int(cursor.rowcount or 0)
        if removed:
            logger.info(
                "Purged %d payload(s) older than %d hour(s) from the offline buffer",
                removed,
                self.retention_hours,
            )
        return removed

    def enforce_limit(self) -> int:
        """Drop the oldest rows until the buffer fits ``max_rows``."""
        with self._lock:
            dropped = self._evict_locked(self.connection)
        if dropped:
            logger.warning("Offline buffer trimmed, dropped %d oldest payload(s)", dropped)
        return dropped

    def _evict_locked(self, conn: sqlite3.Connection) -> int:
        """Trim the buffer to ``max_rows``.  The caller must hold the lock."""
        row = conn.execute("SELECT COUNT(*) AS n FROM payloads").fetchone()
        total = int(row["n"]) if row else 0
        excess = total - self.max_rows
        if excess <= 0:
            return 0
        with conn:
            cursor = conn.execute(
                "DELETE FROM payloads WHERE id IN ("
                " SELECT id FROM payloads ORDER BY id ASC LIMIT ?"
                ")",
                (excess,),
            )
        return int(cursor.rowcount or 0)

    def maintain(self, now: Optional[int] = None) -> Tuple[int, int]:
        """Run both retention and size enforcement.

        Returns:
            ``(expired_rows, evicted_rows)``.
        """
        return self.purge_expired(now=now), self.enforce_limit()
