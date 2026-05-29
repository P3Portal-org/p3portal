# p3portal.org
"""PROJ-73: Node-Update-Cron – Daily asyncio background loop."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from croniter import croniter

from backend.features.node_updates.service import _all_members, refresh_member
from backend.services.config_service import get_config
from backend.services.nodes_service import list_nodes

logger = logging.getLogger(__name__)

_STARTUP_DELAY = 60  # seconds to wait after app startup before first schedule evaluation


async def start_node_updates_cron() -> None:
    """Fire-and-forget daily APT refresh loop.

    Waits _STARTUP_DELAY seconds so the app fully initialises, then evaluates
    portal_config key 'update_check_cron' (default '30 3 * * *') to calculate
    the next scheduled run. Members are processed serially with a 2 s gap.
    Errors per member are caught and logged; daily success is silent (no audit).
    """
    await asyncio.sleep(_STARTUP_DELAY)
    while True:
        try:
            cron_expr = await get_config("update_check_cron") or "30 3 * * *"
            now = datetime.now()
            it = croniter(cron_expr, now)
            next_run: datetime = it.get_next(datetime)
            sleep_secs = (next_run - datetime.now()).total_seconds()
            if sleep_secs > 0:
                await asyncio.sleep(sleep_secs)

            nodes = await list_nodes()
            for node in nodes:
                for member_name in _all_members(node):
                    try:
                        await refresh_member(node, member_name, is_manual=False, username=None)
                    except Exception as exc:
                        logger.warning(
                            "Cron APT refresh node=%s member=%s: %s",
                            node.name, member_name, exc,
                        )
                    await asyncio.sleep(2)

        except Exception as exc:
            logger.error("node_updates cron loop error: %s", exc)
            await asyncio.sleep(300)
