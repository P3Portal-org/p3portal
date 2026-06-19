# p3portal.org
"""PROJ-75: Tests für ProxmoxClient.get_vm_configs_bulk – Bulk-Config-Abruf über
EINEN Client (keep-alive) statt eines TLS-Handshakes pro Gast; Fehlergründe
werden je Eintrag erfasst (best-effort, wirft nie)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from backend.services.proxmox import ProxmoxAuth, ProxmoxClient


class _FakeResp:
    def __init__(self, payload, status=200):
        self._p = payload
        self._status = status

    def raise_for_status(self):
        if self._status >= 400:
            raise httpx.HTTPStatusError(
                "err",
                request=httpx.Request("GET", "https://x/config"),
                response=httpx.Response(self._status),
            )

    def json(self):
        return self._p


class _FakeClient:
    """Liefert pro vmid eine Config aus der Map; 403 für vmids in ``forbidden``."""
    def __init__(self, configs, forbidden=None):
        self._configs = configs
        self._forbidden = forbidden or set()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, **kw):
        vmid = int(url.rstrip("/").rsplit("/config", 1)[0].rsplit("/", 1)[1])
        if vmid in self._forbidden:
            return _FakeResp({}, status=403)
        return _FakeResp({"data": self._configs.get(vmid, {})})


_AUTH = ProxmoxAuth(kind="token", value="portal@pve!t", secret="uuid")


@pytest.mark.asyncio
async def test_bulk_reuses_one_client_and_returns_configs():
    pc = ProxmoxClient(base_url="https://x:8006")
    configs = {101: {"net0": "virtio=AA,bridge=vmbr0"}, 201: {"net0": "name=eth0,bridge=vmbr1"}}
    fake = MagicMock(return_value=_FakeClient(configs))
    with patch.object(ProxmoxClient, "_client", new=fake):
        out = await pc.get_vm_configs_bulk(
            _AUTH, [("pve1", 101, "qemu"), ("pve1", 201, "lxc")]
        )

    # EIN Client für den ganzen Batch (keep-alive), nicht einer pro Gast.
    assert fake.call_count == 1
    assert out[("pve1", 101)] == ({"net0": "virtio=AA,bridge=vmbr0"}, None)
    assert out[("pve1", 201)] == ({"net0": "name=eth0,bridge=vmbr1"}, None)


@pytest.mark.asyncio
async def test_bulk_captures_403_reason_without_raising():
    pc = ProxmoxClient(base_url="https://x:8006")
    fake = MagicMock(return_value=_FakeClient({102: {}}, forbidden={101}))
    with patch.object(ProxmoxClient, "_client", new=fake):
        out = await pc.get_vm_configs_bulk(
            _AUTH, [("pve1", 101, "qemu"), ("pve1", 102, "qemu")]
        )

    assert out[("pve1", 101)] == (None, "403")     # forbidden → reason captured
    assert out[("pve1", 102)] == ({}, None)         # other guest still OK


@pytest.mark.asyncio
async def test_bulk_empty_items():
    pc = ProxmoxClient(base_url="https://x:8006")
    assert await pc.get_vm_configs_bulk(_AUTH, []) == {}
