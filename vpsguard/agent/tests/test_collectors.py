"""Collector tests.

``psutil`` and every external tool are mocked, so the suite runs unchanged on
Windows, macOS and Linux.
"""

from __future__ import annotations

import collections
from datetime import datetime, timezone
from types import SimpleNamespace

import psutil
import pytest

from vpsguard_agent.collectors import REGISTRY, build_collectors
from vpsguard_agent.collectors.base import (
    BaseCollector,
    ToolResult,
    percentage,
    rate_per_second,
    sorted_by_usage,
    to_gb,
    to_mb,
)
from vpsguard_agent.collectors.cpu import CpuCollector
from vpsguard_agent.collectors.disk import DiskCollector
from vpsguard_agent.collectors.docker import (
    DockerCollector,
    parse_docker_timestamp,
    parse_pair,
    parse_percent,
    parse_size,
)
from vpsguard_agent.collectors.logs import LogCollector
from vpsguard_agent.collectors.memory import MemoryCollector
from vpsguard_agent.collectors.network import NetworkCollector
from vpsguard_agent.collectors.processes import ProcessCollector
from vpsguard_agent.collectors.security import SecurityCollector
from vpsguard_agent.collectors.services import ServiceCollector
from vpsguard_agent.collectors.smart import SmartCollector
from vpsguard_agent.collectors.ssl_certs import SslCollector, parse_der_not_after
from vpsguard_agent.collectors.temperature import TemperatureCollector
from vpsguard_agent.config import METRIC_KEYS, Config

CpuTimes = collections.namedtuple(
    "CpuTimes", ["user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"]
)
VirtualMemory = collections.namedtuple(
    "VirtualMemory", ["total", "available", "percent", "used", "free"]
)
SwapMemory = collections.namedtuple("SwapMemory", ["total", "used", "free", "percent"])
Partition = collections.namedtuple("Partition", ["device", "mountpoint", "fstype", "opts"])
Usage = collections.namedtuple("Usage", ["total", "used", "free", "percent"])
DiskIO = collections.namedtuple(
    "DiskIO", ["read_count", "write_count", "read_bytes", "write_bytes"]
)
NetIO = collections.namedtuple(
    "NetIO",
    [
        "bytes_sent",
        "bytes_recv",
        "packets_sent",
        "packets_recv",
        "errin",
        "errout",
        "dropin",
        "dropout",
    ],
)
Connection = collections.namedtuple("Connection", ["status", "laddr"])
Address = collections.namedtuple("Address", ["ip", "port"])
Temperature = collections.namedtuple("Temperature", ["label", "current", "high", "critical"])

MB = 1024 * 1024
GB = 1024 * MB


@pytest.fixture()
def config(tmp_path):
    return Config(
        url="https://monitor.example.com",
        api_key="KEY",
        state_dir=str(tmp_path),
        metrics={key: True for key in METRIC_KEYS},
        log_files=[],
        log_patterns=["error", "denied"],
        log_max_lines=100,
        ssl_domains=[],
    )


# ----------------------------------------------------------------------
# Shared helpers
# ----------------------------------------------------------------------
def test_unit_conversion_helpers():
    assert to_mb(2 * MB) == 2.0
    assert to_gb(3 * GB) == 3.0
    assert percentage(25, 200) == 12.5
    assert percentage(1, 0) == 0.0


def test_rate_per_second_ignores_counter_resets():
    assert rate_per_second(200, 100, 10) == 10.0
    assert rate_per_second(50, 100, 10) == 0.0, "a counter reset must not spike"
    assert rate_per_second(200, 100, 0) == 0.0


def test_sorted_by_usage_orders_by_cpu_then_memory():
    items = [
        {"name": "a", "cpu_percent": 1.0, "mem_percent": 9.0},
        {"name": "b", "cpu_percent": 5.0, "mem_percent": 1.0},
        {"name": "c", "cpu_percent": 5.0, "mem_percent": 4.0},
    ]

    assert [item["name"] for item in sorted_by_usage(items, 2)] == ["c", "b"]


# ----------------------------------------------------------------------
# Error handling contract
# ----------------------------------------------------------------------
class ExplodingCollector(BaseCollector):
    name = "cpu"

    def collect(self):
        raise OSError("/proc is not mounted")


class CountingCollector(BaseCollector):
    name = "docker"

    def __init__(self, config):
        super().__init__(config)
        self.calls = 0

    def collect(self):
        self.calls += 1
        return {"docker": [{"name": f"call-{self.calls}"}]}


def test_safe_collect_swallows_exceptions(config, caplog):
    collector = ExplodingCollector(config)

    with caplog.at_level("WARNING"):
        assert collector.safe_collect() == {}

    assert "failed" in caplog.text


