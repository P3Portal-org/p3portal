# p3portal.org
"""PROJ-83: Onboarding-Block (kanonische, idempotente Definition).

EINE Definition dessen, was in einem managed Gast eingerichtet wird:
  1. Service-User `p3-ansible` (idempotent via getent-Guard)
  2. NOPASSWD-sudoers-Drop-in (0440, visudo-validiert)
  3. authorized_keys = exakt die gelieferten Public Keys (Set-Überschreibung →
     entfernte Key-Tiers fallen sauber raus)

Sicherheit: die EINZIGE Variable ist die Public-Key-Liste = **Daten**. Keys gehen
via single-quoted Heredoc (keine Shell-Expansion) in die Datei, nie in einen
shell-evaluierten String → kein Command-Injection. Keys werden vorab sanitisiert
(keine Zeilenumbrüche, kein Heredoc-Sentinel).

Zwei MVP-Zustellwege, derselbe Block:
  (a) manuell anzeigen (Router-EP) – jeder Host, kein Token-Privileg.
  (b) cloud-init vendor-data (`#cloud-config`) – nur QEMU-Deploys mit Snippets-Storage.
POSIX-portabel für Debian/Ubuntu + RHEL/Rocky.
"""
from __future__ import annotations

import base64

_SUDOERS_SENTINEL = "P3_SUDOERS_EOF"
_KEYS_SENTINEL = "P3_KEYS_EOF"
SERVICE_USER = "p3-ansible"


class InvalidPublicKey(ValueError):
    """Ein gelieferter Public Key ist nicht onboarding-sicher."""


def _sanitize_keys(public_keys: list[str]) -> list[str]:
    """Validiert + normalisiert die Public-Key-Liste.

    Verwirft leere Einträge; lehnt Keys mit Zeilenumbruch / Heredoc-Sentinel /
    Steuerzeichen ab (Defense-in-Depth gegen Heredoc-Ausbruch).
    """
    out: list[str] = []
    for raw in public_keys:
        if raw is None:
            continue
        key = raw.strip()
        if not key:
            continue
        if "\n" in key or "\r" in key:
            raise InvalidPublicKey("public key must be a single line")
        if _KEYS_SENTINEL in key or _SUDOERS_SENTINEL in key:
            raise InvalidPublicKey("public key contains reserved heredoc sentinel")
        if any(ord(c) < 0x20 for c in key):
            raise InvalidPublicKey("public key contains control characters")
        if key not in out:
            out.append(key)
    return out


def render_onboarding_block(public_keys: list[str]) -> str:
    """Erzeugt den idempotenten POSIX-sh-Onboarding-Block als Text.

    Mehrfaches Ausführen ist gefahrlos: useradd nur wenn fehlend; sudoers + authorized_keys
    werden überschrieben (Set-Semantik). Bei leerer Key-Liste werden die authorized_keys
    geleert (Host wird unbenutzbar, sauber).
    """
    keys = _sanitize_keys(public_keys)
    keys_block = "\n".join(keys)
    # Nachgestelltes Newline für den Heredoc, auch bei leerer Key-Liste.
    if keys_block:
        keys_block += "\n"
    return f"""#!/bin/sh
# P3 Portal – Ansible onboarding block (idempotent).
# Creates the dedicated service user '{SERVICE_USER}' with NOPASSWD sudo and the
# managed SSH public keys. Safe to run multiple times.
set -eu

# 1. Service user (idempotent)
getent passwd {SERVICE_USER} >/dev/null 2>&1 || useradd -m -s /bin/sh {SERVICE_USER}

# 2. Passwordless sudo drop-in (validated)
cat > /etc/sudoers.d/{SERVICE_USER} <<'{_SUDOERS_SENTINEL}'
{SERVICE_USER} ALL=(ALL) NOPASSWD:ALL
{_SUDOERS_SENTINEL}
chmod 0440 /etc/sudoers.d/{SERVICE_USER}
visudo -cf /etc/sudoers.d/{SERVICE_USER}

# 3. authorized_keys = exactly the managed keys (set-overwrite)
P3_HOME=$(getent passwd {SERVICE_USER} | cut -d: -f6)
install -d -m 0700 "$P3_HOME/.ssh"
chown {SERVICE_USER}: "$P3_HOME/.ssh"
cat > "$P3_HOME/.ssh/authorized_keys" <<'{_KEYS_SENTINEL}'
{keys_block}{_KEYS_SENTINEL}
chmod 0600 "$P3_HOME/.ssh/authorized_keys"
chown {SERVICE_USER}: "$P3_HOME/.ssh/authorized_keys"
"""


def render_cloud_init_vendor_data(public_keys: list[str]) -> str:
    """Erzeugt eine cloud-init `#cloud-config` vendor-data-Datei, die den Block beim
    ersten Boot ausführt.

    Der Block wird base64-kodiert über write_files abgelegt (keine YAML-Sonderzeichen)
    und per runcmd ausgeführt. vendor-data wird mit der von Proxmox generierten
    user-data (ciuser/sshkeys) gemerged → kein Konflikt mit dem User des Erstellers
    (AC-KEY-6). Greift nur beim ersten Boot.
    """
    block = render_onboarding_block(public_keys)
    b64 = base64.b64encode(block.encode("utf-8")).decode("ascii")
    return (
        "#cloud-config\n"
        "write_files:\n"
        "  - path: /var/lib/p3-onboard.sh\n"
        "    permissions: '0700'\n"
        "    encoding: b64\n"
        f"    content: {b64}\n"
        "runcmd:\n"
        "  - [ /bin/sh, /var/lib/p3-onboard.sh ]\n"
    )
