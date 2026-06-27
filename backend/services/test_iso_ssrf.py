# p3portal.org
"""Code-Review (Befund 6): SSRF-Schutz im ISO-URL-Probe (query_url).

query_url darf keine internen Adressen (Loopback/IMDS/Link-Local) proben.
RFC1918 (LAN-Mirror) bleibt erlaubt – das deckt is_unsafe_setup_target ab und
ist in test_http_client separat getestet.
"""
from __future__ import annotations

import pytest

from backend.services import iso_service


@pytest.mark.asyncio
async def test_query_url_blocks_imds(monkeypatch):
    monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "169.254.169.254")
    with pytest.raises(ValueError):
        await iso_service.query_url("http://metadata.evil.test/latest/meta-data/")


@pytest.mark.asyncio
async def test_query_url_blocks_loopback(monkeypatch):
    monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "127.0.0.1")
    with pytest.raises(ValueError):
        await iso_service.query_url("http://localhost.evil.test:8006/")


@pytest.mark.asyncio
async def test_query_url_rejects_unresolvable(monkeypatch):
    monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: None)
    with pytest.raises(ValueError):
        await iso_service.query_url("http://nxdomain.evil.test/")
