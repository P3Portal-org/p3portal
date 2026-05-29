# p3portal.org
"""PROJ-73: Tests für service.py (unit-level, no external I/O)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.features.node_updates.service import (
    _all_members,
    _empty_member_state,
    _is_stale,
    _row_to_member_state,
)


class TestIsStale:
    def test_none_is_stale(self):
        assert _is_stale(None) is True

    def test_empty_string_is_stale(self):
        assert _is_stale("") is True

    def test_recent_not_stale(self):
        recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        assert _is_stale(recent) is False

    def test_exactly_48h_boundary_is_stale(self):
        old = (datetime.now(timezone.utc) - timedelta(hours=49)).isoformat()
        assert _is_stale(old) is True

    def test_24h_ago_not_stale(self):
        ts = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        assert _is_stale(ts) is False

    def test_invalid_timestamp_is_stale(self):
        assert _is_stale("not-a-date") is True

    def test_naive_datetime_treated_as_utc(self):
        # Naive ISO string → treated as UTC
        recent_naive = (datetime.utcnow() - timedelta(hours=1)).isoformat()
        assert _is_stale(recent_naive) is False


class TestAllMembers:
    def _make_node(self, proxmox_node=None, cluster_nodes=None):
        node = MagicMock()
        node.proxmox_node = proxmox_node
        node.cluster_nodes = cluster_nodes or []
        return node

    def test_single_node(self):
        node = self._make_node(proxmox_node="pve1")
        assert _all_members(node) == ["pve1"]

    def test_cluster_nodes_appended(self):
        node = self._make_node(proxmox_node="pve1", cluster_nodes=["pve2", "pve3"])
        assert _all_members(node) == ["pve1", "pve2", "pve3"]

    def test_no_duplicates(self):
        node = self._make_node(proxmox_node="pve1", cluster_nodes=["pve1", "pve2"])
        result = _all_members(node)
        assert result.count("pve1") == 1
        assert "pve2" in result

    def test_no_proxmox_node(self):
        node = self._make_node(proxmox_node=None, cluster_nodes=["pve2"])
        assert _all_members(node) == ["pve2"]

    def test_empty_cluster_node_skipped(self):
        node = self._make_node(proxmox_node="pve1", cluster_nodes=["", "pve2"])
        assert "" not in _all_members(node)
        assert "pve2" in _all_members(node)


class TestRowToMemberState:
    def _base_row(self, **overrides):
        row = {
            "portal_node_id": 1,
            "proxmox_node_name": "pve1",
            "last_check_at": "2026-01-01T00:00:00+00:00",
            "last_success_at": "2026-01-01T00:00:00+00:00",
            "last_error": None,
            "payload_json": "[]",
        }
        row.update(overrides)
        return row

    def test_empty_payload(self):
        state = _row_to_member_state(self._base_row())
        assert state.package_count == 0
        assert state.security_count == 0
        assert state.packages == []

    def test_package_parsed(self):
        payload = '[{"name":"openssl","version_old":"1.0","version_new":"1.1","is_security":true}]'
        state = _row_to_member_state(self._base_row(payload_json=payload))
        assert state.package_count == 1
        assert state.security_count == 1
        assert state.packages[0].name == "openssl"

    def test_mixed_security_count(self):
        payload = (
            '[{"name":"openssl","version_old":"1.0","version_new":"1.1","is_security":true},'
            '{"name":"curl","version_old":"7.0","version_new":"7.1","is_security":false}]'
        )
        state = _row_to_member_state(self._base_row(payload_json=payload))
        assert state.package_count == 2
        assert state.security_count == 1

    def test_invalid_json_yields_empty(self):
        state = _row_to_member_state(self._base_row(payload_json="not-json"))
        assert state.packages == []

    def test_is_stale_forwarded(self):
        old_ts = (datetime.now(timezone.utc) - timedelta(hours=60)).isoformat()
        state = _row_to_member_state(self._base_row(last_success_at=old_ts))
        assert state.is_stale is True


class TestEmptyMemberState:
    def test_defaults(self):
        state = _empty_member_state(1, "pve1", None, None)
        assert state.portal_node_id == 1
        assert state.proxmox_node_name == "pve1"
        assert state.package_count == 0
        assert state.security_count == 0
        assert state.is_stale is True
        assert state.packages == []
