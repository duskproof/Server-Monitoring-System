"""TLS certificate expiry collector.

For every ``host:port`` in the ``[ssl] domains`` option the agent performs a
TLS handshake and reports the certificate expiry.  Only the stdlib :mod:`ssl`
module is used: a verified handshake yields the full certificate details, and
when verification fails (self-signed, wrong hostname, already expired) the
expiry date is recovered from the raw DER certificate so the metric is still
useful.
"""

from __future__ import annotations

import socket
import ssl
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from .base import SLOW, BaseCollector

HANDSHAKE_TIMEOUT = 5.0
MAX_DOMAINS = 25

_DER_UTC_TIME = 0x17
_DER_GENERALIZED_TIME = 0x18
_DER_SEQUENCE = 0x30


class SslCollector(BaseCollector):
    """Check TLS certificate validity for the configured endpoints."""

    name = "ssl"
    tier = SLOW

    def available(self) -> bool:
        if not self.config.ssl_domains:
            self.warn_once(
                "no_domains", "No domains configured in [ssl] domains, skipping SSL checks"
            )
            return False
        return True

    def collect(self) -> Dict[str, Any]:
        entries: List[Dict[str, Any]] = []
        for host, port in self.config.ssl_domains[:MAX_DOMAINS]:
            entry = self._check(host, port)
            if entry is not None:
                entries.append(entry)
        if not entries:
            return {}
        return {"ssl": entries}

    # ------------------------------------------------------------------
    def _check(self, host: str, port: int) -> Optional[Dict[str, Any]]:
        cert, der, error = self._fetch_certificate(host, port)
        if cert is None and der is None:
            self.warn_once(f"connect:{host}:{port}", "TLS check failed for %s:%s: %s", host, port, error)
            return None

        not_after = None
        issuer = ""
        subject = ""
        if cert:
            not_after = self._parse_asn1_time(cert.get("notAfter", ""))
            issuer = self._name_from_rdns(cert.get("issuer"), ("organizationName", "commonName"))
            subject = self._name_from_rdns(cert.get("subject"), ("commonName", "organizationName"))
        if not_after is None and der:
            not_after = parse_der_not_after(der)

        if not_after is None:
            self.warn_once(
                f"expiry:{host}:{port}",
                "Could not determine certificate expiry for %s:%s: %s",
                host,
                port,
                error or "unknown reason",
            )
            return None

        now = datetime.now(timezone.utc)
        days_left = int((not_after - now).total_seconds() // 86400)
        entry: Dict[str, Any] = {
            "domain": host,
            "port": port,
            "issuer": issuer,
            "subject": subject or host,
            "not_after": not_after.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "days_left": days_left,
            "valid": bool(error is None and days_left >= 0),
        }
        if error:
            entry["error"] = error
        return entry

    def _fetch_certificate(
        self, host: str, port: int
    ) -> Tuple[Optional[Dict[str, Any]], Optional[bytes], Optional[str]]:
        """Return ``(cert_dict, der_bytes, error)`` for one endpoint."""
        context = ssl.create_default_context()
        try:
            with socket.create_connection((host, port), timeout=HANDSHAKE_TIMEOUT) as raw:
                with context.wrap_socket(raw, server_hostname=host) as tls:
                    return tls.getpeercert(), tls.getpeercert(binary_form=True), None
        except ssl.SSLCertVerificationError as exc:
            reason = getattr(exc, "verify_message", None) or str(exc)
            der = self._fetch_der_unverified(host, port)
            return None, der, f"verification failed: {reason}"
        except (ssl.SSLError, socket.timeout, OSError) as exc:
            return None, None, str(exc)

    def _fetch_der_unverified(self, host: str, port: int) -> Optional[bytes]:
        """Grab the raw certificate even when the chain cannot be verified."""
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        try:
            with socket.create_connection((host, port), timeout=HANDSHAKE_TIMEOUT) as raw:
                with context.wrap_socket(raw, server_hostname=host) as tls:
                    return tls.getpeercert(binary_form=True)
        except (ssl.SSLError, socket.timeout, OSError) as exc:
            self.log.debug("Unverified TLS handshake with %s:%s failed: %s", host, port, exc)
            return None

    @staticmethod
    def _parse_asn1_time(value: str) -> Optional[datetime]:
        """Parse the ``'Dec  1 00:00:00 2026 GMT'`` format used by :mod:`ssl`."""
        if not value:
            return None
        for fmt in ("%b %d %H:%M:%S %Y %Z", "%b %d %H:%M:%S %Y"):
            try:
                return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
        return None

    @staticmethod
    def _name_from_rdns(rdns: Any, preferred: Tuple[str, ...]) -> str:
        """Extract a readable name from :func:`ssl.SSLSocket.getpeercert` RDNs."""
        if not rdns:
            return ""
        flat: Dict[str, str] = {}
        for rdn in rdns:
            for pair in rdn:
                if isinstance(pair, (tuple, list)) and len(pair) == 2:
                    flat.setdefault(str(pair[0]), str(pair[1]))
        for key in preferred:
            if key in flat:
                return flat[key]
        return next(iter(flat.values()), "")


def _read_der_tlv(data: bytes, offset: int) -> Tuple[int, int, int, int]:
    """Read one DER TLV header.

    Returns:
        ``(tag, content_offset, content_length, next_offset)``.
    """
    tag = data[offset]
    length_byte = data[offset + 1]
    if length_byte < 0x80:
        length = length_byte
        content_offset = offset + 2
    else:
        num_bytes = length_byte & 0x7F
        length = int.from_bytes(data[offset + 2 : offset + 2 + num_bytes], "big")
        content_offset = offset + 2 + num_bytes
    return tag, content_offset, length, content_offset + length


def _parse_der_time(tag: int, raw: bytes) -> Optional[datetime]:
    text = raw.decode("ascii", errors="ignore").strip()
    try:
        if tag == _DER_UTC_TIME:
            # YYMMDDHHMMSSZ, years 50-99 map to 19xx per RFC 5280.
            parsed = datetime.strptime(text, "%y%m%d%H%M%SZ")
        else:
            parsed = datetime.strptime(text[:15], "%Y%m%d%H%M%SZ")
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc)


def parse_der_not_after(der: bytes) -> Optional[datetime]:
    """Extract ``notAfter`` from a DER-encoded X.509 certificate.

    The validity field is the first ``SEQUENCE`` that contains exactly two
    ASN.1 time values, which makes it findable without a full X.509 parser.
    """
    if not der:
        return None

    def walk(data: bytes, start: int, end: int, depth: int) -> Optional[datetime]:
        offset = start
        while offset + 1 < end and depth < 8:
            try:
                tag, content_offset, length, next_offset = _read_der_tlv(data, offset)
            except (IndexError, ValueError):
                return None
            if next_offset > end or length < 0:
                return None
            if tag == _DER_SEQUENCE:
                times: List[Tuple[int, bytes]] = []
                inner = content_offset
                inner_end = content_offset + length
                while inner + 1 < inner_end:
                    try:
                        itag, ioff, ilen, inext = _read_der_tlv(data, inner)
                    except (IndexError, ValueError):
                        break
                    if inext > inner_end:
                        break
                    if itag in (_DER_UTC_TIME, _DER_GENERALIZED_TIME):
                        times.append((itag, data[ioff : ioff + ilen]))
                    inner = inext
                if len(times) == 2:
                    return _parse_der_time(times[1][0], times[1][1])
                found = walk(data, content_offset, inner_end, depth + 1)
                if found is not None:
                    return found
            offset = next_offset
        return None

    return walk(der, 0, len(der), 0)
