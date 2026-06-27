# p3portal.org
"""PROJ-67 Phase 1 – F-002: Sicherer HTTP-Client für ausgehende Requests.

Ersetzt alle direkten `httpx.AsyncClient(verify=False)`-Aufrufe in Services.
Bietet DNS-Rebinding-Schutz und Privat-IP-Blockierung für Webhook-URLs.
"""
from __future__ import annotations

import ipaddress
import logging
import socket
from contextlib import asynccontextmanager
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

# RFC1918 + Loopback + Link-Local + Multicast Netzwerke
_BLOCKED_NETWORKS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    ipaddress.ip_network("127.0.0.0/8"),       # IPv4 Loopback
    ipaddress.ip_network("10.0.0.0/8"),         # RFC1918
    ipaddress.ip_network("172.16.0.0/12"),      # RFC1918
    ipaddress.ip_network("192.168.0.0/16"),     # RFC1918
    ipaddress.ip_network("169.254.0.0/16"),     # Link-Local
    ipaddress.ip_network("100.64.0.0/10"),      # CGNAT / shared address space (RFC6598)
    ipaddress.ip_network("224.0.0.0/4"),        # Multicast
    ipaddress.ip_network("::1/128"),            # IPv6 Loopback
    ipaddress.ip_network("fc00::/7"),           # IPv6 ULA
    ipaddress.ip_network("fe80::/10"),          # IPv6 Link-Local
    ipaddress.ip_network("ff00::/8"),           # IPv6 Multicast
    ipaddress.ip_network("64:ff9b::/96"),       # NAT64 (RFC6052)
    ipaddress.ip_network("0.0.0.0/8"),          # Unspecified
]

# Setup-Wizard-spezifische Block-Liste: Proxmox-Hosts liegen typischerweise
# auf RFC1918, deshalb wird hier nur Loopback / Link-Local / Multicast geblockt.
# Wichtig: 169.254.0.0/16 deckt die Cloud-Metadata-Adresse 169.254.169.254 ab.
_SETUP_BLOCKED_NETWORKS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    ipaddress.ip_network("127.0.0.0/8"),        # IPv4 Loopback
    ipaddress.ip_network("169.254.0.0/16"),     # Link-Local + IMDS
    ipaddress.ip_network("224.0.0.0/4"),        # Multicast
    ipaddress.ip_network("0.0.0.0/8"),          # Unspecified
    ipaddress.ip_network("::1/128"),            # IPv6 Loopback
    ipaddress.ip_network("fe80::/10"),          # IPv6 Link-Local
    ipaddress.ip_network("ff00::/8"),           # IPv6 Multicast
]


def _addr_in_networks(addr, networks) -> bool:
    """Prüft addr gegen eine Netz-Liste – inkl. IPv4-mapped-IPv6.

    ``::ffff:127.0.0.1`` ist ein IPv6Address und liegt in keinem IPv4-Network;
    ohne diese Normalisierung würde ``ipaddress`` ihn nicht als Loopback erkennen
    → SSRF-Bypass via attacker-kontrollierter AAAA-Antwort. Wir testen daher
    zusätzlich die eingebettete IPv4-Adresse.
    """
    if any(addr in net for net in networks):
        return True
    mapped = getattr(addr, "ipv4_mapped", None)
    if mapped is not None and any(mapped in net for net in networks):
        return True
    return False


def is_private_ip(ip_str: str) -> bool:
    """Prüft ob eine IP-Adresse in einem blockierten Netzwerk liegt."""
    try:
        addr = ipaddress.ip_address(ip_str)
        return _addr_in_networks(addr, _BLOCKED_NETWORKS)
    except ValueError:
        return True  # Ungültige IP → blockieren


def is_unsafe_setup_target(ip_str: str) -> bool:
    """Prüft ob eine IP-Adresse für Setup-Wizard-Probes unsicher ist.

    Anders als is_private_ip() erlaubt diese Funktion RFC1918 (LAN ist die
    Realität für Proxmox-Hosts), blockiert aber weiterhin Loopback,
    Link-Local (inkl. IMDS 169.254.169.254), Multicast und Unspecified.
    """
    try:
        addr = ipaddress.ip_address(ip_str)
        return _addr_in_networks(addr, _SETUP_BLOCKED_NETWORKS)
    except ValueError:
        return True  # Ungültige IP → blockieren


def _resolve_host(hostname: str) -> str | None:
    """Löst einen Hostnamen synchron auf. Gibt None bei Fehler zurück."""
    try:
        results = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC)
        if results:
            return results[0][4][0]  # erste aufgelöste IP
        return None
    except (socket.gaierror, OSError):
        return None


