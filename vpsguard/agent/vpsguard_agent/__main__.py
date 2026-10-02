"""Command line entry point for the VPSGuard agent.

Usage::

    python -m vpsguard_agent run
    python -m vpsguard_agent collect-once
    python -m vpsguard_agent test-config
    python -m vpsguard_agent version
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import List, Optional

from . import __version__
from .buffer import PayloadBuffer
from .config import (
    DEFAULT_CONFIG_PATH,
    VALID_LOG_LEVELS,
    Config,
    ConfigError,
    config_path_from_env,
    load_config,
)
from .logging_setup import setup_logging
from .payload import PayloadBuilder, serialise
from .scheduler import Scheduler
from .transport import Transport

EXIT_OK = 0
EXIT_FAILURE = 1
EXIT_CONFIG_ERROR = 2


def _global_options() -> argparse.ArgumentParser:
    """Options accepted both before and after the subcommand.

    ``SUPPRESS`` defaults matter here: without them the subparser would write its
    own empty default over a value already parsed from before the subcommand.
    """
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--config",
        default=argparse.SUPPRESS,
        metavar="PATH",
        help=f"Path to agent.conf (default: $VPSGUARD_CONFIG or {DEFAULT_CONFIG_PATH})",
    )
    common.add_argument(
        "--log-level",
        default=argparse.SUPPRESS,
        choices=list(VALID_LOG_LEVELS),
        help="Override [agent] log_level",
    )
    return common


def build_parser() -> argparse.ArgumentParser:
    """Create the CLI argument parser."""
    common = _global_options()
    parser = argparse.ArgumentParser(
        prog="vpsguard-agent",
        description="VPSGuard monitoring agent for Linux servers.",
        parents=[common],
    )
    parser.set_defaults(config="", log_level="")
    parser.add_argument(
        "--version",
        action="version",
        version=f"vpsguard-agent {__version__}",
    )

    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser(
        "run", help="Run the collection loop (default)", parents=[common]
    )
    collect = subparsers.add_parser(
        "collect-once",
        help="Print a single payload as pretty JSON and exit",
        parents=[common],
    )
    collect.add_argument(
        "--compact", action="store_true", help="Print compact JSON instead of indented"
    )
    collect.add_argument(
        "--no-slow",
        action="store_true",
        help="Skip the slow tier (temperature, smart, ssl, logs, security)",
    )
    subparsers.add_parser(
        "test-config",
        help="Validate the configuration and server connectivity",
        parents=[common],
    )
    subparsers.add_parser("version", help="Print the agent version", parents=[common])
    return parser


def _resolve_config(args: argparse.Namespace, require_file: bool = True) -> Config:
    config = load_config(args.config, require_file=require_file)
    if args.log_level:
        config.log_level = args.log_level
    return config


def command_version() -> int:
    """Print the agent version."""
    print(f"vpsguard-agent {__version__}")
    return EXIT_OK


def command_run(args: argparse.Namespace) -> int:
    """Run the main collection loop."""
    try:
        config = _resolve_config(args)
    except ConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return EXIT_CONFIG_ERROR

    setup_logging(config.log_level, log_dir=config.log_dir, log_file=config.log_file)
    scheduler = Scheduler(config)
    return scheduler.run()


def command_collect_once(args: argparse.Namespace) -> int:
    """Collect one payload and print it, without contacting the server."""
    try:
        # A missing config file is tolerated here: collecting metrics locally is
        # the most common troubleshooting step on a not-yet-installed host.
        config = _resolve_config(args, require_file=False)
    except ConfigError as exc:
        config_path = config_path_from_env(args.config)
        if os.path.isfile(config_path):
            print(f"Configuration error: {exc}", file=sys.stderr)
            return EXIT_CONFIG_ERROR
        print(
            f"Warning: {exc}. Continuing with defaults for local collection only.",
            file=sys.stderr,
        )
        config = Config(
            url="https://monitor.invalid",
            api_key="not-configured",
            metrics={key: True for key in _all_metric_keys()},
            log_files=[],
            log_patterns=["error"],
        )
        if args.log_level:
            config.log_level = args.log_level

    setup_logging(config.log_level, log_file=config.log_file, quiet_stderr=True)
    builder = PayloadBuilder(config)
    payload = builder.build(refresh_slow=not args.no_slow)
    print(serialise(payload, pretty=not args.compact))
    return EXIT_OK


def _all_metric_keys() -> List[str]:
    from .config import METRIC_KEYS

    return list(METRIC_KEYS)


def command_test_config(args: argparse.Namespace) -> int:
    """Validate the configuration and probe the server."""
    try:
        config = _resolve_config(args)
    except ConfigError as exc:
        print(f"FAIL  configuration: {exc}", file=sys.stderr)
        return EXIT_CONFIG_ERROR

    setup_logging(config.log_level, log_file=config.log_file, quiet_stderr=True)

    print(f"OK    configuration loaded from {config.source_path or '<defaults + environment>'}")
    print(json.dumps(config.redacted(), indent=2))

    failures = 0

    if not os.path.isdir(config.state_dir):
        print(f"WARN  state directory {config.state_dir} does not exist yet")
    elif not os.access(config.state_dir, os.W_OK):
        print(f"FAIL  state directory {config.state_dir} is not writable", file=sys.stderr)
        failures += 1

    try:
        with PayloadBuffer(
            config.buffer_path,
            max_rows=config.buffer_size,
            retention_hours=config.buffer_retention_hours,
        ) as payload_buffer:
            print(f"OK    offline buffer usable ({payload_buffer.count()} payload(s) queued)")
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        print(f"FAIL  offline buffer at {config.buffer_path}: {exc}", file=sys.stderr)
        failures += 1

    try:
        builder = PayloadBuilder(config)
        payload = builder.build(refresh_slow=False)
        collected = sorted(payload["metrics"].keys())
        print(f"OK    collected {len(collected)} fast metric group(s): {', '.join(collected)}")
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL  metric collection: {exc}", file=sys.stderr)
        failures += 1

    with Transport(config) as transport:
        reachable, detail = transport.check_connectivity()
    if reachable:
        print(f"OK    server {config.ingest_url}: {detail}")
    else:
        print(f"FAIL  server {config.ingest_url}: {detail}", file=sys.stderr)
        failures += 1

    if failures:
        print(f"\n{failures} check(s) failed.", file=sys.stderr)
        return EXIT_FAILURE
    print("\nAll checks passed.")
    return EXIT_OK


def main(argv: Optional[List[str]] = None) -> int:
    """CLI entry point."""
    parser = build_parser()
    args = parser.parse_args(argv)
    command = args.command or "run"

    if command == "version":
        return command_version()
    if command == "collect-once":
        return command_collect_once(args)
    if command == "test-config":
        return command_test_config(args)
    return command_run(args)


if __name__ == "__main__":
    sys.exit(main())
