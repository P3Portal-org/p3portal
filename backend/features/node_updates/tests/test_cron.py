# p3portal.org
"""PROJ-73: Tests für cron.py (asyncio-Loop, unit-level)."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest


class TestStartNodeUpdatesCron:
    @pytest.mark.asyncio
    async def test_startup_delay_then_refresh(self):
        """Cron wartet _STARTUP_DELAY, berechnet next_run, refresht alle Members."""
        mock_node = MagicMock()
        mock_node.name = "pve1"
        mock_node.proxmox_node = "pve1"
        mock_node.cluster_nodes = []

        sleep_calls: list[float] = []
        iterations = 0

        async def fake_sleep(secs: float) -> None:
            nonlocal iterations
            sleep_calls.append(secs)
            if len(sleep_calls) >= 3:
                raise asyncio.CancelledError

        with (
            patch("backend.features.node_updates.cron.asyncio.sleep", side_effect=fake_sleep),
            patch(
                "backend.features.node_updates.cron.get_config",
                new_callable=AsyncMock,
                return_value="0 3 * * *",
            ),
            patch(
                "backend.features.node_updates.cron.list_nodes",
                new_callable=AsyncMock,
                return_value=[mock_node],
            ),
            patch(
                "backend.features.node_updates.cron.refresh_member",
                new_callable=AsyncMock,
            ) as mock_refresh,
            patch(
                "backend.features.node_updates.cron._all_members",
                return_value=["pve1"],
            ),
        ):
            from backend.features.node_updates.cron import start_node_updates_cron

            with pytest.raises(asyncio.CancelledError):
                await start_node_updates_cron()

        # First sleep is the startup delay (60s)
        assert sleep_calls[0] == 60

    @pytest.mark.asyncio
    async def test_member_refresh_called_serially_with_gap(self):
        """Zwischen Members wird asyncio.sleep(2) aufgerufen."""
        mock_node = MagicMock()
        mock_node.name = "pve1"
        mock_node.proxmox_node = "pve1"
        mock_node.cluster_nodes = ["pve2"]

        sleep_calls: list[float] = []

        async def fake_sleep(secs: float) -> None:
            sleep_calls.append(secs)
            if len(sleep_calls) >= 5:
                raise asyncio.CancelledError

        with (
            patch("backend.features.node_updates.cron.asyncio.sleep", side_effect=fake_sleep),
            patch(
                "backend.features.node_updates.cron.get_config",
                new_callable=AsyncMock,
                return_value="0 3 * * *",
            ),
            patch(
                "backend.features.node_updates.cron.list_nodes",
                new_callable=AsyncMock,
                return_value=[mock_node],
            ),
            patch(
                "backend.features.node_updates.cron.refresh_member",
                new_callable=AsyncMock,
            ) as mock_refresh,
            patch(
                "backend.features.node_updates.cron._all_members",
                return_value=["pve1", "pve2"],
            ),
        ):
            from backend.features.node_updates.cron import start_node_updates_cron

            with pytest.raises(asyncio.CancelledError):
                await start_node_updates_cron()

        # After startup sleep, there must be 2s inter-member gaps
        assert 2.0 in sleep_calls

    @pytest.mark.asyncio
    async def test_member_exception_logged_loop_continues(self):
        """Fehler bei einem Member bricht die gesamte Schleife nicht ab."""
        mock_node = MagicMock()
        mock_node.name = "pve1"

        calls = []

        async def fake_sleep(secs: float) -> None:
            calls.append(secs)
            if len(calls) >= 4:
                raise asyncio.CancelledError

        async def bad_refresh(*args, **kwargs):
            raise RuntimeError("connection refused")

        with (
            patch("backend.features.node_updates.cron.asyncio.sleep", side_effect=fake_sleep),
            patch(
                "backend.features.node_updates.cron.get_config",
                new_callable=AsyncMock,
                return_value="0 3 * * *",
            ),
            patch(
                "backend.features.node_updates.cron.list_nodes",
                new_callable=AsyncMock,
                return_value=[mock_node],
            ),
            patch(
                "backend.features.node_updates.cron.refresh_member",
                side_effect=bad_refresh,
            ),
            patch(
                "backend.features.node_updates.cron._all_members",
                return_value=["pve1"],
            ),
        ):
            from backend.features.node_updates.cron import start_node_updates_cron

            with pytest.raises(asyncio.CancelledError):
                await start_node_updates_cron()

        # Loop must have continued (sleep(2) still happened)
        assert 2.0 in calls

    @pytest.mark.asyncio
    async def test_outer_exception_sleeps_300(self):
        """Wenn der äußere Loop crasht, schläft er 300s bevor Retry."""
        sleep_calls: list[float] = []

        async def fake_sleep(secs: float) -> None:
            sleep_calls.append(secs)
            if len(sleep_calls) >= 2:
                raise asyncio.CancelledError

        with (
            patch("backend.features.node_updates.cron.asyncio.sleep", side_effect=fake_sleep),
            patch(
                "backend.features.node_updates.cron.get_config",
                new_callable=AsyncMock,
                side_effect=RuntimeError("db gone"),
            ),
        ):
            from backend.features.node_updates.cron import start_node_updates_cron

            with pytest.raises(asyncio.CancelledError):
                await start_node_updates_cron()

        # After startup delay and outer exception, must sleep 300
        assert 300 in sleep_calls

    @pytest.mark.asyncio
    async def test_uses_default_cron_when_config_missing(self):
        """Fehlendes portal_config → Default '30 3 * * *' wird genutzt."""
        mock_node = MagicMock()
        mock_node.name = "pve1"

        calls = []

        async def fake_sleep(secs: float) -> None:
            calls.append(secs)
            if len(calls) >= 2:
                raise asyncio.CancelledError

        with (
            patch("backend.features.node_updates.cron.asyncio.sleep", side_effect=fake_sleep),
            patch(
                "backend.features.node_updates.cron.get_config",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "backend.features.node_updates.cron.list_nodes",
                new_callable=AsyncMock,
                return_value=[mock_node],
            ),
            patch(
                "backend.features.node_updates.cron.refresh_member",
                new_callable=AsyncMock,
            ),
            patch(
                "backend.features.node_updates.cron._all_members",
                return_value=["pve1"],
            ),
        ):
            from backend.features.node_updates.cron import start_node_updates_cron

            with pytest.raises(asyncio.CancelledError):
                await start_node_updates_cron()

        # Must have slept at least the startup delay
        assert calls[0] == 60
