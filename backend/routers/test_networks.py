# p3portal.org
"""Tests für PROJ-79 – Netzwerk-Verwaltung (Router + Schemas + Parser + Gate)."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from backend.models.networks import NetworkIfaceWriteRequest

# ── Test users ────────────────────────────────────────────────────────────────

_ADMIN_USER = MagicMock(
    username="admin", auth_type="local", role="admin",
    portal_permissions=[], jti="jti-admin", user_id=1,
)
_VIEWER_USER = MagicMock(
    username="viewer", auth_type="local", role="viewer",
    portal_permissions=[], jti="jti-viewer", user_id=2,
)
_MANAGER_USER = MagicMock(
    username="manager", auth_type="local", role="viewer",
    portal_permissions=["manage_networks"], jti="jti-manager", user_id=3,
)

_SAMPLE_BRIDGE = {
    "iface": "vmbr1", "type": "bridge", "method": "static",
    "cidr": "10.0.0.1/24", "gateway": "10.0.0.254", "autostart": 1,
    "bridge_ports": "eth0", "bridge_vlan_aware": 0, "comments": "lab bridge", "active": 1,
}
_SAMPLE_VLAN = {
    "iface": "vmbr0.100", "type": "vlan", "method": "manual",
    "vlan-raw-device": "vmbr0", "vlan-id": 100, "autostart": 1, "active": 1,
}


def _override_user(app, user):
    from backend.core.deps import get_current_user
    app.dependency_overrides[get_current_user] = lambda: user


def _clear(app):
    app.dependency_overrides.clear()


# ── Schema validation ─────────────────────────────────────────────────────────

class TestNetworkIfaceWriteRequest:
    def test_valid_bridge(self):
        req = NetworkIfaceWriteRequest(
            type="bridge", iface="vmbr1", cidr="10.0.0.1/24",
            gateway="10.0.0.254", autostart=True, bridge_ports=["eth0"],
        )
        params = req.to_proxmox_params()
        assert params["type"] == "bridge"
        assert params["autostart"] == 1
        assert params["cidr"] == "10.0.0.1/24"
        assert params["bridge_ports"] == "eth0"
        assert params["bridge_vlan_aware"] == 0

    def test_bridge_vlan_aware_with_vids(self):
        req = NetworkIfaceWriteRequest(
            type="bridge", iface="vmbr2", bridge_vlan_aware=True, bridge_vids="2-4094",
        )
        params = req.to_proxmox_params()
        assert params["bridge_vlan_aware"] == 1
        assert params["bridge_vids"] == "2-4094"

    def test_bridge_vids_dropped_when_not_vlan_aware(self):
        req = NetworkIfaceWriteRequest(
            type="bridge", iface="vmbr2", bridge_vlan_aware=False, bridge_vids="2-4094",
        )
        params = req.to_proxmox_params()
        assert "bridge_vids" not in params

    def test_valid_vlan_dotted_name(self):
        req = NetworkIfaceWriteRequest(type="vlan", iface="vmbr0.100")
        params = req.to_proxmox_params()
        assert params["type"] == "vlan"

    def test_valid_vlan_freeform_with_device_and_tag(self):
        req = NetworkIfaceWriteRequest(
            type="vlan", iface="vlan100", vlan_raw_device="vmbr0", vlan_id=100,
        )
        params = req.to_proxmox_params()
        assert params["vlan-raw-device"] == "vmbr0"
        assert params["vlan-id"] == 100

    def test_vlan_freeform_without_device_raises(self):
        with pytest.raises(ValidationError):
            NetworkIfaceWriteRequest(type="vlan", iface="vlan100")

    def test_invalid_bridge_name_raises(self):
        with pytest.raises(ValidationError):
            NetworkIfaceWriteRequest(type="bridge", iface="notabridge")

    def test_invalid_type_raises(self):
        with pytest.raises(ValidationError):
            NetworkIfaceWriteRequest(type="bond", iface="bond0")

    def test_invalid_cidr_raises(self):
        with pytest.raises(ValidationError):
            NetworkIfaceWriteRequest(type="bridge", iface="vmbr1", cidr="not-a-cidr")

    def test_invalid_gateway_raises(self):
        with pytest.raises(ValidationError):
            NetworkIfaceWriteRequest(type="bridge", iface="vmbr1", gateway="999.1.1.1")

    def test_vlan_id_out_of_range_raises(self):
        with pytest.raises(ValidationError):
            NetworkIfaceWriteRequest(type="vlan", iface="x", vlan_raw_device="vmbr0", vlan_id=5000)

    def test_invalid_vids_token_raises(self):
        with pytest.raises(ValidationError):
            NetworkIfaceWriteRequest(
                type="bridge", iface="vmbr1", bridge_vlan_aware=True, bridge_vids="abc",
            )

    def test_mtu_out_of_hard_bounds_raises(self):
        with pytest.raises(ValidationError):
            NetworkIfaceWriteRequest(type="bridge", iface="vmbr1", mtu=100)  # < 128
        with pytest.raises(ValidationError):
            NetworkIfaceWriteRequest(type="bridge", iface="vmbr1", mtu=70000)  # > 65520

    def test_soft_warning_gateway_outside_subnet(self):
        req = NetworkIfaceWriteRequest(
            type="bridge", iface="vmbr1", cidr="10.0.0.1/24", gateway="192.168.1.1",
        )
        warnings = req.soft_warnings()
        assert any("outside subnet" in w for w in warnings)

    def test_soft_warning_mtu_outside_typical(self):
        req = NetworkIfaceWriteRequest(type="bridge", iface="vmbr1", mtu=500)  # >=128 but <576
        warnings = req.soft_warnings()
        assert any("MTU" in w for w in warnings)

    def test_no_soft_warning_when_gateway_in_subnet(self):
        req = NetworkIfaceWriteRequest(
            type="bridge", iface="vmbr1", cidr="10.0.0.1/24", gateway="10.0.0.254",
        )
        assert req.soft_warnings() == []


# ── Parser ────────────────────────────────────────────────────────────────────

class TestParseNetworkIface:
    def test_parse_bridge(self):
        from backend.routers.networks import _parse_network_iface
        iface = _parse_network_iface(_SAMPLE_BRIDGE)
        assert iface.iface == "vmbr1"
        assert iface.type == "bridge"
        assert iface.cidr == "10.0.0.1/24"
        assert iface.gateway == "10.0.0.254"
        assert iface.autostart is True
        assert iface.bridge_ports == ["eth0"]
        assert iface.active is True

    def test_parse_vlan(self):
        from backend.routers.networks import _parse_network_iface
        iface = _parse_network_iface(_SAMPLE_VLAN)
        assert iface.type == "vlan"
        assert iface.vlan_raw_device == "vmbr0"
        assert iface.vlan_id == 100

    def test_parse_cidr_from_address_netmask(self):
        from backend.routers.networks import _parse_network_iface
        iface = _parse_network_iface({
            "iface": "vmbr3", "type": "bridge",
            "address": "192.168.5.1", "netmask": "255.255.255.0",
        })
        assert iface.cidr == "192.168.5.1/24"

    def test_parse_pve_version_type_drift(self):
        """A PVE version may return autostart/active as strings, bridge_ports as list."""
        from backend.routers.networks import _parse_network_iface
        iface = _parse_network_iface({
            "iface": "vmbr9", "type": "bridge",
            "autostart": "1", "active": "0",
            "bridge_ports": ["eth0", "eth1"], "mtu": "1500",
        })
        assert iface.autostart is True
        assert iface.active is False
        assert iface.bridge_ports == ["eth0", "eth1"]
        assert iface.mtu == 1500

    def test_parse_pending_flag(self):
        from backend.routers.networks import _parse_network_iface
        iface = _parse_network_iface({"iface": "vmbr1", "type": "bridge", "pending": 1})
        assert iface.pending is True

    def test_parse_non_dict_does_not_raise(self):
        from backend.routers.networks import _parse_network_iface
        iface = _parse_network_iface("garbage")  # type: ignore[arg-type]
        assert iface.iface == ""

    def test_parse_bridge_ports_none_string(self):
        from backend.routers.networks import _parse_network_iface
        iface = _parse_network_iface({"iface": "vmbr1", "type": "bridge", "bridge_ports": "none"})
        assert iface.bridge_ports == []


class TestIsManageableIface:
    """Lenient bridge/VLAN detection so real bridges never disappear (empty-tab fix)."""

    def test_bridge_type(self):
        from backend.routers.networks import _is_manageable_iface
        assert _is_manageable_iface({"iface": "vmbr0", "type": "bridge"}) is True

    def test_vlan_type(self):
        from backend.routers.networks import _is_manageable_iface
        assert _is_manageable_iface({"iface": "vmbr0.100", "type": "vlan"}) is True

    def test_ovs_bridge_type_kept(self):
        from backend.routers.networks import _is_manageable_iface
        assert _is_manageable_iface({"iface": "vmbr1", "type": "OVSBridge"}) is True

    def test_bridge_name_without_matching_type(self):
        from backend.routers.networks import _is_manageable_iface
        # PVE drift: type missing/unexpected but the name is bridge-typical
        assert _is_manageable_iface({"iface": "vmbr2", "type": ""}) is True

    def test_dotted_vlan_name_without_type(self):
        from backend.routers.networks import _is_manageable_iface
        assert _is_manageable_iface({"iface": "eth0.50", "type": "unknown"}) is True

    def test_eth_dropped(self):
        from backend.routers.networks import _is_manageable_iface
        assert _is_manageable_iface({"iface": "eth0", "type": "eth"}) is False

    def test_bond_dropped(self):
        from backend.routers.networks import _is_manageable_iface
        assert _is_manageable_iface({"iface": "bond0", "type": "bond"}) is False

    def test_loopback_dropped(self):
        from backend.routers.networks import _is_manageable_iface
        assert _is_manageable_iface({"iface": "lo", "type": "loopback"}) is False


# ── Error mapper ──────────────────────────────────────────────────────────────

class TestNetworkWriteHttpExc:
    def _exc(self, code):
        exc = MagicMock(spec=Exception)
        exc.response = MagicMock()
        exc.response.status_code = code
        return exc

    def test_403_maps_to_403(self):
        from backend.routers.networks import _network_write_http_exc
        result = _network_write_http_exc(self._exc(403))
        assert result.status_code == 403
        assert "Sys.Modify" in result.detail

    def test_401_maps_to_502(self):
        from backend.routers.networks import _network_write_http_exc
        assert _network_write_http_exc(self._exc(401)).status_code == 502

    def test_500_passes_through(self):
        from backend.routers.networks import _network_write_http_exc
        assert _network_write_http_exc(self._exc(500)).status_code == 500


# ── RBAC gate ─────────────────────────────────────────────────────────────────

class TestAssertNetworkAccess:
    @pytest.mark.asyncio
    async def test_admin_allowed(self):
        from backend.routers.networks import _assert_network_access
        await _assert_network_access(_ADMIN_USER, "pve1")  # no raise

    @pytest.mark.asyncio
    async def test_manage_networks_allowed(self):
        from backend.routers.networks import _assert_network_access
        await _assert_network_access(_MANAGER_USER, "pve1")  # no raise

    @pytest.mark.asyncio
    async def test_node_scope_allowed(self):
        from backend.routers.networks import _assert_network_access
        node_row = MagicMock(id=7)
        with (
            patch("backend.services.nodes_service.get_node_for_proxmox_name", AsyncMock(return_value=node_row)),
            patch("backend.services.permissions_resolver.resolve_node_action", AsyncMock(return_value=True)),
        ):
            await _assert_network_access(_VIEWER_USER, "pve1")  # no raise

    @pytest.mark.asyncio
    async def test_viewer_denied(self):
        from fastapi import HTTPException
        from backend.routers.networks import _assert_network_access
        node_row = MagicMock(id=7)
        with (
            patch("backend.services.nodes_service.get_node_for_proxmox_name", AsyncMock(return_value=node_row)),
            patch("backend.services.permissions_resolver.resolve_node_action", AsyncMock(return_value=False)),
        ):
            with pytest.raises(HTTPException) as ei:
                await _assert_network_access(_VIEWER_USER, "pve1")
        assert ei.value.status_code == 403


# ── Read-auth token chain (empty-tab fix: admin→operator→viewer) ──────────────

class TestResolveReadAuth:
    @pytest.mark.asyncio
    async def test_prefers_admin_token(self):
        """Reading /nodes/{node}/network uses the strongest token, not viewer-only."""
        from backend.routers import networks as net
        node_row = MagicMock(url="https://pve:8006", verify_ssl=False)

        def _extract(row, role):
            return MagicMock(token_id=f"id-{role}", token_secret=f"sec-{role}") if role == "admin" else None

        with (
            patch("backend.services.nodes_service.get_node_for_proxmox_name", AsyncMock(return_value=node_row)),
            patch("backend.services.service_accounts._extract_token", side_effect=_extract),
        ):
            client, auth = await net._resolve_read_auth(_MANAGER_USER, "pve1")
        assert auth.value == "id-admin"

    @pytest.mark.asyncio
    async def test_falls_back_to_viewer(self):
        from backend.routers import networks as net
        node_row = MagicMock(url="https://pve:8006", verify_ssl=False)

        def _extract(row, role):
            return MagicMock(token_id="id-viewer", token_secret="sec") if role == "viewer" else None

        with (
            patch("backend.services.nodes_service.get_node_for_proxmox_name", AsyncMock(return_value=node_row)),
            patch("backend.services.service_accounts._extract_token", side_effect=_extract),
        ):
            client, auth = await net._resolve_read_auth(_MANAGER_USER, "pve1")
        assert auth.value == "id-viewer"


# ── Router endpoints ──────────────────────────────────────────────────────────

class TestNetworkRouter:
    @pytest.mark.asyncio
    async def test_list_returns_interfaces(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_node_network_interfaces = AsyncMock(return_value=[_SAMPLE_BRIDGE, _SAMPLE_VLAN])
        with patch("backend.routers.networks._resolve_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/networks?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        data = resp.json()
        assert data["permission_denied"] is False
        assert len(data["interfaces"]) == 2
        assert data["has_pending"] is False

    @pytest.mark.asyncio
    async def test_list_has_pending(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        pending_bridge = {**_SAMPLE_BRIDGE, "pending": 1}
        mock_client = AsyncMock()
        mock_client.get_node_network_interfaces = AsyncMock(return_value=[pending_bridge])
        with patch("backend.routers.networks._resolve_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/networks?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json()["has_pending"] is True

    @pytest.mark.asyncio
    async def test_list_filters_non_bridge_vlan_types(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        raw = [_SAMPLE_BRIDGE, {"iface": "eth0", "type": "eth"}, {"iface": "bond0", "type": "bond"}]
        mock_client = AsyncMock()
        mock_client.get_node_network_interfaces = AsyncMock(return_value=raw)
        with patch("backend.routers.networks._resolve_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/networks?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        # only the bridge survives the type filter
        assert len(resp.json()["interfaces"]) == 1

    @pytest.mark.asyncio
    async def test_list_permission_denied(self):
        import httpx
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        resp_403 = MagicMock(status_code=403)
        mock_client.get_node_network_interfaces = AsyncMock(
            side_effect=httpx.HTTPStatusError("forbidden", request=MagicMock(), response=resp_403)
        )
        with patch("backend.routers.networks._resolve_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/networks?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json()["permission_denied"] is True

    @pytest.mark.asyncio
    async def test_list_node_unreachable_on_auth_error(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        with patch("backend.routers.networks._resolve_read_auth", AsyncMock(side_effect=Exception("boom"))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/networks?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json()["node_unreachable"] is True

    @pytest.mark.asyncio
    async def test_list_blocked_for_viewer(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        node_row = MagicMock(id=7)
        with (
            patch("backend.services.nodes_service.get_node_for_proxmox_name", AsyncMock(return_value=node_row)),
            patch("backend.services.permissions_resolver.resolve_node_action", AsyncMock(return_value=False)),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/networks?node=pve1")
        _clear(app)
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_devices_returns_names(self):
        from backend.main import app
        _override_user(app, _MANAGER_USER)
        mock_client = AsyncMock()
        mock_client.get_node_network_interfaces = AsyncMock(
            return_value=[{"iface": "eth0"}, {"iface": "vmbr0"}, {"iface": "eth1"}]
        )
        with patch("backend.routers.networks._resolve_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/networks/devices?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json() == ["eth0", "eth1", "vmbr0"]

    @pytest.mark.asyncio
    async def test_create_bridge_success(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_node_network_interfaces = AsyncMock(return_value=[])
        mock_client.create_network_iface = AsyncMock()
        with (
            patch("backend.routers.networks._resolve_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.networks.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/networks?node=pve1",
                    json={"type": "bridge", "iface": "vmbr1", "cidr": "10.0.0.1/24",
                          "gateway": "10.0.0.254", "autostart": True},
                )
        _clear(app)
        assert resp.status_code == 201
        assert resp.json()["iface"] == "vmbr1"
        # gateway in subnet → no warnings
        assert resp.json()["warnings"] == []
        called_params = mock_client.create_network_iface.call_args.args[2]
        assert called_params["iface"] == "vmbr1"
        assert called_params["type"] == "bridge"

    @pytest.mark.asyncio
    async def test_create_returns_soft_warning(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_node_network_interfaces = AsyncMock(return_value=[])
        mock_client.create_network_iface = AsyncMock()
        with (
            patch("backend.routers.networks._resolve_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.networks.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/networks?node=pve1",
                    json={"type": "bridge", "iface": "vmbr1", "cidr": "10.0.0.1/24",
                          "gateway": "192.168.1.1"},
                )
        _clear(app)
        assert resp.status_code == 201
        assert any("outside subnet" in w for w in resp.json()["warnings"])

    @pytest.mark.asyncio
    async def test_create_name_collision_409(self):
        """An interface name that already exists → clean 409 (AC-CB-3, BUG-79-2)."""
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_node_network_interfaces = AsyncMock(return_value=[_SAMPLE_BRIDGE])  # vmbr1 exists
        mock_client.create_network_iface = AsyncMock()
        with (
            patch("backend.routers.networks._resolve_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.networks.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/networks?node=pve1",
                    json={"type": "bridge", "iface": "vmbr1"},
                )
        _clear(app)
        assert resp.status_code == 409
        assert "existiert bereits" in resp.json()["detail"]
        # create must NOT be attempted on collision
        mock_client.create_network_iface.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_create_invalid_name_422(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        with patch("backend.routers.networks._resolve_write_auth", AsyncMock(return_value=(AsyncMock(), MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/networks?node=pve1",
                    json={"type": "bridge", "iface": "badname"},
                )
        _clear(app)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_proxmox_403_passes_through(self):
        import httpx
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_node_network_interfaces = AsyncMock(return_value=[])
        resp_403 = MagicMock(status_code=403)
        mock_client.create_network_iface = AsyncMock(
            side_effect=httpx.HTTPStatusError("forbidden", request=MagicMock(), response=resp_403)
        )
        with (
            patch("backend.routers.networks._resolve_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.networks.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/networks?node=pve1",
                    json={"type": "bridge", "iface": "vmbr1"},
                )
        _clear(app)
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_update_success(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.update_network_iface = AsyncMock()
        with (
            patch("backend.routers.networks._resolve_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.networks.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put(
                    "/api/networks/vmbr1?node=pve1",
                    json={"type": "bridge", "iface": "vmbr1", "cidr": "10.0.0.2/24"},
                )
        _clear(app)
        assert resp.status_code == 200
        mock_client.update_network_iface.assert_awaited_once()
        assert mock_client.update_network_iface.call_args.args[2] == "vmbr1"

    @pytest.mark.asyncio
    async def test_delete_success(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.delete_network_iface = AsyncMock()
        with (
            patch("backend.routers.networks._resolve_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.networks.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/networks/vmbr1?node=pve1")
        _clear(app)
        assert resp.status_code == 204

    @pytest.mark.asyncio
    async def test_reload_success(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.reload_node_network = AsyncMock()
        with (
            patch("backend.routers.networks._resolve_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.networks.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/networks/reload?node=pve1")
        _clear(app)
        assert resp.status_code == 204
        mock_client.reload_node_network.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_revert_success(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.revert_node_network = AsyncMock()
        with (
            patch("backend.routers.networks._resolve_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.networks.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/networks/revert?node=pve1")
        _clear(app)
        assert resp.status_code == 204
        mock_client.revert_node_network.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_usage_finds_referencing_guests(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_cluster_resources_v2 = AsyncMock(return_value=[
            {"vmid": 100, "node": "pve1", "name": "web", "type": "qemu"},
            {"vmid": 101, "node": "pve1", "name": "db", "type": "lxc"},
            {"vmid": 200, "node": "pve2", "name": "other", "type": "qemu"},  # different node, ignored
        ])

        async def _cfg(auth, node, vmid, kind):
            if vmid == 100:
                return {"net0": "virtio=AA:BB,bridge=vmbr1", "name": "web"}
            return {"net0": "virtio=CC:DD,bridge=vmbr2"}  # vmid 101 uses other bridge

        mock_client.get_vm_config = AsyncMock(side_effect=_cfg)

        with patch("backend.routers.networks._resolve_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/networks/vmbr1/usage?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        data = resp.json()
        assert data["in_use"] is True
        assert len(data["usages"]) == 1
        assert data["usages"][0]["vmid"] == 100
        # only pve1 guests were inspected (pve2 ignored) → no config fetched for 200
        assert mock_client.get_vm_config.await_count == 2

    @pytest.mark.asyncio
    async def test_usage_no_match_exact_bridge_name(self):
        """bridge=vmbr10 must NOT match a query for vmbr1 (substring trap)."""
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_cluster_resources_v2 = AsyncMock(return_value=[
            {"vmid": 100, "node": "pve1", "name": "web", "type": "qemu"},
        ])
        mock_client.get_vm_config = AsyncMock(return_value={"net0": "virtio=AA:BB,bridge=vmbr10"})
        with patch("backend.routers.networks._resolve_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/networks/vmbr1/usage?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json()["in_use"] is False

    @pytest.mark.asyncio
    async def test_usage_incomplete_on_config_error(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mock_client = AsyncMock()
        mock_client.get_cluster_resources_v2 = AsyncMock(return_value=[
            {"vmid": 100, "node": "pve1", "name": "web", "type": "qemu"},
        ])
        mock_client.get_vm_config = AsyncMock(side_effect=Exception("cfg boom"))
        with patch("backend.routers.networks._resolve_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/networks/vmbr1/usage?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        data = resp.json()
        assert data["incomplete"] is True
        assert data["in_use"] is False


# ── Cross-cutting registration ────────────────────────────────────────────────

class TestRegistration:
    def test_manage_networks_is_valid_portal_permission(self):
        from backend.models.auth import PortalPermissionsRequest
        req = PortalPermissionsRequest(portal_permissions=["manage_networks"])
        assert "manage_networks" in req.portal_permissions

    def test_node_manage_network_in_valid_actions(self):
        from backend.features.node_assignments.schemas import VALID_NODE_ACTIONS
        assert "node:manage_network" in VALID_NODE_ACTIONS
