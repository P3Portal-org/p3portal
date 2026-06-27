# p3portal.org
"""Code-Review-Fix: node-bewusste + unionierende check_permission().

Sperrt zwei Befunde fest:
- (A) Cross-Installation-Leak: ein node-scoped Assignment darf NICHT auf einer
  anderen Installation (kollidierende VMID) greifen.
- (B) Nicht-Union: mehrere Assignments für dieselbe Ressource müssen unioniert
  werden (vorher gewann nur die erste Zeile).
"""
from __future__ import annotations

import pytest
import pytest_asyncio

from backend.core.config import settings
from backend.db.database import init_db
from backend.services.local_auth import create_user, get_user_by_username
from backend.services.nodes_service import create_node
from backend.services.rbac_service import (
    check_permission,
    create_assignment,
    create_preset,
)


async def _make_node(name: str) -> int:
    row = await create_node(
        name=name,
        url=f"https://{name}.example.com:8006",
        proxmox_node=name,
        verify_ssl=False,
        token_id="root@pam!t",
        token_secret="x",
    )
    return row.id


@pytest.fixture(autouse=True)
def _patch_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture(autouse=True)
async def _db(_patch_data_dir):
    await init_db()


async def _seed():
    await create_user("rbac_ns_user", "SecurePass1234", "viewer")
    user = await get_user_by_username("rbac_ns_user")
    node_a = await _make_node("inst-a")
    node_b = await _make_node("inst-b")
    view_only = await create_preset("NS View", "", ["view"], created_by="admin")
    stopper = await create_preset("NS Stop", "", ["view", "stop"], created_by="admin")
    # VM 100 auf Installation A = nur view, auf Installation B = view+stop
    await create_assignment(user["id"], "vm", 100, view_only.id, "admin", portal_node_id=node_a)
    await create_assignment(user["id"], "vm", 100, stopper.id, "admin", portal_node_id=node_b)
    return user["id"], node_a, node_b


@pytest.mark.asyncio
async def test_node_scoped_assignment_does_not_leak_across_installations():
    uid, node_a, node_b = await _seed()
    # stop ist nur auf Installation B erlaubt
    assert await check_permission(uid, 100, "vm", "stop", portal_node_id=node_b) is True
    # ... und NICHT auf Installation A (view-only) – der Cross-Installation-Leak
    assert await check_permission(uid, 100, "vm", "stop", portal_node_id=node_a) is False
    # view ist auf Installation A erlaubt
    assert await check_permission(uid, 100, "vm", "view", portal_node_id=node_a) is True
    # eine dritte, nicht zugewiesene Installation → nichts erlaubt
    assert await check_permission(uid, 100, "vm", "view", portal_node_id=9999) is False


@pytest.mark.asyncio
async def test_unions_across_multiple_assignments_when_node_unknown():
    uid, _node_a, _node_b = await _seed()
    # Ohne Node-Kontext (None) wird über ALLE Zeilen unioniert (rückwärtskompatibel):
    # view kommt aus beiden, stop aus der zweiten Zuweisung.
    assert await check_permission(uid, 100, "vm", "view", portal_node_id=None) is True
    assert await check_permission(uid, 100, "vm", "stop", portal_node_id=None) is True
    # delete ist in keinem Preset → bleibt verweigert
    assert await check_permission(uid, 100, "vm", "delete", portal_node_id=None) is False


@pytest.mark.asyncio
async def test_owner_path_grants_actions_without_direct_assignment():
    """Befund 1C: ein viewer OHNE Direkt-Assignment, aber als Owner einer VM,
    bekommt über resolve_user_permissions die OWNER_ACTIONS (start/stop/... aber
    KEIN delete). Vorher war der Owner-Pfad nicht verdrahtet → keine Rechte."""
    from datetime import datetime, timezone

    from sqlalchemy import text

    from backend.db.database import get_db

    await create_user("rbac_owner_viewer", "SecurePass1234", "viewer")
    user = await get_user_by_username("rbac_owner_viewer")
    node = await _make_node("inst-owner")
    async with get_db() as db:
        await db.execute(
            text("""
                INSERT INTO vm_owners (resource_type, node_id, vmid, user_id, assigned_at, source)
                VALUES ('vm', :nid, 300, :uid, :ts, 'adopt')
            """),
            {"nid": node, "uid": user["id"], "ts": datetime.now(timezone.utc).isoformat()},
        )
        await db.commit()

    from backend.services.permissions_resolver import resolve_user_permissions

    allowed = await resolve_user_permissions(user["id"], node, 300, "vm")
    assert "view" in allowed and "start" in allowed and "snapshot" in allowed
    assert "delete" not in allowed  # OWNER_ACTIONS schließt delete bewusst aus
    # eine VM, die dem User NICHT gehört → keine Rechte
    assert await resolve_user_permissions(user["id"], node, 999, "vm") == set()


@pytest.mark.asyncio
async def test_null_node_assignment_applies_to_any_installation():
    await create_user("rbac_ns_legacy", "SecurePass1234", "viewer")
    user = await get_user_by_username("rbac_ns_legacy")
    node = await _make_node("inst-legacy")
    preset = await create_preset("NS Legacy", "", ["view", "reboot"], created_by="admin")
    # Legacy: portal_node_id=NULL → gilt überall
    await create_assignment(user["id"], "vm", 200, preset.id, "admin", portal_node_id=None)
    assert await check_permission(user["id"], 200, "vm", "reboot", portal_node_id=node) is True
    assert await check_permission(user["id"], 200, "vm", "reboot", portal_node_id=9999) is True
    assert await check_permission(user["id"], 200, "vm", "reboot", portal_node_id=None) is True
