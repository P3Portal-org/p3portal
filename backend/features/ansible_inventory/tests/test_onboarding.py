# p3portal.org
"""PROJ-83: Onboarding-Block-Tests (Sicherheit + Idempotenz + cloud-init)."""
from __future__ import annotations

import pytest

from backend.features.ansible_inventory import onboarding as ob

KEY1 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 alice@host"
KEY2 = "ssh-rsa AAAAB3NzaC1yc2E bob@host"


def test_block_contains_user_sudoers_keys():
    blk = ob.render_onboarding_block([KEY1, KEY2])
    assert "p3-ansible" in blk
    assert "NOPASSWD:ALL" in blk
    assert "visudo -cf" in blk
    assert KEY1 in blk and KEY2 in blk
    # Idempotenz-Guard
    assert "getent passwd p3-ansible" in blk
    assert "useradd" in blk
    # authorized_keys set-overwrite (kein >> append)
    assert ">> " not in blk.split("authorized_keys")[1][:5]


def test_block_set_overwrite_uses_truncate():
    blk = ob.render_onboarding_block([KEY1])
    # nutzt `cat >` (Überschreibung), nicht `cat >>`
    assert "cat > \"$P3_HOME/.ssh/authorized_keys\"" in blk


def test_empty_keys_produce_empty_authorized_keys():
    blk = ob.render_onboarding_block([])
    assert "p3-ansible" in blk
    # heredoc bleibt valide, Key-Block leer
    assert "P3_KEYS_EOF" in blk


@pytest.mark.parametrize("bad", [
    "ssh-ed25519 AAA\nmalicious",
    "ssh-ed25519 AAA\rmalicious",
    "P3_KEYS_EOF",
    "contains P3_SUDOERS_EOF here",
    "ctrl\x07char",
    "nul\x00byte",
])
def test_rejects_unsafe_keys(bad):
    with pytest.raises(ob.InvalidPublicKey):
        ob.render_onboarding_block([bad])


def test_dedup_keys():
    blk = ob.render_onboarding_block([KEY1, KEY1])
    assert blk.count(KEY1) == 1


def test_whitespace_and_empty_dropped():
    blk = ob.render_onboarding_block(["  ", "", KEY1])
    assert KEY1 in blk


def test_cloud_init_vendor_data():
    vd = ob.render_cloud_init_vendor_data([KEY1])
    assert vd.startswith("#cloud-config")
    assert "write_files" in vd
    assert "encoding: b64" in vd
    assert "runcmd" in vd
    # Der eigentliche Block ist base64 → kein Klartext-Key in der YAML
    assert KEY1 not in vd


def test_cloud_init_b64_decodes_to_block():
    import base64
    vd = ob.render_cloud_init_vendor_data([KEY1])
    b64_line = [l for l in vd.splitlines() if l.strip().startswith("content:")][0]
    b64 = b64_line.split("content:", 1)[1].strip()
    decoded = base64.b64decode(b64).decode()
    assert "p3-ansible" in decoded and KEY1 in decoded