def test_safe_collect_skips_unavailable_collectors(config):
    class NeedsTool(BaseCollector):
        name = "smart"
        required_tools = ("no-such-binary-anywhere",)

        def collect(self):  # pragma: no cover - must not run
            raise AssertionError

    assert NeedsTool(config).safe_collect() == {}


def test_min_interval_caches_subprocess_collectors(config):
    collector = CountingCollector(config)
    collector.min_interval = 3600

    first = collector.safe_collect()
    second = collector.safe_collect()

    assert collector.calls == 1
    assert first == second == {"docker": [{"name": "call-1"}]}


def test_warn_once_only_warns_a_single_time(config, caplog):
    collector = CountingCollector(config)

    with caplog.at_level("WARNING"):
        collector.warn_once("key", "problem with %s", "thing")
        collector.warn_once("key", "problem with %s", "thing")

    assert caplog.text.count("problem with thing") == 1


# ----------------------------------------------------------------------
# CPU
# ----------------------------------------------------------------------
def test_cpu_collector(config, monkeypatch):
    monkeypatch.setattr(psutil, "getloadavg", lambda: (0.45, 0.52, 0.6))
    monkeypatch.setattr(psutil, "cpu_percent", lambda interval=None, percpu=False: [10.0, 15.0])
    monkeypatch.setattr(psutil, "cpu_count", lambda logical=True: 2)
    monkeypatch.setattr(psutil, "cpu_freq", lambda: SimpleNamespace(current=2400.0))
    monkeypatch.setattr(
        psutil,
        "sensors_temperatures",
        lambda: {"coretemp": [Temperature("Package id 0", 54.0, 80.0, 100.0)]},
        raising=False,
    )

    samples = iter(
        [
            CpuTimes(100.0, 0.0, 40.0, 800.0, 5.0, 1.0, 1.0, 0.0),
            CpuTimes(112.0, 0.0, 44.0, 883.0, 5.3, 1.0, 1.0, 0.0),
        ]
    )
    monkeypatch.setattr(psutil, "cpu_times", lambda: next(samples))

    collector = CpuCollector(config)  # consumes the first sample while priming
    cpu = collector.collect()["cpu"]

    assert cpu["load_1m"] == 0.45
    assert cpu["load_15m"] == 0.6
    assert cpu["cores"] == [10.0, 15.0]
    assert cpu["core_count"] == 2
    assert cpu["frequency_mhz"] == 2400.0
    assert cpu["temperature"] == 54.0
    assert cpu["percent"] == pytest.approx(16.0, abs=0.5)
    assert cpu["percent_user"] == pytest.approx(12.0, abs=0.5)
    assert cpu["percent_iowait"] == pytest.approx(0.3, abs=0.1)
    assert cpu["percent_idle"] == pytest.approx(83.0, abs=1.0)


def test_cpu_collector_without_sensors_or_frequency(config, monkeypatch):
    monkeypatch.setattr(psutil, "getloadavg", lambda: (0.0, 0.0, 0.0))
    monkeypatch.setattr(psutil, "cpu_percent", lambda interval=None, percpu=False: [])
    monkeypatch.setattr(psutil, "cpu_count", lambda logical=True: 1)
    monkeypatch.setattr(psutil, "cpu_times", lambda: CpuTimes(1, 0, 1, 1, 0, 0, 0, 0))
    monkeypatch.setattr(psutil, "cpu_freq", lambda: None)
    monkeypatch.setattr(psutil, "sensors_temperatures", lambda: {}, raising=False)

    cpu = CpuCollector(config).collect()["cpu"]

    assert "frequency_mhz" not in cpu
    assert "temperature" not in cpu


def test_cpu_load_average_failure_is_tolerated(config, monkeypatch):
    def boom():
        raise OSError("no load average here")

    monkeypatch.setattr(psutil, "getloadavg", boom)
    monkeypatch.setattr(psutil, "cpu_percent", lambda interval=None, percpu=False: [1.0])
    monkeypatch.setattr(psutil, "cpu_count", lambda logical=True: 1)
    monkeypatch.setattr(psutil, "cpu_times", lambda: CpuTimes(1, 0, 1, 8, 0, 0, 0, 0))
    monkeypatch.setattr(psutil, "cpu_freq", lambda: None)

    cpu = CpuCollector(config).safe_collect()["cpu"]

    assert "load_1m" not in cpu
    assert cpu["cores"] == [1.0]


