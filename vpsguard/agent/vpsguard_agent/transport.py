"""HTTPS transport towards the central VPSGuard server.

A single :class:`requests.Session` is reused for the whole agent lifetime so
that TLS handshakes and TCP connections are amortised.  Transient failures are
retried by urllib3 with exponential backoff (1s / 2s / 4s); anything that is
still failing afterwards is reported to the caller, which then buffers the
payload for a later attempt.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional, Tuple

import requests
from requests.adapters import HTTPAdapter

try:  # urllib3 >= 2.0 and >= 1.26 both ship Retry, the kwargs differ slightly.
    from urllib3.util.retry import Retry
except ImportError:  # pragma: no cover - very old urllib3 bundled in requests
    from requests.packages.urllib3.util.retry import Retry  # type: ignore

from . import __version__
from .config import Config
from .logging_setup import get_logger

logger = get_logger("transport")

RETRY_TOTAL = 3
RETRY_BACKOFF_FACTOR = 1.0  # -> 1s, 2s, 4s
RETRY_STATUS_FORCELIST = (408, 425, 429, 500, 502, 503, 504)
DEFAULT_TIMEOUT = 10.0
MAX_RESULT_TEXT = 8 * 1024


class TransportError(Exception):
    """A payload could not be delivered; the caller should buffer and retry."""


class AuthError(TransportError):
    """The server rejected our credentials (HTTP 401/403).

    This is a configuration problem that will not fix itself, so the scheduler
    slows down instead of hammering the endpoint.
    """


def _build_retry() -> Retry:
    kwargs: Dict[str, Any] = {
        "total": RETRY_TOTAL,
        "connect": RETRY_TOTAL,
        "read": RETRY_TOTAL,
        "status": RETRY_TOTAL,
        "backoff_factor": RETRY_BACKOFF_FACTOR,
        "status_forcelist": list(RETRY_STATUS_FORCELIST),
        "raise_on_status": False,
        "respect_retry_after_header": True,
    }
    methods = ["POST", "GET", "HEAD"]
    try:
        return Retry(allowed_methods=methods, **kwargs)
    except TypeError:  # pragma: no cover - urllib3 < 1.26
        return Retry(method_whitelist=methods, **kwargs)


class Transport:
    """Thin HTTPS client implementing the VPSGuard ingest protocol."""

    def __init__(self, config: Config, session: Optional[requests.Session] = None) -> None:
        self.config = config
        self.timeout = float(getattr(config, "request_timeout", DEFAULT_TIMEOUT) or DEFAULT_TIMEOUT)
        self.session = session or self._build_session()
        if not config.verify_tls:
            logger.warning(
                "TLS certificate verification is DISABLED (verify_tls = false). "
                "Traffic to %s can be intercepted; only use this with a private CA "
                "you cannot install on this host.",
                config.url,
            )
            self._silence_insecure_warnings()

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        adapter = HTTPAdapter(max_retries=_build_retry(), pool_connections=4, pool_maxsize=4)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        session.headers.update(
            {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": f"vpsguard-agent/{__version__}",
                "X-API-Key": self.config.api_key,
            }
        )
        return session

    @staticmethod
    def _silence_insecure_warnings() -> None:
        try:
            import urllib3

            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        except Exception:  # pragma: no cover - urllib3 layout differences
            logger.debug("Could not silence urllib3 insecure request warnings")

    def close(self) -> None:
        """Release pooled connections."""
        try:
            self.session.close()
        except Exception:  # pragma: no cover - defensive
            pass

    def __enter__(self) -> "Transport":
        return self

    def __exit__(self, *_exc_info: object) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Requests
    # ------------------------------------------------------------------
    def _post(self, url: str, body: str) -> requests.Response:
        try:
            response = self.session.post(
                url,
                data=body.encode("utf-8"),
                timeout=self.timeout,
                verify=self.config.verify_tls,
            )
        except requests.RequestException as exc:
            raise TransportError(f"POST {url} failed: {exc}") from exc

        if response.status_code in (401, 403):
            raise AuthError(
                f"Server rejected the API key (HTTP {response.status_code}) at {url}. "
                "Check [server] api_key in the agent configuration."
            )
        if response.status_code >= 400:
            raise TransportError(
                f"POST {url} returned HTTP {response.status_code}: "
                f"{response.text[:200].strip()}"
            )
        return response

    @staticmethod
    def _parse_json(response: requests.Response) -> Dict[str, Any]:
        if not response.content:
            return {}
        try:
            parsed = response.json()
        except ValueError as exc:
            raise TransportError(f"Server returned a non-JSON response: {exc}") from exc
        if not isinstance(parsed, dict):
            raise TransportError(f"Server returned unexpected JSON type: {type(parsed).__name__}")
        return parsed

    def send_payload(self, body: str) -> Dict[str, Any]:
        """Send one metrics payload and return the parsed server response.

        Args:
            body: The JSON-encoded payload.

        Raises:
            AuthError: Credentials were rejected.
            TransportError: Any other delivery failure.
        """
        response = self._post(self.config.ingest_url, body)
        payload = self._parse_json(response)
        logger.debug(
            "Payload accepted (HTTP %s, %d bytes sent)", response.status_code, len(body)
        )
        return payload

    def send_command_result(self, command_id: str, result: Dict[str, Any]) -> bool:
        """Report the outcome of a remote command.

        Returns:
            ``True`` when the server acknowledged the result.
        """
        url = self.config.command_result_url(command_id)
        body = json.dumps(self._truncate_result(result))
        try:
            self._post(url, body)
        except AuthError:
            raise
        except TransportError as exc:
            logger.error("Could not report result of command %s: %s", command_id, exc)
            return False
        logger.info("Reported result of command %s (%s)", command_id, result.get("status"))
        return True

    @staticmethod
    def _truncate_result(result: Dict[str, Any]) -> Dict[str, Any]:
        trimmed = dict(result)
        for key in ("stdout", "stderr"):
            value = trimmed.get(key)
            if isinstance(value, str) and len(value.encode("utf-8")) > MAX_RESULT_TEXT:
                trimmed[key] = value.encode("utf-8")[:MAX_RESULT_TEXT].decode(
                    "utf-8", errors="ignore"
                )
        return trimmed

    def check_connectivity(self) -> Tuple[bool, str]:
        """Probe the ingest endpoint without submitting metrics.

        A ``GET`` on the ingest URL exercises DNS, TLS and authentication.  Most
        servers answer ``405 Method Not Allowed``, which still proves the
        endpoint is reachable and the key was not rejected.

        Returns:
            ``(ok, human_readable_detail)``.
        """
        url = self.config.ingest_url
        try:
            response = self.session.get(
                url, timeout=self.timeout, verify=self.config.verify_tls
            )
        except requests.RequestException as exc:
            return False, f"Cannot reach {url}: {exc}"

        if response.status_code in (401, 403):
            return False, (
                f"Server rejected the API key (HTTP {response.status_code}). "
                "Check [server] api_key."
            )
        if response.status_code >= 500:
            return False, f"Server error at {url}: HTTP {response.status_code}"
        # POST-only routes often answer 404/405 on GET; that still proves reachability.
        if response.status_code in (200, 204, 404, 405):
            return True, f"Reachable (HTTP {response.status_code} on GET probe)"
        return True, f"Reachable, endpoint answered HTTP {response.status_code}"
