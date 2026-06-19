# p3portal.org
"""PROJ-83: Deploy-Onboarding-Hook (Zustands-Aufzeichnung + cloud-init extravars)."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import text

from backend.db.database import get_db, init_db
from backend.features.ansible_inventory import deploy_hook as dh
from backend.features.ansible_inventory import host_state as hs


@pytest.fixture(autouse=True)
def _data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def db():
    await init_db()
    async with get_db() as s:
        await s.execute(text(
            "INSERT INTO nodes (id, name, url, proxmox_node, created_at) "
            "VALUES (1, 'n1', 'https://pve:8006', 'pve1', '2026-01-01')"
        ))
        await s.commit()
    yield


async def _insert_job(job_id, *, manage=1, gopt=0, category="vm_deployment",
                      owner=5, params=None):
    if params is None:
        params = {"proxmox_node": "pve1", "vm_id": 101}
    async with get_db() as s:
        await s.execute(text(
            "INSERT INTO jobs (id, type, playbook, status, created_at, username, params, "
            "auto_owner_user_id, deploy_category, ansible_manage, ansible_global_opt_in) "
            "VALUES (:id, 'ansible', 'p', 'success', '2026-01-01', 'op', :params, "
            ":owner, :cat, :manage, :gopt)"
        ), {"id": job_id, "params": json.dumps(params), "owner": owner,
            "cat": category, "manage": manage, "gopt": gopt})
        await s.commit()


@pytest.mark.asyncio
async def test_records_managed_when_keys_present(db):
    await _insert_job("j1")
    with patch.object(dh._keys, "get_injection_public_keys",
                      new=AsyncMock(return_value=["ssh-ed25519 AAA user"])):
        await dh.on_deploy_success_ansible("j1")
    st = await hs.get_host_state(1, 101, "qemu")
    assert st is not None and st["ssh_managed"] is True


@pytest.mark.asyncio
async def test_skips_when_manage_off(db):
    await _insert_job("j2", manage=0)
    with patch.object(dh._keys, "get_injection_public_keys",
                      new=AsyncMock(return_value=["ssh-ed25519 AAA"])):
        await dh.on_deploy_success_ansible("j2")
    assert await hs.get_host_state(1, 101, "qemu") is None


@pytest.mark.asyncio
async def test_skips_when_no_keys(db):
    await _insert_job("j3")
    with patch.object(dh._keys, "get_injection_public_keys",
                      new=AsyncMock(return_value=[])):
        await dh.on_deploy_success_ansible("j3")
    assert await hs.get_host_state(1, 101, "qemu") is None


@pytest.mark.asyncio
async def test_skips_non_deploy_category(db):
    await _insert_job("j4", category="vm_lxc_config")
    with patch.object(dh._keys, "get_injection_public_keys",
                      new=AsyncMock(return_value=["ssh-ed25519 AAA"])):
        await dh.on_deploy_success_ansible("j4")
    assert await hs.get_host_state(1, 101, "qemu") is None


@pytest.mark.asyncio
async def test_lxc_kind_and_global_opt_in(db):
    await _insert_job("j5", category="lxc_deployment", gopt=1,
                      params={"proxmox_node": "pve1", "vm_id": 202})
    with patch.object(dh._keys, "get_injection_public_keys",
                      new=AsyncMock(return_value=["ssh-ed25519 AAA"])):
        await dh.on_deploy_success_ansible("j5")
    st = await hs.get_host_state(1, 202, "lxc")
    assert st["ssh_managed"] is True
    assert st["global_opt_in"] is True


@pytest.mark.asyncio
async def test_build_extravars_empty_when_no_owner(db):
    ev = await dh.build_deploy_onboarding_extravars(None, None, False)
    assert ev == {}


@pytest.mark.asyncio
async def test_build_extravars_contains_block_and_vendor_data(db):
    with patch.object(dh._keys, "get_injection_public_keys",
                      new=AsyncMock(return_value=["ssh-ed25519 AAA user"])):
        ev = await dh.build_deploy_onboarding_extravars(5, None, False)
    assert "p3_onboard_vendor_data" in ev
    assert "p3_onboard_block" in ev
    assert ev["p3_onboard_vendor_data"].startswith("#cloud-config")
    assert "p3-ansible" in ev["p3_onboard_block"]