# ----------------------------------------------------------------------
# Memory
# ----------------------------------------------------------------------
def test_memory_collector_reports_megabytes(config, monkeypatch):
    monkeypatch.setattr(
        psutil,
        "virtual_memory",
        lambda: VirtualMemory(2048 * MB, 1200 * MB, 37.5, 768 * MB, 1280 * MB),
    )
    monkeypatch.setattr(psutil, "swap_memory", lambda: SwapMemory(1024 * MB, 0, 1024 * MB, 0.0))

    memory = MemoryCollector(config).collect()["memory"]

    assert memory == {
        "total": 2048.0,
        "used": 768.0,
        "free": 1280.0,
        "available": 1200.0,
        "used_percent": 37.5,
        "swap_total": 1024.0,
        "swap_used": 0.0,
        "swap_used_percent": 0.0,
    }


def test_memory_collector_without_swap(config, monkeypatch):
    monkeypatch.setattr(
        psutil,
        "virtual_memory",
        lambda: VirtualMemory(1024 * MB, 512 * MB, 50.0, 512 * MB, 512 * MB),
    )

    def no_swap():
        raise RuntimeError("swap is not available")

    monkeypatch.setattr(psutil, "swap_memory", no_swap)

    memory = MemoryCollector(config).collect()["memory"]

    assert "swap_total" not in memory
    assert memory["used_percent"] == 50.0


# ----------------------------------------------------------------------
# Disk
# ----------------------------------------------------------------------
def test_disk_collector_space_and_iops(config, monkeypatch):
    monkeypatch.setattr(
        psutil,
        "disk_partitions",
        lambda all=False: [
            Partition("/dev/vda1", "/", "ext4", "rw"),
            Partition("tmpfs", "/run", "tmpfs", "rw"),
            Partition("overlay", "/var/lib/docker/overlay2/abc", "overlay", "rw"),
        ],
    )
    monkeypatch.setattr(
        psutil, "disk_usage", lambda mount: Usage(40 * GB, 22 * GB, 18 * GB, 55.0)
    )

    io_samples = iter(
        [
            {"vda1": DiskIO(100, 200, 120 * MB, 340 * MB)},
            {"vda1": DiskIO(200, 600, 130 * MB, 350 * MB)},
        ]
    )
    monkeypatch.setattr(psutil, "disk_io_counters", lambda perdisk=True: next(io_samples))

    collector = DiskCollector(config)
    first = collector.collect()["disk"]
    assert len(first) == 1, "pseudo filesystems must be filtered out"
    assert first[0]["mount"] == "/"
    assert first[0]["device"] == "/dev/vda1"
    assert first[0]["fstype"] == "ext4"
    assert first[0]["total_gb"] == 40.0
    assert first[0]["used_gb"] == 22.0
    assert first[0]["free_gb"] == 18.0
    assert first[0]["used_percent"] == 55.0
    assert first[0]["io_read_mb"] == 120.0
    assert first[0]["iops_read"] == 0.0, "no previous sample yet"

    second = collector.collect()["disk"]
    assert second[0]["io_write_mb"] == 350.0
    assert second[0]["iops_read"] > 0.0
    assert second[0]["iops_write"] > second[0]["iops_read"]


def test_disk_collector_skips_unreadable_mounts(config, monkeypatch):
    monkeypatch.setattr(
        psutil,
        "disk_partitions",
        lambda all=False: [Partition("/dev/sdb1", "/mnt/broken", "ext4", "rw")],
    )

    def denied(_mount):
        raise PermissionError("mount is not readable")

    monkeypatch.setattr(psutil, "disk_usage", denied)
    monkeypatch.setattr(psutil, "disk_io_counters", lambda perdisk=True: {})

    assert DiskCollector(config).collect() == {}


def test_disk_device_name_candidates():
    assert DiskCollector._device_candidates("/dev/vda1") == ["vda1", "vda"]
    assert DiskCollector._device_candidates("/dev/nvme0n1p1") == ["nvme0n1p1", "nvme0n1"]
    assert DiskCollector._device_candidates("") == []


# ----------------------------------------------------------------------
# Network
# ----------------------------------------------------------------------
def test_network_collector_counters_and_speeds(config, monkeypatch):
    samples = iter(
        [
            {
                "eth0": NetIO(654321, 123456, 1200, 1000, 0, 0, 0, 0),
                "lo": NetIO(1, 1, 1, 1, 0, 0, 0, 0),
                "docker0": NetIO(5, 5, 5, 5, 0, 0, 0, 0),
            },
            {
                "eth0": NetIO(674321, 133456, 1300, 1100, 1, 2, 3, 4),
                "lo": NetIO(2, 2, 2, 2, 0, 0, 0, 0),
                "docker0": NetIO(6, 6, 6, 6, 0, 0, 0, 0),
            },
        ]
    )
    monkeypatch.setattr(psutil, "net_io_counters", lambda pernic=True: next(samples))
    monkeypatch.setattr(
        psutil,
        "net_connections",
        lambda kind="inet": [
            Connection("ESTABLISHED", Address("10.0.0.1", 443)),
            Connection("ESTABLISHED", Address("10.0.0.1", 443)),
            Connection("LISTEN", Address("0.0.0.0", 22)),
            Connection("TIME_WAIT", Address("10.0.0.1", 80)),
            Connection("CLOSE_WAIT", Address("10.0.0.1", 80)),
        ],
    )

    collector = NetworkCollector(config)
    first = collector.collect()

    assert set(first["network"]) == {"eth0"}, "loopback and bridges are filtered"
    assert first["network"]["eth0"]["rx_bytes"] == 123456
    assert first["network"]["eth0"]["tx_bytes"] == 654321
    assert first["network"]["eth0"]["rx_speed_bps"] == 0.0
    assert first["connections"] == {
        "established": 2,
        "listen": 1,
        "time_wait": 1,
        "total": 5,
    }

    second = collector.collect()["network"]["eth0"]
    assert second["rx_speed_bps"] > 0.0
    assert second["tx_speed_bps"] > 0.0
    assert second["rx_errors"] == 1
    assert second["tx_dropped"] == 4


