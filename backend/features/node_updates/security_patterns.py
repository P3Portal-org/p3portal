# p3portal.org
"""PROJ-73: Pattern-Liste sicherheitsrelevanter APT-Pakete.

Zentral pflegbar (AC-SEC-3). Keine UI-Editierbarkeit, keine DB-Tabelle.
Prefix-Match: Trailing '*' wird als Wildcard behandelt, sonst exakter Prefix.
"""
from __future__ import annotations

# AC-SEC-1: Pattern-Liste mit mind. den geforderten Paketen.
# Bewusst breit gehalten – False-Positives sind akzeptiertes Risiko (Edge 15).
SECURITY_PATTERNS: tuple[str, ...] = (
    "proxmox-kernel-",
    "pve-firmware",
    "pve-kernel-",
    "pve-qemu-kvm",
    "qemu-server",
    "libpve-",
    "openssh-server",
    "openssh-client",
    "sudo",
    "systemd",
    "libc6",
    "libssl",
    "openssl",
    "linux-image-",
)


def is_security_package(name: str) -> bool:
    """Return True if *name* matches any security pattern (prefix-based)."""
    lower = name.lower()
    for pattern in SECURITY_PATTERNS:
        if lower.startswith(pattern.lower()):
            return True
    return False
