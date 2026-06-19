# p3portal.org
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.routers.vms import router
from backend.services.proxmox import ProxmoxAuth, _sessions, proxmox_client

app = FastAPI()
app.include_router(router)

_FAKE_SESSION = {
    "ticket": "PVE:testuser@pam:FAKETICKET",
    "csrf": "FAKE:CSRF",
    "cap": {},
}
_FAKE_AUTH_OPERATOR = ProxmoxAuth(
    kind="token",
    value="portal-operator@pve!portal-operator",
    secret="fake-operator-uuid",
)
_FAKE_AUTH_ADMIN = ProxmoxAuth(
    kind="token",
    value="portal-admin@pve!portal-admin",
    secret="fake-admin-uuid",
)
_FAKE_UPID = "UPID:pve1:00001234:00000001:deadbeef:qmstart:100:root@pam:"


@pytest.fixture(autouse=True)
def inject_proxmox_session():
    _sessions["proxmox-user@pam"] = _FAKE_SESSION
    yield
    _sessions.clear()


@pytest.fixture(autouse=True)
def _no_stack_managed():
    """Default the PROJ-76 stack-mutation guard + PROJ-96 dependency-impact guard
    to no-ops.

    Both real guards hit the DB (get_node_for_proxmox_name); in unit tests the
    global session isn't initialised. Tests that exercise the 409 stack-block or
    the dependency-impact warning re-patch these targets inside their own
    ``with`` block (the inner patch wins).
    """
    with patch("backend.routers.vms._assert_not_stack_managed", new=AsyncMock(return_value=None)), \
         patch("backend.routers.vms._dependency_impact", new=AsyncMock(return_value=None)):
        yield


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
def operator_local_headers():
    token = create_access_token("localop", auth_type="local", role="operator")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_local_headers():
    token = create_access_token("localadmin", auth_type="local", role="admin")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def viewer_local_headers():
    token = create_access_token("localview", auth_type="local", role="viewer")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def proxmox_operator_headers():
    token = create_access_token("proxmox-user@pam", auth_type="proxmox", role="operator")
    return {"Authorization": f"Bearer {token}"}


# ── Helpers ───────────────────────────────────────────────────────────────────

# Mocks return (client, auth, proxmox_node, vm_type). The client is the real
# global proxmox_client so downstream patches on proxmox_client.<method> still
# apply (route handlers reference the bound name imported at module level).
_PATCH_VM_ACCESS_OPERATOR = lambda: patch(  # noqa: E731
    "backend.routers.vms._resolve_vm_access",
    new=AsyncMock(return_value=(proxmox_client, _FAKE_AUTH_OPERATOR, "pve1", "qemu")),
)
_PATCH_VM_ACCESS_ADMIN = lambda: patch(  # noqa: E731
    "backend.routers.vms._resolve_vm_access",
    new=AsyncMock(return_value=(proxmox_client, _FAKE_AUTH_ADMIN, "pve1", "qemu")),
)


def _patch_vm_access_missing():
    from fastapi import HTTPException
    return patch(
        "backend.routers.vms._resolve_vm_access",
        new=AsyncMock(side_effect=HTTPException(503, "service account not configured")),
    )


# ── VM Start ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_vm_start_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post("/api/vms/100/start", headers=operator_local_headers)
    assert resp.status_code == 200
    assert resp.json()["task_id"] == _FAKE_UPID


