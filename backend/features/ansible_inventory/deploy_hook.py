# p3portal.org
"""PROJ-83: Deploy-Onboarding-Hook (Core).

Geschwister zu PROJ-48 owners.deploy_hook.on_deploy_success. Wird nach erfolgreichem
Ansible-Deploy aufgerufen. Wenn der Opt-out-Haken „Für Ansible verwalten" gesetzt war
(jobs.ansible_manage) und mindestens ein Verwaltungs-Key existiert, wird der Host-Zustand
in ansible_managed_hosts aufgezeichnet (ssh_managed=true, ansible_user, global_opt_in).

Die eigentliche Schlüssel-Zustellung passiert während des Deploys über cloud-init
vendor-data (build_deploy_onboarding_extravars → injizierte Extravars). Hier wird nur
der Zustand persistiert (Intent), damit das dynamische Inventory den Host als managed führt.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import text

from backend.db.database import get_db
from backend.features.ansible_inventory import host_state, keys as _keys
from backend.features.owners.deploy_hook import _resolve_node_id, _resolve_vmid

logger = logging.getLogger(__name__)

DEPLOY_CATEGORIES = frozenset({"vm_deployment", "lxc_deployment"})


async def on_deploy_success_ansible(job_id: str) -> None:
    async with get_db() as db:
        row = (await db.execute(
            text(
                "SELECT ansible_manage, ansible_global_opt_in, deploy_category, "
                "auto_owner_user_id, params, username FROM jobs WHERE id = :id"
            ),
            {"id": job_id},
        )).mappings().fetchone()
    if row is None:
        return
    if not row["ansible_manage"]:
        return
    deploy_category = row["deploy_category"]
    if deploy_category not in DEPLOY_CATEGORIES:
        return

    try:
        params = json.loads(row["params"] or "{}")
    except (ValueError, TypeError):
        params = {}

    node_id = await _resolve_node_id(params)
    vmid = _resolve_vmid(params)
    if node_id is None or vmid is None:
        logger.info("PROJ-83: deploy onboarding skipped for job %s – node/vmid unresolved", job_id)
        return

    kind = "lxc" if deploy_category == "lxc_deployment" else "qemu"
    owner_user_id = row["auto_owner_user_id"]
    if owner_user_id is None:
        # ohne Owner kein User-Key zuordenbar → nicht managed
        return

    pool_id = params.get("pool_id") if isinstance(params, dict) else None
    global_opt_in = bool(row["ansible_global_opt_in"])

    keys = await _keys.get_injection_public_keys(owner_user_id, pool_id, global_opt_in)
    if not keys:
        logger.info("PROJ-83: deploy onboarding skipped for job %s – no injection keys", job_id)
        return

    await host_state.upsert_host_state(
        node_id, vmid, kind,
        ssh_managed=True,
        global_opt_in=global_opt_in,
    )
    logger.info(
        "PROJ-83: host recorded managed: node=%s vmid=%s kind=%s (job %s)",
        node_id, vmid, kind, job_id,
    )


async def build_deploy_onboarding_extravars(
    owner_user_id: int | None, pool_id: int | None, global_opt_in: bool
) -> dict:
    """Erzeugt die Onboarding-Extravars für das Deploy-Playbook (cloud-init vendor-data).

    Gibt {} zurück, wenn keine Keys vorhanden sind (→ kein Onboarding, Host bleibt unmanaged).
    Das Deploy-Playbook kann `p3_onboard_vendor_data` als vendor-data-Snippet ablegen +
    `cicustom: vendor=...` setzen (siehe docs/ansible-inventory.md). user-data bleibt
    unangetastet (AC-KEY-6).
    """
    if owner_user_id is None:
        return {}
    keys = await _keys.get_injection_public_keys(owner_user_id, pool_id, global_opt_in)
    if not keys:
        return {}
    from backend.features.ansible_inventory.onboarding import (
        render_cloud_init_vendor_data,
        render_onboarding_block,
    )
    return {
        "p3_onboard_vendor_data": render_cloud_init_vendor_data(keys),
        "p3_onboard_block": render_onboarding_block(keys),
    }
