# p3portal.org
from __future__ import annotations

import asyncio
import logging

from backend.core.config import settings
from backend.core.http_client import check_dns_rebinding, pin_url_to_ip, secure_outbound_client

logger = logging.getLogger(__name__)

_RETRY_DELAYS = [5, 25, 125]  # seconds between attempts (exponential backoff)


async def _load_allowlist_patterns() -> list[str]:
    """Load active webhook allowlist patterns from DB. Empty list = allowlist inactive."""
    try:
        from backend.db.database import get_db
        from sqlalchemy import text
        async with get_db() as db:
            result = await db.execute(text("SELECT pattern FROM webhook_allowlist ORDER BY id"))
            return [row[0] for row in result.fetchall()]
    except Exception:
        return []


async def dispatch_webhook(
    callback_url: str,
    job_id: str,
    status: str,
    playbook: str,
    node: str | None,
    started_at: str | None,
    finished_at: str | None,
    api_key_id: int | None = None,
    api_key_name: str | None = None,
    verify_ssl: bool = True,
) -> None:
    """Fire-and-forget webhook dispatch. Up to 3 attempts with exponential backoff.

    All failures are logged to external_api_log; they never affect job status.
    """
    payload = {
        "job_id": job_id,
        "status": status,
        "playbook": playbook,
        "node": node,
        "started_at": started_at,
        "finished_at": finished_at,
    }
    timeout = settings.webhook_timeout_seconds
    last_exc: str = ""

    # PROJ-67 Phase 1 – F-002: Allowlist + URL validation (once, before retries)
    from backend.core.http_client import validate_webhook_url
    allowlist = await _load_allowlist_patterns()
    try:
        validate_webhook_url(callback_url, allowlist_patterns=allowlist or None)
    except ValueError as exc:
        last_exc = str(exc)
        logger.warning("Webhook URL validation fehlgeschlagen für Job %s: %s", job_id, last_exc)
        _log_callback(
            api_key_id, api_key_name or "unknown",
            callback_url, None, 1, success=False, error=last_exc,
        )
        return

    for attempt, delay in enumerate([0] + _RETRY_DELAYS, start=1):
        if delay:
            await asyncio.sleep(delay)
        try:
            # PROJ-67 Phase 1 – F-002: DNS-Rebinding check before each attempt
            from urllib.parse import urlparse as _urlparse
            _hostname = _urlparse(callback_url).hostname or ""
            _safe, _resolved_ip = check_dns_rebinding(_hostname)
            if not _safe:
                last_exc = f"DNS-Rebinding geblockt ({_resolved_ip or 'unresolvable'})"
                logger.warning("Webhook DNS-Rebinding check failed for %s: %s", callback_url, last_exc)
                break  # no retry on security block

            # Pin auf die geprüfte IP, damit httpx nicht ein drittes Mal auflöst
            # (TOCTOU-Fenster zwischen Check und Request). SNI/Host bleiben der
            # Original-Hostname → TLS-Verifikation bei verify_ssl=True intakt.
            _pinned_url, _extra_headers = pin_url_to_ip(callback_url, _resolved_ip)
            _extensions = {"sni_hostname": _hostname} if _hostname else None
            async with secure_outbound_client(timeout=timeout, verify=verify_ssl) as client:
                response = await client.post(
                    _pinned_url, json=payload, headers=_extra_headers,
                    extensions=_extensions,
                )
            if response.is_success:
                _log_callback(
                    api_key_id, api_key_name or "unknown",
                    callback_url, response.status_code, attempt, success=True,
                )
                return
            last_exc = f"HTTP {response.status_code}"
        except Exception as exc:
            last_exc = str(exc)

        logger.warning(
            "Webhook attempt %d/%d failed for job %s: %s",
            attempt, len(_RETRY_DELAYS) + 1, job_id, last_exc,
        )

    _log_callback(
        api_key_id, api_key_name or "unknown",
        callback_url, None, len(_RETRY_DELAYS) + 1, success=False, error=last_exc,
    )


def _log_callback(
    api_key_id: int | None,
    api_key_name: str,
    callback_url: str,
    status_code: int | None,
    attempt: int,
    *,
    success: bool,
    error: str = "",
    user_id: int | None = None,
) -> None:
    from backend.features.api_surface.audit import log_api_call

    asyncio.ensure_future(
        log_api_call(
            api_key_id=api_key_id or 0,
            user_id=user_id,
            api_key_name=api_key_name,
            scope_used="webhook",
            method="POST",
            endpoint=callback_url,
            status_code=status_code or 0,
            callback_url=callback_url,
        )
    )
    label = "ok" if success else f"failed after {attempt} attempts: {error}"
    logger.info("Webhook %s (attempt %d): %s", label, attempt, callback_url)
