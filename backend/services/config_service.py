# p3portal.org
"""PROJ-21: Runtime configuration from portal_config DB table.

Read priority:
  1. Env-Var (set at process start) – always wins (override for Ops deployments)
  2. DB value in portal_config
  3. None / empty string

Secrets (is_secret=1) are stored Fernet-encrypted.
Key derivation: PBKDF2-HMAC-SHA256(SECRET_KEY, salt=b"p3portal_config_v1", 200k iters) → 32 bytes → Fernet.
"""
from __future__ import annotations

import base64
import logging
from datetime import date, datetime, timezone

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from sqlalchemy import text

from backend.db.database import get_db, get_sync_engine

logger = logging.getLogger(__name__)

# In-memory cache – populated at startup via load_config_cache()
_cache: dict[str, str] = {}
_fernet_instance: Fernet | None = None

# Mapping: portal_config key → settings attribute name (env-var fallback)
_ENV_MAP: dict[str, str] = {
    "proxmox_host":                  "proxmox_host",
    "proxmox_node":                  "proxmox_node",
    "proxmox_verify_ssl":            "proxmox_verify_ssl",
    "packer_http_ip":                "packer_http_ip",
    "packer_token_id":               "packer_token_id",
    "packer_token_secret":           "packer_token_secret",
    "proxmox_viewer_token_id":       "proxmox_viewer_token_id",
    "proxmox_viewer_token_secret":   "proxmox_viewer_token_secret",
    "proxmox_operator_token_id":     "proxmox_operator_token_id",
    "proxmox_operator_token_secret": "proxmox_operator_token_secret",
    "proxmox_admin_token_id":        "proxmox_admin_token_id",
    "proxmox_admin_token_secret":    "proxmox_admin_token_secret",
}

# Keys that hold secret values (encrypted at rest)
_SECRET_KEYS: frozenset[str] = frozenset({
    "packer_token_secret",
    "proxmox_viewer_token_secret",
    "proxmox_operator_token_secret",
    "proxmox_admin_token_secret",
})


def _fernet() -> Fernet:
    global _fernet_instance
    if _fernet_instance is None:
        from backend.core.config import settings
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"p3portal_config_v1",
            iterations=200_000,
        )
        raw = kdf.derive(settings.secret_key.encode())
        _fernet_instance = Fernet(base64.urlsafe_b64encode(raw))
    return _fernet_instance


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def _env_value(key: str) -> str | None:
    """Return non-empty env-var value for the given config key, or None."""
    attr = _ENV_MAP.get(key)
    if not attr:
        return None
    from backend.core.config import settings
    val = getattr(settings, attr, None)
    if val is None:
        return None
    s = str(val)
    return s if s else None


# PROJ-94: trial flags (plain text, NOT secrets → not in _SECRET_KEYS)
TRIAL_USED_KEY = "trial_used"
TRIAL_STARTED_AT_KEY = "trial_started_at"


# ── Sync interface (uses in-memory cache) ─────────────────────────────────────

def get_config_sync(key: str) -> str | None:
    """Sync read: env-var → in-memory cache → None."""
    env = _env_value(key)
    if env is not None:
        return env
    return _cache.get(key) or None


def get_trial_flags_sync() -> tuple[bool, str | None]:
    """PROJ-94: read the two trial flags DIRECTLY (sync) from the DB.

    Deliberately bypasses the process-local in-memory `_cache` (which is only
    populated at startup + on set_config in the same process): the backend runs
    in multiple processes (uvicorn web + celery worker), so a trial started in
    the web process would otherwise be invisible to the worker. The license
    branch that calls this is throttled to ~1×/min/process by the 60s TTL cache,
    so a fresh sync engine per call is acceptable.

    Returns (trial_used, trial_started_at). On any error / DB-not-ready → (False, None).
    """
    engine = get_sync_engine()
    if engine is None:
        return (False, None)
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT key, value FROM portal_config "
                    "WHERE key IN (:used, :started)"
                ),
                {"used": TRIAL_USED_KEY, "started": TRIAL_STARTED_AT_KEY},
            ).mappings().fetchall()
        data = {r["key"]: r["value"] for r in rows}
        trial_used = (data.get(TRIAL_USED_KEY) or "").lower() == "true"
        trial_started_at = data.get(TRIAL_STARTED_AT_KEY) or None
        return (trial_used, trial_started_at)
    except Exception as e:
        logger.warning("portal_config: trial flags sync read failed: %s", e)
        return (False, None)
    finally:
        try:
            engine.dispose()
        except Exception:
            pass