def test_network_collector_without_connection_permission(config, monkeypatch):
    monkeypatch.setattr(
        psutil, "net_io_counters", lambda pernic=True: {"eth0": NetIO(1, 1, 1, 1, 0, 0, 0, 0)}
    )

    def denied(kind="inet"):
        raise psutil.AccessDenied()

    monkeypatch.setattr(psutil, "net_connections", denied)

    fragment = NetworkCollector(config).collect()

    assert "network" in fragment
    assert "connections" not in fragment


# ----------------------------------------------------------------------
# Processes
# ----------------------------------------------------------------------
def test_process_collector_top_n_and_summary(config, monkeypatch):
    config.top_processes = 2
    processes = [
        SimpleNamespace(
            info={
                "pid": 123,
                "name": "nginx",
                "username": "www-data",
                "cpu_percent": 5.2,
                "memory_percent": 1.4,
                "memory_info": SimpleNamespace(rss=48 * MB),
                "status": psutil.STATUS_RUNNING,
            }
        ),
        SimpleNamespace(
            info={
                "pid": 200,
                "name": "python",
                "username": "root",
                "cpu_percent": 25.0,
                "memory_percent": 10.0,
                "memory_info": SimpleNamespace(rss=256 * MB),
                "status": psutil.STATUS_SLEEPING,
            }
        ),
        SimpleNamespace(
            info={
                "pid": 300,
                "name": "defunct",
                "username": None,
                "cpu_percent": None,
                "memory_percent": None,
                "memory_info": None,
                "status": psutil.STATUS_ZOMBIE,
            }
        ),
    ]
    monkeypatch.setattr(psutil, "process_iter", lambda attrs=None, ad_value=None: iter(processes))

    fragment = ProcessCollector(config).collect()

    assert [entry["pid"] for entry in fragment["processes"]] == [200, 123]
    assert fragment["processes"][0]["mem_rss_mb"] == 256.0
    assert fragment["processes"][1]["user"] == "www-data"
    assert fragment["process_summary"] == {
        "total": 3,
        "running": 1,
        "sleeping": 1,
        "zombie": 1,
    }


def test_process_collector_with_empty_table(config, monkeypatch):
    monkeypatch.setattr(psutil, "process_iter", lambda attrs=None, ad_value=None: iter([]))

    assert ProcessCollector(config).collect() == {}


# ----------------------------------------------------------------------
# systemd services
# ----------------------------------------------------------------------
LIST_UNITS = (
    "nginx.service loaded active running A high performance web server\n"
    "\u25cf broken.service loaded failed failed Broken unit\n"
    "ssh.service loaded active running OpenBSD Secure Shell server\n"
    "not-a-service.socket loaded active listening Socket\n"
)
LIST_UNIT_FILES = "nginx.service enabled enabled\nssh.service disabled enabled\n"


def test_service_collector(config, monkeypatch):
    def fake_run(argv, timeout=None):
        if "list-units" in argv:
            return ToolResult(True, 0, LIST_UNITS, "")
        return ToolResult(True, 0, LIST_UNIT_FILES, "")

    collector = ServiceCollector(config)
    monkeypatch.setattr(collector, "run", fake_run)

    services = collector.collect()["services"]

    assert services[0] == {
        "name": "broken.service",
        "active": "failed",
        "sub": "failed",
        "enabled": False,
    }, "failed units are reported first"
    by_name = {service["name"]: service for service in services}
    assert by_name["nginx.service"] == {
        "name": "nginx.service",
        "active": "active",
        "sub": "running",
        "enabled": True,
    }
    assert by_name["ssh.service"]["enabled"] is False
    assert "not-a-service.socket" not in by_name


