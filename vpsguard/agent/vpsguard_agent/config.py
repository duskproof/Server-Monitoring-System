"""Configuration loading for the VPSGuard agent.

The agent is configured through an INI file (``/etc/vpsguard/agent.conf`` by
default).  Every value has a safe default, so a minimal configuration only
needs the server URL and the API key.  A small set of environment variables can
override the most volatile settings, which is handy for containers.
"""

from __future__ import annotations

import configparser
import os
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

DEFAULT_CONFIG_PATH = "/etc/vpsguard/agent.conf"
DEFAULT_STATE_DIR = "/var/lib/vpsguard"
DEFAULT_LOG_DIR = "/var/log/vpsguard"

INGEST_PATH = "/api/v1/ingest"
COMMAND_RESULT_PATH = "/api/v1/agent/commands/{command_id}/result"

VALID_LOG_LEVELS = ("debug", "info", "warning", "error", "critical")

#: Metric names that can be toggled in the ``[metrics]`` section.
METRIC_KEYS = (
    "cpu",
    "memory",
    "disk",
    "network",
    "processes",
    "services",
    "docker",
    "temperature",
    "smart",
    "security",
    "ssl",
    "logs",
)

_DEFAULTS: Dict[str, Dict[str, str]] = {
    "server": {
        "url": "",
        "api_key": "",
    },
    "agent": {
        "interval": "30",
        "slow_interval": "300",
        "log_level": "info",
        "buffer_size": "1000",
        "buffer_retention_hours": "24",
        "allow_commands": "false",
        "command_user": "vpsguard",
        "command_timeout": "60",
        "verify_tls": "true",
        "state_dir": DEFAULT_STATE_DIR,
        "log_dir": DEFAULT_LOG_DIR,
        "log_file": "",
        "top_processes": "10",
        "subprocess_refresh_seconds": "60",
        "request_timeout": "10",
    },
    "metrics": {key: "true" for key in METRIC_KEYS},
    "logs": {
        "files": "/var/log/syslog,/var/log/auth.log",
        "patterns": "error,critical,failed,denied",
        "max_lines": "2000",
    },
    "ssl": {
        "domains": "",
    },
}

#: Environment variable -> (section, option) overrides.
ENV_OVERRIDES: Dict[str, Tuple[str, str]] = {
    "VPSGUARD_URL": ("server", "url"),
    "VPSGUARD_API_KEY": ("server", "api_key"),
    "VPSGUARD_INTERVAL": ("agent", "interval"),
    "VPSGUARD_LOG_LEVEL": ("agent", "log_level"),
}

_TRUE_VALUES = ("1", "true", "yes", "on", "enabled")
_FALSE_VALUES = ("0", "false", "no", "off", "disabled")


class ConfigError(Exception):
    """Raised when the configuration is missing or invalid."""


