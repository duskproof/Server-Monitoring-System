"""Tests for configuration loading, defaults, overrides and validation."""

from __future__ import annotations

import os

import pytest

from vpsguard_agent.config import (
    Config,
    ConfigError,
    config_path_from_env,
    load_config,
    mask_secret,
    parse_bool,
    validate_config,
)

FULL_CONFIG = """
[server]
url = https://monitor.example.com/
api_key = SECRET_KEY_VALUE

[agent]
interval = 15
slow_interval = 120
log_level = debug
buffer_size = 500
buffer_retention_hours = 12
allow_commands = false
command_user = someone
command_timeout = 45
verify_tls = false

[metrics]
cpu = true
memory = true
disk = false
network = yes
processes = no
docker = 0
security = 1
ssl = off
logs = on
services = true
temperature = false
smart = false

[logs]
files = /var/log/syslog, /var/log/auth.log
patterns = error, denied
max_lines = 100

[ssl]
domains = example.com:8443, plain.example.org
"""

MINIMAL_CONFIG = """
[server]
url = https://monitor.example.com
api_key = KEY
"""


def write_config(tmp_path, content: str) -> str:
    path = tmp_path / "agent.conf"
    path.write_text(content, encoding="utf-8")
    return str(path)


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    """Keep the developer's own VPSGUARD_* variables out of the tests."""
    for name in (
        "VPSGUARD_URL",
        "VPSGUARD_API_KEY",
        "VPSGUARD_INTERVAL",
        "VPSGUARD_LOG_LEVEL",
        "VPSGUARD_CONFIG",
    ):
        monkeypatch.delenv(name, raising=False)


def test_full_config_is_parsed(tmp_path):
    config = load_config(write_config(tmp_path, FULL_CONFIG))

    assert config.url == "https://monitor.example.com"  # trailing slash stripped
    assert config.api_key == "SECRET_KEY_VALUE"
    assert config.interval == 15
    assert config.slow_interval == 120
    assert config.log_level == "debug"
    assert config.buffer_size == 500
    assert config.buffer_retention_hours == 12
    assert config.allow_commands is False
    assert config.command_user == "someone"
    assert config.command_timeout == 45
    assert config.verify_tls is False
    assert config.log_files == ["/var/log/syslog", "/var/log/auth.log"]
    assert config.log_patterns == ["error", "denied"]
    assert config.log_max_lines == 100
    assert config.ssl_domains == [("example.com", 8443), ("plain.example.org", 443)]


def test_metric_toggles_accept_all_boolean_spellings(tmp_path):
    config = load_config(write_config(tmp_path, FULL_CONFIG))

    assert config.metric_enabled("cpu") is True
    assert config.metric_enabled("network") is True
    assert config.metric_enabled("security") is True
    assert config.metric_enabled("logs") is True
    assert config.metric_enabled("disk") is False
    assert config.metric_enabled("processes") is False
    assert config.metric_enabled("docker") is False
    assert config.metric_enabled("ssl") is False


def test_defaults_are_applied_for_a_minimal_config(tmp_path):
    config = load_config(write_config(tmp_path, MINIMAL_CONFIG))

    assert config.interval == 30
    assert config.slow_interval == 300
    assert config.log_level == "info"
    assert config.buffer_size == 1000
    assert config.buffer_retention_hours == 24
    assert config.allow_commands is False
    assert config.command_user == "vpsguard"
    assert config.command_timeout == 60
    assert config.verify_tls is True
    assert config.top_processes == 10
    assert all(config.metric_enabled(name) for name in ("cpu", "memory", "disk", "smart"))


def test_environment_variables_override_the_file(tmp_path, monkeypatch):
    monkeypatch.setenv("VPSGUARD_URL", "https://env.example.com")
    monkeypatch.setenv("VPSGUARD_API_KEY", "ENV_KEY")
    monkeypatch.setenv("VPSGUARD_INTERVAL", "60")
    monkeypatch.setenv("VPSGUARD_LOG_LEVEL", "warning")

    config = load_config(write_config(tmp_path, FULL_CONFIG))

    assert config.url == "https://env.example.com"
    assert config.api_key == "ENV_KEY"
    assert config.interval == 60
    assert config.log_level == "warning"


def test_environment_overrides_can_be_disabled(tmp_path, monkeypatch):
    monkeypatch.setenv("VPSGUARD_API_KEY", "ENV_KEY")

    config = load_config(write_config(tmp_path, MINIMAL_CONFIG), apply_env=False)

    assert config.api_key == "KEY"


def test_vpsguard_config_env_selects_the_path(tmp_path, monkeypatch):
    path = write_config(tmp_path, MINIMAL_CONFIG)
    monkeypatch.setenv("VPSGUARD_CONFIG", path)

    assert config_path_from_env() == path
    assert load_config().source_path == path