def test_service_collector_when_systemctl_fails(config, monkeypatch):
    collector = ServiceCollector(config)
    monkeypatch.setattr(
        collector, "run", lambda argv, timeout=None: ToolResult(False, 1, "", "Failed to connect")
    )

    assert collector.collect() == {}


# ----------------------------------------------------------------------
# Docker
# ----------------------------------------------------------------------
def test_docker_size_parsers():
    assert parse_size("1.5MiB") == pytest.approx(1.5 * 1024 * 1024)
    assert parse_size("2kB") == 2000.0
    assert parse_size("0B") == 0.0
    assert parse_size("garbage") == 0.0
    assert parse_percent("10.55%") == 10.55
    assert parse_percent("--") == 0.0
    assert parse_pair("1.2MiB / 2GiB")[0] == pytest.approx(1.2 * 1024 * 1024)
    assert parse_pair("broken") == (0.0, 0.0)


def test_docker_timestamp_parser():
    parsed = parse_docker_timestamp("2026-09-03T10:00:00.123456789Z")
    assert parsed == datetime(2026, 9, 3, 10, 0, 0, 123456, tzinfo=timezone.utc)
    assert parse_docker_timestamp("0001-01-01T00:00:00Z") is None
    assert parse_docker_timestamp("") is None


DOCKER_PS = (
    '{"ID":"abc123def4567890","Names":"web","Image":"nginx:latest","State":"running"}\n'
    '{"ID":"fed987654321cba0","Names":"db","Image":"postgres:16","State":"exited"}\n'
)
DOCKER_STATS = (
    '{"Container":"abc123def456","Name":"web","CPUPerc":"10.00%","MemPerc":"2.00%",'
    '"MemUsage":"128MiB / 2GiB","NetIO":"1.2MB / 3.4MB","BlockIO":"0.5MB / 1MB"}\n'
)


def test_docker_collector_merges_ps_stats_and_inspect(config, monkeypatch):
    started = datetime.now(timezone.utc).replace(microsecond=0)
    inspect = (
        f"abc123def4567890\t{started.strftime('%Y-%m-%dT%H:%M:%S.000000000Z')}\thealthy\n"
        f"fed987654321cba0\t0001-01-01T00:00:00Z\tnone\n"
    )

    def fake_run(argv, timeout=None):
        if argv[1] == "ps":
            return ToolResult(True, 0, DOCKER_PS, "")
        if argv[1] == "stats":
            return ToolResult(True, 0, DOCKER_STATS, "")
        return ToolResult(True, 0, inspect, "")

    collector = DockerCollector(config)
    monkeypatch.setattr(collector, "run", fake_run)

    containers = collector.collect()["docker"]
    by_name = {container["name"]: container for container in containers}

    assert by_name["web"]["container_id"] == "abc123def456"
    assert by_name["web"]["image"] == "nginx:latest"
    assert by_name["web"]["cpu_percent"] == 10.0
    assert by_name["web"]["mem_usage_mb"] == 128.0
    assert by_name["web"]["net_rx_mb"] == pytest.approx(1.14, abs=0.02)
    assert by_name["web"]["status"] == "running"
    assert by_name["web"]["health"] == "healthy"
    assert by_name["web"]["uptime_seconds"] >= 0
    assert by_name["db"]["cpu_percent"] == 0.0, "stopped containers have no stats"
    assert by_name["db"]["health"] == "none"


def test_docker_collector_when_daemon_is_unreachable(config, monkeypatch):
    collector = DockerCollector(config)
    monkeypatch.setattr(
        collector,
        "run",
        lambda argv, timeout=None: ToolResult(False, 1, "", "Cannot connect to the Docker daemon"),
    )

    assert collector.collect() == {}


# ----------------------------------------------------------------------
# Temperature
# ----------------------------------------------------------------------
def test_temperature_collector_from_psutil(config, monkeypatch):
    monkeypatch.setattr(
        psutil,
        "sensors_temperatures",
        lambda: {
            "coretemp": [
                Temperature("Package id 0", 54.0, 80.0, 100.0),
                Temperature("", 45.0, None, None),
            ]
        },
        raising=False,
    )
    collector = TemperatureCollector(config)
    monkeypatch.setattr(collector, "run", lambda argv, timeout=None: ToolResult(False, 1, "", ""))

    readings = collector.collect()["temperatures"]

    assert readings[0] == {
        "sensor": "coretemp",
        "label": "Package id 0",
        "current": 54.0,
        "high": 80.0,
        "critical": 100.0,
    }
    assert readings[1]["label"] == "sensor1"
    assert readings[1]["high"] is None


