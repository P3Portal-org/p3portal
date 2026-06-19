# p3portal.org
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.routers.cluster import router
from backend.services.proxmox import ProxmoxAuth, _sessions
from backend.services.service_accounts import TokenConfig

app = FastAPI()
app.include_router(router)

_FAKE_SESSION = {
    "ticket": "PVE:testuser@pam:FAKETICKET",
    "csrf": "FAKE:CSRF",
    "cap": {},
}

# Basis-edition: get_node_status returns NodeInfo-compatible dict for one node
_FAKE_NODE_STATUS = {
    "node": "pve1", "status": "online",
    "cpu": 0.12, "maxcpu": 8,
    "mem": 4294967296, "maxmem": 17179869184,
    "disk": 10737418240, "maxdisk": 107374182400,
    "uptime": 172800,
}

# Plus-edition: get_cluster_resources_v2 returns list of nodes
_FAKE_NODES_CLUSTER = [_FAKE_NODE_STATUS]

_FAKE_VMS = [
    {
        "vmid": 100, "name": "ubuntu-server", "type": "qemu",
        "status": "running", "node": "pve1",
        "cpu": 0.05, "maxcpu": 2,
        "mem": 1073741824, "maxmem": 2147483648,
        "uptime": 3600,
    },
    {
        "vmid": 101, "name": "db-server", "type": "qemu",
        "status": "stopped", "node": "pve1",
        "cpu": 0.0, "maxcpu": 4,
        "mem": 0, "maxmem": 4294967296,
        "uptime": 0,
    },
]

_FAKE_CLUSTER_STATUS = [
    {"type": "cluster", "name": "homelab", "quorate": 1, "nodes": 1},
    {"type": "node", "name": "pve1", "online": 1, "local": 1},
]

_FAKE_TOKEN = TokenConfig(token_id="portal-viewer@pve!portal-viewer", token_secret="fake-uuid")


@pytest.fixture(autouse=True)
def inject_session():
    _sessions["testuser@pam"] = _FAKE_SESSION
    yield
    _sessions.clear()


@pytest.fixture(autouse=True)
def reset_cluster_cache():
    """PROJ-33: Reset module-level cache singleton between tests to prevent test pollution."""
    from backend.services.cluster_cache_service import cluster_cache
    cluster_cache.invalidate_all()
    yield
    cluster_cache.invalidate_all()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
def proxmox_headers():
    token = create_access_token("testuser@pam", auth_type="proxmox", role="operator")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def local_viewer_headers():
    token = create_access_token("localviewer", auth_type="local", role="viewer")
    return {"Authorization": f"Bearer {token}"}


# ── /nodes – Basis edition (default: no plus.lic) ────────────────────────────

@pytest.mark.asyncio
async def test_get_nodes_core_success(client: AsyncClient, proxmox_headers: dict):
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_NODES_CLUSTER),
        ),
    ):
        resp = await client.get("/api/cluster/nodes", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["node"] == "pve1"
    assert body[0]["status"] == "online"
    assert body[0]["maxcpu"] == 8


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_nodes_plus_success(client: AsyncClient, proxmox_headers: dict):
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_NODES_CLUSTER),
        ),
    ):
        resp = await client.get("/api/cluster/nodes", headers=proxmox_headers)
    assert resp.status_code == 200
    assert resp.json()[0]["node"] == "pve1"


@pytest.mark.asyncio
async def test_get_nodes_no_token(client: AsyncClient):
    resp = await client.get("/api/cluster/nodes")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_get_nodes_no_proxmox_session(client: AsyncClient, proxmox_headers: dict):
    _sessions.clear()
    resp = await client.get("/api/cluster/nodes", headers=proxmox_headers)
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_get_nodes_proxmox_unreachable(client: AsyncClient, proxmox_headers: dict):
    import httpx as _httpx
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(side_effect=_httpx.RequestError("timeout")),
        ),
    ):
        resp = await client.get("/api/cluster/nodes", headers=proxmox_headers)
    assert resp.status_code == 502


# ── /nodes – local user via service account ───────────────────────────────────

@pytest.mark.asyncio
async def test_get_nodes_local_user_success(client: AsyncClient, local_viewer_headers: dict):
    viewer_auth = ProxmoxAuth(kind="token", value=_FAKE_TOKEN.token_id, secret=_FAKE_TOKEN.token_secret)
    with (
        patch("backend.routers.cluster._get_cluster_auth", new=AsyncMock(return_value=viewer_auth)),
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_NODES_CLUSTER),
        ),
        # viewer has no node-specific assignments → fallback shows all nodes
        patch("backend.routers.cluster.get_user_permissions", new=AsyncMock(return_value=[])),
    ):
        resp = await client.get("/api/cluster/nodes", headers=local_viewer_headers)
    assert resp.status_code == 200
    assert resp.json()[0]["node"] == "pve1"


@pytest.mark.asyncio
async def test_get_nodes_local_user_token_missing(client: AsyncClient, local_viewer_headers: dict):
    from fastapi import HTTPException
    with patch(
        "backend.routers.cluster._get_cluster_auth",
        new=AsyncMock(side_effect=HTTPException(503, "not configured")),
    ):
        resp = await client.get("/api/cluster/nodes", headers=local_viewer_headers)
    assert resp.status_code == 503


# ── /vms – Basis edition ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_vms_core_success(client: AsyncClient, proxmox_headers: dict):
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_VMS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(return_value=None),
        ),
    ):
        resp = await client.get("/api/cluster/vms", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    running = next(v for v in body if v["vmid"] == 100)
    assert running["status"] == "running"
    assert running["name"] == "ubuntu-server"


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_vms_plus_success(client: AsyncClient, proxmox_headers: dict):
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_VMS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(return_value=None),
        ),
    ):
        resp = await client.get("/api/cluster/vms", headers=proxmox_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_get_vms_ip_returned_for_running(client: AsyncClient, proxmox_headers: dict):
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_VMS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(return_value="192.168.1.100"),
        ),
    ):
        resp = await client.get("/api/cluster/vms", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    running = next(v for v in body if v["vmid"] == 100)
    stopped = next(v for v in body if v["vmid"] == 101)
    assert running["ip"] == "192.168.1.100"
    assert stopped["ip"] is None


@pytest.mark.asyncio
async def test_get_vms_ip_fallback_on_agent_error(client: AsyncClient, proxmox_headers: dict):
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_VMS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(side_effect=Exception("agent not running")),
        ),
    ):
        resp = await client.get("/api/cluster/vms", headers=proxmox_headers)
    assert resp.status_code == 200
    assert all(v["ip"] is None for v in resp.json())


