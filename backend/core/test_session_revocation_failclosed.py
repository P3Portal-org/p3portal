# p3portal.org
"""Code-Review #6 (Option A): Session-Revocation-Check fail-closed bei echtem DB-Fehler.

Vorher: jede Exception im Revocation-Check wurde geschluckt (fail-open). Jetzt nur
noch der „Tabelle existiert nicht"-Fall (uninitialisierte DB/Tests); jeder andere
DB-Fehler → 503 (eine evtl. widerrufene Session läuft nicht ungeprüft weiter).
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

import backend.services.session_service as session_service
from backend.core import deps
from backend.core.security import create_access_token


def _creds(jti: str = "j1"):
    # auth_type=proxmox → kein local_users-DB-Lookup nötig, Test bleibt DB-frei.
    tok = create_access_token(subject="alice", auth_type="proxmox", role="operator", jti=jti)
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=tok)


# ── Helper ────────────────────────────────────────────────────────────────────

def test_db_not_ready_true_for_missing_table():
    assert deps._db_not_ready(Exception("no such table: user_sessions"))
    assert deps._db_not_ready(Exception('relation "user_sessions" does not exist'))
    assert deps._db_not_ready(Exception("UndefinedTable"))


def test_db_not_ready_false_for_real_error():
    assert not deps._db_not_ready(Exception("connection refused"))
    assert not deps._db_not_ready(Exception("could not connect to server"))


# ── get_current_user-Verhalten ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fails_closed_on_real_db_error(monkeypatch):
    async def _boom(jti):
        raise RuntimeError("connection refused")
    monkeypatch.setattr(session_service, "is_jti_revoked", _boom)
    with pytest.raises(HTTPException) as ei:
        await deps.get_current_user(credentials=_creds())
    assert ei.value.status_code == 503


@pytest.mark.asyncio
async def test_allows_when_table_missing(monkeypatch):
    async def _missing(jti):
        raise RuntimeError("no such table: user_sessions")
    monkeypatch.setattr(session_service, "is_jti_revoked", _missing)
    user = await deps.get_current_user(credentials=_creds())
    assert user.username == "alice"  # durchgelassen (wie bisher)


@pytest.mark.asyncio
async def test_revoked_session_still_rejected(monkeypatch):
    async def _revoked(jti):
        return True
    monkeypatch.setattr(session_service, "is_jti_revoked", _revoked)
    with pytest.raises(HTTPException) as ei:
        await deps.get_current_user(credentials=_creds())
    assert ei.value.status_code == 401


@pytest.mark.asyncio
async def test_valid_session_passes(monkeypatch):
    async def _ok(jti):
        return False
    monkeypatch.setattr(session_service, "is_jti_revoked", _ok)
    user = await deps.get_current_user(credentials=_creds())
    assert user.username == "alice"