def validate_webhook_url(
    url: str,
    allow_http: bool = False,
    allowlist_patterns: list[str] | None = None,
) -> None:
    """Validiert eine Webhook-URL synchron.

    Prüft:
    - Schema (https:// erforderlich, http:// nur wenn allow_http=True)
    - Privat-IP-Blockierung (DNS-Resolve → IP-Check)
    - Strict-Allowlist (wenn allowlist_patterns nicht leer)

    Raises:
        ValueError: wenn die URL ungültig, privat oder nicht in der Allowlist ist
    """
    if not url:
        raise ValueError("Webhook-URL darf nicht leer sein")

    parsed = urlparse(url)

    # Schema-Prüfung
    if parsed.scheme == "https":
        pass  # immer erlaubt
    elif parsed.scheme == "http":
        if not allow_http:
            raise ValueError(
                "Webhook-URLs müssen HTTPS verwenden. "
                "HTTP ist nur mit explizitem allow_http-Flag erlaubt."
            )
    else:
        raise ValueError(
            f"Ungültiges URL-Schema '{parsed.scheme}'. Nur https (und http mit Flag) erlaubt."
        )

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Webhook-URL enthält keinen Hostnamen")

    # DNS-Resolve + Privat-IP-Check
    resolved_ip = _resolve_host(hostname)
    if resolved_ip is None:
        raise ValueError(f"Hostname '{hostname}' konnte nicht aufgelöst werden")

    if is_private_ip(resolved_ip):
        raise ValueError(
            f"Webhook-URL zeigt auf eine private/interne IP ({resolved_ip}). "
            "Aus Sicherheitsgründen werden interne Netzwerke blockiert."
        )

    # Strict-Allowlist (nur wenn nicht leer = aktiv)
    if allowlist_patterns:
        if not _matches_allowlist(hostname, allowlist_patterns):
            raise ValueError(
                f"Hostname '{hostname}' ist nicht in der Webhook-Allowlist. "
                "Bitte den Hostnamen in System Settings → Sicherheit → Webhook-Allowlist hinzufügen."
            )


def _matches_allowlist(hostname: str, patterns: list[str]) -> bool:
    """Prüft ob ein Hostname einem der Allowlist-Patterns entspricht.

    Patterns können exakte Hostnamen oder Wildcard-Suffixe (*.example.com) sein.
    """
    hostname = hostname.lower()
    for pattern in patterns:
        pattern = pattern.lower().strip()
        if not pattern:
            continue
        if pattern.startswith("*."):
            suffix = pattern[1:]  # z.B. ".example.com"
            if hostname.endswith(suffix) or hostname == suffix.lstrip("."):
                return True
        else:
            if hostname == pattern:
                return True
    return False


def check_dns_rebinding(hostname: str, expected_allowed: bool = True) -> tuple[bool, str]:
    """DNS-Rebinding-Schutz: Löst Hostname auf und prüft ob IP privat ist.

    Gibt (is_safe, resolved_ip) zurück.
    Wird beim Dispatch unmittelbar vor dem HTTP-Request aufgerufen.
    """
    resolved_ip = _resolve_host(hostname)
    if resolved_ip is None:
        return False, ""
    if is_private_ip(resolved_ip):
        return False, resolved_ip
    return True, resolved_ip


@asynccontextmanager
async def secure_outbound_client(
    verify: bool = True,
    timeout: float = 10.0,
):
    """Async context manager für sichere ausgehende HTTP-Requests.

    Ersetzt direktes `httpx.AsyncClient(verify=False)`.
    verify=True ist der sichere Default.
    """
    async with httpx.AsyncClient(verify=verify, timeout=timeout) as client:
        yield client


def validate_setup_target_url(url: str) -> str:
    """Validiert eine vom Caller gelieferte URL für Setup-Wizard-Probes.

    Während des initialen Setups (`setup_complete=false`) sind die
    Endpoints `/api/setup/test-node` und `/api/setup/test-connection`
    bewusst unauthentifiziert. Ohne diese Validierung ergeben sie
    Unauth-SSRF gegen Loopback, Container-interne Services und
    Cloud-IMDS (169.254.169.254).

    Anders als `validate_webhook_url()` erlaubt diese Funktion RFC1918,
    weil Proxmox-Hosts im LAN die Normalfall-Topologie sind.

    Gibt die aufgelöste IP zurück (für IP-Pinning im Caller, gegen
    DNS-Rebinding).

    Raises:
        ValueError mit generischer Meldung – die Originaldetails werden
        bewusst nicht zurückgegeben, um Informationsleckage zu vermeiden.
    """
    if not url:
        raise ValueError("URL darf nicht leer sein")

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Ungültiges URL-Schema (nur http/https erlaubt)")

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL enthält keinen Hostnamen")

    resolved_ip = _resolve_host(hostname)
    if resolved_ip is None:
        raise ValueError("Hostname konnte nicht aufgelöst werden")

    if is_unsafe_setup_target(resolved_ip):
        raise ValueError(
            "Ziel-Adresse blockiert (Loopback, Link-Local, IMDS oder Multicast). "
            "Bitte eine erreichbare Proxmox-Host-Adresse angeben."
        )

    return resolved_ip


def pin_url_to_ip(url: str, resolved_ip: str) -> tuple[str, dict[str, str]]:
    """Schreibt eine URL so um, dass sie gegen die übergebene IP statt
    gegen den Hostnamen konnektiert.

    Schließt DNS-Rebinding zwischen Validierung und Request: nach
    `validate_setup_target_url()` haben wir eine bereits geprüfte IP –
    diese wird jetzt fest in die URL geschrieben, sodass eine zweite
    DNS-Auflösung kein anderes Ziel mehr liefern kann.

    Der Host-Header behält den Original-Hostnamen, damit
    Proxmox-Reverse-Proxies und vhosts korrekt routen.

    Returns:
        (rewritten_url, extra_headers)
    """
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    port_part = f":{parsed.port}" if parsed.port else ""

    # IPv6-Literals brauchen eckige Klammern in der URL.
    try:
        is_v6 = isinstance(ipaddress.ip_address(resolved_ip), ipaddress.IPv6Address)
    except ValueError:
        is_v6 = False
    ip_in_url = f"[{resolved_ip}]" if is_v6 else resolved_ip

    netloc = f"{ip_in_url}{port_part}"
    rewritten = parsed._replace(netloc=netloc).geturl()

    host_header = f"{hostname}{port_part}" if hostname else netloc
    return rewritten, {"Host": host_header}
