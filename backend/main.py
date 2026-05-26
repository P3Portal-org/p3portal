# p3portal.org
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

# Backend-Logger auf INFO setzen, damit Plus-Hook-Logs (PROJ-70:, Plus-Behavior
# registriert: ...) sichtbar sind. Uvicorn konfiguriert nur eigene Logger.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.core.config import settings
from backend.db.database import init_db, migrate_env_to_db
from backend.features.api_surface.middleware import UpkRateLimitMiddleware
from backend.features.api_surface.router import router as api_surface_router
from backend.routers import auth, cluster, jobs, packer, playbooks, profile, rbac, vms
from backend.routers import settings as settings_router
from backend.routers import admin, license as license_router, pages as pages_router
from backend.routers import themes as themes_router, i18n as i18n_router
from backend.routers import setup as setup_router, nodes as nodes_router
from backend.routers import user_api_keys as user_api_keys_router
from backend.routers import announcements as announcements_router
from backend.routers import alerts as alerts_router
# PROJ-70: scheduled_jobs_router wird via try/except unten eingehängt (Plus-only)
from backend.routers import capabilities as capabilities_router
from backend.core.license import get_license_status
from backend.services.local_auth import seed_default_admin
from backend.services.rbac_service import seed_default_presets
from backend.services.session_service import cleanup_expired_sessions
from backend.services.theme_service import seed_builtin_themes
from backend.services.config_service import load_config_cache, init_env_token_bootstrap, get_proxmox_node

logger = logging.getLogger(__name__)

_DEFAULT_ADMIN_PW = "change-me-on-first-start"

# PROJ-9: Semaphore for external job rate-limiting (None = unlimited)
_external_semaphore: asyncio.Semaphore | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _external_semaphore
    if settings.external_job_max_concurrent > 0:
        _external_semaphore = asyncio.Semaphore(settings.external_job_max_concurrent)
        logger.info("External job semaphore: max %d concurrent", settings.external_job_max_concurrent)

    node = get_proxmox_node()
    if node:
        logger.info("Proxmox node: %s", node)
    else:
        logger.info("PROXMOX_NODE not set – will be configured via Setup-Wizard or DB")

    await init_db()
    await migrate_env_to_db()          # PROJ-21: import env-vars → DB, create default node
    await load_config_cache()          # PROJ-21: populate in-memory config cache
    await init_env_token_bootstrap()   # PROJ-26: bootstrap/override token keys from env
    get_license_status()               # warm license cache once at startup

    # PROJ-60: Plus-Selbstregistrierung (Inversion of Control).
    # Falls backend/plus/ fehlt (Pure-Core-Build), bleibt Singleton = CorePlusBehavior.
    try:
        import backend.plus  # noqa: F401
    except ImportError:
        logger.info("backend.plus nicht gefunden – Core-Edition-Modus aktiv")

    # PROJ-63 BUG-63-2: Plus-DB-Tabellen NACH init_db() anlegen.
    # plus/__init__ läuft ggf. früher (Router-Import triggert Package-Init),
    # bevor init_db() den Sync-Engine setzt. Dieser Hook-Aufruf ist idempotent.
    from backend.core.plus_protocol import plus_behavior as _pb
    _pb.ensure_plus_db_tables()

    # PROJ-70: Scheduled-Job-Runner – Asyncio-Loop NUR als Fallback wenn
    # kein Celery/Valkey konfiguriert ist. Wenn VALKEY_URL gesetzt ist, dispatcht
    # Celery-Beat über backend.celery_app; Asyncio-Loop würde sonst zu
    # Double-Dispatch führen (Jobs würden doppelt feuern).
    # Muss NACH ensure_plus_db_tables() laufen (Tabellen müssen existieren).
    if not os.getenv("VALKEY_URL"):
        await _pb.start_scheduled_job_runner()
        logger.info("PROJ-70: Asyncio-Runner aktiv (kein VALKEY_URL gesetzt)")
    else:
        logger.info("PROJ-70: VALKEY_URL gesetzt – Dispatch via Celery-Beat (kein Asyncio-Loop)")

    # PROJ-66: Tooling-Health-Check im Hintergrund starten (fire-and-forget).
    # Muss NACH ensure_plus_db_tables() laufen (Plus-Hook-Init).
    from backend.features.tooling.lifespan import register_startup_check
    register_startup_check()

    await seed_default_presets()
    await cleanup_expired_sessions()
    await seed_builtin_themes()

    # Seed default admin only if a non-default password is configured (env-var path).
    # Fresh installs with default password use the Setup-Wizard instead.
    if settings.admin_password != _DEFAULT_ADMIN_PW:
        await seed_default_admin(settings.admin_username, settings.admin_password)
    else:
        logger.info("Default admin password detected – skipping seed; use Setup-Wizard")

    yield


# PROJ-67 Phase 1 – F-016: API-Docs nur wenn explizit aktiviert (Default: aus)
_docs_url = "/api/docs" if settings.expose_api_docs else None
_openapi_url = "/api/openapi.json" if settings.expose_api_docs else None