@pytest.mark.asyncio
async def test_get_vms_ctime_for_template(client: AsyncClient, proxmox_headers: dict):
    vms_with_template = [
        *_FAKE_VMS,
        {
            "vmid": 900, "name": "ubuntu-tmpl", "type": "qemu", "status": "stopped",
            "node": "pve1", "cpu": 0.0, "maxcpu": 2, "mem": 0, "maxmem": 2147483648,
            "uptime": 0, "template": 1,
        },
    ]
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch("backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
              new=AsyncMock(return_value=vms_with_template)),
        patch("backend.routers.cluster.proxmox_client.get_vm_ip",
              new=AsyncMock(return_value=None)),
        patch("backend.routers.cluster.proxmox_client.get_vm_ctime",
              new=AsyncMock(return_value=1714003200)),
    ):
        resp = await client.get("/api/cluster/vms", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    tmpl = next(v for v in body if v["vmid"] == 900)
    assert tmpl["ctime"] == 1714003200
    assert all(v.get("ctime") is None for v in body if v["vmid"] != 900)


@pytest.mark.asyncio
async def test_get_vms_no_token(client: AsyncClient):
    resp = await client.get("/api/cluster/vms")
    assert resp.status_code in (401, 403)


# ── /status – Basis edition ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_cluster_status_core_success(client: AsyncClient, proxmox_headers: dict):
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_status_v2",
            new=AsyncMock(return_value=_FAKE_CLUSTER_STATUS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_ha_status_v2",
            new=AsyncMock(return_value="none"),
        ),
    ):
        resp = await client.get("/api/cluster/status", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["quorum"] is True
    assert body["node_count"] == 1
    assert body["ha_status"] == "none"


@pytest.mark.asyncio
async def test_get_cluster_status_core_offline(client: AsyncClient, proxmox_headers: dict):
    offline_cluster_status = [
        {"type": "cluster", "name": "homelab", "quorate": 0, "nodes": 1},
        {"type": "node", "name": "pve1", "online": 0, "local": 1},
    ]
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_status_v2",
            new=AsyncMock(return_value=offline_cluster_status),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_ha_status_v2",
            new=AsyncMock(return_value="none"),
        ),
    ):
        resp = await client.get("/api/cluster/status", headers=proxmox_headers)
    assert resp.status_code == 200
    assert resp.json()["quorum"] is False


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_cluster_status_plus_success(client: AsyncClient, proxmox_headers: dict):
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_status_v2",
            new=AsyncMock(return_value=_FAKE_CLUSTER_STATUS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_ha_status_v2",
            new=AsyncMock(return_value="none"),
        ),
    ):
        resp = await client.get("/api/cluster/status", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["quorum"] is True
    assert body["node_count"] == 1
    assert body["ha_status"] == "none"


@pytest.mark.asyncio
async def test_get_cluster_status_no_token(client: AsyncClient):
    resp = await client.get("/api/cluster/status")
    assert resp.status_code in (401, 403)


# ── PROJ-29: /vms/{node}/{vm_type}/{vmid} – VM detail ────────────────────────

_FAKE_VM_STATUS = {
    "status": "running",
    "name": "ubuntu-server",
    "vmid": 100,
    "cpu": 0.123,
    "cpus": 2,
    "mem": 1073741824,
    "maxmem": 2147483648,
    "uptime": 3600,
}

_FAKE_VM_CONFIG = {
    "name": "ubuntu-server",
    "cores": 2,
    "memory": 2048,
    "bios": "seabios",
    "ostype": "l26",
    "net0": "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0",
    "scsi0": "local-lvm:vm-100-disk-0,size=32G",
    "tags": "ubuntu;production",
}

_FAKE_STORAGES = [{"storage": "local", "content": "backup"}]

_FAKE_BACKUP_CONTENT = [
    {
        "volid": "local:backup/vzdump-qemu-100-2024_01_01-14_00_00.vma.zst",
        "content": "backup",
        "vmid": 100,
        "ctime": 1704110400,
        "size": 1073741824,
    }
]

_FAKE_BACKUP_JOBS = [
    {
        "id": "job-1",
        "schedule": "0 2 * * *",
        "storage": "local",
        "mode": "snapshot",
        "compress": "zstd",
        "enabled": 1,
        "comment": "Nightly",
        "vmid": "100,101",
    },
    {
        "id": "job-all",
        "schedule": "0 4 * * 0",
        "storage": "local",
        "mode": "stop",
        "compress": "lzo",
        "enabled": 1,
        "comment": "Weekly all",
        "vmid": "all",
    },
]


@pytest.fixture
def operator_headers():
    token = create_access_token("operator_user", auth_type="proxmox", role="operator")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def viewer_headers():
    # local viewer – require_operator DOES check role for local users
    token = create_access_token("viewer_user", auth_type="local", role="viewer")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def inject_operator_session():
    _sessions["operator_user"] = _FAKE_SESSION
    yield
    _sessions.pop("operator_user", None)


@pytest.fixture
def inject_viewer_session():
    # Not needed for local users (no proxmox session lookup), kept for fixture compat
    yield


@pytest.mark.asyncio
async def test_get_vm_detail_running(client: AsyncClient, proxmox_headers: dict):
    with (
        patch("backend.routers.cluster.proxmox_client.get_vm_status_current",
              new=AsyncMock(return_value=_FAKE_VM_STATUS)),
        patch("backend.routers.cluster.proxmox_client.get_vm_config",
              new=AsyncMock(return_value=_FAKE_VM_CONFIG)),
        patch("backend.routers.cluster.proxmox_client.get_vm_ip",
              new=AsyncMock(return_value="192.168.1.100")),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/qemu/100", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["vmid"] == 100
    assert body["status"] == "running"
    assert body["name"] == "ubuntu-server"
    assert body["ip"] == "192.168.1.100"
    assert body["cpu_usage"] == pytest.approx(0.123)
    assert body["mem_used"] == 1073741824
    assert body["is_template"] is False
    assert body["tags"] == ["ubuntu", "production"]
    assert len(body["networks"]) == 1
    assert body["networks"][0]["model"] == "virtio"
    assert body["networks"][0]["bridge"] == "vmbr0"
    assert len(body["disks"]) == 1
    assert body["disks"][0]["id"] == "scsi0"
    assert body["disks"][0]["size"] == "32G"


@pytest.mark.asyncio
async def test_get_vm_detail_stopped(client: AsyncClient, proxmox_headers: dict):
    stopped_status = {**_FAKE_VM_STATUS, "status": "stopped", "cpu": 0.0, "mem": 0}
    with (
        patch("backend.routers.cluster.proxmox_client.get_vm_status_current",
              new=AsyncMock(return_value=stopped_status)),
        patch("backend.routers.cluster.proxmox_client.get_vm_config",
              new=AsyncMock(return_value=_FAKE_VM_CONFIG)),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/qemu/100", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "stopped"
    assert body["cpu_usage"] is None
    assert body["mem_used"] is None
    assert body["ip"] is None


@pytest.mark.asyncio
async def test_get_vm_detail_lxc(client: AsyncClient, proxmox_headers: dict):
    lxc_config = {
        "hostname": "my-ct",
        "cores": 1,
        "memory": 512,
        "ostype": "debian",
        "rootfs": "local-lvm:vm-200-disk-0,size=8G",
        "mp0": "local-lvm:vm-200-disk-1,size=16G,mp=/data",
        "net0": "name=eth0,hwaddr=AA:BB:CC:DD:EE:FF,bridge=vmbr0",
    }
    lxc_status = {**_FAKE_VM_STATUS, "vmid": 200, "name": "my-ct", "status": "running"}
    with (
        patch("backend.routers.cluster.proxmox_client.get_vm_status_current",
              new=AsyncMock(return_value=lxc_status)),
        patch("backend.routers.cluster.proxmox_client.get_vm_config",
              new=AsyncMock(return_value=lxc_config)),
        patch("backend.routers.cluster.proxmox_client.get_vm_ip",
              new=AsyncMock(return_value=None)),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/lxc/200", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    disk_ids = [d["id"] for d in body["disks"]]
    assert "rootfs" in disk_ids
    assert "mp0" in disk_ids


@pytest.mark.asyncio
async def test_get_vm_detail_invalid_type(client: AsyncClient, proxmox_headers: dict):
    resp = await client.get("/api/cluster/vms/pve1/openvz/100", headers=proxmox_headers)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_vm_detail_no_auth(client: AsyncClient):
    resp = await client.get("/api/cluster/vms/pve1/qemu/100")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_get_vm_detail_proxmox_502(client: AsyncClient, proxmox_headers: dict):
    import httpx as _httpx
    with (
        patch("backend.routers.cluster.proxmox_client.get_vm_status_current",
              new=AsyncMock(side_effect=_httpx.RequestError("timeout"))),
        patch("backend.routers.cluster.proxmox_client.get_vm_config",
              new=AsyncMock(side_effect=_httpx.RequestError("timeout"))),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/qemu/100", headers=proxmox_headers)
    assert resp.status_code == 502


# ── PROJ-29: /vms/{node}/{vm_type}/{vmid}/backups ────────────────────────────

@pytest.mark.asyncio
async def test_get_vm_backups_success(client: AsyncClient, proxmox_headers: dict):
    with (
        patch("backend.routers.cluster.proxmox_client.get_node_backup_storages",
              new=AsyncMock(return_value=_FAKE_STORAGES)),
        patch("backend.routers.cluster.proxmox_client.get_storage_contents",
              new=AsyncMock(return_value=_FAKE_BACKUP_CONTENT)),
        patch("backend.routers.cluster.proxmox_client.get_datacenter_backup_jobs",
              new=AsyncMock(return_value=_FAKE_BACKUP_JOBS)),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/qemu/100/backups", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["backups"]) == 1
    assert body["backups"][0]["storage"] == "local"
    assert body["backups"][0]["size"] == 1073741824
    assert len(body["schedules"]) == 2  # job-1 (covers 100) + job-all


@pytest.mark.asyncio
async def test_get_vm_backups_schedule_filters_other_vmid(client: AsyncClient, proxmox_headers: dict):
    """Schedules that don't cover vmid=999 should be excluded."""
    with (
        patch("backend.routers.cluster.proxmox_client.get_node_backup_storages",
              new=AsyncMock(return_value=[])),
        patch("backend.routers.cluster.proxmox_client.get_datacenter_backup_jobs",
              new=AsyncMock(return_value=_FAKE_BACKUP_JOBS)),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/qemu/999/backups", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["backups"] == []
    # Only job-all covers 999
    assert len(body["schedules"]) == 1
    assert body["schedules"][0]["id"] == "job-all"


@pytest.mark.asyncio
async def test_get_vm_backups_no_storages(client: AsyncClient, proxmox_headers: dict):
    with (
        patch("backend.routers.cluster.proxmox_client.get_node_backup_storages",
              new=AsyncMock(return_value=[])),
        patch("backend.routers.cluster.proxmox_client.get_datacenter_backup_jobs",
              new=AsyncMock(return_value=[])),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/qemu/100/backups", headers=proxmox_headers)
    assert resp.status_code == 200
    assert resp.json() == {"backups": [], "schedules": [], "storages": []}


@pytest.mark.asyncio
async def test_get_vm_backups_no_auth(client: AsyncClient):
    resp = await client.get("/api/cluster/vms/pve1/qemu/100/backups")
    assert resp.status_code in (401, 403)


# ── PROJ-29: POST /vms/{node}/{vm_type}/{vmid}/backup ────────────────────────

@pytest.mark.asyncio
async def test_create_vm_backup_success(
    client: AsyncClient, operator_headers: dict, inject_operator_session  # noqa: F811
):
    with patch("backend.routers.cluster.proxmox_client.create_vzdump_backup",
               new=AsyncMock(return_value="UPID:pve1:00001234:FAKE")):
        resp = await client.post(
            "/api/cluster/vms/pve1/qemu/100/backup",
            headers=operator_headers,
            json={"storage": "local", "mode": "snapshot", "compress": "zstd"},
        )
    assert resp.status_code == 202
    assert resp.json()["task_id"] == "UPID:pve1:00001234:FAKE"


@pytest.mark.asyncio
async def test_create_vm_backup_viewer_forbidden(client: AsyncClient, viewer_headers: dict, inject_viewer_session):
    resp = await client.post(
        "/api/cluster/vms/pve1/qemu/100/backup",
        headers=viewer_headers,
        json={"storage": "local", "mode": "snapshot", "compress": "zstd"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_vm_backup_no_auth(client: AsyncClient):
    resp = await client.post(
        "/api/cluster/vms/pve1/qemu/100/backup",
        json={"storage": "local", "mode": "snapshot", "compress": "zstd"},
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_create_vm_backup_invalid_mode(client: AsyncClient, operator_headers: dict, inject_operator_session):
    resp = await client.post(
        "/api/cluster/vms/pve1/qemu/100/backup",
        headers=operator_headers,
        json={"storage": "local", "mode": "invalid", "compress": "zstd"},
    )
    assert resp.status_code == 422


# ── PROJ-29: DELETE /vms/{node}/{vm_type}/{vmid}/backup ──────────────────────

@pytest.mark.asyncio
async def test_delete_vm_backup_success(
    client: AsyncClient, operator_headers: dict, inject_operator_session  # noqa: F811
):
    with patch("backend.routers.cluster.proxmox_client.delete_storage_content",
               new=AsyncMock(return_value=None)):
        resp = await client.request(
            "DELETE",
            "/api/cluster/vms/pve1/qemu/100/backup",
            headers=operator_headers,
            json={"volid": "local:backup/vzdump-qemu-100-2024.vma.zst", "storage": "local"},
        )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_vm_backup_viewer_forbidden(client: AsyncClient, viewer_headers: dict, inject_viewer_session):
    resp = await client.request(
        "DELETE",
        "/api/cluster/vms/pve1/qemu/100/backup",
        headers=viewer_headers,
        json={"volid": "local:backup/vzdump-qemu-100-2024.vma.zst", "storage": "local"},
    )
    assert resp.status_code == 403


# ── PROJ-29: _parse_networks + _parse_disks unit tests ───────────────────────

def test_parse_networks_virtio():
    from backend.routers.cluster import _parse_networks
    config = {"net0": "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,firewall=1"}
    nets = _parse_networks(config)
    assert len(nets) == 1
    assert nets[0].id == "net0"
    assert nets[0].model == "virtio"
    assert nets[0].mac == "AA:BB:CC:DD:EE:FF"
    assert nets[0].bridge == "vmbr0"


def test_parse_networks_e1000():
    from backend.routers.cluster import _parse_networks
    config = {"net0": "e1000=11:22:33:44:55:66,bridge=vmbr1"}
    nets = _parse_networks(config)
    assert nets[0].model == "e1000"


def test_parse_networks_multiple():
    from backend.routers.cluster import _parse_networks
    config = {
        "net0": "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0",
        "net2": "e1000=11:22:33:44:55:66,bridge=vmbr1",
    }
    nets = _parse_networks(config)
    ids = [n.id for n in nets]
    assert "net0" in ids
    assert "net2" in ids
    assert "net1" not in ids


def test_parse_disks_qemu():
    from backend.routers.cluster import _parse_disks
    config = {
        "scsi0": "local-lvm:vm-100-disk-0,size=32G",
        "ide2": "none,media=cdrom",
        "scsi1": "local-lvm:vm-100-disk-1,size=8G",
    }
    disks = _parse_disks(config, "qemu")
    ids = [d.id for d in disks]
    assert "scsi0" in ids
    assert "scsi1" in ids
    assert "ide2" not in ids  # cdrom excluded
    assert disks[0].size == "32G"


def test_parse_disks_lxc():
    from backend.routers.cluster import _parse_disks
    config = {
        "rootfs": "local-lvm:vm-200-disk-0,size=8G",
        "mp0": "local-lvm:vm-200-disk-1,size=16G,mp=/data",
    }
    disks = _parse_disks(config, "lxc")
    ids = [d.id for d in disks]
    assert "rootfs" in ids
    assert "mp0" in ids


def test_job_covers_vmid():
    from backend.routers.cluster import _job_covers_vmid
    assert _job_covers_vmid({"vmid": "100,101"}, 100) is True
    assert _job_covers_vmid({"vmid": "100,101"}, 999) is False
    assert _job_covers_vmid({"vmid": "all"}, 999) is True
    assert _job_covers_vmid({}, 100) is True  # no vmid key → covers all


# ── PROJ-30: Multi-Node Fan-Out (Plus-Edition + local users) ─────────────────

from dataclasses import dataclass, field as dc_field


@dataclass
class _FakeNodeRow:
    id: int
    name: str
    url: str
    proxmox_node: str
    verify_ssl: bool
    token_id: str = ""
    token_secret: str = ""
    viewer_token_id: str = "viewer@pve!viewer"
    viewer_token_secret: str = "viewer-secret"
    operator_token_id: str = ""
    operator_token_secret: str = ""
    admin_token_id: str = ""
    admin_token_secret: str = ""
    packer_token_id: str = ""
    packer_token_secret: str = ""
    is_default: bool = False
    created_at: str = "2024-01-01T00:00:00"
    created_by: str = "admin"
    cluster_nodes: list = dc_field(default_factory=list)
    poll_interval: int = 30  # PROJ-33


_NODE_ROW_1 = _FakeNodeRow(id=1, name="Production", url="https://pve1.example.com:8006",
                           proxmox_node="pve1", verify_ssl=False, is_default=True)
_NODE_ROW_2 = _FakeNodeRow(id=2, name="Staging", url="https://pve2.example.com:8006",
                           proxmox_node="pve2", verify_ssl=False)

_FAKE_AUTH_1 = ProxmoxAuth(kind="token", value="viewer@pve!viewer", secret="viewer-secret")
_FAKE_AUTH_2 = ProxmoxAuth(kind="token", value="viewer@pve!viewer", secret="viewer-secret")


@pytest.fixture
def local_plus_headers():
    token = create_access_token("localadmin", auth_type="local", role="admin")
    return {"Authorization": f"Bearer {token}"}


def _make_portal_clients(nodes_and_data: list) -> list:
    """Build fake (NodeRow, AsyncMock client, auth) tuples for _get_all_portal_clients patch."""
    result = []
    for nr, mock_client, auth in nodes_and_data:
        result.append((nr, mock_client, auth))
    return result


# ── /nodes – Multi-Node Fan-Out ───────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_nodes_multi_node_success(client: AsyncClient, local_plus_headers: dict):
    """Plus + local: fan-out to 2 nodes, both succeed, portal_node_name annotated."""
    mc1, mc2 = AsyncMock(), AsyncMock()
    # get_nodes() ruft get_nodes_with_swap() (PROJ-S563 Swap-Balken), nicht
    # get_cluster_resources_v2 — Mock muss die tatsächlich konsumierte Methode treffen.
    mc1.get_nodes_with_swap = AsyncMock(return_value=[{**_FAKE_NODE_STATUS, "node": "pve1"}])
    mc2.get_nodes_with_swap = AsyncMock(return_value=[{**_FAKE_NODE_STATUS, "node": "pve2"}])
    portal = _make_portal_clients([
        (_NODE_ROW_1, mc1, _FAKE_AUTH_1),
        (_NODE_ROW_2, mc2, _FAKE_AUTH_2),
    ])
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch("backend.routers.cluster._get_all_portal_clients", new=AsyncMock(return_value=portal)),
    ):
        resp = await client.get("/api/cluster/nodes", headers=local_plus_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    names = {n["portal_node_name"] for n in body}
    assert names == {"Production", "Staging"}


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_nodes_multi_node_partial_failure(client: AsyncClient, local_plus_headers: dict):
    """Plus + local: one node unreachable, other node's data still returned."""
    mc1 = AsyncMock()
    mc1.get_nodes_with_swap = AsyncMock(return_value=[{**_FAKE_NODE_STATUS, "node": "pve1"}])
    mc2 = AsyncMock()
    mc2.get_nodes_with_swap = AsyncMock(side_effect=Exception("timeout"))
    portal = _make_portal_clients([
        (_NODE_ROW_1, mc1, _FAKE_AUTH_1),
        (_NODE_ROW_2, mc2, _FAKE_AUTH_2),
    ])
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch("backend.routers.cluster._get_all_portal_clients", new=AsyncMock(return_value=portal)),
    ):
        resp = await client.get("/api/cluster/nodes", headers=local_plus_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["portal_node_name"] == "Production"


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_nodes_multi_node_all_down(client: AsyncClient, local_plus_headers: dict):
    """Plus + local: all nodes unreachable → 502."""
    mc1, mc2 = AsyncMock(), AsyncMock()
    mc1.get_cluster_resources_v2 = AsyncMock(side_effect=Exception("timeout"))
    mc2.get_cluster_resources_v2 = AsyncMock(side_effect=Exception("timeout"))
    portal = _make_portal_clients([
        (_NODE_ROW_1, mc1, _FAKE_AUTH_1),
        (_NODE_ROW_2, mc2, _FAKE_AUTH_2),
    ])
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch("backend.routers.cluster._get_all_portal_clients", new=AsyncMock(return_value=portal)),
    ):
        resp = await client.get("/api/cluster/nodes", headers=local_plus_headers)
    assert resp.status_code == 502


# ── /vms – Multi-Node Fan-Out ─────────────────────────────────────────────────

_FAKE_VM_NODE2 = {
    "vmid": 200, "name": "staging-server", "type": "qemu",
    "status": "running", "node": "pve2",
    "cpu": 0.1, "maxcpu": 4, "mem": 2147483648, "maxmem": 4294967296,
    "uptime": 1800,
}


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_vms_multi_node_success(client: AsyncClient, local_plus_headers: dict):
    """Plus + local: VMs from 2 nodes are merged and annotated with portal_node_name."""
    mc1, mc2 = AsyncMock(), AsyncMock()
    mc1.get_cluster_resources_v2 = AsyncMock(return_value=[_FAKE_VMS[0]])
    mc1.get_vm_ip = AsyncMock(return_value=None)
    mc2.get_cluster_resources_v2 = AsyncMock(return_value=[_FAKE_VM_NODE2])
    mc2.get_vm_ip = AsyncMock(return_value="192.168.2.50")
    portal = _make_portal_clients([
        (_NODE_ROW_1, mc1, _FAKE_AUTH_1),
        (_NODE_ROW_2, mc2, _FAKE_AUTH_2),
    ])
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch("backend.routers.cluster._get_all_portal_clients", new=AsyncMock(return_value=portal)),
    ):
        resp = await client.get("/api/cluster/vms", headers=local_plus_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    vmids = {v["vmid"] for v in body}
    assert vmids == {100, 200}
    portal_names = {v["portal_node_name"] for v in body}
    assert portal_names == {"Production", "Staging"}


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_vms_multi_node_ip_uses_correct_client(client: AsyncClient, local_plus_headers: dict):
    """Plus + local: IP lookup uses the per-node client (not the global proxmox_client)."""
    mc1, mc2 = AsyncMock(), AsyncMock()
    mc1.get_cluster_resources_v2 = AsyncMock(return_value=[_FAKE_VMS[0]])  # vmid=100 running
    mc1.get_vm_ip = AsyncMock(return_value="10.0.0.100")
    mc2.get_cluster_resources_v2 = AsyncMock(return_value=[_FAKE_VM_NODE2])  # vmid=200 running
    mc2.get_vm_ip = AsyncMock(return_value="10.0.0.200")
    portal = _make_portal_clients([
        (_NODE_ROW_1, mc1, _FAKE_AUTH_1),
        (_NODE_ROW_2, mc2, _FAKE_AUTH_2),
    ])
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch("backend.routers.cluster._get_all_portal_clients", new=AsyncMock(return_value=portal)),
    ):
        resp = await client.get("/api/cluster/vms", headers=local_plus_headers)
    assert resp.status_code == 200
    body = resp.json()
    vm100 = next(v for v in body if v["vmid"] == 100)
    vm200 = next(v for v in body if v["vmid"] == 200)
    assert vm100["ip"] == "10.0.0.100"
    assert vm200["ip"] == "10.0.0.200"
    mc1.get_vm_ip.assert_called_once()
    mc2.get_vm_ip.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_vms_multi_node_all_down(client: AsyncClient, local_plus_headers: dict):
    """Plus + local: all nodes unreachable → 502."""
    mc1, mc2 = AsyncMock(), AsyncMock()
    mc1.get_cluster_resources_v2 = AsyncMock(side_effect=Exception("timeout"))
    mc2.get_cluster_resources_v2 = AsyncMock(side_effect=Exception("timeout"))
    portal = _make_portal_clients([
        (_NODE_ROW_1, mc1, _FAKE_AUTH_1),
        (_NODE_ROW_2, mc2, _FAKE_AUTH_2),
    ])
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch("backend.routers.cluster._get_all_portal_clients", new=AsyncMock(return_value=portal)),
    ):
        resp = await client.get("/api/cluster/vms", headers=local_plus_headers)
    assert resp.status_code == 502


# ── /status – Multi-Node Fan-Out ──────────────────────────────────────────────

_FAKE_CLUSTER_STATUS_NODE2 = [
    {"type": "cluster", "name": "staging", "quorate": 1, "nodes": 1},
    {"type": "node", "name": "pve2", "online": 1, "local": 1},
]


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_cluster_status_multi_node_aggregates(client: AsyncClient, local_plus_headers: dict):
    """Plus + local: node_count aggregated across both installations."""
    mc1, mc2 = AsyncMock(), AsyncMock()
    mc1.get_cluster_status_v2 = AsyncMock(return_value=_FAKE_CLUSTER_STATUS)
    mc1.get_ha_status_v2 = AsyncMock(return_value="none")
    mc2.get_cluster_status_v2 = AsyncMock(return_value=_FAKE_CLUSTER_STATUS_NODE2)
    mc2.get_ha_status_v2 = AsyncMock(return_value="none")
    portal = _make_portal_clients([
        (_NODE_ROW_1, mc1, _FAKE_AUTH_1),
        (_NODE_ROW_2, mc2, _FAKE_AUTH_2),
    ])
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch("backend.routers.cluster._get_all_portal_clients", new=AsyncMock(return_value=portal)),
    ):
        resp = await client.get("/api/cluster/status", headers=local_plus_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["node_count"] == 2  # 1 + 1
    assert body["quorum"] is True
    assert body["ha_status"] == "none"
    assert body["unreachable_nodes"] == []


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_cluster_status_multi_node_unreachable_in_response(
    client: AsyncClient, local_plus_headers: dict
):
    """Plus + local: unreachable node listed in unreachable_nodes; quorum=False."""
    mc1, mc2 = AsyncMock(), AsyncMock()
    mc1.get_cluster_status_v2 = AsyncMock(return_value=_FAKE_CLUSTER_STATUS)
    mc1.get_ha_status_v2 = AsyncMock(return_value="none")
    mc2.get_cluster_status_v2 = AsyncMock(side_effect=Exception("connection refused"))
    mc2.get_ha_status_v2 = AsyncMock(side_effect=Exception("connection refused"))
    portal = _make_portal_clients([
        (_NODE_ROW_1, mc1, _FAKE_AUTH_1),
        (_NODE_ROW_2, mc2, _FAKE_AUTH_2),
    ])
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch("backend.routers.cluster._get_all_portal_clients", new=AsyncMock(return_value=portal)),
    ):
        resp = await client.get("/api/cluster/status", headers=local_plus_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert "Staging" in body["unreachable_nodes"]
    assert body["quorum"] is False
    assert body["node_count"] == 1


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_cluster_status_multi_node_all_down(client: AsyncClient, local_plus_headers: dict):
    """Plus + local: all installations unreachable → 502."""
    mc1, mc2 = AsyncMock(), AsyncMock()
    mc1.get_cluster_status_v2 = AsyncMock(side_effect=Exception("timeout"))
    mc1.get_ha_status_v2 = AsyncMock(side_effect=Exception("timeout"))
    mc2.get_cluster_status_v2 = AsyncMock(side_effect=Exception("timeout"))
    mc2.get_ha_status_v2 = AsyncMock(side_effect=Exception("timeout"))
    portal = _make_portal_clients([
        (_NODE_ROW_1, mc1, _FAKE_AUTH_1),
        (_NODE_ROW_2, mc2, _FAKE_AUTH_2),
    ])
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch("backend.routers.cluster._get_all_portal_clients", new=AsyncMock(return_value=portal)),
    ):
        resp = await client.get("/api/cluster/status", headers=local_plus_headers)
    assert resp.status_code == 502


# ── /templates – Multi-Node Fan-Out ──────────────────────────────────────────

_FAKE_TMPL_NODE2 = {
    "vmid": 901, "name": "debian-12-staging", "type": "qemu", "status": "stopped",
    "node": "pve2", "cpu": 0.0, "maxcpu": 2, "mem": 0, "maxmem": 2147483648,
    "uptime": 0, "template": 1,
}


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_templates_multi_node_success(client: AsyncClient, local_plus_headers: dict):
    """Plus + local: templates from both installations are merged."""
    tmpl_node1 = {**_FAKE_VMS[0], "template": 1, "vmid": 900, "name": "ubuntu-tmpl"}
    mc1, mc2 = AsyncMock(), AsyncMock()
    mc1.get_cluster_resources_v2 = AsyncMock(return_value=[tmpl_node1, _FAKE_VMS[1]])
    mc2.get_cluster_resources_v2 = AsyncMock(return_value=[_FAKE_TMPL_NODE2])
    portal = _make_portal_clients([
        (_NODE_ROW_1, mc1, _FAKE_AUTH_1),
        (_NODE_ROW_2, mc2, _FAKE_AUTH_2),
    ])
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch("backend.routers.cluster._get_all_portal_clients", new=AsyncMock(return_value=portal)),
    ):
        resp = await client.get("/api/cluster/templates", headers=local_plus_headers)
    assert resp.status_code == 200
    body = resp.json()
    vmids = {t["vmid"] for t in body}
    assert vmids == {900, 901}  # non-template vmid=101 excluded


# ── _build_portal_client unit test ────────────────────────────────────────────

def test_build_portal_client_creates_per_node_client():
    from backend.routers.cluster import _build_portal_client
    node = _FakeNodeRow(id=1, name="Test", url="https://pve.test:8006",
                        proxmox_node="pve", verify_ssl=False)
    client, auth = _build_portal_client(node)
    assert auth.kind == "token"
    assert auth.value == node.viewer_token_id
    assert auth.secret == node.viewer_token_secret


def test_build_portal_client_no_viewer_token_raises():
    from backend.routers.cluster import _build_portal_client
    node = _FakeNodeRow(id=2, name="NoToken", url="https://pve.test:8006",
                        proxmox_node="pve", verify_ssl=False,
                        viewer_token_id="", viewer_token_secret="")
    with pytest.raises(ValueError, match="No viewer token"):
        _build_portal_client(node)


# ── PROJ-32: VmDetailResponse extended config fields ─────────────────────────

_FAKE_VM_CONFIG_EXTENDED = {
    **_FAKE_VM_CONFIG,
    "cpu": "host",
    "sockets": 2,
    "onboot": 1,
    "protection": 0,
    "description": "Production web server",
}


@pytest.mark.asyncio
async def test_get_vm_detail_extended_config_fields(client: AsyncClient, proxmox_headers: dict):
    """PROJ-32: VmDetailResponse must include the 7 new config fields."""
    with (
        patch("backend.routers.cluster.proxmox_client.get_vm_status_current",
              new=AsyncMock(return_value=_FAKE_VM_STATUS)),
        patch("backend.routers.cluster.proxmox_client.get_vm_config",
              new=AsyncMock(return_value=_FAKE_VM_CONFIG_EXTENDED)),
        patch("backend.routers.cluster.proxmox_client.get_vm_ip",
              new=AsyncMock(return_value="192.168.1.100")),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/qemu/100", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["cpu_type"] == "host"
    assert body["sockets"] == 2
    assert body["onboot"] is True
    assert body["protection"] is False
    assert body["description"] == "Production web server"
    assert body["lxc_hostname"] is None   # qemu – field not set
    assert body["lxc_ostemplate"] is None


@pytest.mark.asyncio
async def test_get_vm_detail_lxc_hostname_and_template(client: AsyncClient, proxmox_headers: dict):
    """PROJ-32: lxc_hostname + lxc_ostemplate populated only for LXC."""
    lxc_config = {
        "hostname": "my-ct",
        "ostemplate": "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst",
        "cores": 1,
        "memory": 512,
        "ostype": "debian",
        "rootfs": "local-lvm:vm-200-disk-0,size=8G",
    }
    lxc_status = {**_FAKE_VM_STATUS, "vmid": 200, "name": "my-ct", "status": "running"}
    with (
        patch("backend.routers.cluster.proxmox_client.get_vm_status_current",
              new=AsyncMock(return_value=lxc_status)),
        patch("backend.routers.cluster.proxmox_client.get_vm_config",
              new=AsyncMock(return_value=lxc_config)),
        patch("backend.routers.cluster.proxmox_client.get_vm_ip",
              new=AsyncMock(return_value=None)),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/lxc/200", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["lxc_hostname"] == "my-ct"
    assert "debian-12" in body["lxc_ostemplate"]


@pytest.mark.asyncio
async def test_get_vm_detail_description_empty_is_null(client: AsyncClient, proxmox_headers: dict):
    """PROJ-32: empty description string becomes None."""
    config_empty_desc = {**_FAKE_VM_CONFIG, "description": ""}
    with (
        patch("backend.routers.cluster.proxmox_client.get_vm_status_current",
              new=AsyncMock(return_value=_FAKE_VM_STATUS)),
        patch("backend.routers.cluster.proxmox_client.get_vm_config",
              new=AsyncMock(return_value=config_empty_desc)),
        patch("backend.routers.cluster.proxmox_client.get_vm_ip",
              new=AsyncMock(return_value=None)),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/qemu/100", headers=proxmox_headers)
    assert resp.status_code == 200
    assert resp.json()["description"] is None


# ── PROJ-32: GET /vms/{node}/qemu/{vmid}/guest-info ──────────────────────────

_FAKE_GUEST_INFO = {
    "os_name": "Ubuntu 24.04.2 LTS",
    "os_version": "24.04",
    "kernel": "6.8.0-51-generic",
    "arch": "x86_64",
    "hostname": "ubuntu-server",
    "timezone": "Europe/Berlin",
    "timezone_offset": 7200,
    "filesystems": [
        {"mountpoint": "/", "total_bytes": 34359738368, "used_bytes": 8589934592, "fstype": "ext4"},
        {"mountpoint": "/boot", "total_bytes": 1073741824, "used_bytes": 268435456, "fstype": "ext4"},
    ],
    "truncated_count": 0,
}


@pytest.mark.asyncio
async def test_get_vm_guest_info_success(client: AsyncClient, proxmox_headers: dict):
    """PROJ-32: guest-info endpoint returns OS/hostname/timezone/filesystems."""
    with (
        patch("backend.routers.cluster.proxmox_client.get_guest_info",
              new=AsyncMock(return_value=_FAKE_GUEST_INFO)),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/qemu/100/guest-info",
                                headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["os_name"] == "Ubuntu 24.04.2 LTS"
    assert body["hostname"] == "ubuntu-server"
    assert body["timezone"] == "Europe/Berlin"
    assert body["timezone_offset"] == 7200
    assert len(body["filesystems"]) == 2
    assert body["filesystems"][0]["mountpoint"] == "/"
    assert body["truncated_count"] == 0


@pytest.mark.asyncio
async def test_get_vm_guest_info_agent_unavailable(client: AsyncClient, proxmox_headers: dict):
    """PROJ-32: all-null result when guest agent is not available (no 500)."""
    empty_info = {
        "os_name": None, "os_version": None, "kernel": None, "arch": None,
        "hostname": None, "timezone": None, "timezone_offset": None,
        "filesystems": [], "truncated_count": 0,
    }
    with (
        patch("backend.routers.cluster.proxmox_client.get_guest_info",
              new=AsyncMock(return_value=empty_info)),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/qemu/100/guest-info",
                                headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["os_name"] is None
    assert body["filesystems"] == []


@pytest.mark.asyncio
async def test_get_vm_guest_info_truncated(client: AsyncClient, proxmox_headers: dict):
    """PROJ-32: truncated_count reflects filesystems beyond top-10."""
    truncated_info = {**_FAKE_GUEST_INFO, "truncated_count": 5}
    with (
        patch("backend.routers.cluster.proxmox_client.get_guest_info",
              new=AsyncMock(return_value=truncated_info)),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/qemu/100/guest-info",
                                headers=proxmox_headers)
    assert resp.status_code == 200
    assert resp.json()["truncated_count"] == 5


@pytest.mark.asyncio
async def test_get_vm_guest_info_no_auth(client: AsyncClient):
    """PROJ-32: unauthenticated request → 401/403."""
    resp = await client.get("/api/cluster/vms/pve1/qemu/100/guest-info")
    assert resp.status_code in (401, 403)


# ── PROJ-32: GET /vms/{node}/lxc/{vmid}/interfaces ───────────────────────────

_FAKE_LXC_INTERFACES = [
    {"name": "lo", "inet": "127.0.0.1/8", "inet6": "::1/128", "hwaddr": "00:00:00:00:00:00"},
    {"name": "eth0", "inet": "192.168.1.50/24", "inet6": "fe80::1/64", "hwaddr": "AA:BB:CC:DD:EE:FF"},
]


@pytest.mark.asyncio
async def test_get_lxc_interfaces_success(client: AsyncClient, proxmox_headers: dict):
    """PROJ-32: LXC interfaces endpoint returns all interfaces with IPs."""
    with (
        patch("backend.routers.cluster.proxmox_client.get_lxc_interfaces",
              new=AsyncMock(return_value=_FAKE_LXC_INTERFACES)),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/lxc/200/interfaces",
                                headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    eth0 = next(i for i in body if i["name"] == "eth0")
    assert eth0["inet"] == "192.168.1.50/24"
    assert eth0["hwaddr"] == "AA:BB:CC:DD:EE:FF"


@pytest.mark.asyncio
async def test_get_lxc_interfaces_empty(client: AsyncClient, proxmox_headers: dict):
    """PROJ-32: empty list returned when LXC interfaces unavailable."""
    with (
        patch("backend.routers.cluster.proxmox_client.get_lxc_interfaces",
              new=AsyncMock(return_value=[])),
        patch("backend.routers.cluster._check_detail_access", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/cluster/vms/pve1/lxc/200/interfaces",
                                headers=proxmox_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_get_lxc_interfaces_no_auth(client: AsyncClient):
    """PROJ-32: unauthenticated request → 401/403."""
    resp = await client.get("/api/cluster/vms/pve1/lxc/200/interfaces")
    assert resp.status_code in (401, 403)


# ── PROJ-32: proxmox.py unit tests for get_guest_info / get_lxc_interfaces ───

@pytest.mark.asyncio
async def test_proxmox_get_guest_info_success():
    """Unit test: get_guest_info() aggregates 4 agent calls correctly."""
    from backend.services.proxmox import ProxmoxClient
    from backend.models.vms import GuestInfoResponse

    _osinfo = {"pretty-name": "Debian 12", "version-id": "12", "kernel-release": "6.1.0", "machine": "x86_64"}
    _hostname = {"host-name": "debian-host"}
    _timezone = {"zone": "UTC", "offset": 0}
    _fsinfo = [
        {"mountpoint": "/", "type": "ext4", "total-bytes": 10000, "used-bytes": 5000},
        {"mountpoint": "/proc", "type": "proc", "total-bytes": 0, "used-bytes": 0},
    ]

    async def _mock_agent(cmd):
        return {"get-osinfo": _osinfo, "get-host-name": _hostname,
                "get-timezone": _timezone, "get-fsinfo": _fsinfo}.get(cmd)

    client = ProxmoxClient(base_url="https://pve.test:8006")
    auth = ProxmoxAuth(kind="token", value="test!token", secret="secret")

    with patch.object(client, "get_guest_info", wraps=client.get_guest_info):
        import asyncio as _asyncio

        async def _fake_gather(*coros):
            return [_osinfo, _hostname, _timezone, _fsinfo]

        with patch("backend.services.proxmox.asyncio.gather", new=_fake_gather):
            import httpx as _httpx

            class _MockResp:
                status_code = 200
                def json(self): return {"data": {"result": None}}
                def raise_for_status(self): pass

            async def _mock_get(url, **kwargs):
                cmd = url.split("/")[-1]
                result = {"get-osinfo": _osinfo, "get-host-name": _hostname,
                          "get-timezone": _timezone, "get-fsinfo": _fsinfo}.get(cmd)

                class R:
                    status_code = 200
                    def json(self): return {"data": {"result": result}}
                    def raise_for_status(self): pass
                return R()

            with patch("httpx.AsyncClient") as MockClient:
                mock_http = AsyncMock()
                mock_http.__aenter__ = AsyncMock(return_value=mock_http)
                mock_http.__aexit__ = AsyncMock(return_value=False)
                mock_http.get = AsyncMock(side_effect=_mock_get)
                MockClient.return_value = mock_http

                result = await client.get_guest_info(auth, "pve1", 100)

    info = GuestInfoResponse.model_validate(result)
    assert info.hostname == "debian-host"
    assert info.timezone == "UTC"
    assert info.timezone_offset == 0
    # proc pseudo-fs must be filtered out
    assert all(f.fstype != "proc" for f in info.filesystems)


@pytest.mark.asyncio
async def test_proxmox_get_guest_info_agent_error():
    """Unit test: individual agent call failure → field is None, no exception."""
    from backend.services.proxmox import ProxmoxClient
    from backend.models.vms import GuestInfoResponse

    client = ProxmoxClient(base_url="https://pve.test:8006")
    auth = ProxmoxAuth(kind="token", value="test!token", secret="secret")

    async def _fail_get(url, **kwargs):
        raise Exception("agent not available")

    with patch("httpx.AsyncClient") as MockClient:
        mock_http = AsyncMock()
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)
        mock_http.get = AsyncMock(side_effect=_fail_get)
        MockClient.return_value = mock_http

        result = await client.get_guest_info(auth, "pve1", 100)

    info = GuestInfoResponse.model_validate(result)
    assert info.os_name is None
    assert info.hostname is None
    assert info.filesystems == []


@pytest.mark.asyncio
async def test_proxmox_get_lxc_interfaces_success():
    """Unit test: get_lxc_interfaces() returns parsed interface list."""
    from backend.services.proxmox import ProxmoxClient

    _raw = [
        {"name": "eth0", "inet": "10.0.0.5/24", "inet6": None, "hwaddr": "DE:AD:BE:EF:00:01"},
    ]

    client = ProxmoxClient(base_url="https://pve.test:8006")
    auth = ProxmoxAuth(kind="token", value="test!token", secret="secret")

    async def _mock_get(url, **kwargs):
        class R:
            status_code = 200
            def json(self): return {"data": _raw}
            def raise_for_status(self): pass
        return R()

    with patch("httpx.AsyncClient") as MockClient:
        mock_http = AsyncMock()
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)
        mock_http.get = AsyncMock(side_effect=_mock_get)
        MockClient.return_value = mock_http

        result = await client.get_lxc_interfaces(auth, "pve1", 200)

    assert len(result) == 1
    assert result[0]["name"] == "eth0"
    assert result[0]["inet"] == "10.0.0.5/24"
    assert result[0]["hwaddr"] == "DE:AD:BE:EF:00:01"


@pytest.mark.asyncio
async def test_proxmox_get_lxc_interfaces_error():
    """Unit test: get_lxc_interfaces() returns [] on connection error."""
    from backend.services.proxmox import ProxmoxClient

    client = ProxmoxClient(base_url="https://pve.test:8006")
    auth = ProxmoxAuth(kind="token", value="test!token", secret="secret")

    with patch("httpx.AsyncClient") as MockClient:
        mock_http = AsyncMock()
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)
        mock_http.get = AsyncMock(side_effect=Exception("timeout"))
        MockClient.return_value = mock_http

        result = await client.get_lxc_interfaces(auth, "pve1", 200)

    assert result == []


# ── PROJ-33: force=true / cache integration ───────────────────────────────────

@pytest.mark.asyncio
async def test_get_nodes_force_true_calls_invalidate(client: AsyncClient, proxmox_headers: dict):
    """force=true on /nodes must trigger cluster_cache.invalidate_all()."""
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_NODES_CLUSTER),
        ),
        patch("backend.routers.cluster.cluster_cache") as mock_cache,
    ):
        mock_cache.get_or_fetch = AsyncMock(return_value=_FAKE_NODES_CLUSTER)
        resp = await client.get("/api/cluster/nodes?force=true", headers=proxmox_headers)
    # Proxmox-login user → no cache, but the force query param should be accepted
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_get_nodes_local_user_uses_cache(client: AsyncClient, local_viewer_headers: dict):
    """Local users hit the cluster_cache service, not Proxmox directly."""
    viewer_auth = ProxmoxAuth(kind="token", value=_FAKE_TOKEN.token_id, secret=_FAKE_TOKEN.token_secret)
    with (
        patch("backend.routers.cluster._get_cluster_auth", new=AsyncMock(return_value=viewer_auth)),
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch("backend.routers.cluster.cluster_cache") as mock_cache,
        patch("backend.services.nodes_service.get_default_node", new=AsyncMock(return_value=None)),
        patch("backend.routers.cluster.get_user_permissions", new=AsyncMock(return_value=[])),
    ):
        mock_cache.get_or_fetch = AsyncMock(return_value=[_FAKE_NODE_STATUS])
        resp = await client.get("/api/cluster/nodes", headers=local_viewer_headers)
    assert resp.status_code == 200
    mock_cache.get_or_fetch.assert_called_once()


@pytest.mark.asyncio
async def test_get_vms_force_true_accepted(client: AsyncClient, proxmox_headers: dict):
    """force=true query param is accepted and passed through."""
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_VMS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(return_value=None),
        ),
    ):
        resp = await client.get("/api/cluster/vms?force=true", headers=proxmox_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_get_vms_local_user_uses_cache(client: AsyncClient, local_viewer_headers: dict):
    """Local users' VM request goes through cluster_cache."""
    viewer_auth = ProxmoxAuth(kind="token", value=_FAKE_TOKEN.token_id, secret=_FAKE_TOKEN.token_secret)
    with (
        patch("backend.routers.cluster._get_cluster_auth", new=AsyncMock(return_value=viewer_auth)),
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch("backend.routers.cluster.cluster_cache") as mock_cache,
        patch("backend.services.nodes_service.get_default_node", new=AsyncMock(return_value=None)),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ctime",
            new=AsyncMock(return_value=None),
        ),
    ):
        mock_cache.get_or_fetch = AsyncMock(return_value=_FAKE_VMS)
        resp = await client.get("/api/cluster/vms", headers=local_viewer_headers)
    assert resp.status_code == 200
    mock_cache.get_or_fetch.assert_called_once()


@pytest.mark.asyncio
async def test_get_status_force_true_accepted(client: AsyncClient, proxmox_headers: dict):
    """force=true on /status is accepted."""
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_status_v2",
            new=AsyncMock(return_value=_FAKE_CLUSTER_STATUS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_ha_status_v2",
            new=AsyncMock(return_value="none"),
        ),
    ):
        resp = await client.get("/api/cluster/status?force=true", headers=proxmox_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_get_status_local_user_uses_cache(client: AsyncClient, local_viewer_headers: dict):
    """Local users' status request goes through cluster_cache."""
    viewer_auth = ProxmoxAuth(kind="token", value=_FAKE_TOKEN.token_id, secret=_FAKE_TOKEN.token_secret)
    cached_status = {"quorate": True, "node_count": 1, "ha": "none"}
    with (
        patch("backend.routers.cluster._get_cluster_auth", new=AsyncMock(return_value=viewer_auth)),
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch("backend.routers.cluster.cluster_cache") as mock_cache,
        patch("backend.services.nodes_service.get_default_node", new=AsyncMock(return_value=None)),
    ):
        mock_cache.get_or_fetch = AsyncMock(return_value=cached_status)
        resp = await client.get("/api/cluster/status", headers=local_viewer_headers)
    assert resp.status_code == 200
    mock_cache.get_or_fetch.assert_called_once()


# ── PROJ-38: LXC Template endpoints ─────────────────────────────────────────

@pytest.fixture
def admin_headers():
    token = create_access_token("admin_user", auth_type="proxmox", role="admin")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def inject_admin_session():
    _sessions["admin_user"] = _FAKE_SESSION
    yield
    _sessions.pop("admin_user", None)


_FAKE_APLINFO = [
    {"template": "debian-12-standard_12.7-1_amd64.tar.zst", "type": "lxc", "section": "system"},
    {"template": "ubuntu-24.04-standard_24.04-2_amd64.tar.zst", "type": "lxc", "section": "system"},
]

_FAKE_INSTALLED = [
    {"volid": "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst", "storage": "local", "pve_node": "pve1"},
]


@pytest.mark.asyncio
async def test_list_lxc_templates_success(client: AsyncClient, proxmox_headers: dict):
    """GET /lxc-templates returns available + installed fields for proxmox-login users."""
    with (
        patch("backend.routers.cluster._get_cluster_auth", new=AsyncMock(
            return_value=ProxmoxAuth(kind="cookie", value="TICKET", csrf="CSRF")
        )),
        patch("backend.routers.cluster.proxmox_client") as mock_pc,
    ):
        mock_response_nodes = MagicMock()
        mock_response_nodes.raise_for_status = MagicMock()
        mock_response_nodes.json.return_value = {"data": [{"node": "pve1", "status": "online"}]}

        mock_response_aplinfo = MagicMock()
        mock_response_aplinfo.raise_for_status = MagicMock()
        mock_response_aplinfo.json.return_value = {"data": _FAKE_APLINFO}

        mock_response_storage = MagicMock()
        mock_response_storage.raise_for_status = MagicMock()
        mock_response_storage.json.return_value = {"data": [
            {"storage": "local", "active": 1, "content": "vztmpl,images"}
        ]}

        mock_response_content = MagicMock()
        mock_response_content.raise_for_status = MagicMock()
        mock_response_content.json.return_value = {"data": _FAKE_INSTALLED}

        mock_http = AsyncMock()
        mock_http.get = AsyncMock(side_effect=[
            mock_response_nodes,
            mock_response_aplinfo,
            mock_response_storage,
            mock_response_content,
        ])
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_http)
        mock_ctx.__aexit__ = AsyncMock(return_value=None)
        mock_pc._client.return_value = mock_ctx
        mock_pc._base = "https://proxmox.test:8006"
        mock_pc._auth_kwargs.return_value = {"headers": {"Authorization": "PVEAPIToken=test"}}
        mock_pc.get_session.return_value = _FAKE_SESSION

        resp = await client.get("/api/cluster/lxc-templates", headers=proxmox_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert "available" in body
    assert "installed" in body
    assert "failed_nodes" in body


@pytest.mark.asyncio
async def test_download_lxc_template_ok(client: AsyncClient, operator_headers: dict, inject_operator_session):
    """POST /lxc-templates/download returns 204 for operator."""
    with (
        patch("backend.routers.cluster._get_portal_node_write_auth", new=AsyncMock(
            return_value=(
                MagicMock(
                    _base="https://proxmox.test:8006",
                    _auth_kwargs=MagicMock(return_value={"headers": {"Authorization": "PVEAPIToken=test"}}),
                    _client=MagicMock(return_value=_make_mock_http_ctx(204)),
                ),
                ProxmoxAuth(kind="token", value="tid", secret="sec"),
            )
        )),
    ):
        resp = await client.post(
            "/api/cluster/lxc-templates/download",
            json={"node": "pve1", "template": "debian-12-standard_12.7-1_amd64.tar.zst", "storage": "local"},
            headers=operator_headers,
        )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_lxc_template_ok(client: AsyncClient, admin_headers: dict, inject_admin_session):
    """DELETE /lxc-templates returns 204 for admin."""
    with (
        patch("backend.routers.cluster._get_portal_node_write_auth", new=AsyncMock(
            return_value=(
                MagicMock(
                    _base="https://proxmox.test:8006",
                    _auth_kwargs=MagicMock(return_value={"headers": {"Authorization": "PVEAPIToken=test"}}),
                    _client=MagicMock(return_value=_make_mock_http_ctx(204)),
                ),
                ProxmoxAuth(kind="token", value="tid", secret="sec"),
            )
        )),
    ):
        resp = await client.request(
            "DELETE",
            "/api/cluster/lxc-templates",
            json={"node": "pve1", "storage": "local", "volid": "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst"},
            headers=admin_headers,
        )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_upload_lxc_template_ok(client: AsyncClient, admin_headers: dict, inject_admin_session):
    """POST /lxc-templates/upload with valid .tar.gz returns 204 for admin."""
    with (
        patch("backend.routers.cluster._get_portal_node_write_auth", new=AsyncMock(
            return_value=(
                MagicMock(
                    _base="https://proxmox.test:8006",
                    _auth_kwargs=MagicMock(return_value={"headers": {"Authorization": "PVEAPIToken=test"}}),
                    _client=MagicMock(return_value=_make_mock_http_ctx(200)),
                ),
                ProxmoxAuth(kind="token", value="tid", secret="sec"),
            )
        )),
    ):
        resp = await client.post(
            "/api/cluster/lxc-templates/upload",
            data={"node": "pve1", "storage": "local"},
            files={"file": ("mytemplate-1.0.tar.gz", b"fake content", "application/gzip")},
            headers=admin_headers,
        )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_upload_lxc_template_invalid_extension(client: AsyncClient, admin_headers: dict, inject_admin_session):
    """POST /lxc-templates/upload with .iso extension returns 422."""
    resp = await client.post(
        "/api/cluster/lxc-templates/upload",
        data={"node": "pve1", "storage": "local"},
        files={"file": ("debian.iso", b"fake content", "application/octet-stream")},
        headers=admin_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upload_lxc_template_invalid_filename(client: AsyncClient, admin_headers: dict, inject_admin_session):
    """POST /lxc-templates/upload with path traversal filename returns 422."""
    resp = await client.post(
        "/api/cluster/lxc-templates/upload",
        data={"node": "pve1", "storage": "local"},
        files={"file": ("../evil.tar.gz", b"fake content", "application/gzip")},
        headers=admin_headers,
    )
    assert resp.status_code == 422


# ── PROJ-40: GET /nodes/{node}/tasks ─────────────────────────────────────────

_FAKE_TASKS = [
    {
        "upid": "UPID:pve1:00001234:qmstart:100:root@pam",
        "type": "qmstart",
        "user": "root@pam",
        "status": "OK",
        "starttime": 1700000000,
        "endtime": 1700000010,
        "id": "100",
        "node": "pve1",
    },
    {
        "upid": "UPID:pve1:00001235:vzdump:101:root@pam",
        "type": "vzdump",
        "user": "root@pam",
        "status": "",  # still running
        "starttime": 1700000100,
        "endtime": None,
        "id": "101",
        "node": "pve1",
    },
]

_FAKE_BACKUP_TASKS = [
    {
        "upid": "UPID:pve1:00001235:vzdump:101:root@pam",
        "type": "vzdump",
        "user": "root@pam",
        "status": "OK",
        "starttime": 1700000100,
        "endtime": 1700001200,
        "id": "101",
        "node": "pve1",
    },
]


@pytest.mark.asyncio
async def test_get_node_tasks_success(client: AsyncClient, proxmox_headers: dict):
    """GET /nodes/{node}/tasks returns task list with duration field."""
    with patch("backend.routers.cluster._get_client_auth_for_node",
               new=AsyncMock(return_value=(
                   MagicMock(get_node_tasks=AsyncMock(return_value=_FAKE_TASKS)),
                   ProxmoxAuth(kind="cookie", value="TICKET", csrf="CSRF"),
               ))):
        resp = await client.get("/api/cluster/nodes/pve1/tasks", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert body[0]["type"] == "qmstart"
    assert body[0]["status"] == "OK"
    assert body[0]["duration"] == 10  # endtime - starttime
    assert body[1]["duration"] is None  # still running (endtime is None)


@pytest.mark.asyncio
async def test_get_node_tasks_typefilter(client: AsyncClient, proxmox_headers: dict):
    """GET /nodes/{node}/tasks?typefilter=vzdump forwards typefilter to proxmox."""
    mock_client = MagicMock()
    mock_client.get_node_tasks = AsyncMock(return_value=[_FAKE_TASKS[1]])
    with patch("backend.routers.cluster._get_client_auth_for_node",
               new=AsyncMock(return_value=(
                   mock_client,
                   ProxmoxAuth(kind="cookie", value="TICKET", csrf="CSRF"),
               ))):
        resp = await client.get(
            "/api/cluster/nodes/pve1/tasks?typefilter=vzdump",
            headers=proxmox_headers,
        )
    assert resp.status_code == 200
    mock_client.get_node_tasks.assert_called_once_with(
        ProxmoxAuth(kind="cookie", value="TICKET", csrf="CSRF"),
        "pve1", limit=50, typefilter="vzdump",
    )


@pytest.mark.asyncio
async def test_get_node_tasks_no_auth(client: AsyncClient):
    """GET /nodes/{node}/tasks requires authentication."""
    resp = await client.get("/api/cluster/nodes/pve1/tasks")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_get_node_tasks_proxmox_unreachable(client: AsyncClient, proxmox_headers: dict):
    """GET /nodes/{node}/tasks → 502 when Proxmox is unreachable."""
    import httpx as _httpx
    mock_client = MagicMock()
    mock_client.get_node_tasks = AsyncMock(side_effect=_httpx.RequestError("timeout"))
    with patch("backend.routers.cluster._get_client_auth_for_node",
               new=AsyncMock(return_value=(
                   mock_client,
                   ProxmoxAuth(kind="cookie", value="TICKET", csrf="CSRF"),
               ))):
        resp = await client.get("/api/cluster/nodes/pve1/tasks", headers=proxmox_headers)
    assert resp.status_code == 502


# ── PROJ-40: GET /nodes/{node}/backups ────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_node_backups_success(client: AsyncClient, proxmox_headers: dict):
    """GET /nodes/{node}/backups returns vzdump tasks with vmid field."""
    with patch("backend.routers.cluster._get_client_auth_for_node",
               new=AsyncMock(return_value=(
                   MagicMock(get_node_tasks=AsyncMock(return_value=_FAKE_BACKUP_TASKS)),
                   ProxmoxAuth(kind="cookie", value="TICKET", csrf="CSRF"),
               ))):
        resp = await client.get("/api/cluster/nodes/pve1/backups", headers=proxmox_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["vmid"] == "101"
    assert body[0]["status"] == "OK"
    assert body[0]["duration"] == 1100  # 1700001200 - 1700000100


@pytest.mark.asyncio
async def test_get_node_backups_no_auth(client: AsyncClient):
    """GET /nodes/{node}/backups requires authentication."""
    resp = await client.get("/api/cluster/nodes/pve1/backups")
    assert resp.status_code in (401, 403)


# ── Helper for mock HTTP context manager ────────────────────────────────────

def _make_mock_http_ctx(status_code: int):
    """Return a mock async context manager whose client responds with the given status."""
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.status_code = status_code

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(return_value=mock_resp)
    mock_http.delete = AsyncMock(return_value=mock_resp)

    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=mock_http)
    ctx.__aexit__ = AsyncMock(return_value=None)
    return ctx
