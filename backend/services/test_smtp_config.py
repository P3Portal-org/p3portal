# p3portal.org
"""Code-Review-Fix: SMTP-Config nutzt config_service.get_config/set_config.

Bewusst OHNE Mock von get_smtp_config/update_smtp_config – die deployten
test_router_alerts-Tests mocken diese Funktionen und maskierten damit den
ImportError (`from config_service import get/set` existiert nicht).
"""
from __future__ import annotations

import pytest
import pytest_asyncio

from backend.core.config import settings
from backend.db.database import init_db
from backend.services.alert_rule_service import get_smtp_config, update_smtp_config


@pytest.fixture(autouse=True)
def _patch_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture(autouse=True)
async def _db(_patch_data_dir):
    await init_db()


@pytest.mark.asyncio
async def test_get_smtp_config_unconfigured_does_not_raise():
    # Vor dem Fix: ImportError (config_service hat kein 'get').
    cfg = await get_smtp_config()
    assert cfg["configured"] is False
    assert cfg["host"] is None


@pytest.mark.asyncio
async def test_update_then_get_smtp_config_roundtrips_password():
    await update_smtp_config({
        "host": "smtp.example.com",
        "port": 587,
        "username": "alerts@example.com",
        "password": "s3cr3t-pw",
        "use_tls": True,
        "from_address": "alerts@example.com",
    })

    cfg = await get_smtp_config()
    assert cfg["configured"] is True
    assert cfg["host"] == "smtp.example.com"
    assert cfg["port"] == 587
    assert cfg["use_tls"] is True
    # get_smtp_config gibt das Passwort bewusst NICHT zurück
    assert "password" not in cfg

    # Der E-Mail-Pfad (alert_notification_service) liest das Passwort genauso:
    # get_config entschlüsselt is_secret-Keys intern → Klartext, KEIN Doppel-Decrypt.
    from backend.services.config_service import get_config
    assert await get_config("smtp_password") == "s3cr3t-pw"