@pytest.mark.asyncio
async def test_vm_start_viewer_forbidden(client: AsyncClient, viewer_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch("backend.routers.vms.get_user_by_username", new=AsyncMock(return_value=None)),
    ):
        resp = await client.post("/api/vms/100/start", headers=viewer_local_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_vm_start_unauthenticated(client: AsyncClient):
    resp = await client.post("/api/vms/100/start")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_vm_start_missing_token_503(client: AsyncClient, operator_local_headers: dict):
    with _patch_vm_access_missing():
        resp = await client.post("/api/vms/100/start", headers=operator_local_headers)
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_vm_start_vm_not_found(client: AsyncClient, operator_local_headers: dict):
    from fastapi import HTTPException as _HTTPException
    with patch(
        "backend.routers.vms._resolve_vm_access",
        new=AsyncMock(side_effect=_HTTPException(status_code=404, detail="VM 999 not found")),
    ):
        resp = await client.post("/api/vms/999/start", headers=operator_local_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_vm_start_proxmox_user(client: AsyncClient, proxmox_operator_headers: dict):
    cookie_auth = ProxmoxAuth(
        kind="cookie", value=_FAKE_SESSION["ticket"], csrf=_FAKE_SESSION["csrf"]
    )
    with (
        patch(
            "backend.routers.vms._resolve_vm_access",
            new=AsyncMock(return_value=(proxmox_client, cookie_auth, "pve1", "qemu")),
        ),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post("/api/vms/100/start", headers=proxmox_operator_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_vm_start_with_explicit_node_query(
    client: AsyncClient, operator_local_headers: dict
):
    """Multi-Node: ?node=<name> is forwarded into _resolve_vm_access unchanged."""
    captured = {}

    async def _fake(_current_user, _vmid, proxmox_node=None):
        captured["proxmox_node"] = proxmox_node
        return proxmox_client, _FAKE_AUTH_OPERATOR, proxmox_node or "pve1", "qemu"

    with (
        patch("backend.routers.vms._resolve_vm_access", new=AsyncMock(side_effect=_fake)),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post(
            "/api/vms/100/start?node=pve2", headers=operator_local_headers
        )
    assert resp.status_code == 200
    assert captured["proxmox_node"] == "pve2"


# ── VM Stop ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_vm_stop_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post("/api/vms/100/stop", headers=operator_local_headers)
    assert resp.status_code == 200
    assert "task_id" in resp.json()


# ── VM Reboot ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_vm_reboot_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post("/api/vms/100/reboot", headers=operator_local_headers)
    assert resp.status_code == 200


# ── VM Config Update (CPU/RAM) ────────────────────────────────────────────────

_PATCH_AUDIT = lambda: patch(  # noqa: E731
    "backend.routers.vms.write_audit_log", new=AsyncMock(return_value=None)
)


@pytest.mark.asyncio
async def test_update_vm_config_success(client: AsyncClient, operator_local_headers: dict):
    captured = {}

    async def _fake_put(_auth, node, vmid, updates, delete_keys=None, vm_type="qemu"):
        captured.update(updates=updates, delete_keys=delete_keys, vm_type=vm_type)

    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.put_vm_config", new=AsyncMock(side_effect=_fake_put)),
    ):
        resp = await client.patch(
            "/api/vms/100/config",
            headers=operator_local_headers,
            json={"cores": 4, "memory": 4096, "onboot": True},
        )
    assert resp.status_code == 204
    assert captured["updates"] == {"cores": 4, "memory": 4096, "onboot": 1}


@pytest.mark.asyncio
async def test_update_vm_config_no_changes_400(client: AsyncClient, operator_local_headers: dict):
    with (_PATCH_VM_ACCESS_OPERATOR(), _PATCH_AUDIT()):
        resp = await client.patch("/api/vms/100/config", headers=operator_local_headers, json={})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_update_vm_config_viewer_forbidden(client: AsyncClient, viewer_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch("backend.routers.vms.get_user_by_username", new=AsyncMock(return_value=None)),
    ):
        resp = await client.patch(
            "/api/vms/100/config", headers=viewer_local_headers, json={"cores": 2}
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_vm_config_sockets_ignored_for_lxc(client: AsyncClient, operator_local_headers: dict):
    captured = {}

    async def _fake_put(_auth, node, vmid, updates, delete_keys=None, vm_type="lxc"):
        captured.update(updates=updates, delete_keys=delete_keys)

    with (
        patch(
            "backend.routers.vms._resolve_vm_access",
            new=AsyncMock(return_value=(proxmox_client, _FAKE_AUTH_OPERATOR, "pve1", "lxc")),
        ),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.put_vm_config", new=AsyncMock(side_effect=_fake_put)),
    ):
        resp = await client.patch(
            "/api/vms/200/config",
            headers=operator_local_headers,
            json={"cores": 2, "sockets": 2, "swap": 512},
        )
    assert resp.status_code == 204
    # sockets dropped (LXC), swap kept
    assert "sockets" not in captured["updates"]
    assert captured["updates"]["swap"] == 512


@pytest.mark.asyncio
async def test_update_vm_config_clear_description(client: AsyncClient, operator_local_headers: dict):
    captured = {}

    async def _fake_put(_auth, node, vmid, updates, delete_keys=None, vm_type="qemu"):
        captured.update(updates=updates, delete_keys=delete_keys)

    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.put_vm_config", new=AsyncMock(side_effect=_fake_put)),
    ):
        resp = await client.patch(
            "/api/vms/100/config", headers=operator_local_headers, json={"description": "  "}
        )
    assert resp.status_code == 204
    assert captured["delete_keys"] == ["description"]


@pytest.mark.asyncio
async def test_update_vm_config_invalid_memory_422(client: AsyncClient, operator_local_headers: dict):
    with (_PATCH_VM_ACCESS_OPERATOR(), _PATCH_AUDIT()):
        resp = await client.patch(
            "/api/vms/100/config", headers=operator_local_headers, json={"memory": 1}
        )
    assert resp.status_code == 422


# ── Snapshots ─────────────────────────────────────────────────────────────────

_FAKE_SNAPSHOTS = [
    {"name": "current", "parent": "snap1", "description": ""},
    {"name": "snap1", "snaptime": 1713897600, "description": "Before update", "parent": ""},
]


@pytest.mark.asyncio
async def test_list_snapshots_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.get_snapshots",
            new=AsyncMock(return_value=_FAKE_SNAPSHOTS),
        ),
    ):
        resp = await client.get("/api/vms/100/snapshots", headers=operator_local_headers)
    assert resp.status_code == 200
    body = resp.json()
    # "current" pseudo-snapshot must be filtered out
    assert all(s["name"] != "current" for s in body)
    assert len(body) == 1
    assert body[0]["name"] == "snap1"


@pytest.mark.asyncio
async def test_list_snapshots_viewer_forbidden(client: AsyncClient, viewer_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch("backend.routers.vms.get_user_by_username", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/vms/100/snapshots", headers=viewer_local_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_snapshot_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.create_snapshot",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post(
            "/api/vms/100/snapshots",
            json={"name": "my-snap", "description": "test"},
            headers=operator_local_headers,
        )
    assert resp.status_code == 202
    assert resp.json()["task_id"] == _FAKE_UPID


@pytest.mark.asyncio
async def test_create_snapshot_invalid_name(client: AsyncClient, operator_local_headers: dict):
    with _PATCH_VM_ACCESS_OPERATOR():
        resp = await client.post(
            "/api/vms/100/snapshots",
            json={"name": "bad name with spaces!"},
            headers=operator_local_headers,
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_rollback_snapshot_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.rollback_snapshot",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post(
            "/api/vms/100/snapshots/snap1/rollback",
            headers=operator_local_headers,
        )
    assert resp.status_code == 200
    assert "task_id" in resp.json()


@pytest.mark.asyncio
async def test_delete_snapshot_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.delete_snapshot",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.delete(
            "/api/vms/100/snapshots/snap1",
            headers=operator_local_headers,
        )
    assert resp.status_code == 200


# ── VM Delete ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_vm_success_admin(client: AsyncClient, admin_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_ADMIN(),
        patch(
            "backend.routers.vms.proxmox_client.delete_vm",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.delete("/api/vms/100", headers=admin_local_headers)
    assert resp.status_code == 200
    assert resp.json()["task_id"] == _FAKE_UPID


@pytest.mark.asyncio
async def test_delete_vm_operator_forbidden(client: AsyncClient, operator_local_headers: dict):
    resp = await client.delete("/api/vms/100", headers=operator_local_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_vm_unauthenticated(client: AsyncClient):
    resp = await client.delete("/api/vms/100")
    assert resp.status_code in (401, 403)


# ── Service Account Status ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_service_account_status_admin(client: AsyncClient, admin_local_headers: dict):
    with patch(
        "backend.routers.vms.get_service_account_status",
        new=AsyncMock(return_value={"viewer": True, "operator": True, "admin": False}),
    ):
        resp = await client.get("/api/service-accounts/status", headers=admin_local_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["viewer"] is True
    assert body["admin"] is False


@pytest.mark.asyncio
async def test_service_account_status_operator_forbidden(
    client: AsyncClient, operator_local_headers: dict
):
    resp = await client.get("/api/service-accounts/status", headers=operator_local_headers)
    assert resp.status_code == 403


# ── PROJ-81: VM Disk Management ───────────────────────────────────────────────

def _http_status_error(code: int) -> httpx.HTTPStatusError:
    req = httpx.Request("PUT", "http://test/api2/json")
    resp = httpx.Response(code, request=req)
    return httpx.HTTPStatusError("err", request=req, response=resp)


_PATCH_STORAGE_READ = lambda: patch(  # noqa: E731
    "backend.routers.vms._resolve_node_read_auth",
    new=AsyncMock(return_value=(proxmox_client, _FAKE_AUTH_OPERATOR)),
)

_CFG_ONE_DISK = {
    "name": "testvm",
    "boot": "order=scsi0",
    "scsi0": "local-lvm:vm-100-disk-0,size=32G",
    "scsihw": "virtio-scsi-pci",
}
_CFG_TWO_DISKS = {
    "name": "testvm",
    "boot": "order=scsi0",
    "scsi0": "local-lvm:vm-100-disk-0,size=32G",
    "scsi1": "local-lvm:vm-100-disk-1,size=10G,serial=p3-deadbeef",
    "scsihw": "virtio-scsi-pci",
}


# ── image-storages read ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_image_storages_success(client: AsyncClient, viewer_local_headers: dict):
    raw = [
        {"storage": "local-lvm", "type": "lvmthin", "avail": 100, "total": 200, "used": 100},
        {"storage": "", "type": "dir"},  # dropped (no storage id)
    ]
    with (
        _PATCH_STORAGE_READ(),
        patch(
            "backend.routers.vms.proxmox_client.get_node_image_storages",
            new=AsyncMock(return_value=raw),
        ),
    ):
        resp = await client.get("/api/nodes/pve1/image-storages", headers=viewer_local_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "local-lvm"
    assert body[0]["avail"] == 100


@pytest.mark.asyncio
async def test_list_image_storages_unauthenticated(client: AsyncClient):
    resp = await client.get("/api/nodes/pve1/image-storages")
    assert resp.status_code in (401, 403)


# ── attach ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_attach_disk_success(client: AsyncClient, operator_local_headers: dict):
    captured = {}

    async def _fake_attach(_auth, node, vmid, bus, index, storage, size_gb, serial):
        captured.update(bus=bus, index=index, storage=storage, size_gb=size_gb, serial=serial)

    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch(
            "backend.routers.vms.proxmox_client.get_vm_config",
            new=AsyncMock(side_effect=[_CFG_ONE_DISK, _CFG_TWO_DISKS]),
        ),
        patch("backend.routers.vms.proxmox_client.attach_vm_disk", new=AsyncMock(side_effect=_fake_attach)),
    ):
        resp = await client.post(
            "/api/vms/100/disks",
            headers=operator_local_headers,
            json={"size_gb": 10, "storage": "local-lvm", "bus": "scsi"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["disk"] == "scsi1"
    assert any(d["id"] == "scsi1" for d in body["disks"])
    # next free scsi slot is 1 (scsi0 taken, scsihw ignored)
    assert captured["index"] == 1
    assert captured["bus"] == "scsi"
    assert captured["size_gb"] == 10
    assert captured["serial"].startswith("p3-")


@pytest.mark.asyncio
async def test_attach_disk_viewer_forbidden(client: AsyncClient, viewer_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch("backend.routers.vms.get_user_by_username", new=AsyncMock(return_value=None)),
    ):
        resp = await client.post(
            "/api/vms/100/disks",
            headers=viewer_local_headers,
            json={"size_gb": 10, "storage": "local-lvm"},
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_attach_disk_lxc_rejected(client: AsyncClient, operator_local_headers: dict):
    with patch(
        "backend.routers.vms._resolve_vm_access",
        new=AsyncMock(return_value=(proxmox_client, _FAKE_AUTH_OPERATOR, "pve1", "lxc")),
    ):
        resp = await client.post(
            "/api/vms/200/disks",
            headers=operator_local_headers,
            json={"size_gb": 10, "storage": "local-lvm"},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_attach_disk_stack_managed_409(client: AsyncClient, operator_local_headers: dict):
    from fastapi import HTTPException
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms._assert_not_stack_managed",
            new=AsyncMock(side_effect=HTTPException(status_code=409, detail={"error": "vm_managed_by_stack"})),
        ),
    ):
        resp = await client.post(
            "/api/vms/100/disks",
            headers=operator_local_headers,
            json={"size_gb": 10, "storage": "local-lvm"},
        )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_attach_disk_proxmox_403_mapped(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.get_vm_config", new=AsyncMock(return_value=_CFG_ONE_DISK)),
        patch(
            "backend.routers.vms.proxmox_client.attach_vm_disk",
            new=AsyncMock(side_effect=_http_status_error(403)),
        ),
    ):
        resp = await client.post(
            "/api/vms/100/disks",
            headers=operator_local_headers,
            json={"size_gb": 10, "storage": "local-lvm"},
        )
    assert resp.status_code == 403
    assert "VM.Config.Disk" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_attach_disk_proxmox_401_becomes_502(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.get_vm_config", new=AsyncMock(return_value=_CFG_ONE_DISK)),
        patch(
            "backend.routers.vms.proxmox_client.attach_vm_disk",
            new=AsyncMock(side_effect=_http_status_error(401)),
        ),
    ):
        resp = await client.post(
            "/api/vms/100/disks",
            headers=operator_local_headers,
            json={"size_gb": 10, "storage": "local-lvm"},
        )
    assert resp.status_code == 502


@pytest.mark.asyncio
async def test_attach_disk_bus_full_422(client: AsyncClient, operator_local_headers: dict):
    full = {"name": "vm", **{f"scsi{i}": "local-lvm:x,size=8G" for i in range(31)}}
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.get_vm_config", new=AsyncMock(return_value=full)),
    ):
        resp = await client.post(
            "/api/vms/100/disks",
            headers=operator_local_headers,
            json={"size_gb": 10, "storage": "local-lvm", "bus": "scsi"},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_attach_disk_invalid_size_422(client: AsyncClient, operator_local_headers: dict):
    with _PATCH_VM_ACCESS_OPERATOR():
        resp = await client.post(
            "/api/vms/100/disks",
            headers=operator_local_headers,
            json={"size_gb": 0, "storage": "local-lvm"},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_attach_disk_storage_charset_rejected_422(client: AsyncClient, operator_local_headers: dict):
    # BUG-81-2: a storage value with extra disk-config options must be rejected
    # before it can be smuggled into the volume spec.
    with _PATCH_VM_ACCESS_OPERATOR():
        resp = await client.post(
            "/api/vms/100/disks",
            headers=operator_local_headers,
            json={"size_gb": 10, "storage": "local-lvm,import-from=local-lvm:vm-999-disk-0"},
        )
    assert resp.status_code == 422


# ── resize ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_resize_disk_success(client: AsyncClient, operator_local_headers: dict):
    captured = {}

    async def _fake_resize(_auth, node, vmid, disk, size_gb):
        captured.update(disk=disk, size_gb=size_gb)

    after = {**_CFG_TWO_DISKS, "scsi1": "local-lvm:vm-100-disk-1,size=64G,serial=p3-deadbeef"}
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch(
            "backend.routers.vms.proxmox_client.get_vm_config",
            new=AsyncMock(side_effect=[_CFG_TWO_DISKS, after]),
        ),
        patch("backend.routers.vms.proxmox_client.resize_vm_disk", new=AsyncMock(side_effect=_fake_resize)),
    ):
        resp = await client.put(
            "/api/vms/100/disks/scsi1/resize",
            headers=operator_local_headers,
            json={"size_gb": 64},
        )
    assert resp.status_code == 200
    assert captured == {"disk": "scsi1", "size_gb": 64}


@pytest.mark.asyncio
async def test_resize_disk_shrink_rejected_422(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.get_vm_config", new=AsyncMock(return_value=_CFG_TWO_DISKS)),
    ):
        resp = await client.put(
            "/api/vms/100/disks/scsi1/resize",
            headers=operator_local_headers,
            json={"size_gb": 5},  # current is 10G
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_resize_disk_not_found_404(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.get_vm_config", new=AsyncMock(return_value=_CFG_ONE_DISK)),
    ):
        resp = await client.put(
            "/api/vms/100/disks/scsi9/resize",
            headers=operator_local_headers,
            json={"size_gb": 64},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_resize_disk_bad_slot_422(client: AsyncClient, operator_local_headers: dict):
    # path pattern rejects non disk-slot strings before the handler runs
    with _PATCH_VM_ACCESS_OPERATOR():
        resp = await client.put(
            "/api/vms/100/disks/notadisk/resize",
            headers=operator_local_headers,
            json={"size_gb": 64},
        )
    assert resp.status_code == 422


# ── remove ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_remove_disk_success(client: AsyncClient, operator_local_headers: dict):
    captured = {}

    async def _fake_delete(_auth, node, vmid, disk):
        captured["disk"] = disk

    after = {k: v for k, v in _CFG_TWO_DISKS.items() if k != "scsi1"}
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch(
            "backend.routers.vms.proxmox_client.get_vm_config",
            new=AsyncMock(side_effect=[_CFG_TWO_DISKS, after]),
        ),
        patch("backend.routers.vms.proxmox_client.delete_vm_disk", new=AsyncMock(side_effect=_fake_delete)),
    ):
        resp = await client.delete(
            "/api/vms/100/disks/scsi1?confirm=testvm",
            headers=operator_local_headers,
        )
    assert resp.status_code == 200
    assert captured["disk"] == "scsi1"
    assert all(d["id"] != "scsi1" for d in resp.json()["disks"])


@pytest.mark.asyncio
async def test_remove_disk_confirm_mismatch_400(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.get_vm_config", new=AsyncMock(return_value=_CFG_TWO_DISKS)),
    ):
        resp = await client.delete(
            "/api/vms/100/disks/scsi1?confirm=wrongname",
            headers=operator_local_headers,
        )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_remove_disk_root_disk_rejected_422(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.get_vm_config", new=AsyncMock(return_value=_CFG_TWO_DISKS)),
    ):
        resp = await client.delete(
            "/api/vms/100/disks/scsi0?confirm=testvm",  # scsi0 is the boot disk
            headers=operator_local_headers,
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_remove_disk_index0_fallback_when_no_boot_info(
    client: AsyncClient, operator_local_headers: dict
):
    cfg = {
        "name": "vm",
        "scsi0": "local-lvm:vm-100-disk-0,size=32G",
        "scsi1": "local-lvm:vm-100-disk-1,size=10G",
    }
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.get_vm_config", new=AsyncMock(return_value=cfg)),
    ):
        resp = await client.delete(
            "/api/vms/100/disks/scsi0?confirm=vm",  # no boot info → index-0 blocked
            headers=operator_local_headers,
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_remove_disk_not_found_404(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.get_vm_config", new=AsyncMock(return_value=_CFG_ONE_DISK)),
    ):
        resp = await client.delete(
            "/api/vms/100/disks/scsi5?confirm=testvm",
            headers=operator_local_headers,
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_remove_disk_missing_confirm_422(client: AsyncClient, operator_local_headers: dict):
    with _PATCH_VM_ACCESS_OPERATOR():
        resp = await client.delete("/api/vms/100/disks/scsi1", headers=operator_local_headers)
    assert resp.status_code == 422  # required confirm query param missing