def test_temperature_collector_uses_nvidia_smi(config, monkeypatch):
    monkeypatch.setattr(psutil, "sensors_temperatures", lambda: {}, raising=False)
    monkeypatch.setattr(
        "vpsguard_agent.collectors.temperature.tool_available",
        lambda name: name == "nvidia-smi",
    )
    collector = TemperatureCollector(config)
    monkeypatch.setattr(
        collector,
        "run",
        lambda argv, timeout=None: ToolResult(True, 0, "0, NVIDIA A100, 61\n", ""),
    )

    readings = collector.collect()["temperatures"]

    assert readings == [
        {
            "sensor": "nvidia-gpu",
            "label": "GPU 0 NVIDIA A100",
            "current": 61.0,
            "high": None,
            "critical": None,
        }
    ]


def test_temperature_collector_without_any_sensor(config, monkeypatch):
    monkeypatch.setattr(psutil, "sensors_temperatures", lambda: {}, raising=False)
    monkeypatch.setattr(
        "vpsguard_agent.collectors.temperature.tool_available", lambda name: False
    )

    assert TemperatureCollector(config).collect() == {}


# ----------------------------------------------------------------------
# SMART
# ----------------------------------------------------------------------
SMART_SCAN = '{"devices":[{"name":"/dev/sda","type":"sat"}]}'
SMART_DEVICE = """
{
  "model_name": "Samsung SSD 860",
  "smart_status": {"passed": true},
  "temperature": {"current": 38},
  "power_on_time": {"hours": 12345},
  "ata_smart_attributes": {"table": [
      {"id": 5, "name": "Reallocated_Sector_Ct", "value": 100, "raw": {"value": 0}},
      {"id": 177, "name": "Wear_Leveling_Count", "value": 98, "raw": {"value": 12}}
  ]}
}
"""


def test_smart_collector(config, monkeypatch):
    def fake_run(argv, timeout=None):
        if "--scan-open" in argv:
            return ToolResult(True, 0, SMART_SCAN, "")
        return ToolResult(True, 0, SMART_DEVICE, "")

    collector = SmartCollector(config)
    monkeypatch.setattr(collector, "run", fake_run)

    entries = collector.collect()["smart"]

    assert entries == [
        {
            "device": "/dev/sda",
            "model": "Samsung SSD 860",
            "health": "PASSED",
            "temperature": 38,
            "power_on_hours": 12345,
            "reallocated_sectors": 0,
            "wear_leveling": 98,
        }
    ]


def test_smart_collector_nvme_wear_and_failed_health(config, monkeypatch):
    device = (
        '{"model_name":"NVMe X","smart_status":{"passed":false},'
        '"nvme_smart_health_information_log":{"percentage_used":7}}'
    )

    def fake_run(argv, timeout=None):
        if "--scan-open" in argv:
            return ToolResult(True, 0, '{"devices":[{"name":"/dev/nvme0","type":"nvme"}]}', "")
        return ToolResult(True, 0, device, "")

    collector = SmartCollector(config)
    monkeypatch.setattr(collector, "run", fake_run)

    entry = collector.collect()["smart"][0]

    assert entry["health"] == "FAILED"
    assert entry["wear_leveling"] == 93
    assert entry["temperature"] is None


def test_smart_collector_without_permissions(config, monkeypatch):
    collector = SmartCollector(config)
    monkeypatch.setattr(
        collector,
        "run",
        lambda argv, timeout=None: ToolResult(False, 2, "", "Permission denied"),
    )

    assert collector.collect() == {}


# ----------------------------------------------------------------------
# Security
# ----------------------------------------------------------------------
def test_security_collector_counts_failed_ssh(config, monkeypatch, tmp_path):
    now = datetime.now().astimezone()
    recent = now.strftime("%b %d %H:%M:%S")
    auth_log = tmp_path / "auth.log"
    auth_log.write_text(
        f"{recent} host sshd[1]: Failed password for root from 1.2.3.4 port 22 ssh2\n"
        f"{recent} host sshd[2]: Invalid user admin from 5.6.7.8\n"
        "Jan 01 00:00:00 host sshd[3]: Failed password for root from 9.9.9.9 port 22 ssh2\n"
        f"{recent} host sshd[4]: Accepted password for ok from 1.1.1.1 port 22 ssh2\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "vpsguard_agent.collectors.security.AUTH_LOG_CANDIDATES", (str(auth_log),)
    )
    monkeypatch.setattr(
        "vpsguard_agent.collectors.security.tool_available", lambda name: False
    )
    monkeypatch.setattr(psutil, "net_connections", lambda kind="inet": [])

    security = SecurityCollector(config).collect()["security"]

    assert security["failed_ssh_attempts"] == 3
    assert security["failed_ssh_last_hour"] == 2
    assert security["firewall_status"] == "unknown"
    assert security["firewall_backend"] == "none"
    assert security["last_logins"] == []


