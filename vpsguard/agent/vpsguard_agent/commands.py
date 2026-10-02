"""Sandboxed execution of remote commands received from the central server.

Safety rules enforced here:

* commands only run when ``[agent] allow_commands = true``;
* only a fixed set of command types is accepted;
* arguments are validated (service names, log paths) before use;
* ``subprocess`` is always called with an argument list, never ``shell=True``
  with server-supplied data;
* untrusted payloads (``run_script``) run under ``systemd-run --uid=<user>``
  with memory and CPU caps, falling back to ``su -s /bin/sh -c`` when systemd
  is unavailable;
* every invocation is bounded by ``command_timeout`` and its output truncated
  to 8 KiB.

Service control (``systemctl``) intentionally runs with the agent's own
privileges: restarting a unit is impossible from an unprivileged sandbox.  The
service unit ships without extra capabilities, so deployments that want remote
service control must grant polkit/sudo rights explicitly.
"""

from __future__ import annotations

import glob
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .config import Config
from .logging_setup import get_logger

logger = get_logger("commands")

STATUS_SUCCESS = "success"
STATUS_FAILED = "failed"
STATUS_TIMEOUT = "timeout"
STATUS_REJECTED = "rejected"

SUPPORTED_TYPES = (
    "restart_service",
    "stop_service",
    "start_service",
    "restart_docker",
    "run_script",
    "cleanup_logs",
    "agent_update",
    "ping",
)

MAX_OUTPUT_BYTES = 8 * 1024
MAX_TIMEOUT_SECONDS = 900
MAX_SCRIPT_BYTES = 64 * 1024

#: systemd unit names, optionally templated (``getty@tty1.service``).
SERVICE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9@._\-]{0,127}$")

#: Docker container name or short/long ID.
CONTAINER_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,127}$")

#: ``cleanup_logs`` may only touch files below these directories.
ALLOWED_LOG_ROOTS = ("/var/log",)

#: Rotated/compressed log files are safe to delete outright.
ROTATED_SUFFIXES = (".gz", ".xz", ".bz2", ".zst", ".old")
ROTATED_PATTERN = re.compile(r"\.\d+$")

SANDBOX_PROPERTIES = ("--property=MemoryMax=256M", "--property=CPUQuota=50%")

#: stderr fragments proving systemd-run itself failed (not the payload).
SYSTEMD_RUN_SETUP_ERRORS = (
    "failed to connect to bus",
    "interactive authentication required",
    "access denied",
    "operation not permitted",
    "no such file or directory",
    "failed to start transient service",
)


def truncate_output(text: str, limit: int = MAX_OUTPUT_BYTES) -> str:
    """Truncate text to ``limit`` bytes, appending a marker when cut."""
    if not text:
        return ""
    encoded = text.encode("utf-8", errors="replace")
    if len(encoded) <= limit:
        return text
    return encoded[:limit].decode("utf-8", errors="ignore") + "\n... [truncated]"


@dataclass
class CommandResult:
    """Outcome of a remote command, matching the result API contract."""

    status: str
    exit_code: int = 0
    stdout: str = ""
    stderr: str = ""
    duration_ms: int = 0
    command_id: str = field(default="", compare=False)

    def to_dict(self) -> Dict[str, Any]:
        """Return the JSON body for the command result endpoint."""
        return {
            "status": self.status,
            "exit_code": int(self.exit_code),
            "stdout": truncate_output(self.stdout),
            "stderr": truncate_output(self.stderr),
            "duration_ms": int(self.duration_ms),
        }


