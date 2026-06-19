# p3portal.org
"""Tests für PROJ-90 – Firewall-Verwaltung (Schemas + Parser + Gates + Mapper + Endpoints + Fan-out)."""
from __future__ import annotations

import httpx
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from backend.models.firewall import (
    AliasWriteRequest,
    DcFirewallOptionsUpdate,
    FirewallRuleMoveRequest,
    FirewallRuleWriteRequest,
    GuestFirewallOptionsUpdate,
    IpSetCreateRequest,
    IpSetEntryRequest,
    NodeFirewallOptionsUpdate,
    SecurityGroupCreateRequest,
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
_FW_MANAGER = MagicMock(
    username="fwmgr", auth_type="local", role="viewer",
    portal_permissions=["manage_firewall"], jti="jti-fwmgr", user_id=3,
)
_NODE_SCOPED = MagicMock(
    username="nodescoped", auth_type="local", role="operator",
    portal_permissions=[], jti="jti-ns", user_id=4,
)

_RULE = {"pos": 0, "type": "in", "action": "ACCEPT", "enable": 1, "dport": "22", "source": "10.0.0.0/8"}
_GROUP_RULE = {"pos": 0, "type": "group", "action": "web", "enable": 1}


def _override_user(app, user):
    from backend.core.deps import get_current_user
    app.dependency_overrides[get_current_user] = lambda: user


def _clear(app):
    app.dependency_overrides.clear()


# ── Rule schema validation ──────────────────────────────────────────────────────

class TestFirewallRuleWriteRequest:
    def test_valid_in_rule(self):
        req = FirewallRuleWriteRequest(type="in", action="ACCEPT", source="10.0.0.0/24", dport="80")
        params = req.to_proxmox_params(with_pos=True)
        assert params["type"] == "in"
        assert params["action"] == "ACCEPT"
        assert params["enable"] == 1
        assert params["source"] == "10.0.0.0/24"
        assert params["dport"] == "80"
        assert "pos" not in params  # none given

    def test_pos_included_when_set(self):
        req = FirewallRuleWriteRequest(type="out", action="DROP", pos=3)
        assert req.to_proxmox_params(with_pos=True)["pos"] == 3
        assert "pos" not in req.to_proxmox_params(with_pos=False)

    def test_invalid_type_raises(self):
        with pytest.raises(ValidationError):
            FirewallRuleWriteRequest(type="sideways", action="ACCEPT")

    def test_invalid_action_for_in_rule(self):
        with pytest.raises(ValidationError):
            FirewallRuleWriteRequest(type="in", action="MAYBE")

    def test_group_requires_action(self):
        with pytest.raises(ValidationError):
            FirewallRuleWriteRequest(type="group", action="")

    def test_group_rule_action_is_sg_name(self):
        req = FirewallRuleWriteRequest(type="group", action="web")
        assert req.to_proxmox_params()["action"] == "web"

    def test_macro_xor_proto(self):
        with pytest.raises(ValidationError):
            FirewallRuleWriteRequest(type="in", action="ACCEPT", macro="SSH", dport="22")
        with pytest.raises(ValidationError):
            FirewallRuleWriteRequest(type="in", action="ACCEPT", macro="SSH", proto="tcp")

    def test_macro_alone_ok(self):
        req = FirewallRuleWriteRequest(type="in", action="ACCEPT", macro="SSH")
        assert req.to_proxmox_params()["macro"] == "SSH"

    def test_source_accepts_ipset_alias_range(self):
        req = FirewallRuleWriteRequest(
            type="in", action="ACCEPT", source="+myset,webalias,10.0.0.1-10.0.0.5,192.168.0.0/24",
        )
        assert "+myset" in req.to_proxmox_params()["source"]

    def test_source_rejects_garbage(self):
        with pytest.raises(ValidationError):
            FirewallRuleWriteRequest(type="in", action="ACCEPT", source="not a host")

    def test_icmp_type_maps_to_dashed_key(self):
        req = FirewallRuleWriteRequest(type="in", action="ACCEPT", proto="icmp", icmp_type="echo-request")
        assert req.to_proxmox_params()["icmp-type"] == "echo-request"

    def test_move_request(self):
        assert FirewallRuleMoveRequest(moveto=5).moveto == 5
        with pytest.raises(ValidationError):
            FirewallRuleMoveRequest(moveto=-1)


# ── Options schema validation ────────────────────────────────────────────────────

class TestOptionsSchemas:
    def test_dc_enable_forbidden(self):
        with pytest.raises(ValidationError):
            DcFirewallOptionsUpdate(enable=True)  # extra=forbid

    def test_dc_policy_validated(self):
        with pytest.raises(ValidationError):
            DcFirewallOptionsUpdate(policy_in="NONSENSE")
        params = DcFirewallOptionsUpdate(policy_in="DROP", ebtables=False).to_proxmox_params()
        assert params["policy_in"] == "DROP"
        assert params["ebtables"] == 0

    def test_node_options_params(self):
        params = NodeFirewallOptionsUpdate(enable=True, nf_conntrack_max=100000, ndp=False).to_proxmox_params()
        assert params["enable"] == 1
        assert params["nf_conntrack_max"] == 100000
        assert params["ndp"] == 0

    def test_node_options_unknown_field_forbidden(self):
        with pytest.raises(ValidationError):
            NodeFirewallOptionsUpdate(bogus=1)

    def test_guest_options_params(self):
        params = GuestFirewallOptionsUpdate(enable=True, dhcp=False, policy_in="ACCEPT").to_proxmox_params()
        assert params["enable"] == 1
        assert params["dhcp"] == 0
        assert params["policy_in"] == "ACCEPT"


# ── SG / IPSet / Alias schema validation ──────────────────────────────────────────

class TestObjectSchemas:
    def test_sg_name_charset(self):
        with pytest.raises(ValidationError):
            SecurityGroupCreateRequest(group="1bad")
        with pytest.raises(ValidationError):
            SecurityGroupCreateRequest(group="bad name")
        assert SecurityGroupCreateRequest(group="web").to_proxmox_params()["group"] == "web"

    def test_ipset_name_charset(self):
        with pytest.raises(ValidationError):
            IpSetCreateRequest(name="-nope")
        assert IpSetCreateRequest(name="trusted", comment="c").to_proxmox_params()["comment"] == "c"

    def test_ipset_entry_cidr(self):
        with pytest.raises(ValidationError):
            IpSetEntryRequest(cidr="not-an-ip")
        p = IpSetEntryRequest(cidr="10.0.0.0/24", nomatch=True).to_proxmox_params()
        assert p["cidr"] == "10.0.0.0/24"
        assert p["nomatch"] == 1

    def test_alias_validation(self):
        with pytest.raises(ValidationError):
            AliasWriteRequest(name="ok", cidr="garbage")
        with pytest.raises(ValidationError):
            AliasWriteRequest(name="1bad", cidr="10.0.0.1")
        create = AliasWriteRequest(name="gw", cidr="10.0.0.1").to_proxmox_params()
        assert create["name"] == "gw" and create["cidr"] == "10.0.0.1"
        upd = AliasWriteRequest(name="gw", cidr="10.0.0.2").to_proxmox_params(for_update=True)
        assert "name" not in upd  # name is in the path on update


# ── Error mapper ─────────────────────────────────────────────────────────────────

class TestFirewallWriteHttpExc:
    def _exc(self, code):
        exc = MagicMock(spec=httpx.HTTPStatusError)
        exc.response = MagicMock()
        exc.response.status_code = code
        return exc

    def test_403_maps_to_403(self):
        from backend.routers.firewall import _firewall_write_http_exc
        result = _firewall_write_http_exc(self._exc(403))
        assert result.status_code == 403
        assert "Sys.Modify" in result.detail or "VM.Config.Network" in result.detail

    def test_401_maps_to_502(self):
        from backend.routers.firewall import _firewall_write_http_exc
        assert _firewall_write_http_exc(self._exc(401)).status_code == 502

    def test_500_passes_through(self):
        from backend.routers.firewall import _firewall_write_http_exc
        assert _firewall_write_http_exc(self._exc(500)).status_code == 500


# ── RBAC gates ───────────────────────────────────────────────────────────────────

class TestDcFirewallAccess:
    def test_admin_allowed(self):
        from backend.routers.firewall import _assert_dc_firewall_access
        _assert_dc_firewall_access(_ADMIN_USER)

    def test_manage_firewall_allowed(self):
        from backend.routers.firewall import _assert_dc_firewall_access
        _assert_dc_firewall_access(_FW_MANAGER)

    def test_viewer_denied(self):
        from fastapi import HTTPException
        from backend.routers.firewall import _assert_dc_firewall_access
        with pytest.raises(HTTPException) as ei:
            _assert_dc_firewall_access(_VIEWER_USER)
        assert ei.value.status_code == 403


class TestNodeFirewallAccess:
    @pytest.mark.asyncio
    async def test_admin_allowed(self):
        from backend.routers.firewall import _assert_node_firewall_access
        await _assert_node_firewall_access(_ADMIN_USER, "pve1")

    @pytest.mark.asyncio
    async def test_manage_firewall_allowed(self):
        from backend.routers.firewall import _assert_node_firewall_access
        await _assert_node_firewall_access(_FW_MANAGER, "pve1")

    @pytest.mark.asyncio
    async def test_node_scope_allowed(self):
        from backend.routers.firewall import _assert_node_firewall_access
        portal_node = MagicMock(id=7)
        with (
            patch("backend.services.nodes_service.get_node_for_proxmox_name", AsyncMock(return_value=portal_node)),
            patch("backend.services.permissions_resolver.resolve_node_action", AsyncMock(return_value=True)),
        ):
            await _assert_node_firewall_access(_NODE_SCOPED, "pve1")

    @pytest.mark.asyncio
    async def test_node_scope_denied(self):
        from fastapi import HTTPException
        from backend.routers.firewall import _assert_node_firewall_access
        portal_node = MagicMock(id=7)
        with (
            patch("backend.services.nodes_service.get_node_for_proxmox_name", AsyncMock(return_value=portal_node)),
            patch("backend.services.permissions_resolver.resolve_node_action", AsyncMock(return_value=False)),
        ):
            with pytest.raises(HTTPException) as ei:
                await _assert_node_firewall_access(_NODE_SCOPED, "pve1")
        assert ei.value.status_code == 403


# ── Parse helpers ────────────────────────────────────────────────────────────────

class TestParsers:
    def test_parse_rule_type_drift(self):
        from backend.routers.firewall import _parse_rule
        r = _parse_rule({"pos": "2", "type": "in", "action": "DROP", "enable": "0", "icmp-type": "echo-request"})
        assert r.pos == 2 and r.enable is False and r.icmp_type == "echo-request"

    def test_parse_rule_enable_default_true(self):
        from backend.routers.firewall import _parse_rule
        assert _parse_rule({"pos": 0, "type": "in", "action": "ACCEPT"}).enable is True

    def test_parse_rule_non_dict(self):
        from backend.routers.firewall import _parse_rule
        assert _parse_rule("garbage").action == ""  # type: ignore[arg-type]

    def test_bn_tristate(self):
        from backend.routers.firewall import _bn
        assert _bn(None) is None and _bn("1") is True and _bn("0") is False

    def test_rule_matches_group_exact(self):
        from backend.routers.firewall import _rule_matches
        assert _rule_matches({"type": "group", "action": "web"}, "group", "web") is True
        assert _rule_matches({"type": "group", "action": "web10"}, "group", "web") is False  # no substring

    def test_rule_matches_ipset_segment(self):
        from backend.routers.firewall import _rule_matches
        assert _rule_matches({"source": "+trusted,10.0.0.0/8"}, "ipset", "trusted") is True
        assert _rule_matches({"source": "+trusted2"}, "ipset", "trusted") is False

    def test_rule_matches_alias_segment(self):
        from backend.routers.firewall import _rule_matches
        assert _rule_matches({"dest": "gw,10.0.0.0/8"}, "alias", "gw") is True
        assert _rule_matches({"dest": "gw2"}, "alias", "gw") is False


# ── Datacenter rule endpoints ────────────────────────────────────────────────────

class TestDcRulesRouter:
    @pytest.mark.asyncio
    async def test_list_rules(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_dc_firewall_rules = AsyncMock(return_value=[_RULE])
        with patch("backend.routers.firewall._dc_read_auth", AsyncMock(return_value=(mc, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/datacenter/rules")
        _clear(app)
        assert resp.status_code == 200
        assert len(resp.json()["rules"]) == 1

    @pytest.mark.asyncio
    async def test_list_rules_permission_denied(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_dc_firewall_rules = AsyncMock(
            side_effect=httpx.HTTPStatusError("f", request=MagicMock(), response=MagicMock(status_code=403))
        )
        with patch("backend.routers.firewall._dc_read_auth", AsyncMock(return_value=(mc, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/datacenter/rules")
        _clear(app)
        assert resp.status_code == 200 and resp.json()["permission_denied"] is True

    @pytest.mark.asyncio
    async def test_list_rules_node_unreachable_on_auth_error(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        with patch("backend.routers.firewall._dc_read_auth", AsyncMock(side_effect=Exception("boom"))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/datacenter/rules")
        _clear(app)
        assert resp.json()["node_unreachable"] is True

    @pytest.mark.asyncio
    async def test_list_rules_viewer_403(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/firewall/datacenter/rules")
        _clear(app)
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_rule(self):
        from backend.main import app
        _override_user(app, _FW_MANAGER)
        mc = AsyncMock()
        mc.create_dc_firewall_rule = AsyncMock()
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/firewall/datacenter/rules",
                    json={"type": "in", "action": "ACCEPT", "dport": "443", "pos": 0},
                )
        _clear(app)
        assert resp.status_code == 201
        params = mc.create_dc_firewall_rule.call_args.args[1]
        assert params["dport"] == "443" and params["pos"] == 0

    @pytest.mark.asyncio
    async def test_create_group_rule_missing_sg_422(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_firewall_groups = AsyncMock(return_value=[{"group": "other"}])
        mc.create_dc_firewall_rule = AsyncMock()
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/firewall/datacenter/rules",
                    json={"type": "group", "action": "web"},
                )
        _clear(app)
        assert resp.status_code == 422
        mc.create_dc_firewall_rule.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_move_rule_sends_only_moveto(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.update_dc_firewall_rule = AsyncMock()
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/firewall/datacenter/rules/2/move", json={"moveto": 5})
        _clear(app)
        assert resp.status_code == 204
        pos, params = mc.update_dc_firewall_rule.call_args.args[1], mc.update_dc_firewall_rule.call_args.args[2]
        assert pos == 2 and params == {"moveto": 5}

    @pytest.mark.asyncio
    async def test_create_rule_403_from_proxmox(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.create_dc_firewall_rule = AsyncMock(
            side_effect=httpx.HTTPStatusError("f", request=MagicMock(), response=MagicMock(status_code=403))
        )
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/firewall/datacenter/rules", json={"type": "in", "action": "DROP"})
        _clear(app)
        assert resp.status_code == 403


# ── Datacenter options endpoints ─────────────────────────────────────────────────

class TestDcOptionsRouter:
    @pytest.mark.asyncio
    async def test_get_options(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_dc_firewall_options = AsyncMock(return_value={"enable": 1, "policy_in": "DROP", "ebtables": 0})
        with patch("backend.routers.firewall._dc_read_auth", AsyncMock(return_value=(mc, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/datacenter/options")
        _clear(app)
        data = resp.json()
        assert data["enable"] is True and data["policy_in"] == "DROP" and data["ebtables"] is False

    @pytest.mark.asyncio
    async def test_update_options_enable_rejected(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.update_dc_firewall_options = AsyncMock()
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put("/api/firewall/datacenter/options", json={"enable": True})
        _clear(app)
        assert resp.status_code == 422  # extra=forbid
        mc.update_dc_firewall_options.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_update_options_ok(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.update_dc_firewall_options = AsyncMock()
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put("/api/firewall/datacenter/options", json={"policy_in": "ACCEPT"})
        _clear(app)
        assert resp.status_code == 204
        assert mc.update_dc_firewall_options.call_args.args[1] == {"policy_in": "ACCEPT"}


# ── Security groups / IPSet / Alias collision pre-checks ──────────────────────────

class TestObjectEndpoints:
    @pytest.mark.asyncio
    async def test_create_sg_collision_409(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_firewall_groups = AsyncMock(return_value=[{"group": "web"}])
        mc.create_firewall_group = AsyncMock()
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/firewall/datacenter/groups", json={"group": "web"})
        _clear(app)
        assert resp.status_code == 409
        mc.create_firewall_group.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_create_sg_ok(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_firewall_groups = AsyncMock(return_value=[])
        mc.create_firewall_group = AsyncMock()
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/firewall/datacenter/groups", json={"group": "db"})
        _clear(app)
        assert resp.status_code == 201 and resp.json()["group"] == "db"

    @pytest.mark.asyncio
    async def test_create_ipset_collision_409(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_firewall_ipsets = AsyncMock(return_value=[{"name": "trusted"}])
        mc.create_firewall_ipset = AsyncMock()
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/firewall/datacenter/ipsets", json={"name": "trusted"})
        _clear(app)
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_delete_ipset_entry_with_slash_cidr(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.delete_firewall_ipset_entry = AsyncMock()
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/firewall/datacenter/ipsets/trusted/entries/10.0.0.0/24")
        _clear(app)
        assert resp.status_code == 204
        # the {cidr:path} converter captures the slash
        assert mc.delete_firewall_ipset_entry.call_args.args[2] == "10.0.0.0/24"

    @pytest.mark.asyncio
    async def test_create_alias_collision_409(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_firewall_aliases = AsyncMock(return_value=[{"name": "gw"}])
        mc.create_firewall_alias = AsyncMock()
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/firewall/datacenter/aliases", json={"name": "gw", "cidr": "10.0.0.1"})
        _clear(app)
        assert resp.status_code == 409


# ── Security: path-traversal guard on IPSet-entry delete (BUG-90-1) ───────────────

class TestIpSetEntryPathTraversal:
    @pytest.mark.asyncio
    async def test_dc_traversal_rejected_422(self):
        """A '../'-laden cidr must never reach Proxmox (would collapse to an
        arbitrary privileged DELETE like /access/users/victim@pam)."""
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.delete_firewall_ipset_entry = AsyncMock()
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                # percent-encoded dot-segments survive uvicorn decode + {cidr:path} capture
                resp = await ac.delete(
                    "/api/firewall/datacenter/ipsets/trusted/entries/..%2f..%2f..%2f..%2faccess%2fusers%2fvictim@pam"
                )
        _clear(app)
        assert resp.status_code == 422
        mc.delete_firewall_ipset_entry.assert_not_awaited()  # never reached the API

    @pytest.mark.asyncio
    async def test_dc_valid_cidr_still_deletes(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.delete_firewall_ipset_entry = AsyncMock()
        with (
            patch("backend.routers.firewall._dc_write_auth", AsyncMock(return_value=(mc, MagicMock()))),
            patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/firewall/datacenter/ipsets/trusted/entries/10.0.0.0/24")
        _clear(app)
        assert resp.status_code == 204
        assert mc.delete_firewall_ipset_entry.call_args.args[2] == "10.0.0.0/24"

    @pytest.mark.asyncio
    async def test_guest_traversal_rejected_422(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc, (p1, p2) = _patch_guest("qemu")
        mc.delete_guest_firewall_ipset_entry = AsyncMock()
        with p1, p2, patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete(
                    "/api/firewall/vms/101/ipsets/trusted/entries/..%2f..%2f..%2f..%2f..%2faccess%2fusers%2fvictim@pam"
                )
        _clear(app)
        assert resp.status_code == 422
        mc.delete_guest_firewall_ipset_entry.assert_not_awaited()


# ── Usage fan-out ────────────────────────────────────────────────────────────────

class TestUsageEndpoint:
    @pytest.mark.asyncio
    async def test_invalid_kind_422(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        with patch("backend.routers.firewall._dc_read_auth", AsyncMock(return_value=(AsyncMock(), MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/datacenter/usage/bogus/x")
        _clear(app)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_usage_group_match_across_levels(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_dc_firewall_rules = AsyncMock(return_value=[_GROUP_RULE])  # references group "web"
        mc.get_firewall_groups = AsyncMock(return_value=[{"group": "other"}])
        mc.get_firewall_group_rules = AsyncMock(return_value=[])
        mc.get_cluster_resources_v2 = AsyncMock(side_effect=lambda auth, t: (
            [{"node": "pve1", "status": "online"}] if t == "node"
            else [{"vmid": 101, "node": "pve1", "type": "qemu"}]
        ))
        mc.get_node_firewall_rules = AsyncMock(return_value=[])
        mc.get_guest_firewall_rules = AsyncMock(return_value=[_GROUP_RULE])  # guest also references "web"
        with patch("backend.routers.firewall._dc_read_auth", AsyncMock(return_value=(mc, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/datacenter/usage/group/web")
        _clear(app)
        data = resp.json()
        assert data["in_use"] is True
        levels = sorted(u["level"] for u in data["usages"])
        assert "datacenter" in levels and "guest" in levels
        assert data["incomplete"] is False

    @pytest.mark.asyncio
    async def test_usage_incomplete_on_guest_read_error(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_dc_firewall_rules = AsyncMock(return_value=[])
        mc.get_firewall_groups = AsyncMock(return_value=[])
        mc.get_cluster_resources_v2 = AsyncMock(side_effect=lambda auth, t: (
            [] if t == "node" else [{"vmid": 101, "node": "pve1", "type": "qemu"}]
        ))
        mc.get_guest_firewall_rules = AsyncMock(side_effect=Exception("denied"))
        with patch("backend.routers.firewall._dc_read_auth", AsyncMock(return_value=(mc, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/datacenter/usage/ipset/trusted")
        _clear(app)
        assert resp.json()["incomplete"] is True


# ── Node endpoints ───────────────────────────────────────────────────────────────

class TestNodeRouter:
    @pytest.mark.asyncio
    async def test_list_node_rules(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_node_firewall_rules = AsyncMock(return_value=[_RULE])
        with patch("backend.routers.firewall._node_read_auth", AsyncMock(return_value=(mc, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/nodes/pve1/rules")
        _clear(app)
        assert resp.status_code == 200 and len(resp.json()["rules"]) == 1

    @pytest.mark.asyncio
    async def test_node_options_global_enabled_flag(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_node_firewall_options = AsyncMock(return_value={"enable": 1, "log_level_in": "info"})
        mc.get_dc_firewall_options = AsyncMock(return_value={"enable": 1})
        with patch("backend.routers.firewall._node_read_auth", AsyncMock(return_value=(mc, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/nodes/pve1/options")
        _clear(app)
        data = resp.json()
        assert data["enable"] is True and data["global_firewall_enabled"] is True

    @pytest.mark.asyncio
    async def test_node_options_global_enabled_best_effort_none(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc = AsyncMock()
        mc.get_node_firewall_options = AsyncMock(return_value={"enable": 0})
        mc.get_dc_firewall_options = AsyncMock(side_effect=Exception("no audit"))
        with patch("backend.routers.firewall._node_read_auth", AsyncMock(return_value=(mc, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/nodes/pve1/options")
        _clear(app)
        assert resp.json()["global_firewall_enabled"] is None  # best-effort tolerated

    @pytest.mark.asyncio
    async def test_node_rules_viewer_403(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        # viewer has no manage_firewall and no node scope → gate denies before auth
        with (
            patch("backend.services.nodes_service.get_node_for_proxmox_name", AsyncMock(return_value=MagicMock(id=1))),
            patch("backend.services.permissions_resolver.resolve_node_action", AsyncMock(return_value=False)),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/nodes/pve1/rules")
        _clear(app)
        assert resp.status_code == 403


# ── VM/LXC endpoints (reuse _resolve_vm_access + _check_rbac from vms.py) ──────────

def _patch_guest(vm_type="qemu"):
    """Patch the vms.py helpers that _resolve_guest_fw imports."""
    mc = AsyncMock()
    return mc, (
        patch("backend.routers.vms._resolve_vm_access",
              AsyncMock(return_value=(mc, MagicMock(), "pve1", vm_type))),
        patch("backend.routers.vms._check_rbac", AsyncMock(return_value=None)),
    )


class TestVmRouter:
    @pytest.mark.asyncio
    async def test_list_guest_rules_qemu(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc, (p1, p2) = _patch_guest("qemu")
        mc.get_guest_firewall_rules = AsyncMock(return_value=[_RULE])
        with p1, p2:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/vms/101/rules")
        _clear(app)
        assert resp.status_code == 200 and len(resp.json()["rules"]) == 1
        # kind derived from vm_type
        assert mc.get_guest_firewall_rules.call_args.args[3] == "qemu"

    @pytest.mark.asyncio
    async def test_guest_rules_lxc_path(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc, (p1, p2) = _patch_guest("lxc")
        mc.get_guest_firewall_rules = AsyncMock(return_value=[])
        with p1, p2:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/vms/200/rules")
        _clear(app)
        assert resp.status_code == 200
        assert mc.get_guest_firewall_rules.call_args.args[3] == "lxc"

    @pytest.mark.asyncio
    async def test_guest_options_global_enabled(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc, (p1, p2) = _patch_guest("qemu")
        mc.get_guest_firewall_options = AsyncMock(return_value={"enable": 1, "dhcp": 1})
        mc.get_dc_firewall_options = AsyncMock(return_value={"enable": 0})
        with p1, p2:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/vms/101/options")
        _clear(app)
        data = resp.json()
        assert data["enable"] is True and data["dhcp"] is True and data["global_firewall_enabled"] is False

    @pytest.mark.asyncio
    async def test_create_guest_rule(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc, (p1, p2) = _patch_guest("qemu")
        mc.create_guest_firewall_rule = AsyncMock()
        with p1, p2, patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/firewall/vms/101/rules", json={"type": "in", "action": "ACCEPT", "dport": "80"})
        _clear(app)
        assert resp.status_code == 201
        assert mc.create_guest_firewall_rule.call_args.args[3] == "qemu"

    @pytest.mark.asyncio
    async def test_guest_rbac_denied(self):
        from fastapi import HTTPException, status as st
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        mc = AsyncMock()
        with (
            patch("backend.routers.vms._resolve_vm_access",
                  AsyncMock(return_value=(mc, MagicMock(), "pve1", "qemu"))),
            patch("backend.routers.vms._check_rbac",
                  AsyncMock(side_effect=HTTPException(status_code=st.HTTP_403_FORBIDDEN, detail="no"))),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/firewall/vms/101/rules")
        _clear(app)
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_guest_alias(self):
        from backend.main import app
        _override_user(app, _ADMIN_USER)
        mc, (p1, p2) = _patch_guest("lxc")
        mc.create_guest_firewall_alias = AsyncMock()
        with p1, p2, patch("backend.routers.firewall.write_audit_log", new_callable=AsyncMock):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/firewall/vms/200/aliases", json={"name": "gw", "cidr": "10.0.0.1"})
        _clear(app)
        assert resp.status_code == 201
        assert mc.create_guest_firewall_alias.call_args.args[3] == "lxc"