app = FastAPI(
    title="P3 Portal",
    version="v1.75.0-beta",
    docs_url=_docs_url,
    redoc_url=None,
    openapi_url=_openapi_url,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# PROJ-44: Token-Bucket Rate-Limiter für upk_-Authentifizierung (No-Op für JWT)
app.add_middleware(UpkRateLimitMiddleware)

app.include_router(api_surface_router)
app.include_router(setup_router.router)
app.include_router(nodes_router.router)
app.include_router(auth.router)
app.include_router(license_router.router)
app.include_router(admin.router)
app.include_router(profile.router)
app.include_router(settings_router.router)
app.include_router(cluster.router)
app.include_router(vms.router)
app.include_router(rbac.router)
app.include_router(playbooks.router)
app.include_router(packer.router)
app.include_router(pages_router.router)
app.include_router(jobs.router)
app.include_router(themes_router.router)
app.include_router(themes_router.preferences_router)
app.include_router(i18n_router.router)
app.include_router(user_api_keys_router.router)
app.include_router(announcements_router.router)
app.include_router(alerts_router.router)
app.include_router(alerts_router.smtp_router)
# PROJ-70: Scheduled-Jobs-Router im Plus-Modul; 404 in Pure-Core
try:
    from backend.plus.scheduled_jobs.router import router as sj_router, settings_router as sj_settings_router
    app.include_router(sj_router)
    app.include_router(sj_settings_router)
except ImportError:
    logger.info("PROJ-70: backend.plus.scheduled_jobs nicht gefunden – Scheduled-Job-Endpunkte nicht registriert")
app.include_router(capabilities_router.router)
# ── Feature-Module routers (PROJ-52+) ─────────────────────────────────────────
# Neue Features (PROJ-45+) werden hier eingehängt.
# Muster: from backend.features.<name> import router as <name>_router
#         app.include_router(<name>_router)
# Prefix und Tags sind im jeweiligen router.py definiert.
# ─────────────────────────────────────────────────────────────────────────────
from backend.features.groups.router import router as groups_router
app.include_router(groups_router)

# PROJ-62: Pools-Router im Plus-Modul; 404 wenn Plus nicht aktiv (Pure-Core)
try:
    from backend.plus.pools.router import router as pools_router, me_router as pools_me_router, vms_router as pools_vms_router
    app.include_router(pools_router)
    app.include_router(pools_me_router)
    app.include_router(pools_vms_router)
except ImportError:
    logger.info("PROJ-62: backend.plus.pools nicht gefunden – Pool-Endpunkte nicht registriert")

from backend.features.sidebar_pins.router import router as sidebar_pins_router
app.include_router(sidebar_pins_router)

from backend.features.node_assignments.router import router as node_assignments_router, me_router as node_assignments_me_router
app.include_router(node_assignments_router)
app.include_router(node_assignments_me_router)

from backend.features.owners.router import router as owners_router, me_router as owners_me_router
app.include_router(owners_router)
app.include_router(owners_me_router)

try:
    from backend.plus.playbook_permissions.router import router as playbook_permissions_router
    app.include_router(playbook_permissions_router)
except ImportError:
    pass  # PROJ-63: Plus-only Router, in Pure-Core nicht verfügbar → 404 für alle 4 Endpoints

try:
    from backend.plus.approvals.router import router as approvals_router
    app.include_router(approvals_router)
except ImportError:
    pass  # PROJ-64: Plus-only Router, in Pure-Core nicht verfügbar → 404 für alle Approval-Endpoints

from backend.features.help.router import router as help_router
app.include_router(help_router)

from backend.features.notifications.router import router as notifications_router
app.include_router(notifications_router)

from backend.features.tooling.router import router as tooling_router
app.include_router(tooling_router)

# PROJ-67 Phase 1 – F-002: Webhook-Allowlist
from backend.routers.webhook_allowlist import router as webhook_allowlist_router
app.include_router(webhook_allowlist_router)

# PROJ-68: Git-Sync Router (Plus-only; 412 für Core-Nutzer, öffentlicher Webhook kein JWT)
try:
    from backend.plus.git_sync.router import router as git_sync_router
    from backend.plus.git_sync.webhook_router import webhook_router as git_sync_webhook_router
    app.include_router(git_sync_router)
    app.include_router(git_sync_webhook_router)
except ImportError:
    logger.info("PROJ-68: backend.plus.git_sync nicht gefunden – Git-Sync-Endpunkte nicht registriert")


@app.get("/api/health", tags=["meta"])
async def health():
    return {"status": "ok"}


@app.get("/api/about", tags=["meta"])
async def about():
    return {"author": "p3portal.org", "project": "proxmox-portal"}


# Static frontend (React build) – served last so API routes take priority
_static_dir = Path(__file__).parent.parent / "frontend" / "dist"
if _static_dir.is_dir():
    app.mount("/assets", StaticFiles(directory=str(_static_dir / "assets")), name="assets")

    @app.get("/favicon.png", include_in_schema=False)
    async def favicon():
        return FileResponse(_static_dir / "favicon.png", media_type="image/png")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(_static_dir / "index.html")
