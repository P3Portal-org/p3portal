# p3portal.org
"""PROJ-83: Dynamischer Inventory-Generator (Core).

Projiziert das Inventory zur Laufzeit aus Proxmox (SoT) + minimalem persistierten
Host-Zustand. Kein materialisiertes Inventory → strukturell keine Leichen.

Scopes:
  - user (Core):  VMs/LXC mit Owner = aktueller Nutzer (PROJ-48 vm_owners).
  - pool/global (Plus): via Mediator-Hook resolve_guest_scope (Core → None → 404 vorher).

Gruppen:
  - managed   : ssh_managed && IP vorhanden  → einzig ausführbar
  - unmanaged : !ssh_managed
  - no_ip     : ssh_managed && keine IP
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from sqlalchemy import text

from backend.db.database import get_db
from backend.features.ansible_inventory import host_state
from backend.features.ansible_inventory import keys as _keys

logger = logging.getLogger(__name__)

# Fehlercodes (klartext im Router/Runner)
ERR_NO_KEY = "no_scope_key"          # Scope hat keinen Private Key (z.B. User ohne PROJ-14-Key)
ERR_EMPTY_SCOPE = "empty_scope"      # keine Kandidaten im Scope
ERR_NO_TARGETS = "no_managed_targets"  # kein managed Host im (gewählten) Ziel-Set


def host_ref(portal_node_id: int, vmid: int, kind: str) -> str:
    """Kanonische, eindeutige Host-Kennung (Multi-Node-sicher)."""
    return f"{portal_node_id}:{vmid}:{kind}"


def _ansible_name(proxmox_node: str, vmid: int) -> str:
    safe_node = "".join(c if (c.isalnum() or c in "-_.") else "_" for c in (proxmox_node or "node"))
    return f"vmid{vmid}-{safe_node}"


@dataclass
class HostEntry:
    host_ref: str
    portal_node_id: int
    proxmox_node: str | None
    vmid: int
    kind: str
    group: str            # managed | unmanaged | no_ip
    ip: str | None
    ansible_user: str


@dataclass
class InventoryResult:
    scope: str
    scope_ref: int | None
    entries: list[HostEntry] = field(default_factory=list)
    private_key: str | None = None
    error: str | None = None
    # Laufzeit (nur managed ∩ ausgewählte Ziele):
    inventory_dict: dict = field(default_factory=dict)
    targets: list[dict] = field(default_factory=list)  # {ansible_host, portal_node_id, vmid, kind, host_key}
    host_keys: dict = field(default_factory=dict)        # {ip: host_key}


# ── Kandidaten-Ermittlung ────────────────────────────────────────────────────

async def _user_scope_candidates(user_id: int) -> list[tuple[int, int, str]]:
    """User-Scope: (portal_node_id, vmid, kind) aus vm_owners (PROJ-48)."""
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT node_id, vmid, resource_type FROM vm_owners "
                "WHERE user_id = :uid AND deleted_at IS NULL"
            ),
            {"uid": user_id},
        )
        rows = result.mappings().fetchall()
    out: list[tuple[int, int, str]] = []
    for r in rows:
        if r["node_id"] is None or r["vmid"] is None:
            continue
        kind = "lxc" if r["resource_type"] == "lxc" else "qemu"
        out.append((int(r["node_id"]), int(r["vmid"]), kind))
    return out


# ── Live-Auflösung pro Portal-Node ──────────────────────────────────────────

async def _resolve_node_live(
    portal_node_id: int, candidates: list[tuple[int, str]]
) -> tuple[dict, dict]:
    """Für einen Portal-Node: Live-Daten (proxmox_node + type) + IPs der managed Hosts.

    candidates = [(vmid, kind), ...]. Gibt zurück:
      live_map: {vmid: {"proxmox_node": str, "type": str}}
      states:   {(vmid, kind): host_state_dict}
    IP-Auflösung erfolgt separat in build_inventory (nur für managed).
    """
    from backend.services.nodes_service import get_node
    from backend.services.service_accounts import _extract_token
    from backend.services.proxmox import ProxmoxAuth, ProxmoxClient

    states = await host_state.bulk_get_host_states(portal_node_id, candidates)

    node = await get_node(portal_node_id)
    if node is None:
        return {}, states
    token = _extract_token(node, "viewer")
    if token is None:
        return {}, states

    client = ProxmoxClient(base_url=node.url, verify_ssl=node.verify_ssl)
    auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    live_map: dict[int, dict] = {}
    try:
        resources = await client.get_cluster_resources_v2(auth, "vm")
        for r in resources:
            vmid = r.get("vmid")
            if vmid is None:
                continue
            live_map[int(vmid)] = {
                "proxmox_node": r.get("node", ""),
                "type": r.get("type", "qemu"),
            }
    except Exception as exc:
        logger.warning("PROJ-83: cluster resources lookup failed for node %s: %s", portal_node_id, exc)
    return live_map, states


async def _fetch_host_ip(node, proxmox_node: str, vmid: int, vm_type: str) -> str | None:
    """Live-IP eines Hosts über den per-Node Viewer-Token (PROJ-26-Muster)."""
    if node is None:
        return None
    from backend.services.service_accounts import _extract_token
    from backend.services.proxmox import ProxmoxAuth, ProxmoxClient

    token = _extract_token(node, "viewer")
    if token is None:
        return None
    client = ProxmoxClient(base_url=node.url, verify_ssl=node.verify_ssl)
    auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    try:
        return await client.get_vm_ip(auth, proxmox_node, vmid, vm_type)
    except Exception:
        return None


# ── Hauptgenerator ───────────────────────────────────────────────────────────

async def build_inventory(
    scope: str,
    scope_ref: int | None,
    user_id: int,
    target_hosts: list[str] | None = None,
) -> InventoryResult:
    """Erzeugt das Inventory-Ergebnis für einen Scope.

    target_hosts: optionale Teilmenge der host_refs; None/leer = ganzer Scope.
    """
    result = InventoryResult(scope=scope, scope_ref=scope_ref)

    # 1. Kandidaten + Scope-Private-Key auflösen
    if scope == "user":
        candidates = await _user_scope_candidates(user_id)
        result.private_key = await _keys.get_user_private_key(user_id)
        if result.private_key is None:
            result.error = ERR_NO_KEY
    else:
        # Pool/Global via Plus-Mediator
        from backend.core.plus_protocol import plus_behavior
        guest_scope = await plus_behavior.resolve_guest_scope(scope, scope_ref, user_id)
        if guest_scope is None:
            result.error = ERR_EMPTY_SCOPE
            return result
        candidates = [
            (int(n), int(v), str(k)) for (n, v, k) in guest_scope.candidate_hosts
        ]
        result.private_key = guest_scope.private_key
        if not result.private_key:
            result.error = ERR_NO_KEY

    if result.error == ERR_NO_KEY:
        return result
    if not candidates:
        if result.error is None:
            result.error = ERR_EMPTY_SCOPE
        return result

    # 2. Pro Portal-Node gruppieren und live auflösen
    by_node: dict[int, list[tuple[int, str]]] = {}
    for (nid, vmid, kind) in candidates:
        by_node.setdefault(nid, []).append((vmid, kind))

    from backend.services.nodes_service import get_node

    selected = set(target_hosts) if target_hosts else None

    for nid, vmkinds in by_node.items():
        live_map, states = await _resolve_node_live(nid, vmkinds)
        node = await get_node(nid)

        # IPs für managed Hosts parallel ermitteln
        managed_ip_tasks: dict[tuple[int, str], asyncio.Task] = {}
        sem = asyncio.Semaphore(10)

        async def _fetch_ip(vmid: int, vm_type: str, proxmox_node: str):
            async with sem:
                return await _fetch_host_ip(node, proxmox_node, vmid, vm_type)

        for (vmid, kind) in vmkinds:
            st = states.get((vmid, kind))
            managed = bool(st and st["ssh_managed"])
            if managed:
                live = live_map.get(vmid, {})
                vm_type = live.get("type", "qemu")
                proxmox_node = live.get("proxmox_node", "")
                managed_ip_tasks[(vmid, kind)] = asyncio.ensure_future(
                    _fetch_ip(vmid, vm_type, proxmox_node)
                )

        ip_results: dict[tuple[int, str], str | None] = {}
        if managed_ip_tasks:
            done = await asyncio.gather(*managed_ip_tasks.values(), return_exceptions=True)
            for key, res in zip(managed_ip_tasks.keys(), done):
                ip_results[key] = res if isinstance(res, str) else None

        for (vmid, kind) in vmkinds:
            st = states.get((vmid, kind))
            live = live_map.get(vmid, {})
            proxmox_node = live.get("proxmox_node") or None
            ansible_user = (st["ansible_user"] if st else host_state.DEFAULT_ANSIBLE_USER)
            managed = bool(st and st["ssh_managed"])
            ip = ip_results.get((vmid, kind)) if managed else None

            if not managed:
                group = "unmanaged"
            elif ip:
                group = "managed"
            else:
                group = "no_ip"

            ref = host_ref(nid, vmid, kind)
            entry = HostEntry(
                host_ref=ref,
                portal_node_id=nid,
                proxmox_node=proxmox_node,
                vmid=vmid,
                kind=kind,
                group=group,
                ip=ip,
                ansible_user=ansible_user,
            )
            result.entries.append(entry)

            # Laufzeit-Inventory: nur managed ∩ ausgewählte Ziele
            if group == "managed" and (selected is None or ref in selected):
                name = _ansible_name(proxmox_node or "node", vmid)
                result.inventory_dict.setdefault("managed", {}).setdefault("hosts", {})[name] = {
                    "ansible_host": ip,
                    "ansible_user": ansible_user,
                }
                hk = st["host_key"] if st else None
                result.targets.append({
                    "name": name,
                    "ansible_host": ip,
                    "portal_node_id": nid,
                    "vmid": vmid,
                    "kind": kind,
                    "host_key": hk,
                })
                if hk and ip:
                    result.host_keys[ip] = hk

    if not result.targets and result.error is None:
        result.error = ERR_NO_TARGETS

    return result


# ── PROJ-84: node-/installations-weite Discovery + Run-Scope-Berechnung ───────

ERR_NODE_UNKNOWN = "node_unknown"
ERR_NODE_UNREACHABLE = "node_unreachable"


async def _node_run_scope_sets(
    portal_node_id: int,
) -> tuple[set[tuple[int, str]], set[tuple[int, str]]]:
    """Bulk-Lookup für AC-RUN-2: (owned, pooled) als Mengen von (vmid, kind) auf einem Node.

    owned   = vm_owners (PROJ-48, Core, immer vorhanden).
    pooled  = pool_members (PROJ-46, Plus; defensiv – fehlt die Tabelle in Pure Core → leer).
    `resource_type` 'vm'→'qemu', 'lxc'→'lxc'.
    """
    owned: set[tuple[int, str]] = set()
    pooled: set[tuple[int, str]] = set()

    def _kind(rt) -> str:
        return "lxc" if rt == "lxc" else "qemu"

    async with get_db() as db:
        rows = (await db.execute(
            text(
                "SELECT vmid, resource_type FROM vm_owners "
                "WHERE node_id = :nid AND deleted_at IS NULL"
            ),
            {"nid": portal_node_id},
        )).mappings().fetchall()
        for r in rows:
            if r["vmid"] is not None:
                owned.add((int(r["vmid"]), _kind(r["resource_type"])))
        try:
            prows = (await db.execute(
                text("SELECT vmid, resource_type FROM pool_members WHERE node_id = :nid"),
                {"nid": portal_node_id},
            )).mappings().fetchall()
            for r in prows:
                if r["vmid"] is not None:
                    pooled.add((int(r["vmid"]), _kind(r["resource_type"])))
        except Exception:
            pass  # pool_members existiert nur in Plus
    return owned, pooled


async def build_discovery(portal_node_id: int) -> dict:
    """PROJ-84: Listet ALLE QEMU+LXC einer Installation mit Managed-Status, ownership-unabhängig.

    Quelle: get_cluster_resources_v2('vm') (Viewer-Token, PROJ-26) + Join ansible_managed_hosts.
    IP wird **nur für managed** Hosts ermittelt (bounded Fan-out, Semaphore 10). Pro Host wird
    `in_run_scope` berechnet (Owner ∨ Pool ∨ global_opt_in) für AC-RUN-2.

    Rückgabe: {portal_node_id, error?, hosts: [...]}.
    """
    from backend.services.nodes_service import get_node
    from backend.services.service_accounts import _extract_token
    from backend.services.proxmox import ProxmoxAuth, ProxmoxClient

    node = await get_node(portal_node_id)
    if node is None:
        return {"portal_node_id": portal_node_id, "error": ERR_NODE_UNKNOWN, "hosts": []}
    token = _extract_token(node, "viewer")
    if token is None:
        return {"portal_node_id": portal_node_id, "error": ERR_NODE_UNREACHABLE, "hosts": []}

    client = ProxmoxClient(base_url=node.url, verify_ssl=node.verify_ssl)
    auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    try:
        resources = await client.get_cluster_resources_v2(auth, "vm")
    except Exception as exc:
        logger.warning("PROJ-84: discovery cluster lookup failed for node %s: %s", portal_node_id, exc)
        return {"portal_node_id": portal_node_id, "error": ERR_NODE_UNREACHABLE, "hosts": []}

    guests: list[dict] = []
    for r in resources:
        vmid = r.get("vmid")
        if vmid is None:
            continue
        kind = "lxc" if r.get("type") == "lxc" else "qemu"
        guests.append({
            "vmid": int(vmid),
            "kind": kind,
            "proxmox_node": r.get("node", "") or None,
            "name": r.get("name") or "",
            "status": r.get("status") or "",
        })

    candidates = [(g["vmid"], g["kind"]) for g in guests]
    states = await host_state.bulk_get_host_states(portal_node_id, candidates)
    owned, pooled = await _node_run_scope_sets(portal_node_id)

    # IP nur für managed Hosts (bounded Fan-out)
    sem = asyncio.Semaphore(10)

    async def _ip(vmid: int, kind: str, proxmox_node: str | None):
        async with sem:
            return await _fetch_host_ip(node, proxmox_node or "", vmid, "lxc" if kind == "lxc" else "qemu")

    ip_tasks: dict[tuple[int, str], asyncio.Task] = {}
    for g in guests:
        key = (g["vmid"], g["kind"])
        st = states.get(key)
        if st and st["ssh_managed"]:
            ip_tasks[key] = asyncio.ensure_future(_ip(g["vmid"], g["kind"], g["proxmox_node"]))
    ip_map: dict[tuple[int, str], str | None] = {}
    if ip_tasks:
        done = await asyncio.gather(*ip_tasks.values(), return_exceptions=True)
        for key, res in zip(ip_tasks.keys(), done):
            ip_map[key] = res if isinstance(res, str) else None

    hosts: list[dict] = []
    for g in guests:
        key = (g["vmid"], g["kind"])
        st = states.get(key)
        managed = bool(st and st["ssh_managed"])
        global_opt_in = bool(st and st["global_opt_in"])
        in_run_scope = (key in owned) or (key in pooled) or global_opt_in
        hosts.append({
            "host_ref": host_ref(portal_node_id, g["vmid"], g["kind"]),
            "portal_node_id": portal_node_id,
            "proxmox_node": g["proxmox_node"],
            "vmid": g["vmid"],
            "kind": g["kind"],
            "name": g["name"],
            "status": g["status"],
            "managed": managed,
            "in_run_scope": in_run_scope,
            "ip": ip_map.get(key) if managed else None,
        })
    hosts.sort(key=lambda h: (not h["managed"], h["vmid"]))
    return {"portal_node_id": portal_node_id, "error": None, "hosts": hosts}
