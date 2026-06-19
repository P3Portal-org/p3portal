# p3portal.org
"""PROJ-97: Verifiziert die Scope-Verdrahtung an der ECHTEN App.

Importiert backend.main, baut die Inventur und prüft pro Domäne, dass
repräsentative Endpoints den richtigen Scope tragen (Marker-Wert im Dependency-Baum).
Erfasst AC-ENF-1..4 ohne Proxmox/DB-Mocks (reine Routen-Introspektion).

Lauf: SECRET_KEY=<key> pytest features/api_surface/test_scope_wiring.py
"""
from __future__ import annotations

import pytest

from backend.features.api_surface.deps import UPK_SCOPE_MARKER_ATTR


def _scopes_of_route(route) -> set[str]:
    """Sammelt alle Scope-Marker im Dependency-Baum einer Route."""
    found: set[str] = set()

    def walk(dep):
        call = getattr(dep, "call", None)
        marker = getattr(call, UPK_SCOPE_MARKER_ATTR, None) if call is not None else None
        if marker:
            found.add(marker)
        for sub in getattr(dep, "dependencies", None) or []:
            walk(sub)

    dependant = getattr(route, "dependant", None)
    if dependant is not None:
        walk(dependant)
    return found


@pytest.fixture(scope="module")
def route_scopes():
    """(method, path) → set[scope] für alle APIRoutes der echten App."""
    import backend.main as m
    from fastapi.routing import APIRoute

    mapping: dict[tuple[str, str], set[str]] = {}
    for route in m.app.routes:
        if not isinstance(route, APIRoute):
            continue
        scopes = _scopes_of_route(route)
        for method in route.methods or set():
            mapping[(method, route.path)] = scopes
    return mapping


# (method, path) → erwarteter Scope. Repräsentativ pro Domäne.
_EXPECTED = {
    # PROJ-78 backup-jobs
    ("GET", "/api/backup-jobs"): "backup_jobs:read",
    ("POST", "/api/backup-jobs"): "backup_jobs:write",
    ("POST", "/api/backup-jobs/{job_id}/run"): "backup_jobs:write",
    # PROJ-79 networks
    ("GET", "/api/networks"): "networks:read",
    ("POST", "/api/networks"): "networks:write",
    ("POST", "/api/networks/reload"): "networks:write",
    # PROJ-80 sdn
    ("GET", "/api/sdn/zones"): "sdn:read",
    ("POST", "/api/sdn/zones"): "sdn:write",
    ("POST", "/api/sdn/apply"): "sdn:write",
    # PROJ-90 firewall (alle 3 Ebenen unter einem Domänen-Scope, AC-ENF-4)
    ("GET", "/api/firewall/datacenter/rules"): "firewall:read",
    ("POST", "/api/firewall/datacenter/rules"): "firewall:write",
    ("GET", "/api/firewall/nodes/{node}/rules"): "firewall:read",
    ("POST", "/api/firewall/vms/{vmid}/rules"): "firewall:write",
    ("DELETE", "/api/firewall/datacenter/ipsets/{name}/entries/{cidr:path}"): "firewall:write",
    # PROJ-10/63/81 vms (Mutationen → vms:write, AC-ENF-2)
    ("POST", "/api/vms/{vmid}/start"): "vms:write",
    ("POST", "/api/vms/{vmid}/stop"): "vms:write",
    ("PATCH", "/api/vms/{vmid}/config"): "vms:write",
    ("POST", "/api/vms/{vmid}/snapshots"): "vms:write",
    ("POST", "/api/vms/{vmid}/disks"): "vms:write",
    ("DELETE", "/api/vms/{vmid}"): "vms:write",
    # vms-Reads bleiben cluster:read (AC-ENF-2)
    ("GET", "/api/vms/{node}/{vmid}/ip"): "cluster:read",
    ("GET", "/api/vms/{vmid}/snapshots"): "cluster:read",
    ("GET", "/api/nodes/{node}/image-storages"): "cluster:read",
    # PROJ-83/84 ansible-inventory (Core + Plus)
    ("GET", "/api/ansible-inventory/hosts"): "ansible_inventory:read",
    ("POST", "/api/ansible-inventory/hosts/{portal_node_id}/{kind}/{vmid}/mark-managed"): "ansible_inventory:write",
    ("POST", "/api/ansible-inventory/keys/global/rotate"): "ansible_inventory:write",
    ("GET", "/api/ansible-inventory/discovery"): "ansible_inventory:read",
    ("POST", "/api/ansible-inventory/onboard"): "ansible_inventory:write",
    # PROJ-92 packer-editor (Plus)
    ("GET", "/api/packer-editor/definitions"): "packer_editor:read",
    ("POST", "/api/packer-editor/definitions"): "packer_editor:write",
    ("POST", "/api/packer-editor/validate"): "packer_editor:write",
    # PROJ-93 ansible-editor (Plus)
    ("GET", "/api/ansible-editor/definitions"): "ansible_editor:read",
    ("POST", "/api/ansible-editor/definitions"): "ansible_editor:write",
    ("GET", "/api/ansible-editor/modules"): "ansible_editor:read",
}


@pytest.mark.parametrize("key,expected", list(_EXPECTED.items()))
def test_endpoint_carries_expected_scope(route_scopes, key, expected):
    scopes = route_scopes.get(key)
    assert scopes is not None, f"Route {key} nicht gefunden"
    assert expected in scopes, f"Route {key}: erwartet {expected!r}, gefunden {scopes!r}"


def test_existing_scopes_unchanged(route_scopes):
    """AC-COMPAT-1: Bestandsendpoints behalten ihre Scopes."""
    assert "cluster:read" in route_scopes.get(("GET", "/api/cluster/nodes"), set())
    assert "jobs:write" in route_scopes.get(("POST", "/api/jobs"), set())
    assert "jobs:read" in route_scopes.get(("GET", "/api/jobs"), set())
