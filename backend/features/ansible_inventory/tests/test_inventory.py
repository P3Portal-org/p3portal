# p3portal.org
"""PROJ-83: Inventory-Generator-Tests (Gruppierung managed/unmanaged/no_ip)."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from backend.features.ansible_inventory import inventory as inv


def _state(ssh_managed, host_key=None, user="p3-ansible"):
    return {
        "portal_node_id": 1, "vmid": 0, "kind": "qemu",
        "ssh_managed": ssh_managed, "ansible_user": user,
        "global_opt_in": False, "host_key": host_key, "host_origin": "proxmox",
    }


class _FakeNode:
    url = "https://pve:8006"
    verify_ssl = False
    proxmox_node = "pve1"


@pytest.mark.asyncio
async def test_user_scope_grouping():
    candidates = [(1, 101, "qemu"), (1, 102, "qemu"), (1, 103, "lxc")]
    live_map = {
        101: {"proxmox_node": "pve1", "type": "qemu"},
        102: {"proxmox_node": "pve1", "type": "qemu"},
        103: {"proxmox_node": "pve1", "type": "lxc"},
    }
    states = {
        (101, "qemu"): _state(True, host_key="ssh-ed25519 HK101"),  # managed + IP → managed
        (102, "qemu"): _state(True),                                 # managed, no IP → no_ip
        (103, "lxc"): _state(False),                                 # unmanaged
    }

    async def fake_ip(node, proxmox_node, vmid, vm_type):
        return "192.168.1.5" if vmid == 101 else None

    with patch.object(inv, "_user_scope_candidates", new=AsyncMock(return_value=candidates)), \
         patch.object(inv._keys, "get_user_private_key", new=AsyncMock(return_value="PRIVKEY")), \
         patch.object(inv, "_resolve_node_live", new=AsyncMock(return_value=(live_map, states))), \
         patch.object(inv, "_fetch_host_ip", new=AsyncMock(side_effect=fake_ip)), \
         patch("backend.services.nodes_service.get_node", new=AsyncMock(return_value=_FakeNode())):
        result = await inv.build_inventory("user", None, user_id=5)

    groups = {e.host_ref: e.group for e in result.entries}
    assert groups["1:101:qemu"] == "managed"
    assert groups["1:102:qemu"] == "no_ip"
    assert groups["1:103:lxc"] == "unmanaged"
    # nur managed im Laufzeit-Inventory
    assert len(result.targets) == 1
    assert result.targets[0]["vmid"] == 101
    assert result.targets[0]["ansible_host"] == "192.168.1.5"
    assert "managed" in result.inventory_dict
    # Host-Key für known_hosts
    assert result.host_keys.get("192.168.1.5") == "ssh-ed25519 HK101"
    assert result.error is None


@pytest.mark.asyncio
async def test_user_scope_no_key_error():
    with patch.object(inv, "_user_scope_candidates", new=AsyncMock(return_value=[(1, 1, "qemu")])), \
         patch.object(inv._keys, "get_user_private_key", new=AsyncMock(return_value=None)):
        result = await inv.build_inventory("user", None, user_id=5)
    assert result.error == inv.ERR_NO_KEY


@pytest.mark.asyncio
async def test_empty_scope():
    with patch.object(inv, "_user_scope_candidates", new=AsyncMock(return_value=[])), \
         patch.object(inv._keys, "get_user_private_key", new=AsyncMock(return_value="PRIVKEY")):
        result = await inv.build_inventory("user", None, user_id=5)
    assert result.error == inv.ERR_EMPTY_SCOPE


@pytest.mark.asyncio
async def test_no_managed_targets_error():
    candidates = [(1, 101, "qemu")]
    states = {(101, "qemu"): _state(False)}  # unmanaged
    with patch.object(inv, "_user_scope_candidates", new=AsyncMock(return_value=candidates)), \
         patch.object(inv._keys, "get_user_private_key", new=AsyncMock(return_value="PRIVKEY")), \
         patch.object(inv, "_resolve_node_live", new=AsyncMock(return_value=({}, states))), \
         patch("backend.services.nodes_service.get_node", new=AsyncMock(return_value=_FakeNode())):
        result = await inv.build_inventory("user", None, user_id=5)
    assert result.error == inv.ERR_NO_TARGETS
    assert result.targets == []


@pytest.mark.asyncio
async def test_target_hosts_filter():
    candidates = [(1, 101, "qemu"), (1, 102, "qemu")]
    live_map = {101: {"proxmox_node": "pve1", "type": "qemu"},
                102: {"proxmox_node": "pve1", "type": "qemu"}}
    states = {(101, "qemu"): _state(True), (102, "qemu"): _state(True)}
    with patch.object(inv, "_user_scope_candidates", new=AsyncMock(return_value=candidates)), \
         patch.object(inv._keys, "get_user_private_key", new=AsyncMock(return_value="PRIVKEY")), \
         patch.object(inv, "_resolve_node_live", new=AsyncMock(return_value=(live_map, states))), \
         patch.object(inv, "_fetch_host_ip", new=AsyncMock(return_value="10.0.0.9")), \
         patch("backend.services.nodes_service.get_node", new=AsyncMock(return_value=_FakeNode())):
        result = await inv.build_inventory("user", None, user_id=5, target_hosts=["1:101:qemu"])
    # beide managed (entries), aber nur 101 im Laufzeit-Ziel
    assert len(result.entries) == 2
    assert len(result.targets) == 1
    assert result.targets[0]["vmid"] == 101


@pytest.mark.asyncio
async def test_pool_scope_via_mediator():
    from backend.core.plus_protocol import GuestScope
    gs = GuestScope(scope="pool", scope_ref=7, private_key="POOLKEY",
                    candidate_hosts=[(1, 201, "qemu")])
    live_map = {201: {"proxmox_node": "pve1", "type": "qemu"}}
    states = {(201, "qemu"): _state(True)}
    with patch("backend.core.plus_protocol.plus_behavior.resolve_guest_scope",
               new=AsyncMock(return_value=gs)), \
         patch.object(inv, "_resolve_node_live", new=AsyncMock(return_value=(live_map, states))), \
         patch.object(inv, "_fetch_host_ip", new=AsyncMock(return_value="10.0.0.1")), \
         patch("backend.services.nodes_service.get_node", new=AsyncMock(return_value=_FakeNode())):
        result = await inv.build_inventory("pool", 7, user_id=5)
    assert result.private_key == "POOLKEY"
    assert len(result.targets) == 1


@pytest.mark.asyncio
async def test_pool_scope_none_when_not_member():
    with patch("backend.core.plus_protocol.plus_behavior.resolve_guest_scope",
               new=AsyncMock(return_value=None)):
        result = await inv.build_inventory("pool", 7, user_id=5)
    assert result.error == inv.ERR_EMPTY_SCOPE
