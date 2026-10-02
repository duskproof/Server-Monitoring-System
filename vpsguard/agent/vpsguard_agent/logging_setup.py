"""Logging configuration for the VPSGuard agent.

Logs always go to stderr so that ``journald`` picks them up when the agent runs
under systemd.  A rotating file handler is added as well whenever the log
directory is writable, which keeps ``collect-once`` and container runs quiet
about permission problems.
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys
from typing import Optional

LOG_FORMAT = "%(asctime)s %(levelname)-8s [%(name)s] %(message)s"
DATE_FORMAT = "%Y-%m-%dT%H:%M:%S%z"

DEFAULT_LOG_FILENAME = "agent.log"
MAX_LOG_BYTES = 5 * 1024 * 1024
LOG_BACKUP_COUNT = 3

_LEVELS = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
    "critical": logging.CRITICAL,
}


def resolve_level(level: str) -> int:
    """Translate a textual log level into a :mod:`logging` constant."""
    return _LEVELS.get(str(level).strip().lower(), logging.INFO)


def setup_logging(
    level: str = "info",
    log_dir: Optional[str] = None,
    log_file: Optional[str] = None,
    *,
    quiet_stderr: bool = False,
) -> logging.Logger:
    """Configure the ``vpsguard_agent`` logger hierarchy.

    Args:
        level: Textual log level (``debug``..``critical``).
        log_dir: Directory for the rotating log file.  Ignored when
            ``log_file`` is given.
        log_file: Explicit log file path.
        quiet_stderr: Raise the stderr handler to WARNING so that machine
            readable stdout output (``collect-once``) stays clean.

    Returns:
        The configured ``vpsguard_agent`` logger.
    """
    numeric_level = resolve_level(level)
    logger = logging.getLogger("vpsguard_agent")
    logger.setLevel(numeric_level)
    logger.propagate = False

    for handler in list(logger.handlers):
        logger.removeHandler(handler)
        try:
            handler.close()
        except Exception:  # pragma: no cover - defensive close
            pass

    formatter = logging.Formatter(LOG_FORMAT, DATE_FORMAT)

    stream_handler = logging.StreamHandler(stream=sys.stderr)
    stream_handler.setFormatter(formatter)
    stream_handler.setLevel(max(numeric_level, logging.WARNING) if quiet_stderr else numeric_level)
    logger.addHandler(stream_handler)

    target = log_file or (os.path.join(log_dir, DEFAULT_LOG_FILENAME) if log_dir else "")
    if target:
        try:
            parent = os.path.dirname(target)
            if parent:
                os.makedirs(parent, exist_ok=True)
            file_handler = logging.handlers.RotatingFileHandler(
                target,
                maxBytes=MAX_LOG_BYTES,
                backupCount=LOG_BACKUP_COUNT,
                encoding="utf-8",
            )
            file_handler.setFormatter(formatter)
            file_handler.setLevel(numeric_level)
            logger.addHandler(file_handler)
        except OSError as exc:
            logger.warning("File logging disabled, cannot write to %s: %s", target, exc)

    # requests/urllib3 are chatty at INFO; keep them at WARNING unless debugging.
    urllib3_level = logging.DEBUG if numeric_level <= logging.DEBUG else logging.WARNING
    logging.getLogger("urllib3").setLevel(urllib3_level)

    return logger


def get_logger(name: str) -> logging.Logger:
    """Return a child logger of the agent logger."""
    if name.startswith("vpsguard_agent"):
        return logging.getLogger(name)
    return logging.getLogger(f"vpsguard_agent.{name}")
