# p3portal.org
"""Tests für PROJ-80 – SDN-Verwaltung (Router + Schemas + Parser + Gate + Fan-out)."""
from __future__ import annotations

import httpx
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from backend.models.sdn import (
    SdnSubnetWriteRequest,
    SdnVnetWriteRequest,
    SdnZoneWriteRequest,
)

# ── Test users ────────────────────────────────────────────────────────────────

_ADMIN_USER = MagicMock(
    username="admin", auth_type="local", role="admin",
    portal_permissions=[], jti="jti-admin", user_id=1,
)
_VIEWER_USER = MagicMock(
    username="viewer", auth_type="local", role="viewer",
    portal_permissions=[], jti="jti-viewer", user_id=2,
)
_SDN_MANAGER = MagicMock(
    username="sdnmgr", auth_type="local", role="viewer",
    portal_permissions=["manage_sdn"], jti="jti-sdnmgr", user_id=3,
)

_SAMPLE_ZONE_SIMPLE = {"zone": "zone1", "type": "simple", "mtu": 1500, "nodes": "pve1,pve2"}
_SAMPLE_ZONE_VLAN = {"zone": "vz", "type": "vlan", "bridge": "vmbr0"}
_SAMPLE_VNET = {"vnet": "vnet1", "zone": "zone1", "tag": 100, "vlanaware": 0, "alias": "lab"}
_SAMPLE_SUBNET = {
    "subnet": "zone1-10.0.0.0-24", "vnet": "vnet1", "cidr": "10.0.0.0/24",
    "gateway": "10.0.0.1", "snat": 1,
}


def _override_user(app, user):
    from backend.core.deps import get_current_user
    app.dependency_overrides[get_current_user] = lambda: user


def _clear(app):
    app.dependency_overrides.clear()


# ── Zone schema validation ──────────────────────────────────────────────────────

class TestSdnZoneWriteRequest:
    def test_valid_simple(self):
        req = SdnZoneWriteRequest(type="simple", zone="z1", mtu=1500, nodes="pve1")
        params = req.to_proxmox_params()
        assert params["type"] == "simple"
        assert params["mtu"] == 1500
        assert params["nodes"] == "pve1"
        assert "bridge" not in params

    def test_valid_vlan_with_bridge(self):
        req = SdnZoneWriteRequest(type="vlan", zone="vz", bridge="vmbr0")
        params = req.to_proxmox_params()
        assert params["type"] == "vlan"
        assert params["bridge"] == "vmbr0"

    def test_vlan_without_bridge_raises(self):
        with pytest.raises(ValidationError):
            SdnZoneWriteRequest(type="vlan", zone="vz")

    def test_invalid_type_raises(self):
        with pytest.raises(ValidationError):
            SdnZoneWriteRequest(type="vxlan", zone="z1")

    def test_id_too_long_raises(self):
        with pytest.raises(ValidationError):
            SdnZoneWriteRequest(type="simple", zone="toolongid")  # 9 chars

    def test_id_starting_with_digit_raises(self):
        with pytest.raises(ValidationError):
            SdnZoneWriteRequest(type="simple", zone="1zone")

    def test_id_special_char_raises(self):
        with pytest.raises(ValidationError):
            SdnZoneWriteRequest(type="simple", zone="zo-ne")

    def test_mtu_hard_bounds(self):
        with pytest.raises(ValidationError):
            SdnZoneWriteRequest(type="simple", zone="z1", mtu=100)
        with pytest.raises(ValidationError):
            SdnZoneWriteRequest(type="simple", zone="z1", mtu=70000)

    def test_update_params_omit_type(self):
        req = SdnZoneWriteRequest(type="simple", zone="z1", mtu=1400)
        params = req.to_proxmox_params(for_update=True)
        assert "type" not in params
        assert params["mtu"] == 1400

    def test_soft_warning_mtu(self):
        req = SdnZoneWriteRequest(type="simple", zone="z1", mtu=500)  # >=128 but <576
        assert any("MTU" in w for w in req.soft_warnings())


# ── VNet schema validation ──────────────────────────────────────────────────────