# ── Async interface (reads from DB) ───────────────────────────────────────────

async def get_config(key: str) -> str | None:
    """Async read: env-var → DB → None."""
    env = _env_value(key)
    if env is not None:
        return env
    try:
        async with get_db() as session:
            result = await session.execute(
                text("SELECT value, is_secret FROM portal_config WHERE key = :key"),
                {"key": key},
            )
            row = result.mappings().fetchone()
        if not row:
            return None
        if row["is_secret"]:
            try:
                return decrypt_secret(row["value"])
            except Exception:
                logger.warning("portal_config: failed to decrypt key %r", key)
                return None
        return row["value"] or None
    except Exception as e:
        logger.warning("portal_config: DB read failed for %r: %s", key, e)
        return None


async def set_config(
    key: str,
    value: str,
    is_secret: bool = False,
    updated_by: str = "system",
) -> None:
    """Write to DB and update in-memory cache. Encrypts secrets."""
    stored = encrypt_secret(value) if is_secret else value
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        await session.execute(
            text(
                "INSERT INTO portal_config (key, value, is_secret, updated_at, updated_by) "
                "VALUES (:key, :value, :is_secret, :now, :by) "
                "ON CONFLICT(key) DO UPDATE SET "
                "value=excluded.value, is_secret=excluded.is_secret, "
                "updated_at=excluded.updated_at, updated_by=excluded.updated_by"
            ),
            {"key": key, "value": stored, "is_secret": 1 if is_secret else 0, "now": now, "by": updated_by},
        )
        await session.commit()
    _cache[key] = value  # store plain in cache


async def mark_trial_started(updated_by: str = "system") -> str:
    """PROJ-94: start the one-time Plus trial.

    Writes trial_started_at (today, ISO date) then trial_used=true. Order matters:
    if the second write fails, the trial is not yet 'used' (the start guard checks
    trial_used) → a retry simply re-sets the date and marks it used. Returns the
    start date (ISO). Caller must guard against re-start (trial_used / valid key).
    """
    started_at = date.today().isoformat()
    await set_config(TRIAL_STARTED_AT_KEY, started_at, is_secret=False, updated_by=updated_by)
    await set_config(TRIAL_USED_KEY, "true", is_secret=False, updated_by=updated_by)
    return started_at


async def is_setup_complete() -> bool:
    val = await get_config("setup_complete")
    return val == "true"


async def get_all_config_masked() -> list[dict]:
    """Returns all portal_config rows; secret values replaced with '***'."""
    try:
        async with get_db() as session:
            result = await session.execute(
                text("SELECT key, value, is_secret, updated_at, updated_by FROM portal_config ORDER BY key")
            )
            rows = result.mappings().fetchall()
        return [
            {
                "key": r["key"],
                "value": "***" if r["is_secret"] else r["value"],
                "updated_at": r["updated_at"],
                "updated_by": r["updated_by"],
            }
            for r in rows
        ]
    except Exception:
        return []


async def load_config_cache() -> None:
    """Populate in-memory cache from portal_config at startup."""
    try:
        async with get_db() as session:
            result = await session.execute(
                text("SELECT key, value, is_secret FROM portal_config")
            )
            rows = result.mappings().fetchall()
        for row in rows:
            try:
                plain = decrypt_secret(row["value"]) if row["is_secret"] else row["value"]
                _cache[row["key"]] = plain
            except Exception:
                logger.warning("portal_config: skipping corrupt cache entry %r", row["key"])
        logger.info("portal_config: cache loaded (%d entries)", len(rows))
    except Exception as e:
        logger.warning("portal_config: cache load skipped (DB not ready?): %s", e)


