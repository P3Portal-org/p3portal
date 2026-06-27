# p3portal.org
"""Code-Review (Befund 5): reservierte Runner-Variablen in validate_params blocken.

Ein User darf backend-injizierte Vars (Credentials/Token/Host) nicht als Extra-
Param mitschicken; geblockt aber NUR, wenn sie nicht als meta.yaml-Param
deklariert sind (kein Bruch bestehender Definitionen).
"""
from __future__ import annotations

from types import SimpleNamespace

from backend.services import packer_service, playbook_service


def _param(pid: str, ptype: str = "string"):
    return SimpleNamespace(id=pid, type=ptype, required=False, min=None, max=None, options=None)


def _playbook(params):
    return SimpleNamespace(parameters=params)


# ── Playbook ──────────────────────────────────────────────────────────────────

def test_playbook_blocks_undeclared_reserved_var(monkeypatch):
    monkeypatch.setattr(playbook_service, "get_playbook",
                        lambda pid: _playbook([_param("vm_name")]))
    errors = playbook_service.validate_params("pb", {"vm_name": "web", "api_password": "x"})
    assert any("api_password" in e and "reserviert" in e for e in errors)


def test_playbook_no_false_positive_on_normal_params(monkeypatch):
    monkeypatch.setattr(playbook_service, "get_playbook",
                        lambda pid: _playbook([_param("vm_name"), _param("vm_cores", "integer")]))
    errors = playbook_service.validate_params("pb", {"vm_name": "web", "vm_cores": 2})
    assert errors == []


def test_playbook_declared_reserved_name_is_allowed(monkeypatch):
    # Wenn ein Playbook bewusst einen so benannten Param deklariert → kein Block.
    monkeypatch.setattr(playbook_service, "get_playbook",
                        lambda pid: _playbook([_param("api_user")]))
    errors = playbook_service.validate_params("pb", {"api_user": "deploy@pve"})
    assert errors == []


# ── Packer ────────────────────────────────────────────────────────────────────

def test_packer_blocks_undeclared_token_secret(monkeypatch):
    monkeypatch.setattr(packer_service, "get_packer_template",
                        lambda tid: _playbook([_param("vm_id", "integer")]))
    errors = packer_service.validate_params("tpl", {"proxmox_api_token_secret": "evil"})
    assert any("proxmox_api_token_secret" in e and "reserviert" in e for e in errors)


def test_packer_no_false_positive(monkeypatch):
    monkeypatch.setattr(packer_service, "get_packer_template",
                        lambda tid: _playbook([_param("vm_id", "integer")]))
    errors = packer_service.validate_params("tpl", {"vm_id": 9000})
    assert errors == []