class TestSdnVnetWriteRequest:
    def test_valid(self):
        req = SdnVnetWriteRequest(vnet="v1", zone="z1", tag=100, vlanaware=True, alias="lab")
        params = req.to_proxmox_params()
        assert params["zone"] == "z1"
        assert params["tag"] == 100
        assert params["vlanaware"] == 1
        assert params["alias"] == "lab"

    def test_no_tag_ok(self):
        req = SdnVnetWriteRequest(vnet="v1", zone="z1")
        params = req.to_proxmox_params()
        assert "tag" not in params
        assert params["vlanaware"] == 0

    def test_invalid_vnet_id_raises(self):
        with pytest.raises(ValidationError):
            SdnVnetWriteRequest(vnet="toolongname", zone="z1")

    def test_tag_out_of_range_raises(self):
        with pytest.raises(ValidationError):
            SdnVnetWriteRequest(vnet="v1", zone="z1", tag=5000)

    def test_missing_zone_raises(self):
        with pytest.raises(ValidationError):
            SdnVnetWriteRequest(vnet="v1", zone="")


# ── Subnet schema validation ────────────────────────────────────────────────────

class TestSdnSubnetWriteRequest:
    def test_valid(self):
        req = SdnSubnetWriteRequest(vnet="v1", cidr="10.0.0.0/24", gateway="10.0.0.1", snat=True)
        params = req.to_proxmox_params()
        assert params["type"] == "subnet"
        assert params["subnet"] == "10.0.0.0/24"
        assert params["gateway"] == "10.0.0.1"
        assert params["snat"] == 1

    def test_update_params_omit_type_and_subnet(self):
        req = SdnSubnetWriteRequest(vnet="v1", cidr="10.0.0.0/24")
        params = req.to_proxmox_params(for_update=True)
        assert "type" not in params
        assert "subnet" not in params
        assert params["snat"] == 0

    def test_invalid_cidr_raises(self):
        with pytest.raises(ValidationError):
            SdnSubnetWriteRequest(vnet="v1", cidr="not-a-cidr")

    def test_invalid_gateway_raises(self):
        with pytest.raises(ValidationError):
            SdnSubnetWriteRequest(vnet="v1", cidr="10.0.0.0/24", gateway="999.1.1.1")

    def test_soft_warning_gateway_outside_subnet(self):
        req = SdnSubnetWriteRequest(vnet="v1", cidr="10.0.0.0/24", gateway="192.168.1.1")
        assert any("outside subnet" in w for w in req.soft_warnings())

    def test_no_soft_warning_gateway_in_subnet(self):
        req = SdnSubnetWriteRequest(vnet="v1", cidr="10.0.0.0/24", gateway="10.0.0.1")
        assert req.soft_warnings() == []


# ── Parser ──────────────────────────────────────────────────────────────────────

class TestParsers:
    def test_parse_zone(self):
        from backend.routers.sdn import _parse_zone
        z = _parse_zone(_SAMPLE_ZONE_SIMPLE)
        assert z.id == "zone1"
        assert z.type == "simple"
        assert z.mtu == 1500
        assert z.pending is False

    def test_parse_zone_vlan_bridge(self):
        from backend.routers.sdn import _parse_zone
        z = _parse_zone(_SAMPLE_ZONE_VLAN)
        assert z.type == "vlan"
        assert z.bridge == "vmbr0"

    def test_parse_vnet(self):
        from backend.routers.sdn import _parse_vnet
        v = _parse_vnet(_SAMPLE_VNET)
        assert v.id == "vnet1"
        assert v.zone == "zone1"
        assert v.tag == 100
        assert v.vlanaware is False

    def test_parse_subnet(self):
        from backend.routers.sdn import _parse_subnet
        s = _parse_subnet(_SAMPLE_SUBNET, "vnet1")
        assert s.id == "zone1-10.0.0.0-24"
        assert s.vnet == "vnet1"
        assert s.cidr == "10.0.0.0/24"
        assert s.snat is True

    def test_parse_non_dict_does_not_raise(self):
        from backend.routers.sdn import _parse_zone, _parse_vnet, _parse_subnet
        assert _parse_zone("garbage").id == ""  # type: ignore[arg-type]
        assert _parse_vnet(None).id == ""  # type: ignore[arg-type]
        assert _parse_subnet(123, "v").vnet == "v"  # type: ignore[arg-type]

    def test_pending_via_state(self):
        from backend.routers.sdn import _obj_pending, _parse_zone
        assert _obj_pending({"zone": "z", "state": "new"}) is True
        assert _obj_pending({"zone": "z", "state": "changed"}) is True
        assert _obj_pending({"zone": "z"}) is False
        z = _parse_zone({"zone": "z1", "type": "simple", "state": "deleted"})
        assert z.pending is True
        assert z.state == "deleted"

    def test_pending_via_pending_dict(self):
        from backend.routers.sdn import _obj_pending
        assert _obj_pending({"zone": "z", "pending": {"mtu": 1400}}) is True
        assert _obj_pending({"zone": "z", "pending": {}}) is False

    def test_parse_pve_type_drift(self):
        """A PVE version may return tag/mtu/snat as strings."""
        from backend.routers.sdn import _parse_vnet, _parse_subnet
        v = _parse_vnet({"vnet": "v", "tag": "200", "vlanaware": "1"})
        assert v.tag == 200
        assert v.vlanaware is True
        s = _parse_subnet({"subnet": "id", "snat": "1"}, "v")
        assert s.snat is True