async def init_env_token_bootstrap() -> None:
    """PROJ-26: Bootstrap or override node tokens from env-vars at startup.

    Tokens live EXCLUSIVELY in the nodes table – portal_config is NOT used.

    Normal mode (ENV_TOKEN_OVERRIDE not set):
      Writes token env-vars into the default node only when the node has no
      tokens configured yet.  Idempotent – subsequent starts are no-ops.

    Override mode (ENV_TOKEN_OVERRIDE=true):
      Unconditionally overwrites all token fields on the default node with
      env-var values.  Useful for emergency token rotation without re-running
      the Setup-Wizard.
    """
    import os
    from backend.core.config import settings
    from backend.services.nodes_service import get_default_node, update_node

    override = os.environ.get("ENV_TOKEN_OVERRIDE", "").lower() == "true"

    env_tokens = {
        "viewer_token_id":        settings.proxmox_viewer_token_id or "",
        "viewer_token_secret":    settings.proxmox_viewer_token_secret or "",
        "operator_token_id":      settings.proxmox_operator_token_id or "",
        "operator_token_secret":  settings.proxmox_operator_token_secret or "",
        "admin_token_id":         settings.proxmox_admin_token_id or "",
        "admin_token_secret":     settings.proxmox_admin_token_secret or "",
        "packer_token_id":        settings.packer_token_id or "",
        "packer_token_secret":    settings.packer_token_secret or "",
    }

    try:
        node = await get_default_node()
        if not node:
            logger.info("init_env_token_bootstrap: no default node – skipping")
            return

        has_any_env_token = any(v for v in env_tokens.values())
        if not has_any_env_token:
            logger.info("init_env_token_bootstrap: no token env-vars set – skipping")
            return

        if override:
            await update_node(
                node.id,
                viewer_token_id=env_tokens["viewer_token_id"] or None,
                viewer_token_secret=env_tokens["viewer_token_secret"] or None,
                operator_token_id=env_tokens["operator_token_id"] or None,
                operator_token_secret=env_tokens["operator_token_secret"] or None,
                admin_token_id=env_tokens["admin_token_id"] or None,
                admin_token_secret=env_tokens["admin_token_secret"] or None,
                packer_token_id=env_tokens["packer_token_id"] or None,
                packer_token_secret=env_tokens["packer_token_secret"] or None,
            )
            logger.info("ENV_TOKEN_OVERRIDE: default node tokens updated from env-vars")
        else:
            node_has_tokens = any([
                node.viewer_token_id, node.viewer_token_secret,
                node.operator_token_id, node.operator_token_secret,
                node.admin_token_id, node.admin_token_secret,
                node.packer_token_id, node.packer_token_secret,
            ])
            if node_has_tokens:
                logger.info("init_env_token_bootstrap: node already has tokens – skipping")
                return
            await update_node(
                node.id,
                viewer_token_id=env_tokens["viewer_token_id"] or None,
                viewer_token_secret=env_tokens["viewer_token_secret"] or None,
                operator_token_id=env_tokens["operator_token_id"] or None,
                operator_token_secret=env_tokens["operator_token_secret"] or None,
                admin_token_id=env_tokens["admin_token_id"] or None,
                admin_token_secret=env_tokens["admin_token_secret"] or None,
                packer_token_id=env_tokens["packer_token_id"] or None,
                packer_token_secret=env_tokens["packer_token_secret"] or None,
            )
            logger.info("init_env_token_bootstrap: default node tokens bootstrapped from env-vars")
    except Exception as e:
        logger.warning("init_env_token_bootstrap: skipped (%s)", e)


# ── Effective runtime helpers (DB-first, env-var fallback) ────────────────────

def get_proxmox_node() -> str:
    """Return the effective Proxmox node name: DB config preferred over env/settings."""
    from backend.core.config import settings
    return get_config_sync("proxmox_node") or settings.proxmox_node


def get_proxmox_verify_ssl() -> bool:
    """Return the effective SSL verification flag: DB config preferred over env/settings."""
    from backend.core.config import settings
    val = get_config_sync("proxmox_verify_ssl")
    if val is not None:
        return val.lower() in ("true", "1", "yes")
    return settings.proxmox_verify_ssl