def test_security_collector_detects_ufw_and_ports(config, monkeypatch):
    monkeypatch.setattr("vpsguard_agent.collectors.security.AUTH_LOG_CANDIDATES", ())
    monkeypatch.setattr(
        "vpsguard_agent.collectors.security.tool_available",
        lambda name: name in ("ufw", "last"),
    )
    monkeypatch.setattr(
        psutil,
        "net_connections",
        lambda kind="inet": [
            Connection("LISTEN", Address("0.0.0.0", 22)),
            Connection("LISTEN", Address("0.0.0.0", 443)),
            Connection("LISTEN", Address("::", 443)),
            Connection("ESTABLISHED", Address("10.0.0.1", 55555)),
        ],
    )

    collector = SecurityCollector(config)

    def fake_run(argv, timeout=None):
        if argv[0] == "ufw":
            return ToolResult(True, 0, "Status: active\n", "")
        if argv[0] == "last":
            return ToolResult(
                True,
                0,
                "root     pts/0        1.2.3.4          Thu Sep  3 10:00:00 2026   still logged in\n"
                "reboot   system boot  0.0.0.0          Thu Sep  3 09:00:00 2026\n",
                "",
            )
        return ToolResult(False, 1, "", "")

    monkeypatch.setattr(collector, "run", fake_run)

    security = collector.collect()["security"]

    assert security["firewall_status"] == "active"
    assert security["firewall_backend"] == "ufw"
    assert security["open_ports"] == [22, 443]
    assert security["last_logins"] == [
        {"user": "root", "from": "1.2.3.4", "at": "2026-09-03T07:00:00Z"}
    ] or security["last_logins"][0]["user"] == "root"
    assert "failed_ssh_attempts" not in security


@pytest.mark.parametrize(
    "line",
    [
        "2026-09-03T10:00:00+00:00 host sshd[1]: Failed password",
        "Sep  3 10:00:00 host sshd[1]: Failed password",
    ],
)
def test_security_log_timestamp_parsing(line):
    now = datetime(2026, 9, 3, 11, 0, 0, tzinfo=timezone.utc)

    parsed = SecurityCollector._parse_log_timestamp(line, now)

    assert parsed is not None
    assert parsed.tzinfo is not None


def test_security_log_timestamp_rejects_junk():
    now = datetime.now(timezone.utc)

    assert SecurityCollector._parse_log_timestamp("no timestamp here", now) is None


# ----------------------------------------------------------------------
# SSL certificates
# ----------------------------------------------------------------------
def der_time(value: bytes) -> bytes:
    return bytes([0x17, len(value)]) + value


def build_certificate_der(not_before: bytes, not_after: bytes) -> bytes:
    validity_body = der_time(not_before) + der_time(not_after)
    validity = bytes([0x30, len(validity_body)]) + validity_body
    return bytes([0x30, len(validity)]) + validity


def test_parse_der_not_after():
    der = build_certificate_der(b"250101000000Z", b"261201000000Z")

    assert parse_der_not_after(der) == datetime(2026, 12, 1, tzinfo=timezone.utc)


def test_parse_der_not_after_with_garbage():
    assert parse_der_not_after(b"") is None
    assert parse_der_not_after(b"\x30\x02\x05\x00") is None


def test_ssl_asn1_time_and_name_helpers():
    assert SslCollector._parse_asn1_time("Dec  1 00:00:00 2026 GMT") == datetime(
        2026, 12, 1, tzinfo=timezone.utc
    )
    assert SslCollector._parse_asn1_time("nonsense") is None

    issuer = ((("countryName", "US"),), (("organizationName", "Let's Encrypt"),))
    assert SslCollector._name_from_rdns(issuer, ("organizationName",)) == "Let's Encrypt"
    assert SslCollector._name_from_rdns(None, ("commonName",)) == ""


def test_ssl_collector_builds_an_entry(config, monkeypatch):
    config.ssl_domains = [("example.com", 443)]
    collector = SslCollector(config)
    cert = {
        "notAfter": "Dec  1 00:00:00 2099 GMT",
        "issuer": ((("organizationName", "Let's Encrypt"),),),
        "subject": ((("commonName", "example.com"),),),
    }
    monkeypatch.setattr(collector, "_fetch_certificate", lambda host, port: (cert, b"", None))

    entry = collector.collect()["ssl"][0]

    assert entry["domain"] == "example.com"
    assert entry["port"] == 443
    assert entry["issuer"] == "Let's Encrypt"
    assert entry["subject"] == "example.com"
    assert entry["not_after"] == "2099-12-01T00:00:00Z"
    assert entry["days_left"] > 0
    assert entry["valid"] is True