@dataclass
class Config:
    """Fully resolved agent configuration."""

    # [server]
    url: str = ""
    api_key: str = ""

    # [agent]
    interval: int = 30
    slow_interval: int = 300
    log_level: str = "info"
    buffer_size: int = 1000
    buffer_retention_hours: int = 24
    allow_commands: bool = False
    command_user: str = "vpsguard"
    command_timeout: int = 60
    verify_tls: bool = True
    state_dir: str = DEFAULT_STATE_DIR
    log_dir: str = DEFAULT_LOG_DIR
    log_file: str = ""
    top_processes: int = 10
    subprocess_refresh_seconds: int = 60
    request_timeout: int = 10

    # [metrics]
    metrics: Dict[str, bool] = field(default_factory=dict)

    # [logs]
    log_files: List[str] = field(default_factory=list)
    log_patterns: List[str] = field(default_factory=list)
    log_max_lines: int = 2000

    # [ssl]
    ssl_domains: List[Tuple[str, int]] = field(default_factory=list)

    #: Path the configuration was loaded from (empty when built from defaults).
    source_path: str = ""

    @property
    def ingest_url(self) -> str:
        """Absolute URL of the metrics ingest endpoint."""
        return self.url.rstrip("/") + INGEST_PATH

    def command_result_url(self, command_id: str) -> str:
        """Absolute URL used to report the result of a remote command."""
        return self.url.rstrip("/") + COMMAND_RESULT_PATH.format(command_id=command_id)

    @property
    def buffer_path(self) -> str:
        """Path of the SQLite offline buffer."""
        return os.path.join(self.state_dir, "buffer.db")

    @property
    def server_id_path(self) -> str:
        """Path of the file holding the server id assigned by the server."""
        return os.path.join(self.state_dir, "server_id")

    def metric_enabled(self, name: str) -> bool:
        """Return whether the collector ``name`` is enabled."""
        return bool(self.metrics.get(name, False))

    def redacted(self) -> Dict[str, object]:
        """Return a dict view of the configuration with the API key masked."""
        return {
            "config_path": self.source_path,
            "url": self.url,
            "api_key": mask_secret(self.api_key),
            "interval": self.interval,
            "slow_interval": self.slow_interval,
            "log_level": self.log_level,
            "buffer_size": self.buffer_size,
            "buffer_retention_hours": self.buffer_retention_hours,
            "allow_commands": self.allow_commands,
            "command_user": self.command_user,
            "command_timeout": self.command_timeout,
            "verify_tls": self.verify_tls,
            "state_dir": self.state_dir,
            "enabled_metrics": sorted(k for k, v in self.metrics.items() if v),
            "log_files": self.log_files,
            "log_patterns": self.log_patterns,
            "ssl_domains": [f"{host}:{port}" for host, port in self.ssl_domains],
        }


def mask_secret(value: str) -> str:
    """Mask a secret so it can safely be written to logs."""
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def parse_bool(value: str, option: str) -> bool:
    """Parse an INI boolean, raising :class:`ConfigError` on garbage input."""
    normalised = str(value).strip().lower()
    if normalised in _TRUE_VALUES:
        return True
    if normalised in _FALSE_VALUES:
        return False
    raise ConfigError(f"Option '{option}' must be a boolean, got {value!r}")


def _parse_int(value: str, option: str, minimum: int = 1) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        raise ConfigError(f"Option '{option}' must be an integer, got {value!r}") from None
    if parsed < minimum:
        raise ConfigError(f"Option '{option}' must be >= {minimum}, got {parsed}")
    return parsed


def _split_list(value: str) -> List[str]:
    return [item.strip() for item in str(value).split(",") if item.strip()]


def _parse_domains(value: str) -> List[Tuple[str, int]]:
    """Parse ``example.com:443,other.com`` into ``[(host, port), ...]``."""
    domains: List[Tuple[str, int]] = []
    for entry in _split_list(value):
        host, _, port_text = entry.partition(":")
        host = host.strip()
        if not host:
            continue
        if port_text.strip():
            try:
                port = int(port_text.strip())
            except ValueError:
                raise ConfigError(
                    f"Invalid port in [ssl] domains entry {entry!r}"
                ) from None
            if not 1 <= port <= 65535:
                raise ConfigError(f"Port out of range in [ssl] domains entry {entry!r}")
        else:
            port = 443
        domains.append((host, port))
    return domains


def config_path_from_env(explicit: str = "") -> str:
    """Resolve the configuration path from CLI flag, env var, or default."""
    if explicit:
        return explicit
    return os.environ.get("VPSGUARD_CONFIG") or DEFAULT_CONFIG_PATH


def load_config(path: str = "", *, apply_env: bool = True, require_file: bool = True) -> Config:
    """Load, merge and validate the agent configuration.

    Args:
        path: Explicit configuration file path.  When empty, ``VPSGUARD_CONFIG``
            and then :data:`DEFAULT_CONFIG_PATH` are used.
        apply_env: Apply the ``VPSGUARD_*`` environment overrides.
        require_file: Fail when the configuration file does not exist.

    Raises:
        ConfigError: The file is missing, unreadable, or holds invalid values.
    """
    resolved_path = config_path_from_env(path)

    parser = configparser.ConfigParser(interpolation=None)
    parser.read_dict(_DEFAULTS)

    file_found = os.path.isfile(resolved_path)
    if file_found:
        try:
            with open(resolved_path, "r", encoding="utf-8") as handle:
                parser.read_file(handle)
        except OSError as exc:
            raise ConfigError(f"Cannot read configuration file {resolved_path}: {exc}") from exc
        except configparser.Error as exc:
            raise ConfigError(f"Invalid configuration file {resolved_path}: {exc}") from exc
    elif require_file:
        raise ConfigError(
            f"Configuration file not found: {resolved_path} "
            "(create it or pass --config /path/to/agent.conf)"
        )

    if apply_env:
        for env_name, (section, option) in ENV_OVERRIDES.items():
            env_value = os.environ.get(env_name)
            if env_value is not None and env_value != "":
                if not parser.has_section(section):
                    parser.add_section(section)
                parser.set(section, option, env_value)

    config = _build_config(parser)
    config.source_path = resolved_path if file_found else ""
    validate_config(config)
    return config


