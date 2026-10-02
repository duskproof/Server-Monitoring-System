"""Collector registry.

Maps the metric names used in the ``[metrics]`` configuration section to their
collector classes and builds the enabled set for a given configuration.
"""

from __future__ import annotations

from typing import Dict, List, Type

from ..config import Config
from ..logging_setup import get_logger
from .base import FAST, SLOW, BaseCollector
from .cpu import CpuCollector
from .disk import DiskCollector
from .docker import DockerCollector
from .logs import LogCollector
from .memory import MemoryCollector
from .network import NetworkCollector
from .processes import ProcessCollector
from .security import SecurityCollector
from .services import ServiceCollector
from .smart import SmartCollector
from .ssl_certs import SslCollector
from .temperature import TemperatureCollector

logger = get_logger("collectors")

#: Metric name -> collector class.
REGISTRY: Dict[str, Type[BaseCollector]] = {
    CpuCollector.name: CpuCollector,
    MemoryCollector.name: MemoryCollector,
    DiskCollector.name: DiskCollector,
    NetworkCollector.name: NetworkCollector,
    ProcessCollector.name: ProcessCollector,
    ServiceCollector.name: ServiceCollector,
    DockerCollector.name: DockerCollector,
    TemperatureCollector.name: TemperatureCollector,
    SmartCollector.name: SmartCollector,
    SecurityCollector.name: SecurityCollector,
    SslCollector.name: SslCollector,
    LogCollector.name: LogCollector,
}

__all__ = [
    "REGISTRY",
    "FAST",
    "SLOW",
    "BaseCollector",
    "build_collectors",
    "CpuCollector",
    "MemoryCollector",
    "DiskCollector",
    "NetworkCollector",
    "ProcessCollector",
    "ServiceCollector",
    "DockerCollector",
    "TemperatureCollector",
    "SmartCollector",
    "SecurityCollector",
    "SslCollector",
    "LogCollector",
]


def build_collectors(config: Config) -> List[BaseCollector]:
    """Instantiate every collector enabled in ``config``.

    A collector whose constructor raises is skipped with a warning instead of
    preventing the agent from starting.
    """
    collectors: List[BaseCollector] = []
    for name, collector_class in REGISTRY.items():
        if not config.metric_enabled(name):
            logger.debug("Collector '%s' disabled by configuration", name)
            continue
        try:
            collectors.append(collector_class(config))
        except Exception as exc:  # noqa: BLE001 - never block startup
            logger.warning("Could not initialise collector '%s': %s", name, exc)
    logger.info(
        "Enabled collectors: %s",
        ", ".join(collector.name for collector in collectors) or "none",
    )
    return collectors