class CommandExecutor:
    """Validate and execute the remote commands supported by the agent."""

    def __init__(self, config: Config) -> None:
        self.config = config

    # ------------------------------------------------------------------
    # Entry point
    # ------------------------------------------------------------------
    def execute(self, command: Dict[str, Any]) -> CommandResult:
        """Execute one command description and return its result.

        Never raises: unexpected errors are reported as ``failed``.
        """
        command_id = str(command.get("id") or "")
        command_type = str(command.get("type") or "").strip().lower()
        args = command.get("args") or {}
        if not isinstance(args, dict):
            args = {}
        timeout = self._resolve_timeout(command.get("timeout"))

        if not self.config.allow_commands:
            logger.warning(
                "Rejected command %s (%s): remote commands are disabled "
                "([agent] allow_commands = false)",
                command_id or "<no id>",
                command_type or "<no type>",
            )
            return CommandResult(
                STATUS_REJECTED,
                exit_code=1,
                stderr="Remote command execution is disabled on this host",
                command_id=command_id,
            )

        if command_type not in SUPPORTED_TYPES:
            logger.warning("Rejected command %s: unsupported type %r", command_id, command_type)
            return CommandResult(
                STATUS_REJECTED,
                exit_code=1,
                stderr=f"Unsupported command type: {command_type!r}",
                command_id=command_id,
            )

        logger.info("Executing command %s (%s, timeout %ss)", command_id, command_type, timeout)
        started = time.monotonic()
        try:
            result = self._dispatch(command_type, args, timeout)
        except Exception as exc:  # noqa: BLE001 - a bad command must not kill the agent
            logger.exception("Command %s (%s) raised: %s", command_id, command_type, exc)
            result = CommandResult(STATUS_FAILED, exit_code=1, stderr=str(exc))

        result.duration_ms = int((time.monotonic() - started) * 1000)
        result.command_id = command_id
        logger.info(
            "Command %s (%s) finished: %s (exit %s, %d ms)",
            command_id,
            command_type,
            result.status,
            result.exit_code,
            result.duration_ms,
        )
        return result

    def _dispatch(self, command_type: str, args: Dict[str, Any], timeout: int) -> CommandResult:
        if command_type == "ping":
            return CommandResult(STATUS_SUCCESS, stdout="pong")
        if command_type in ("restart_service", "stop_service", "start_service"):
            return self._service_action(command_type.split("_")[0], args, timeout)
        if command_type == "restart_docker":
            return self._docker_restart(args, timeout)
        if command_type == "run_script":
            return self._run_script(args, timeout)
        if command_type == "cleanup_logs":
            return self._cleanup_logs(args, timeout)
        if command_type == "agent_update":
            return self._agent_update(args, timeout)
        # _dispatch is only reached for validated types.
        return CommandResult(STATUS_REJECTED, exit_code=1, stderr="Unhandled command type")

    def _resolve_timeout(self, requested: Any) -> int:
        try:
            value = int(requested) if requested is not None else self.config.command_timeout
        except (TypeError, ValueError):
            value = self.config.command_timeout
        return max(1, min(value, MAX_TIMEOUT_SECONDS))

    # ------------------------------------------------------------------
    # Command implementations
    # ------------------------------------------------------------------
    def _service_action(self, action: str, args: Dict[str, Any], timeout: int) -> CommandResult:
        name = str(args.get("name") or args.get("service") or "").strip()
        if not SERVICE_NAME_RE.match(name):
            return CommandResult(
                STATUS_REJECTED, exit_code=1, stderr=f"Invalid service name: {name!r}"
            )
        if not shutil.which("systemctl"):
            return CommandResult(
                STATUS_FAILED, exit_code=127, stderr="systemctl is not available on this host"
            )
        return self._run(["systemctl", action, name], timeout)

    def _docker_restart(self, args: Dict[str, Any], timeout: int) -> CommandResult:
        name = str(
            args.get("name")
            or args.get("container")
            or args.get("containerName")
            or args.get("container_id")
            or args.get("containerId")
            or ""
        ).strip()
        if not CONTAINER_NAME_RE.match(name):
            return CommandResult(
                STATUS_REJECTED, exit_code=1, stderr=f"Invalid container name/id: {name!r}"
            )
        if not shutil.which("docker"):
            return CommandResult(
                STATUS_FAILED, exit_code=127, stderr="docker is not available on this host"
            )
        return self._run(["docker", "restart", name], timeout)

    def _run_script(self, args: Dict[str, Any], timeout: int) -> CommandResult:
        script = args.get("script") or args.get("content") or ""
        if not isinstance(script, str) or not script.strip():
            return CommandResult(
                STATUS_REJECTED, exit_code=1, stderr="run_script requires a non-empty 'script'"
            )
        if len(script.encode("utf-8")) > MAX_SCRIPT_BYTES:
            return CommandResult(
                STATUS_REJECTED,
                exit_code=1,
                stderr=f"Script exceeds the {MAX_SCRIPT_BYTES} byte limit",
            )

        interpreter = str(args.get("interpreter") or "/bin/sh")
        if not interpreter.startswith("/") or not shutil.which(interpreter):
            return CommandResult(
                STATUS_REJECTED, exit_code=1, stderr=f"Invalid interpreter: {interpreter!r}"
            )

        path = ""
        try:
            path = self._write_script(script)
            return self._run([interpreter, path], timeout, sandbox=True)
        finally:
            if path:
                try:
                    os.unlink(path)
                except OSError as exc:
                    logger.debug("Could not remove temporary script %s: %s", path, exc)

    def _write_script(self, script: str) -> str:
        handle, path = tempfile.mkstemp(prefix="vpsguard-script-", suffix=".sh")
        with os.fdopen(handle, "w", encoding="utf-8") as script_file:
            script_file.write(script)
        os.chmod(path, 0o700)
        # When running as root the sandbox drops to command_user, which then
        # needs read access to the script.
        if self._is_root():
            try:
                import pwd

                entry = pwd.getpwnam(self.config.command_user)
                os.chown(path, entry.pw_uid, entry.pw_gid)
            except (ImportError, KeyError, OSError) as exc:
                logger.warning(
                    "Cannot hand the temporary script to user %s: %s",
                    self.config.command_user,
                    exc,
                )
        return path

    def _cleanup_logs(self, args: Dict[str, Any], timeout: int) -> CommandResult:
        older_than_days = self._positive_int(args.get("older_than_days"), default=7)
        patterns = args.get("paths") or args.get("path") or ["/var/log/*.gz", "/var/log/*/*.gz"]
        if isinstance(patterns, str):
            patterns = [patterns]
        if not isinstance(patterns, (list, tuple)):
            return CommandResult(
                STATUS_REJECTED, exit_code=1, stderr="'paths' must be a string or a list"
            )
        truncate_active = bool(args.get("truncate_active"))

        cutoff = time.time() - older_than_days * 86400
        removed: List[str] = []
        truncated: List[str] = []
        errors: List[str] = []
        freed_bytes = 0

        for pattern in patterns:
            pattern = str(pattern)
            if not self._is_allowed_log_path(pattern):
                errors.append(f"{pattern}: outside the allowed roots {ALLOWED_LOG_ROOTS}")
                continue
            for path in sorted(glob.glob(pattern)):
                if not os.path.isfile(path) or os.path.islink(path):
                    continue
                if not self._is_allowed_log_path(os.path.realpath(path)):
                    errors.append(f"{path}: resolves outside the allowed roots")
                    continue
                try:
                    stat = os.stat(path)
                    if stat.st_mtime > cutoff:
                        continue
                    if self._is_rotated(path):
                        os.unlink(path)
                        removed.append(path)
                        freed_bytes += stat.st_size
                    elif truncate_active:
                        with open(path, "w", encoding="utf-8"):
                            pass
                        truncated.append(path)
                        freed_bytes += stat.st_size
                except OSError as exc:
                    errors.append(f"{path}: {exc}")

        journal_note = self._vacuum_journal(older_than_days, timeout)

        report = [
            f"Removed {len(removed)} rotated log file(s)",
            f"Truncated {len(truncated)} active log file(s)",
            f"Reclaimed approximately {freed_bytes / (1024 * 1024):.2f} MB",
        ]
        if journal_note:
            report.append(journal_note)
        report.extend(f"removed: {path}" for path in removed[:50])
        report.extend(f"truncated: {path}" for path in truncated[:50])

        failed = bool(errors) and not removed and not truncated
        return CommandResult(
            STATUS_FAILED if failed else STATUS_SUCCESS,
            exit_code=1 if failed else 0,
            stdout="\n".join(report),
            stderr="\n".join(errors),
        )

    def _vacuum_journal(self, older_than_days: int, timeout: int) -> str:
        if not shutil.which("journalctl"):
            return ""
        result = self._run(
            ["journalctl", f"--vacuum-time={older_than_days}d"], min(timeout, 120)
        )
        if result.status != STATUS_SUCCESS:
            return f"journalctl vacuum failed: {result.stderr.strip()[:200]}"
        return f"journalctl vacuum: {result.stdout.strip().splitlines()[-1] if result.stdout.strip() else 'done'}"

    def _agent_update(self, args: Dict[str, Any], timeout: int) -> CommandResult:
        package = str(args.get("package") or "vpsguard-agent")
        if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._\-]{0,99}(==[A-Za-z0-9._\-]{1,32})?$", package):
            return CommandResult(
                STATUS_REJECTED, exit_code=1, stderr=f"Invalid package specifier: {package!r}"
            )

        python = self._agent_python()
        argv = [python, "-m", "pip", "install", "--upgrade", "--no-input", package]
        index_url = str(args.get("index_url") or "")
        if index_url:
            if not index_url.startswith("https://"):
                return CommandResult(
                    STATUS_REJECTED, exit_code=1, stderr="index_url must use https://"
                )
            argv.extend(["--index-url", index_url])

        result = self._run(argv, max(timeout, 120))
        if result.status != STATUS_SUCCESS:
            return result

        if bool(args.get("restart", True)):
            note = self._schedule_restart()
            result.stdout = f"{result.stdout}\n{note}".strip()
        return result

    @staticmethod
    def _agent_python() -> str:
        """Return the interpreter that owns the agent installation."""
        venv_python = "/opt/vpsguard/bin/python"
        if os.path.isfile(venv_python):
            return venv_python
        import sys

        return sys.executable or "python3"

    @staticmethod
    def _schedule_restart() -> str:
        """Restart the agent shortly after the result has been reported."""
        if not shutil.which("systemctl"):
            return "systemctl unavailable, restart the agent manually"
        try:
            # Fixed literal command, no server-supplied data is interpolated.
            subprocess.Popen(  # noqa: S603 - static argv, shell=False
                ["/bin/sh", "-c", "sleep 5; systemctl restart vpsguard-agent.service"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except OSError as exc:
            return f"could not schedule agent restart: {exc}"
        return "agent restart scheduled in 5 seconds"

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _is_root() -> bool:
        geteuid = getattr(os, "geteuid", None)
        return bool(geteuid and geteuid() == 0)

    @staticmethod
    def _positive_int(value: Any, default: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return default
        return parsed if parsed >= 0 else default

    @staticmethod
    def _is_allowed_log_path(path: str) -> bool:
        normalised = os.path.normpath(path)
        if ".." in normalised.split(os.sep):
            return False
        return any(
            normalised == root or normalised.startswith(root + "/") for root in ALLOWED_LOG_ROOTS
        )

    @staticmethod
    def _is_rotated(path: str) -> bool:
        base = os.path.basename(path)
        if base.endswith(ROTATED_SUFFIXES):
            return True
        return bool(ROTATED_PATTERN.search(base))

    def sandbox_argv(self, argv: Sequence[str]) -> Tuple[List[str], str]:
        """Wrap ``argv`` so it runs unprivileged and resource capped.

        Returns:
            ``(wrapped_argv, strategy)`` where strategy is ``systemd-run``,
            ``su`` or ``direct``.
        """
        argv = [str(part) for part in argv]
        if not self._is_root():
            # Already unprivileged: systemd-run/su would only add failure modes.
            return argv, "direct"
        if shutil.which("systemd-run"):
            wrapped = [
                "systemd-run",
                f"--uid={self.config.command_user}",
                "--pipe",
                "--collect",
                "--quiet",
                *SANDBOX_PROPERTIES,
                "--",
                *argv,
            ]
            return wrapped, "systemd-run"
        if shutil.which("su"):
            quoted = " ".join(shlex.quote(part) for part in argv)
            return ["su", "-s", "/bin/sh", "-c", quoted, self.config.command_user], "su"
        logger.warning(
            "Neither systemd-run nor su is available, running command with agent privileges"
        )
        return argv, "direct"

    def _run(
        self, argv: Sequence[str], timeout: int, sandbox: bool = False
    ) -> CommandResult:
        """Run a command, optionally inside the unprivileged sandbox."""
        effective, strategy = self.sandbox_argv(argv) if sandbox else ([str(p) for p in argv], "direct")
        result = self._spawn(effective, timeout)

        if (
            sandbox
            and strategy == "systemd-run"
            and result.status == STATUS_FAILED
            and self._is_sandbox_setup_failure(result.stderr)
        ):
            logger.warning(
                "systemd-run sandbox unavailable (%s), falling back to su",
                result.stderr.strip().splitlines()[0] if result.stderr.strip() else "unknown",
            )
            if shutil.which("su"):
                quoted = " ".join(shlex.quote(str(part)) for part in argv)
                fallback = ["su", "-s", "/bin/sh", "-c", quoted, self.config.command_user]
                result = self._spawn(fallback, timeout)
        return result

    @staticmethod
    def _is_sandbox_setup_failure(stderr: str) -> bool:
        lowered = (stderr or "").lower()
        return any(marker in lowered for marker in SYSTEMD_RUN_SETUP_ERRORS)

    @staticmethod
    def _spawn(argv: Sequence[str], timeout: int) -> CommandResult:
        argv = [str(part) for part in argv]
        try:
            completed = subprocess.run(  # noqa: S603 - argv list, shell=False
                argv,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout.decode("utf-8", errors="replace") if exc.stdout else ""
            stderr = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else ""
            return CommandResult(
                STATUS_TIMEOUT,
                exit_code=124,
                stdout=stdout,
                stderr=(stderr + f"\nCommand timed out after {timeout}s").strip(),
            )
        except FileNotFoundError:
            return CommandResult(
                STATUS_FAILED, exit_code=127, stderr=f"{argv[0]}: command not found"
            )
        except OSError as exc:
            return CommandResult(STATUS_FAILED, exit_code=126, stderr=str(exc))

        stdout = completed.stdout.decode("utf-8", errors="replace") if completed.stdout else ""
        stderr = completed.stderr.decode("utf-8", errors="replace") if completed.stderr else ""
        status = STATUS_SUCCESS if completed.returncode == 0 else STATUS_FAILED
        return CommandResult(
            status, exit_code=completed.returncode, stdout=stdout, stderr=stderr
        )


def parse_commands(response: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Extract the command list from an ingest response, ignoring junk."""
    if not isinstance(response, dict):
        return []
    commands = response.get("commands")
    if not isinstance(commands, list):
        return []
    valid: List[Dict[str, Any]] = []
    for command in commands:
        if not isinstance(command, dict):
            logger.warning("Ignoring malformed command entry: %r", command)
            continue
        if not command.get("id"):
            logger.warning("Ignoring command without an id: %r", command)
            continue
        valid.append(command)
    return valid