def _build_config(parser: configparser.ConfigParser) -> Config:
    def get(section: str, option: str) -> str:
        return parser.get(section, option, fallback=_DEFAULTS[section][option])

    metrics: Dict[str, bool] = {}
    for key in METRIC_KEYS:
        metrics[key] = parse_bool(get("metrics", key), f"metrics.{key}")

    state_dir = get("agent", "state_dir").strip() or DEFAULT_STATE_DIR
    log_dir = get("agent", "log_dir").strip() or DEFAULT_LOG_DIR
    log_file = get("agent", "log_file").strip()

    return Config(
        url=get("server", "url").strip().rstrip("/"),
        api_key=get("server", "api_key").strip(),
        interval=_parse_int(get("agent", "interval"), "agent.interval", minimum=5),
        slow_interval=_parse_int(get("agent", "slow_interval"), "agent.slow_interval", minimum=10),
        log_level=get("agent", "log_level").strip().lower(),
        buffer_size=_parse_int(get("agent", "buffer_size"), "agent.buffer_size", minimum=1),
        buffer_retention_hours=_parse_int(
            get("agent", "buffer_retention_hours"), "agent.buffer_retention_hours", minimum=1
        ),
        allow_commands=parse_bool(get("agent", "allow_commands"), "agent.allow_commands"),
        command_user=get("agent", "command_user").strip() or "vpsguard",
        command_timeout=_parse_int(
            get("agent", "command_timeout"), "agent.command_timeout", minimum=1
        ),
        verify_tls=parse_bool(get("agent", "verify_tls"), "agent.verify_tls"),
        state_dir=state_dir,
        log_dir=log_dir,
        log_file=log_file,
        top_processes=_parse_int(get("agent", "top_processes"), "agent.top_processes", minimum=1),
        subprocess_refresh_seconds=_parse_int(
            get("agent", "subprocess_refresh_seconds"),
            "agent.subprocess_refresh_seconds",
            minimum=0,
        ),
        request_timeout=_parse_int(
            get("agent", "request_timeout"), "agent.request_timeout", minimum=1
        ),
        metrics=metrics,
        log_files=_split_list(get("logs", "files")),
        log_patterns=_split_list(get("logs", "patterns")),
        log_max_lines=_parse_int(get("logs", "max_lines"), "logs.max_lines", minimum=1),
        ssl_domains=_parse_domains(get("ssl", "domains")),
    )


def validate_config(config: Config) -> None:
    """Validate a :class:`Config`, raising :class:`ConfigError` when unusable."""
    if not config.url:
        raise ConfigError("[server] url is required (e.g. https://monitor.example.com)")
    if not config.url.startswith(("http://", "https://")):
        raise ConfigError(f"[server] url must start with http:// or https://, got {config.url!r}")
    if not config.api_key:
        raise ConfigError("[server] api_key is required")
    if config.log_level not in VALID_LOG_LEVELS:
        raise ConfigError(
            f"[agent] log_level must be one of {', '.join(VALID_LOG_LEVELS)}, "
            f"got {config.log_level!r}"
        )
    if config.slow_interval < config.interval:
        raise ConfigError(
            "[agent] slow_interval must be greater than or equal to interval "
            f"({config.slow_interval} < {config.interval})"
        )
    if config.metric_enabled("logs") and not config.log_patterns:
        raise ConfigError("[logs] patterns must not be empty when the logs collector is enabled")
