"""Tests for payload assembly, slow-tier caching and server id persistence."""

from __future__ import annotations

import json
import os

import pytest

from vpsguard_agent import __version__
from vpsguard_agent.collectors.base import FAST, SLOW, BaseCollector
from vpsguard_agent.config import Config
from vpsguard_agent.payload import (
    PayloadBuilder,
    read_server_id,
    serialise,
    write_server_id,
)

REQUIRED_TOP_LEVEL_KEYS = {
    "api_key",
    "server_id",
    "hostname",
    "agent_version",
    "timestamp",
    "uptime_seconds",
    "metrics",
}


class StubCollector(BaseCollector):
    """Collector returning a canned fragment and counting its invocations."""

    def __init__(self, config, name, tier, fragment):
        self.name = name
        self.tier = tier
        super().__init__(config)
        self.fragment = fragment
        self.calls = 0

    def collect(self):
        self.calls += 1
        return dict(self.fragment)


class BrokenCollector(BaseCollector):
    """Collector that always raises, standing in for a missing tool."""

    name = "smart"
    tier = SLOW

    def collect(self):
        raise RuntimeError("smartctl is not installed")


class UnavailableCollector(BaseCollector):
    """Collector reporting itself as unavailable on this host."""

    name = "docker"
    tier = FAST
    required_tools = ("definitely-not-a-real-binary",)

    def collect(self):  # pragma: no cover - never reached
        raise AssertionError("collect() must not run when unavailable")


class NonDictCollector(BaseCollector):
    """Collector with a broken contract."""

    name = "network"
    tier = FAST

    def collect(self):
        return ["not", "a", "dict"]


@pytest.fixture()
def config(tmp_path):
    return Config(
        url="https://monitor.example.com",
        api_key="TEST_KEY",
        state_dir=str(tmp_path),
        metrics={},
    )


@pytest.fixture(autouse=True)
def fixed_boot_time(monkeypatch):
    import psutil

    monkeypatch.setattr(psutil, "boot_time", lambda: 1_000_000.0)


def build(config, collectors):
    return PayloadBuilder(config, collectors=collectors, hostname="web-01")


def test_payload_matches_the_contract(config):
    cpu = StubCollector(config, "cpu", FAST, {"cpu": {"percent": 12.5}})
    logs = StubCollector(config, "logs", SLOW, {"logs": [{"file": "/var/log/syslog"}]})
    builder = build(config, [cpu, logs])

    payload = builder.build()

    assert set(payload) == REQUIRED_TOP_LEVEL_KEYS
    assert payload["api_key"] == "TEST_KEY"
    assert payload["server_id"] is None
    assert payload["hostname"] == "web-01"
    assert payload["agent_version"] == __version__
    assert isinstance(payload["timestamp"], int)
    assert payload["uptime_seconds"] > 0
    assert payload["metrics"]["cpu"] == {"percent": 12.5}
    assert payload["metrics"]["logs"] == [{"file": "/var/log/syslog"}]


def test_failing_collector_is_omitted_not_fatal(config):
    cpu = StubCollector(config, "cpu", FAST, {"cpu": {"percent": 1.0}})
    builder = build(config, [cpu, BrokenCollector(config)])

    metrics = builder.build()["metrics"]

    assert "cpu" in metrics
    assert "smart" not in metrics


def test_unavailable_collector_is_omitted(config):
    builder = build(config, [UnavailableCollector(config)])

    assert builder.build()["metrics"] == {}


def test_collector_returning_a_non_dict_is_omitted(config):
    builder = build(config, [NonDictCollector(config)])

    assert builder.build()["metrics"] == {}


def test_slow_metrics_are_cached_and_merged_into_every_payload(config):
    config.slow_interval = 10_000
    cpu = StubCollector(config, "cpu", FAST, {"cpu": {"percent": 1.0}})
    temperature = StubCollector(
        config, "temperature", SLOW, {"temperatures": [{"sensor": "coretemp"}]}
    )
    builder = build(config, [cpu, temperature])

    first = builder.build()
    second = builder.build()
    third = builder.build()

    assert temperature.calls == 1, "the slow tier must not run on every cycle"
    assert cpu.calls == 3
    for payload in (first, second, third):
        assert payload["metrics"]["temperatures"] == [{"sensor": "coretemp"}]


def test_slow_tier_refreshes_after_the_interval(config, monkeypatch):
    config.slow_interval = 300
    temperature = StubCollector(config, "temperature", SLOW, {"temperatures": []})
    builder = build(config, [temperature])

    builder.build()
    assert temperature.calls == 1

    builder._slow_refreshed_at -= 301  # pretend slow_interval elapsed
    builder.build()

    assert temperature.calls == 2


def test_refresh_slow_can_be_forced_and_skipped(config):
    temperature = StubCollector(config, "temperature", SLOW, {"temperatures": []})
    builder = build(config, [temperature])

    builder.build(refresh_slow=False)
    assert temperature.calls == 0
    assert builder.build(refresh_slow=True)["metrics"] == {"temperatures": []}
    assert temperature.calls == 1


def test_fast_metrics_win_over_stale_slow_values(config):
    config.slow_interval = 10_000
    slow = StubCollector(config, "temperature", SLOW, {"cpu": {"percent": 99.0}})
    fast = StubCollector(config, "cpu", FAST, {"cpu": {"percent": 5.0}})
    builder = build(config, [slow, fast])

    assert builder.build()["metrics"]["cpu"] == {"percent": 5.0}


def test_server_id_is_read_from_disk(config):
    write_server_id(config.server_id_path, "123e4567-e89b-12d3-a456-426614174000")

    builder = build(config, [])

    assert builder.build()["server_id"] == "123e4567-e89b-12d3-a456-426614174000"


def test_adopting_a_server_id_persists_it(config):
    builder = build(config, [])

    assert builder.adopt_server_id("assigned-id") is True
    assert builder.adopt_server_id("assigned-id") is False, "no rewrite for the same id"
    assert builder.adopt_server_id(None) is False
    assert read_server_id(config.server_id_path) == "assigned-id"
    assert builder.build()["server_id"] == "assigned-id"


def test_read_server_id_returns_none_when_absent(tmp_path):
    assert read_server_id(str(tmp_path / "missing")) is None


def test_write_server_id_creates_parent_directories(tmp_path):
    path = str(tmp_path / "nested" / "server_id")

    assert write_server_id(path, "abc") is True
    assert os.path.isfile(path)
    assert read_server_id(path) == "abc"


def test_build_json_is_valid_json(config):
    cpu = StubCollector(config, "cpu", FAST, {"cpu": {"percent": 3.5}})
    builder = build(config, [cpu])

    compact = builder.build_json()
    pretty = builder.build_json(pretty=True)

    assert json.loads(compact)["metrics"]["cpu"]["percent"] == 3.5
    assert "\n" in pretty and "  " in pretty
    assert " " not in compact.split('"metrics"')[0].replace('"api_key":', "")


def test_serialise_handles_unexpected_types():
    class Weird:
        def __str__(self):
            return "weird"

    assert json.loads(serialise({"value": Weird()}))["value"] == "weird"
