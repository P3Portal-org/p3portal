# p3portal.org
"""PROJ-67 / Code-Review: SSRF-Härtung im Webhook-Dispatch.

Regressionstests für den TOCTOU-Fix: nach dem DNS-Rebinding-Check muss der
HTTP-Request auf die *geprüfte IP* gepinnt werden (kein dritter DNS-Resolve),
während SNI/Host der Original-Hostname bleiben (TLS bei verify_ssl=True intakt).
"""
from __future__ import annotations

from contextlib import asynccontextmanager

import pytest

from backend.services import webhook_service


class _FakeResponse:
    is_success = True
    status_code = 200


class _FakeClient:
    """Zeichnet den post()-Aufruf auf, statt einen echten Request zu senden."""

    def __init__(self, recorder: dict):
        self._rec = recorder

    async def post(self, url, **kwargs):
        self._rec["url"] = url
        self._rec["headers"] = kwargs.get("headers")
        self._rec["extensions"] = kwargs.get("extensions")
        return _FakeResponse()


def _patch_common(monkeypatch, recorder: dict, *, safe: bool, resolved_ip: str):
    @asynccontextmanager
    async def _fake_client(*a, **k):
        yield _FakeClient(recorder)

    monkeypatch.setattr(webhook_service, "secure_outbound_client", _fake_client)
    monkeypatch.setattr(webhook_service, "check_dns_rebinding", lambda h: (safe, resolved_ip))
    monkeypatch.setattr(webhook_service, "_log_callback", lambda *a, **k: None)

    async def _no_allowlist():
        return []

    monkeypatch.setattr(webhook_service, "_load_allowlist_patterns", _no_allowlist)
    # validate_webhook_url wird lazy importiert → am Quellmodul patchen
    monkeypatch.setattr("backend.core.http_client.validate_webhook_url", lambda *a, **k: None)


@pytest.mark.asyncio
async def test_dispatch_pins_to_resolved_ip_with_sni(monkeypatch):
    rec: dict = {}
    _patch_common(monkeypatch, rec, safe=True, resolved_ip="93.184.216.34")

    await webhook_service.dispatch_webhook(
        callback_url="https://hooks.example.com/notify",
        job_id="j1", status="success", playbook="pb", node=None,
        started_at=None, finished_at=None,
    )

    # Request geht an die IP, nicht an den Hostnamen (kein TOCTOU-Resolve).
    assert "93.184.216.34" in rec["url"]
    assert "hooks.example.com" not in rec["url"]
    # Host-Header + SNI behalten den Original-Hostnamen → TLS bleibt prüfbar.
    assert rec["headers"]["Host"] == "hooks.example.com"
    assert rec["extensions"] == {"sni_hostname": "hooks.example.com"}


@pytest.mark.asyncio
async def test_dispatch_blocks_on_rebinding(monkeypatch):
    rec: dict = {}
    _patch_common(monkeypatch, rec, safe=False, resolved_ip="10.0.0.5")

    await webhook_service.dispatch_webhook(
        callback_url="https://rebind.example.com/notify",
        job_id="j2", status="success", playbook="pb", node=None,
        started_at=None, finished_at=None,
    )

    # Kein HTTP-Request, wenn der Rebinding-Check die (private) IP ablehnt.
    assert rec == {}
