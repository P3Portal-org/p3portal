# p3portal.org
"""PROJ-83: host_state CRUD-Tests (DB)."""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text

from backend.db.database import get_db, init_db
from backend.features.ansible_inventory import host_state as hs


@pytest.fixture(autouse=True)
def _data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def db():
    await init_db()
    async with get_db() as session:
        await session.execute(text(
            "INSERT INTO nodes (id, name, url, proxmox_node, created_at) "
            "VALUES (1, 'n1', 'https://pve:8006', 'pve1', '2026-01-01')"
        ))
        await session.commit()
    yield


@pytest.mark.asyncio
async def test_upsert_and_get(db):
    await hs.upsert_host_state(1, 101, "qemu", ssh_managed=True, global_opt_in=True)
    st = await hs.get_host_state(1, 101, "qemu")
    assert st["ssh_managed"] is True
    assert st["global_opt_in"] is True
    assert st["ansible_user"] == "p3-ansible"
    assert st["host_origin"] == "proxmox"


@pytest.mark.asyncio
async def test_upsert_idempotent_update(db):
    await hs.upsert_host_state(1, 101, "qemu", ssh_managed=True)
    await hs.upsert_host_state(1, 101, "qemu", ssh_managed=False)
    st = await hs.get_host_state(1, 101, "qemu")
    assert st["ssh_managed"] is False


@pytest.mark.asyncio
async def test_persist_and_reset_host_key(db):
    await hs.upsert_host_state(1, 101, "qemu", ssh_managed=True)
    await hs.persist_host_key(1, 101, "qemu", "ssh-ed25519 AAAAHOSTKEY")
    st = await hs.get_host_state(1, 101, "qemu")
    assert st["host_key"] == "ssh-ed25519 AAAAHOSTKEY"
    changed = await hs.reset_host_key(1, 101, "qemu")
    assert changed is True
    st2 = await hs.get_host_state(1, 101, "qemu")
    assert st2["host_key"] is None


@pytest.mark.asyncio
async def test_persist_host_key_creates_row(db):
    # kein vorheriger upsert → persist_host_key legt Zeile an
    await hs.persist_host_key(1, 202, "lxc", "ssh-rsa AAAAK")
    st = await hs.get_host_state(1, 202, "lxc")
    assert st is not None
    assert st["ssh_managed"] is False
    assert st["host_key"] == "ssh-rsa AAAAK"


@pytest.mark.asyncio
async def test_reset_host_key_missing_row(db):
    assert await hs.reset_host_key(1, 999, "qemu") is False


@pytest.mark.asyncio
async def test_bulk_get(db):
    await hs.upsert_host_state(1, 101, "qemu", ssh_managed=True)
    await hs.upsert_host_state(1, 102, "lxc", ssh_managed=False)
    res = await hs.bulk_get_host_states(1, [(101, "qemu"), (102, "lxc"), (103, "qemu")])
    assert (101, "qemu") in res and (102, "lxc") in res
    assert (103, "qemu") not in res  # nie angelegt → fehlt


@pytest.mark.asyncio
async def test_delete_vanished(db):
    await hs.upsert_host_state(1, 101, "qemu", ssh_managed=True)
    await hs.upsert_host_state(1, 102, "lxc", ssh_managed=True)
    # nur 101 noch sichtbar → 102 wird entfernt
    n = await hs.delete_vanished(1, still_visible={(101, "qemu")})
    assert n == 1
    assert await hs.get_host_state(1, 102, "lxc") is None
    assert await hs.get_host_state(1, 101, "qemu") is not None