# ── Error mapper ─────────────────────────────────────────────────────────────────

class TestSdnWriteHttpExc:
    def _exc(self, code):
        exc = MagicMock(spec=httpx.HTTPStatusError)
        exc.response = MagicMock()
        exc.response.status_code = code
        return exc

    def test_403_maps_to_403(self):
        from backend.routers.sdn import _sdn_write_http_exc
        result = _sdn_write_http_exc(self._exc(403))
        assert result.status_code == 403
        assert "SDN.Allocate" in result.detail

    def test_401_maps_to_502(self):
        from backend.routers.sdn import _sdn_write_http_exc
        assert _sdn_write_http_exc(self._exc(401)).status_code == 502

    def test_500_passes_through(self):
        from backend.routers.sdn import _sdn_write_http_exc
        assert _sdn_write_http_exc(self._exc(500)).status_code == 500


# ── RBAC gate ────────────────────────────────────────────────────────────────────

class TestAssertSdnAccess:
    def test_admin_allowed(self):
        from backend.routers.sdn import _assert_sdn_access
        _assert_sdn_access(_ADMIN_USER)  # no raise

    def test_manage_sdn_allowed(self):
        from backend.routers.sdn import _assert_sdn_access
        _assert_sdn_access(_SDN_MANAGER)  # no raise

    def test_viewer_denied(self):
        from fastapi import HTTPException
        from backend.routers.sdn import _assert_sdn_access
        with pytest.raises(HTTPException) as ei:
            _assert_sdn_access(_VIEWER_USER)
        assert ei.value.status_code == 403


# ── Read-auth token chain (admin→operator→viewer) ────────────────────────────────

class TestResolveSdnReadAuth:
    @pytest.mark.asyncio
    async def test_prefers_admin_token(self):
        from backend.routers import sdn
        node_row = MagicMock(url="https://pve:8006", verify_ssl=False)

        def _extract(row, role):
            return MagicMock(token_id=f"id-{role}", token_secret=f"sec-{role}") if role == "admin" else None

        with (
            patch("backend.services.nodes_service.get_default_node", AsyncMock(return_value=node_row)),
            patch("backend.services.service_accounts._extract_token", side_effect=_extract),
        ):
            client, auth = await sdn._resolve_sdn_read_auth(_SDN_MANAGER)
        assert auth.value == "id-admin"

    @pytest.mark.asyncio
    async def test_falls_back_to_viewer(self):
        from backend.routers import sdn
        node_row = MagicMock(url="https://pve:8006", verify_ssl=False)

        def _extract(row, role):
            return MagicMock(token_id="id-viewer", token_secret="sec") if role == "viewer" else None

        with (
            patch("backend.services.nodes_service.get_default_node", AsyncMock(return_value=node_row)),
            patch("backend.services.service_accounts._extract_token", side_effect=_extract),
        ):
            client, auth = await sdn._resolve_sdn_read_auth(_SDN_MANAGER)
        assert auth.value == "id-viewer"

    @pytest.mark.asyncio
    async def test_write_auth_requires_admin_token(self):
        from fastapi import HTTPException
        from backend.routers import sdn
        node_row = MagicMock(url="https://pve:8006", verify_ssl=False)
        with (
            patch("backend.services.nodes_service.get_default_node", AsyncMock(return_value=node_row)),
            patch("backend.services.service_accounts._extract_token", return_value=None),
        ):
            with pytest.raises(HTTPException) as ei:
                await sdn._resolve_sdn_write_auth(_SDN_MANAGER)
        assert ei.value.status_code == 503


# ── Zone endpoints ───────────────────────────────────────────────────────────────