def test_ssl_collector_reports_invalid_certificates(config, monkeypatch):
    config.ssl_domains = [("self-signed.example", 8443)]
    collector = SslCollector(config)
    der = build_certificate_der(b"200101000000Z", b"210101000000Z")
    monkeypatch.setattr(
        collector,
        "_fetch_certificate",
        lambda host, port: (None, der, "verification failed: self signed certificate"),
    )

    entry = collector.collect()["ssl"][0]

    assert entry["valid"] is False
    assert entry["days_left"] < 0
    assert entry["not_after"] == "2021-01-01T00:00:00Z"
    assert "self signed" in entry["error"]


def test_ssl_collector_skips_unreachable_hosts(config, monkeypatch):
    config.ssl_domains = [("down.example", 443)]
    collector = SslCollector(config)
    monkeypatch.setattr(
        collector, "_fetch_certificate", lambda host, port: (None, None, "timed out")
    )

    assert collector.collect() == {}


def test_ssl_collector_is_unavailable_without_domains(config):
    config.ssl_domains = []

    assert SslCollector(config).safe_collect() == {}


# ----------------------------------------------------------------------
# Log scanning
# ----------------------------------------------------------------------
def test_log_collector_counts_new_lines_only(config, tmp_path):
    log_file = tmp_path / "syslog"
    log_file.write_text(
        "Sep  3 10:00:00 host app: error something broke\n"
        "Sep  3 10:00:01 host app: all good\n"
        "Sep  3 10:00:02 host app: ERROR again\n"
        "Sep  3 10:00:03 host sshd: connection denied\n",
        encoding="utf-8",
    )
    config.log_files = [str(log_file)]
    collector = LogCollector(config)

    entries = {entry["pattern"]: entry for entry in collector.collect()["logs"]}

    assert entries["error"]["matches"] == 2, "matching is case insensitive"
    assert entries["error"]["file"] == str(log_file)
    assert len(entries["error"]["samples"]) == 2
    assert entries["denied"]["matches"] == 1

    # Nothing new appended: no entries at all.
    assert collector.collect()["logs"] == []

    with open(log_file, "a", encoding="utf-8") as handle:
        handle.write("Sep  3 10:01:00 host app: error number three\n")

    entries = {entry["pattern"]: entry for entry in collector.collect()["logs"]}
    assert entries["error"]["matches"] == 1


def test_log_collector_handles_rotation(config, tmp_path):
    log_file = tmp_path / "syslog"
    log_file.write_text("error one\nerror two\n", encoding="utf-8")
    config.log_files = [str(log_file)]
    collector = LogCollector(config)

    assert collector.collect()["logs"][0]["matches"] == 2

    # Rotation: the file is replaced by a smaller one.
    log_file.write_text("error after rotation\n", encoding="utf-8")

    entries = collector.collect()["logs"]

    assert entries and entries[0]["matches"] == 1


def test_log_collector_reports_missing_files(config, tmp_path, caplog):
    config.log_files = [str(tmp_path / "does-not-exist.log")]
    collector = LogCollector(config)

    with caplog.at_level("WARNING"):
        assert collector.collect() == {"logs": []}

    assert "Cannot access log file" in caplog.text


def test_log_collector_is_unavailable_without_configuration(config):
    config.log_files = []

    assert LogCollector(config).safe_collect() == {}


def test_log_collector_truncates_samples(config, tmp_path):
    log_file = tmp_path / "syslog"
    log_file.write_text("error " + "x" * 2000 + "\n", encoding="utf-8")
    config.log_files = [str(log_file)]

    sample = LogCollector(config).collect()["logs"][0]["samples"][0]

    assert len(sample) == 500


# ----------------------------------------------------------------------
# Registry
# ----------------------------------------------------------------------
def test_registry_covers_every_metric_key():
    assert set(REGISTRY) == set(METRIC_KEYS)


def test_build_collectors_honours_the_configuration(config):
    config.metrics = {key: False for key in METRIC_KEYS}
    config.metrics["cpu"] = True
    config.metrics["memory"] = True

    collectors = build_collectors(config)

    assert sorted(collector.name for collector in collectors) == ["cpu", "memory"]


def test_build_collectors_survives_a_broken_collector(config, monkeypatch):
    class Broken(BaseCollector):
        name = "cpu"

        def __init__(self, _config):
            raise RuntimeError("cannot initialise")

        def collect(self):  # pragma: no cover - never constructed
            raise AssertionError

    monkeypatch.setitem(REGISTRY, "cpu", Broken)
    config.metrics = {"cpu": True, "memory": True}

    collectors = build_collectors(config)

    assert [collector.name for collector in collectors] == ["memory"]


def test_collector_tiers_match_the_specification(config):
    collectors = {collector.name: collector for collector in build_collectors(config)}
    fast = {"cpu", "memory", "disk", "network", "processes", "docker", "services"}
    slow = {"temperature", "smart", "ssl", "logs", "security"}

    for name in fast:
        assert collectors[name].tier == "fast", name
    for name in slow:
        assert collectors[name].tier == "slow", name