def test_explicit_path_wins_over_env(tmp_path, monkeypatch):
    monkeypatch.setenv("VPSGUARD_CONFIG", str(tmp_path / "other.conf"))
    path = write_config(tmp_path, MINIMAL_CONFIG)

    assert config_path_from_env(path) == path


def test_missing_file_raises(tmp_path):
    with pytest.raises(ConfigError, match="Configuration file not found"):
        load_config(str(tmp_path / "absent.conf"))


def test_missing_file_tolerated_when_not_required(tmp_path, monkeypatch):
    monkeypatch.setenv("VPSGUARD_URL", "https://env.example.com")
    monkeypatch.setenv("VPSGUARD_API_KEY", "ENV_KEY")

    config = load_config(str(tmp_path / "absent.conf"), require_file=False)

    assert config.url == "https://env.example.com"
    assert config.source_path == ""


@pytest.mark.parametrize(
    "content, message",
    [
        ("[server]\napi_key = KEY\n", "url is required"),
        ("[server]\nurl = https://x.example\n", "api_key is required"),
        ("[server]\nurl = ftp://x.example\napi_key = KEY\n", "must start with http"),
        (
            "[server]\nurl = https://x.example\napi_key = KEY\n[agent]\nlog_level = loud\n",
            "log_level must be one of",
        ),
        (
            "[server]\nurl = https://x.example\napi_key = KEY\n"
            "[agent]\ninterval = 60\nslow_interval = 30\n",
            "slow_interval must be greater",
        ),
        (
            "[server]\nurl = https://x.example\napi_key = KEY\n[agent]\ninterval = abc\n",
            "must be an integer",
        ),
        (
            "[server]\nurl = https://x.example\napi_key = KEY\n[agent]\nverify_tls = maybe\n",
            "must be a boolean",
        ),
        (
            "[server]\nurl = https://x.example\napi_key = KEY\n[logs]\npatterns =\n",
            "patterns must not be empty",
        ),
        (
            "[server]\nurl = https://x.example\napi_key = KEY\n[ssl]\ndomains = host:notaport\n",
            "Invalid port",
        ),
    ],
)
def test_invalid_configurations_are_rejected(tmp_path, content, message):
    with pytest.raises(ConfigError, match=message):
        load_config(write_config(tmp_path, content))


def test_interval_lower_bound(tmp_path):
    content = "[server]\nurl = https://x.example\napi_key = KEY\n[agent]\ninterval = 1\n"
    with pytest.raises(ConfigError, match="must be >= 5"):
        load_config(write_config(tmp_path, content))


def test_derived_paths_and_urls(tmp_path):
    content = MINIMAL_CONFIG + f"\n[agent]\nstate_dir = {tmp_path.as_posix()}\n"
    config = load_config(write_config(tmp_path, content))

    assert config.ingest_url == "https://monitor.example.com/api/v1/ingest"
    assert config.command_result_url("cmd-1") == (
        "https://monitor.example.com/api/v1/agent/commands/cmd-1/result"
    )
    # normpath keeps the assertion portable: the config file carries POSIX
    # separators while os.path.join emits native ones on Windows.
    assert os.path.normpath(config.buffer_path) == os.path.normpath(
        os.path.join(str(tmp_path), "buffer.db")
    )
    assert os.path.normpath(config.server_id_path) == os.path.normpath(
        os.path.join(str(tmp_path), "server_id")
    )


def test_redacted_view_masks_the_api_key(tmp_path):
    config = load_config(write_config(tmp_path, FULL_CONFIG))
    redacted = config.redacted()

    assert redacted["api_key"] == "SECR...ALUE"
    assert "SECRET_KEY_VALUE" not in str(redacted)
    assert redacted["ssl_domains"] == ["example.com:8443", "plain.example.org:443"]


@pytest.mark.parametrize("value", ["short", "12345678"])
def test_mask_secret_hides_short_keys_completely(value):
    assert mask_secret(value) == "*" * len(value)


def test_mask_secret_handles_empty():
    assert mask_secret("") == ""


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on", "enabled"])
def test_parse_bool_true(value):
    assert parse_bool(value, "option") is True


@pytest.mark.parametrize("value", ["0", "false", "No", "off", "disabled"])
def test_parse_bool_false(value):
    assert parse_bool(value, "option") is False


def test_parse_bool_rejects_garbage():
    with pytest.raises(ConfigError):
        parse_bool("perhaps", "agent.allow_commands")


def test_validate_config_accepts_a_programmatic_config():
    config = Config(url="https://x.example", api_key="KEY", metrics={"logs": False})
    validate_config(config)  # must not raise
