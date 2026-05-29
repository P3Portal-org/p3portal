# p3portal.org
"""PROJ-73: In-Memory asyncio.Lock-Map pro (portal_node_id, proxmox_node_name).

Single-Container-Realität: kein DB-Lock nötig (AC-E-E → Tech-Design §E).
Lock wird beim ersten Zugriff angelegt und danach nicht mehr entfernt.
"""
from __future__ import annotations

import asyncio

_REFRESH_LOCKS: dict[tuple[int, str], asyncio.Lock] = {}
_MAP_LOCK = asyncio.Lock()


async def get_refresh_lock(portal_node_id: int, proxmox_node_name: str) -> asyncio.Lock:
    """Return (create-if-needed) the per-member refresh lock."""
    key = (portal_node_id, proxmox_node_name)
    async with _MAP_LOCK:
        return _REFRESH_LOCKS.setdefault(key, asyncio.Lock())
