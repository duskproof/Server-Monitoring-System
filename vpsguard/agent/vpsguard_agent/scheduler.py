"""Main agent loop.

The scheduler drives the two collection tiers, ships payloads, replays the
offline buffer and dispatches remote commands.  Timing is based on
:func:`time.monotonic` so clock adjustments cannot stall or stampede the loop,
and the sleep is shortened by the time collection already took.
"""

from __future__ import annotations

import signal
import threading
import time
from typing import Any, Dict, List, Optional

from .buffer import FLUSH_BATCH_SIZE, PayloadBuffer
from .commands import CommandExecutor, parse_commands
from .config import Config
from .logging_setup import get_logger
from .payload import PayloadBuilder, serialise
from .transport import AuthError, Transport, TransportError

logger = get_logger("scheduler")

#: Multiplier applied to the interval while the API key is being rejected.
AUTH_BACKOFF_MULTIPLIER = 10
#: Upper bound for the authentication backoff, in seconds.
AUTH_BACKOFF_MAX = 300


class Scheduler:
    """Own the agent lifecycle: collect, send, buffer, execute."""

    def __init__(
        self,
        config: Config,
        builder: Optional[PayloadBuilder] = None,
        transport: Optional[Transport] = None,
        payload_buffer: Optional[PayloadBuffer] = None,
        executor: Optional[CommandExecutor] = None,
    ) -> None:
        self.config = config
        self.builder = builder or PayloadBuilder(config)
        self.transport = transport or Transport(config)
        self.buffer = payload_buffer or PayloadBuffer(
            config.buffer_path,
            max_rows=config.buffer_size,
            retention_hours=config.buffer_retention_hours,
        )
        self.executor = executor or CommandExecutor(config)

        self._stop = threading.Event()
        self._command_thread: Optional[threading.Thread] = None
        self._auth_failed = False
        self.cycles = 0

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def install_signal_handlers(self) -> None:
        """Stop the loop cleanly on SIGTERM/SIGINT."""
        for signal_name in ("SIGTERM", "SIGINT"):
            signal_number = getattr(signal, signal_name, None)
            if signal_number is None:
                continue
            try:
                signal.signal(signal_number, self._handle_signal)
            except (ValueError, OSError) as exc:  # not the main thread
                logger.debug("Cannot install %s handler: %s", signal_name, exc)

    def _handle_signal(self, signum: int, _frame: Any) -> None:
        logger.info("Received signal %s, shutting down after the current cycle", signum)
        self._stop.set()

    def stop(self) -> None:
        """Request a shutdown."""
        self._stop.set()

    @property
    def stopped(self) -> bool:
        return self._stop.is_set()

    def run(self, max_cycles: Optional[int] = None) -> int:
        """Run the collection loop.

        Args:
            max_cycles: Stop after this many cycles (used by tests).

        Returns:
            Process exit code.
        """
        self.install_signal_handlers()
        logger.info(
            "VPSGuard agent starting: target=%s interval=%ss slow_interval=%ss buffered=%d",
            self.config.url,
            self.config.interval,
            self.config.slow_interval,
            self.buffer.count(),
        )

        try:
            while not self._stop.is_set():
                started = time.monotonic()
                self.cycle()
                self.cycles += 1

                if max_cycles is not None and self.cycles >= max_cycles:
                    break

                elapsed = time.monotonic() - started
                self._stop.wait(self._sleep_seconds(elapsed))
        except Exception as exc:  # noqa: BLE001 - report and exit non-zero
            logger.exception("Agent loop crashed: %s", exc)
            return 1
        finally:
            self.shutdown()

        logger.info("VPSGuard agent stopped after %d cycle(s)", self.cycles)
        return 0

    def _sleep_seconds(self, elapsed: float) -> float:
        interval = float(self.config.interval)
        if self._auth_failed:
            interval = min(interval * AUTH_BACKOFF_MULTIPLIER, AUTH_BACKOFF_MAX)
        return max(1.0, interval - elapsed)

    def shutdown(self) -> None:
        """Release every resource the scheduler owns."""
        thread = self._command_thread
        if thread is not None and thread.is_alive():
            logger.info("Waiting for the running command batch to finish")
            thread.join(timeout=self.config.command_timeout + 5)
        self.transport.close()
        self.buffer.close()

    # ------------------------------------------------------------------
    # One cycle
    # ------------------------------------------------------------------
    def cycle(self) -> bool:
        """Collect and deliver one payload.

        Returns:
            ``True`` when the payload reached the server.
        """
        body = serialise(self.builder.build())

        delivered = False
        try:
            response = self.transport.send_payload(body)
        except AuthError as exc:
            if not self._auth_failed:
                logger.error(
                    "FATAL CONFIGURATION ERROR: %s Metrics are being buffered locally; "
                    "the agent will keep retrying slowly until the key is fixed.",
                    exc,
                )
            self._auth_failed = True
            self.buffer.enqueue(body)
        except TransportError as exc:
            logger.warning("Delivery failed, buffering payload: %s", exc)
            self.buffer.enqueue(body)
        else:
            if self._auth_failed:
                logger.info("Authentication recovered, resuming the normal interval")
            self._auth_failed = False
            delivered = True
            self.handle_response(response)
            self.flush_buffer()

        self.buffer.maintain()
        return delivered

    def handle_response(self, response: Dict[str, Any]) -> None:
        """Apply the server response: server id assignment and commands."""
        if not isinstance(response, dict):
            return

        status = str(response.get("status") or "ok")
        if status not in ("ok", "success", "accepted"):
            logger.warning("Server reported status %r", status)

        self.builder.adopt_server_id(response.get("server_id"))

        commands = parse_commands(response)
        if commands:
            self.dispatch_commands(commands)

    # ------------------------------------------------------------------
    # Offline buffer
    # ------------------------------------------------------------------
    def flush_buffer(self, batch_size: int = FLUSH_BATCH_SIZE) -> int:
        """Replay buffered payloads oldest-first.

        Returns:
            The number of payloads successfully delivered.
        """
        batch = self.buffer.fetch_batch(batch_size)
        if not batch:
            return 0

        logger.info("Replaying %d buffered payload(s)", len(batch))
        delivered: List[int] = []
        for row_id, body in batch:
            try:
                self.transport.send_payload(body)
            except AuthError as exc:
                logger.error("Stopping buffer replay, credentials rejected: %s", exc)
                self._auth_failed = True
                break
            except TransportError as exc:
                logger.warning("Buffer replay interrupted, will retry later: %s", exc)
                break
            delivered.append(row_id)

        if delivered:
            self.buffer.delete(delivered)
            logger.info(
                "Delivered %d buffered payload(s), %d still queued",
                len(delivered),
                self.buffer.count(),
            )
        return len(delivered)

    # ------------------------------------------------------------------
    # Remote commands
    # ------------------------------------------------------------------
    def dispatch_commands(self, commands: List[Dict[str, Any]]) -> bool:
        """Run a command batch in a worker thread.

        Commands run off the collection thread so a slow command cannot delay
        metric delivery.  Only one batch runs at a time.

        Returns:
            ``True`` when the batch was started.
        """
        if self._command_thread is not None and self._command_thread.is_alive():
            logger.warning(
                "Skipping %d command(s): the previous batch is still running",
                len(commands),
            )
            return False

        thread = threading.Thread(
            target=self._run_commands,
            args=(commands,),
            name="vpsguard-commands",
            daemon=True,
        )
        self._command_thread = thread
        thread.start()
        return True

    def _run_commands(self, commands: List[Dict[str, Any]]) -> None:
        for command in commands:
            if self._stop.is_set():
                logger.info("Shutdown requested, abandoning the remaining commands")
                return
            result = self.executor.execute(command)
            try:
                self.transport.send_command_result(str(command.get("id")), result.to_dict())
            except AuthError as exc:
                logger.error("Cannot report command results, credentials rejected: %s", exc)
                self._auth_failed = True
                return
            except TransportError as exc:
                logger.warning("Could not report command result: %s", exc)
