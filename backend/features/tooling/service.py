# p3portal.org
"""PROJ-66: ToolingHealthService – Singleton mit in-memory Cache + asyncio.Lock.

Architektur (Tech-Design §C–§H):
- _cache: dict[str, ToolStatus]   – per Tool, initial "unknown"
- _lock: asyncio.Lock             – schützt Cache + Subprocess + Audit
- _initial_check_done: asyncio.Event – set nach erstem run_all_checks()
- _rate_limits: dict              – (user_id, tool_id) → last_recheck_at
- _known_tools: list[str]         – hardcoded ["ansible","packer"] + Plus-Hook

Cache-Hit-Path (§D): get_cached() prüft ohne Lock ob now - last_check < 720s.
Cache-Miss-Path: Lock erwerben, Double-Check, Subprocess, Cache schreiben, Lock freigeben.
Audit-Schreibe innerhalb Lock (§G): atomar mit Cache-Update + Transition-Detect.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from backend.core.plus_protocol import plus_behavior
from backend.features.tooling.audit import emit_status_transition
from backend.features.tooling.runners import CheckResult
from backend.features.tooling.schemas import ToolCheckConfig, ToolStatus, ToolingStatusResponse

logger = logging.getLogger(__name__)

_CACHE_TTL = 720          # Sekunden (AC-API-4, Entscheidung 5)
_RATE_LIMIT_SECONDS = 30  # Rate-Limit für /recheck (AC-API-5, Entscheidung 7)

# Hardcoded Core-Tools (AC-PLUS-2)
_CORE_TOOLS = ["ansible", "packer"]

# Runner-Namen als Strings → dynamisch aus runners-Modul geladen (patchbar in Tests)
_RUNNERS: dict[str, str] = {
    "ansible": "run_ansible_check",
    "packer": "run_packer_check",
}


class ToolingHealthService:
    """Singleton-Service für Tooling-Health-Checks.

    Wird einmal beim Backend-Start instanziiert und hält den in-memory Cache.
    """

    def __init__(self) -> None:
        self._cache: dict[str, ToolStatus] = {
            "ansible": ToolStatus(tool="ansible", status="unknown"),
            "packer": ToolStatus(tool="packer", status="unknown"),
        }
        self._lock = asyncio.Lock()
        self._initial_check_done: asyncio.Event = asyncio.Event()
        # (user_id_or_none, tool_id) → last_recheck_at (für Rate-Limit)
        self._rate_limits: dict[tuple, datetime] = {}
        self._known_tools: list[str] = list(_CORE_TOOLS)  # wird in _init_tools() erweitert
        # PROJ-66 Phase 2: Plus-gelieferte Tools bringen ihren eigenen Runner mit
        # (Callable aus der Hook-Config) → tool_id → async Runner → CheckResult.
        self._extra_runners: dict[str, object] = {}

    # ── Interne Tool-Initialisierung mit Plus-Hook ───────────────────────────

    def _init_tools(self) -> None:
        """Mergt Core-Tools mit Plus-Hook-Tools. Kollisionen: Core gewinnt (EC-12)."""
        extra: list = []
        try:
            extra = plus_behavior.get_additional_tooling_checks()
        except Exception as exc:
            logger.warning("get_additional_tooling_checks() failed: %s", exc)

        for cfg in extra:
            # cfg ist ToolCheckConfig oder dict mit 'tool_id'
            is_dict = isinstance(cfg, dict)
            tool_id = cfg.get("tool_id") if is_dict else getattr(cfg, "tool_id", None)
            if not tool_id:
                continue
            if tool_id in _CORE_TOOLS:
                logger.warning("Tooling: Plus-Hook liefert tool_id '%s' – Kollision mit Core-Tool, ignoriert (EC-12)", tool_id)
                continue
            # PROJ-66 Phase 2: Plus-Tool bringt eigenen Runner-Callable mit (§B).
            runner = cfg.get("runner") if is_dict else getattr(cfg, "runner", None)
            if runner is not None:
                self._extra_runners[tool_id] = runner
            if tool_id not in self._known_tools:
                self._known_tools.append(tool_id)
                self._cache[tool_id] = ToolStatus(tool=tool_id, status="unknown")

    # ── Öffentliche API ──────────────────────────────────────────────────────

    @property
    def known_tools(self) -> list[str]:
        """Liste der bekannten Tool-IDs (Core + Plus-Hook). Idempotent.

        Stellt sicher, dass die Plus-Hook-Tools (PROJ-66 Phase 2: tofu) bereits
        registriert sind, bevor der Recheck-Rate-Limit-Pfad im Router darüber
        iteriert (AC-P2-DISPATCH-3).
        """
        self._init_tools()
        return list(self._known_tools)

    def get_cached(self) -> dict[str, ToolStatus]:
        """Gibt gecachten Status zurück (kein Lock, kein Subprocess).

        Ruft _init_tools(), damit Plus-Hook-Tools (tofu) auch vor dem ersten
        Hintergrund-Check im /status erscheinen (als 'unknown', generisch
        gerendert) – konsistent mit ansible/packer.
        """
        self._init_tools()
        return dict(self._cache)

    async def force_recheck(self, user_id: int | None = None) -> dict[str, ToolStatus]:
        """Cache-Bypass: prüft alle Tools sofort neu. Respektiert Rate-Limit.

        Raises:
            ValueError: wenn Rate-Limit überschritten (user_id, tool, retry_after).
        """
        await self.run_all_checks(bypass_cache=True, user_id=user_id)
        return dict(self._cache)

    def check_rate_limit(self, user_id: int | None, tool: str) -> int | None:
        """Prüft Rate-Limit für einen User+Tool. Gibt None zurück (ok) oder retry_after (s)."""
        key = (user_id, tool)
        last = self._rate_limits.get(key)
        if last is None:
            return None
        elapsed = (datetime.now(timezone.utc) - last).total_seconds()
        if elapsed < _RATE_LIMIT_SECONDS:
            return int(_RATE_LIMIT_SECONDS - elapsed) + 1
        return None

    def _mark_rate_limit(self, user_id: int | None, tool: str) -> None:
        self._rate_limits[(user_id, tool)] = datetime.now(timezone.utc)

    async def run_all_checks(
        self,
        bypass_cache: bool = False,
        user_id: int | None = None,
    ) -> None:
        """Führt Health-Checks für alle bekannten Tools aus.

        Bei bypass_cache=False: Cache-Hit innerhalb TTL → kein Subprocess.
        Alle bekannten Tools laufen parallel via asyncio.gather (Tech-Design §E).
        Rate-Limit wird VOR der Lock-Akquisition geprüft und gesetzt.
        """
        self._init_tools()

        # Rate-Limit prüfen und sofort setzen (vor dem Subprocess).
        # PROJ-66 Phase 2: über _known_tools statt _CORE_TOOLS, damit Plus-Tools
        # (tofu) ebenfalls rate-limited werden (AC-P2-DISPATCH-3, EC-P2-7).
        # _init_tools() lief oben → _known_tools enthält bereits die Hook-Tools.
        if bypass_cache and user_id is not None:
            for tool_id in self._known_tools:
                retry_after = self.check_rate_limit(user_id, tool_id)
                if retry_after is not None:
                    raise ValueError(f"rate_limited:{tool_id}:{retry_after}")
            for tool_id in self._known_tools:
                self._mark_rate_limit(user_id, tool_id)

        await asyncio.gather(
            *[self._check_one(tool_id, bypass_cache) for tool_id in self._known_tools],
            return_exceptions=True,
        )
        self._initial_check_done.set()

    async def _check_one(self, tool_id: str, bypass_cache: bool) -> None:
        """Prüft ein einzelnes Tool. Erwirbt Lock für Subprocess + Cache + Audit."""
        # Fast path: Cache-Hit ohne Lock (Tech-Design §D)
        if not bypass_cache:
            existing = self._cache.get(tool_id)
            if existing and existing.last_check is not None:
                age = (datetime.now(timezone.utc) - existing.last_check).total_seconds()
                if age < _CACHE_TTL:
                    return

        async with self._lock:
            # Double-Check im Lock (verhindert parallele Subprocesse, EC-4)
            if not bypass_cache:
                existing = self._cache.get(tool_id)
                if existing and existing.last_check is not None:
                    age = (datetime.now(timezone.utc) - existing.last_check).total_seconds()
                    if age < _CACHE_TTL:
                        return

            result = await self._run_tool(tool_id)
            if result is not None:
                await self._apply_status(tool_id, result)

    async def _run_tool(self, tool_id: str) -> CheckResult | None:
        """Delegiert den Subprocess-Check an den passenden Runner.

        Lädt den Runner dynamisch aus dem runners-Modul, damit monkeypatch
        in Tests funktioniert (keine direkte Funktionsreferenz).
        """
        import backend.features.tooling.runners as _runners_mod

        runner_name = _RUNNERS.get(tool_id)
        if runner_name is not None:
            # Core-Tool: dynamisch aus runners-Modul (monkeypatch-fähig, Phase 1).
            runner = getattr(_runners_mod, runner_name, None)
            if runner is None:
                logger.warning("Runner-Funktion '%s' nicht gefunden", runner_name)
                return None
        else:
            # PROJ-66 Phase 2: Plus-geliefertes Tool führt seinen mitgebrachten
            # Runner-Callable aus (additiv, Core-Pfad unberührt – AC-P2-DISPATCH).
            runner = self._extra_runners.get(tool_id)
            if runner is None:
                logger.warning("Kein Runner für tool_id '%s'", tool_id)
                return None
        try:
            return await runner()
        except Exception as exc:
            logger.exception("Runner für '%s' hat unerwartet gefehlt: %s", tool_id, exc)
            return None

    async def _apply_status(self, tool_id: str, result: CheckResult) -> None:
        """Aktualisiert Cache + schreibt Audit-Event (innerhalb Lock, Tech-Design §G)."""
        prev = self._cache.get(tool_id)
        prev_status = prev.status if prev else "unknown"

        new_status = ToolStatus(
            tool=tool_id,
            version=result.version,
            status=result.status,
            last_check=result.checked_at,
            stdout=result.stdout,
            stderr=result.stderr,
        )
        self._cache[tool_id] = new_status

        # Audit-Event atomar im Lock (AC-AUDIT-1/2/3)
        await emit_status_transition(
            tool=tool_id,
            from_status=prev_status,
            to_status=result.status,
            version=result.version,
            stderr=result.stderr,
        )

    def build_response(self) -> dict:
        """Baut das Response-Dict für die API aus dem aktuellen Cache."""
        return dict(self._cache)


# Singleton-Instanz (wird von router.py importiert)
tooling_service = ToolingHealthService()
