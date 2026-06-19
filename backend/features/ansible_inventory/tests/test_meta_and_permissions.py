# p3portal.org
"""PROJ-83: PlaybookMeta-Flags + RBAC-Gating (assert_guest_run_allowed)."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from backend.core.deps import CurrentUser
from backend.features.ansible_inventory import permissions as perm
from backend.models.playbooks import PlaybookMeta


def _meta(**kw):
    base = dict(name="x", description="d", playbook="x")
    base.update(kw)
    return PlaybookMeta(**base)


def test_meta_defaults_localhost_no_become():
    m = _meta()
    assert m.targets == "localhost"
    assert m.become is False


def test_meta_guest_become():
    m = _meta(targets="guest", become=True)
    assert m.targets == "guest"
    assert m.become is True


def _user(role="operator", user_id=5, perms=None):
    return CurrentUser(
        username="u", auth_type="local", role=role, user_id=user_id,
        portal_permissions=perms or [],
    )


@pytest.mark.asyncio
async def test_user_scope_requires_local_user():
    with pytest.raises(HTTPException) as ei:
        await perm.assert_guest_run_allowed(_user(user_id=None), "user", None, None)
    assert ei.value.status_code == 403


@pytest.mark.asyncio
async def test_user_scope_ok_no_targets():
    # ganzer Scope → keine Target-Validierung nötig
    await perm.assert_guest_run_allowed(_user(), "user", None, None)


@pytest.mark.asyncio
async def test_user_scope_target_outside_scope_403():
    with patch.object(perm, "user_candidate_refs", new=AsyncMock(return_value={"1:101:qemu"})):
        with pytest.raises(HTTPException) as ei:
            await perm.assert_guest_run_allowed(_user(), "user", None, ["1:999:qemu"])
        assert ei.value.status_code == 403


@pytest.mark.asyncio
async def test_user_scope_target_inside_scope_ok():
    with patch.object(perm, "user_candidate_refs", new=AsyncMock(return_value={"1:101:qemu"})):
        await perm.assert_guest_run_allowed(_user(), "user", None, ["1:101:qemu"])


@pytest.mark.asyncio
async def test_pool_global_404_in_core():
    # Core: can_use_ansible_inventory() False → 404
    with patch.object(perm.plus_behavior, "can_use_ansible_inventory", return_value=False):
        for scope in ("pool", "global"):
            with pytest.raises(HTTPException) as ei:
                await perm.assert_guest_run_allowed(_user(), scope, 1, None)
            assert ei.value.status_code == 404


@pytest.mark.asyncio
async def test_global_scope_admin_only():
    with patch.object(perm.plus_behavior, "can_use_ansible_inventory", return_value=True):
        with pytest.raises(HTTPException) as ei:
            await perm.assert_guest_run_allowed(_user(role="operator"), "global", None, None)
        assert ei.value.status_code == 403
        # admin ok
        await perm.assert_guest_run_allowed(_user(role="admin"), "global", None, None)


@pytest.mark.asyncio
async def test_pool_scope_plus_passes_to_mediator():
    with patch.object(perm.plus_behavior, "can_use_ansible_inventory", return_value=True):
        # Mitgliedschaft setzt der Mediator durch → kein 403 hier
        await perm.assert_guest_run_allowed(_user(), "pool", 7, None)


def test_has_manage_inventory():
    assert perm.has_manage_inventory(_user(role="admin"))
    assert perm.has_manage_inventory(_user(role="operator", perms=["manage_ansible_inventory"]))
    assert not perm.has_manage_inventory(_user(role="operator"))