class TestSdnZoneRouter:
    @pytest.mark.asyncio
    async def test_list_zones(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_zones = AsyncMock(return_value=[_SAMPLE_ZONE_SIMPLE, _SAMPLE_ZONE_VLAN])
        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn/zones")
        _clear(app)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["has_pending"] is False
        assert data["sdn_unavailable"] is False

    @pytest.mark.asyncio
    async def test_list_zones_has_pending(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_zones = AsyncMock(return_value=[{**_SAMPLE_ZONE_SIMPLE, "state": "new"}])
        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn/zones")
        _clear(app)
        assert resp.json()["has_pending"] is True

    @pytest.mark.asyncio
    async def test_list_zones_sdn_unavailable(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        resp_404 = MagicMock(status_code=404)
        mock_client.get_sdn_zones = AsyncMock(
            side_effect=httpx.HTTPStatusError("nf", request=MagicMock(), response=resp_404)
        )
        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn/zones")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json()["sdn_unavailable"] is True

    @pytest.mark.asyncio
    async def test_list_zones_permission_denied(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        resp_403 = MagicMock(status_code=403)
        mock_client.get_sdn_zones = AsyncMock(
            side_effect=httpx.HTTPStatusError("forbidden", request=MagicMock(), response=resp_403)
        )
        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn/zones")
        _clear(app)
        assert resp.json()["permission_denied"] is True

    @pytest.mark.asyncio
    async def test_list_zones_cluster_unreachable_on_auth_error(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(side_effect=Exception("boom"))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn/zones")
        _clear(app)
        assert resp.json()["cluster_unreachable"] is True

    @pytest.mark.asyncio
    async def test_list_zones_blocked_for_viewer(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/sdn/zones")
        _clear(app)
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_zone_success(self):
        from backend.main import app
        _override_user(app, _SDN_MANAGER)
        mock_client = AsyncMock()
        mock_client.get_sdn_zones = AsyncMock(return_value=[])
        mock_client.create_sdn_zone = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/sdn/zones", json={"type": "simple", "zone": "z1", "mtu": 1500})
        _clear(app)
        assert resp.status_code == 201
        assert resp.json()["id"] == "z1"
        params = mock_client.create_sdn_zone.call_args.args[1]
        assert params["zone"] == "z1"
        assert params["type"] == "simple"

    @pytest.mark.asyncio
    async def test_create_zone_collision_409(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_zones = AsyncMock(return_value=[_SAMPLE_ZONE_SIMPLE])  # zone1 exists
        mock_client.create_sdn_zone = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/sdn/zones", json={"type": "simple", "zone": "zone1"})
        _clear(app)
        assert resp.status_code == 409
        assert "existiert bereits" in resp.json()["detail"]
        mock_client.create_sdn_zone.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_create_zone_vlan_without_bridge_422(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        with patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(AsyncMock(), MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/sdn/zones", json={"type": "vlan", "zone": "vz"})
        _clear(app)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_zone_proxmox_403_passes_through(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_zones = AsyncMock(return_value=[])
        resp_403 = MagicMock(status_code=403)
        mock_client.create_sdn_zone = AsyncMock(
            side_effect=httpx.HTTPStatusError("forbidden", request=MagicMock(), response=resp_403)
        )
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/sdn/zones", json={"type": "simple", "zone": "z1"})
        _clear(app)
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_update_zone_omits_type(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.update_sdn_zone = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put("/api/sdn/zones/z1", json={"type": "simple", "zone": "z1", "mtu": 1400})
        _clear(app)
        assert resp.status_code == 200
        params = mock_client.update_sdn_zone.call_args.args[2]
        assert "type" not in params
        assert params["mtu"] == 1400

    @pytest.mark.asyncio
    async def test_delete_zone(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.delete_sdn_zone = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/sdn/zones/z1")
        _clear(app)
        assert resp.status_code == 204
        mock_client.delete_sdn_zone.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_zone_usage_lists_vnets(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_vnets = AsyncMock(return_value=[
            {"vnet": "v1", "zone": "zone1"},
            {"vnet": "v2", "zone": "other"},
        ])
        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn/zones/zone1/usage")
        _clear(app)
        assert resp.status_code == 200
        data = resp.json()
        assert data["in_use"] is True
        assert data["vnets"] == ["v1"]


# ── VNet endpoints ───────────────────────────────────────────────────────────────

class TestSdnVnetRouter:
    @pytest.mark.asyncio
    async def test_list_vnets(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_vnets = AsyncMock(return_value=[_SAMPLE_VNET])
        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn/vnets")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json()["items"][0]["tag"] == 100

    @pytest.mark.asyncio
    async def test_create_vnet_success(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_zones = AsyncMock(return_value=[_SAMPLE_ZONE_SIMPLE])
        mock_client.get_sdn_vnets = AsyncMock(return_value=[])
        mock_client.create_sdn_vnet = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/sdn/vnets", json={"vnet": "v1", "zone": "zone1"})
        _clear(app)
        assert resp.status_code == 201
        params = mock_client.create_sdn_vnet.call_args.args[1]
        assert params["vnet"] == "v1"
        assert params["zone"] == "zone1"

    @pytest.mark.asyncio
    async def test_create_vnet_vlan_zone_requires_tag_422(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_zones = AsyncMock(return_value=[_SAMPLE_ZONE_VLAN])  # vz is a VLAN zone
        mock_client.get_sdn_vnets = AsyncMock(return_value=[])
        mock_client.create_sdn_vnet = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/sdn/vnets", json={"vnet": "v1", "zone": "vz"})  # no tag
        _clear(app)
        assert resp.status_code == 422
        assert "VLAN-Tag" in resp.json()["detail"]
        mock_client.create_sdn_vnet.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_create_vnet_unknown_zone_422(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_zones = AsyncMock(return_value=[])  # zone does not exist
        mock_client.get_sdn_vnets = AsyncMock(return_value=[])
        mock_client.create_sdn_vnet = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/sdn/vnets", json={"vnet": "v1", "zone": "ghost"})
        _clear(app)
        assert resp.status_code == 422
        mock_client.create_sdn_vnet.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_create_vnet_collision_409(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_zones = AsyncMock(return_value=[_SAMPLE_ZONE_SIMPLE])
        mock_client.get_sdn_vnets = AsyncMock(return_value=[_SAMPLE_VNET])  # vnet1 exists
        mock_client.create_sdn_vnet = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/sdn/vnets", json={"vnet": "vnet1", "zone": "zone1"})
        _clear(app)
        assert resp.status_code == 409
        mock_client.create_sdn_vnet.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_update_vnet(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.update_sdn_vnet = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put("/api/sdn/vnets/v1", json={"vnet": "v1", "zone": "z2", "tag": 200})
        _clear(app)
        assert resp.status_code == 200
        assert mock_client.update_sdn_vnet.call_args.args[1] == "v1"

    @pytest.mark.asyncio
    async def test_delete_vnet(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.delete_sdn_vnet = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/sdn/vnets/v1")
        _clear(app)
        assert resp.status_code == 204

    @pytest.mark.asyncio
    async def test_vnet_usage_finds_vms_and_subnets(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_cluster_resources_v2 = AsyncMock(return_value=[
            {"vmid": 100, "node": "pve1", "name": "web", "type": "qemu"},
            {"vmid": 200, "node": "pve2", "name": "db", "type": "lxc"},
        ])

        async def _cfg(auth, node, vmid, kind):
            if vmid == 100:
                return {"net0": "virtio=AA:BB,bridge=vnet1"}
            return {"net0": "virtio=CC:DD,bridge=vnet10"}  # vnet10 != vnet1 (substring trap)

        mock_client.get_vm_config = AsyncMock(side_effect=_cfg)
        mock_client.get_sdn_subnets = AsyncMock(return_value=[_SAMPLE_SUBNET])

        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn/vnets/vnet1/usage")
        _clear(app)
        assert resp.status_code == 200
        data = resp.json()
        assert data["in_use"] is True
        assert len(data["vms"]) == 1  # only vnet1, NOT vnet10 (exact segment match)
        assert data["vms"][0]["vmid"] == 100
        assert data["subnets"] == ["zone1-10.0.0.0-24"]


# ── Subnet endpoints ─────────────────────────────────────────────────────────────

class TestSdnSubnetRouter:
    @pytest.mark.asyncio
    async def test_list_subnets_fans_out_over_vnets(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_vnets = AsyncMock(return_value=[{"vnet": "v1"}, {"vnet": "v2"}])

        async def _subs(auth, vnet):
            if vnet == "v1":
                return [_SAMPLE_SUBNET]
            return [{"subnet": "z2-192.168.0.0-24", "vnet": "v2", "cidr": "192.168.0.0/24"}]

        mock_client.get_sdn_subnets = AsyncMock(side_effect=_subs)
        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn/subnets")
        _clear(app)
        assert resp.status_code == 200
        assert len(resp.json()["items"]) == 2

    @pytest.mark.asyncio
    async def test_create_subnet(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.create_sdn_subnet = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/sdn/subnets",
                    json={"vnet": "v1", "cidr": "10.0.0.0/24", "gateway": "10.0.0.1", "snat": True},
                )
        _clear(app)
        assert resp.status_code == 201
        assert mock_client.create_sdn_subnet.call_args.args[1] == "v1"
        params = mock_client.create_sdn_subnet.call_args.args[2]
        assert params["subnet"] == "10.0.0.0/24"
        assert params["type"] == "subnet"

    @pytest.mark.asyncio
    async def test_create_subnet_soft_warning(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.create_sdn_subnet = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/sdn/subnets",
                    json={"vnet": "v1", "cidr": "10.0.0.0/24", "gateway": "192.168.1.1"},
                )
        _clear(app)
        assert resp.status_code == 201
        assert any("outside subnet" in w for w in resp.json()["warnings"])

    @pytest.mark.asyncio
    async def test_update_subnet(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.update_sdn_subnet = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put(
                    "/api/sdn/subnets/v1/zone1-10.0.0.0-24",
                    json={"vnet": "v1", "cidr": "10.0.0.0/24", "gateway": "10.0.0.254"},
                )
        _clear(app)
        assert resp.status_code == 200
        assert mock_client.update_sdn_subnet.call_args.args[1] == "v1"
        assert mock_client.update_sdn_subnet.call_args.args[2] == "zone1-10.0.0.0-24"
        params = mock_client.update_sdn_subnet.call_args.args[3]
        assert "subnet" not in params  # update omits subnet/type

    @pytest.mark.asyncio
    async def test_delete_subnet(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.delete_sdn_subnet = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/sdn/subnets/v1/zone1-10.0.0.0-24")
        _clear(app)
        assert resp.status_code == 204
        assert mock_client.delete_sdn_subnet.call_args.args[2] == "zone1-10.0.0.0-24"


# ── Aggregate pending + Apply / Revert ──────────────────────────────────────────

class TestSdnApplyRevert:
    @pytest.mark.asyncio
    async def test_aggregate_pending_counts(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_zones = AsyncMock(return_value=[{"zone": "z1", "state": "new"}, {"zone": "z2"}])
        mock_client.get_sdn_vnets = AsyncMock(return_value=[{"vnet": "v1", "state": "changed"}])
        mock_client.get_sdn_subnets = AsyncMock(return_value=[{"subnet": "s1", "state": "deleted"}])
        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn")
        _clear(app)
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_pending"] is True
        assert data["counts"]["zones"] == 1
        assert data["counts"]["vnets"] == 1
        assert data["counts"]["subnets"] == 1

    @pytest.mark.asyncio
    async def test_aggregate_pending_sdn_unavailable(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        resp_501 = MagicMock(status_code=501)
        mock_client.get_sdn_zones = AsyncMock(
            side_effect=httpx.HTTPStatusError("ni", request=MagicMock(), response=resp_501)
        )
        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn")
        _clear(app)
        assert resp.json()["sdn_unavailable"] is True

    @pytest.mark.asyncio
    async def test_apply(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.apply_sdn = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/sdn/apply")
        _clear(app)
        assert resp.status_code == 204
        mock_client.apply_sdn.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_apply_proxmox_403_passes_through(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        resp_403 = MagicMock(status_code=403)
        mock_client.apply_sdn = AsyncMock(
            side_effect=httpx.HTTPStatusError("forbidden", request=MagicMock(), response=resp_403)
        )
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/sdn/apply")
        _clear(app)
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_revert(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.revert_sdn = AsyncMock()
        with (
            patch("backend.routers.sdn._resolve_sdn_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.sdn.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/sdn/revert")
        _clear(app)
        assert resp.status_code == 204
        mock_client.revert_sdn.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_apply_blocked_for_viewer(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/sdn/apply")
        _clear(app)
        assert resp.status_code == 403


# ── Bridges form-helper endpoint ─────────────────────────────────────────────────

class TestSdnBridges:
    @pytest.mark.asyncio
    async def test_bridges_union_over_online_nodes(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_cluster_resources_v2 = AsyncMock(return_value=[
            {"node": "pve1", "status": "online"},
            {"node": "pve2", "status": "online"},
            {"node": "pve3", "status": "offline"},  # skipped
        ])

        async def _bridges(auth, node):
            if node == "pve1":
                return ["vmbr0", "vmbr1"]
            if node == "pve2":
                return ["vmbr0", "vmbr2"]
            raise AssertionError("offline node must not be queried")

        mock_client.get_node_bridges = AsyncMock(side_effect=_bridges)
        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn/bridges")
        _clear(app)
        assert resp.status_code == 200
        data = resp.json()
        assert data["bridges"] == ["vmbr0", "vmbr1", "vmbr2"]  # union, sorted, deduped
        assert data["incomplete"] is False

    @pytest.mark.asyncio
    async def test_bridges_incomplete_on_node_error(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_cluster_resources_v2 = AsyncMock(return_value=[{"node": "pve1", "status": "online"}])
        mock_client.get_node_bridges = AsyncMock(side_effect=Exception("boom"))
        with patch("backend.routers.sdn._resolve_sdn_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn/bridges")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json()["bridges"] == []
        assert resp.json()["incomplete"] is True

    @pytest.mark.asyncio
    async def test_bridges_blocked_for_viewer(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/sdn/bridges")
        _clear(app)
        assert resp.status_code == 403


# ── Multi-installation: ?node=<portal_node_id> targets the right installation ─────

class TestSdnNodeTargeting:
    @pytest.mark.asyncio
    async def test_read_resolver_uses_selected_node(self):
        """?node=<id> must resolve the selected portal node, not the default."""
        from backend.routers import sdn
        selected = MagicMock(url="https://pve2:8006", verify_ssl=False)
        default = MagicMock(url="https://pve1:8006", verify_ssl=False)

        def _extract(row, role):
            return MagicMock(token_id="id-admin", token_secret="sec") if role == "admin" else None

        with (
            patch("backend.services.nodes_service.get_node", AsyncMock(return_value=selected)),
            patch("backend.services.nodes_service.get_default_node", AsyncMock(return_value=default)),
            patch("backend.services.service_accounts._extract_token", side_effect=_extract),
        ):
            client, _auth = await sdn._resolve_sdn_read_auth(_SDN_MANAGER, portal_node_id=2)
        assert "pve2" in client._base  # selected installation, not the default

    @pytest.mark.asyncio
    async def test_read_resolver_default_when_no_node(self):
        from backend.routers import sdn
        default = MagicMock(url="https://pve1:8006", verify_ssl=False)

        def _extract(row, role):
            return MagicMock(token_id="id-admin", token_secret="sec") if role == "admin" else None

        with (
            patch("backend.services.nodes_service.get_default_node", AsyncMock(return_value=default)),
            patch("backend.services.service_accounts._extract_token", side_effect=_extract),
        ):
            client, _auth = await sdn._resolve_sdn_read_auth(_SDN_MANAGER)
        assert "pve1" in client._base

    @pytest.mark.asyncio
    async def test_unknown_node_503(self):
        from fastapi import HTTPException
        from backend.routers import sdn
        with (
            patch("backend.services.nodes_service.get_node", AsyncMock(return_value=None)),
        ):
            with pytest.raises(HTTPException) as ei:
                await sdn._resolve_sdn_read_auth(_SDN_MANAGER, portal_node_id=999)
        assert ei.value.status_code == 503

    @pytest.mark.asyncio
    async def test_list_zones_passes_node_to_resolver(self):
        """The endpoint forwards ?node= to the resolver."""
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_sdn_zones = AsyncMock(return_value=[_SAMPLE_ZONE_SIMPLE])
        seen = {}

        async def _resolver(user, portal_node_id=None):
            seen["node"] = portal_node_id
            return mock_client, MagicMock()

        with patch("backend.routers.sdn._resolve_sdn_read_auth", side_effect=_resolver):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/sdn/zones?node=2")
        _clear(app)
        assert resp.status_code == 200
        assert seen["node"] == 2


# ── manage_sdn registered as a valid portal permission ──────────────────────────

class TestManageSdnPermission:
    def test_manage_sdn_in_core_perms(self):
        from backend.models.auth import PortalPermissionsRequest
        req = PortalPermissionsRequest(portal_permissions=["manage_sdn"])
        assert "manage_sdn" in req.portal_permissions
