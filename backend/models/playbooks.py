# p3portal.org
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class PlaybookParameter(BaseModel):
    id: str
    label: str
    type: str  # string | integer | dropdown | bool | ssh_key | password | target_host | proxmox_node | proxmox_template | proxmox_bridge | ip_config | vm_access
    required: bool = False
    default: str | int | bool | None = None
    min: int | None = None
    max: int | None = None
    options: list[dict] | None = None


class PlaybookPreset(BaseModel):
    label: str
    values: dict[str, str | int | bool | float]


class PlaybookMeta(BaseModel):
    name: str
    description: str
    playbook: str
    required_role: str | None = None
    category: str | None = None  # vm_deployment | lxc_deployment | vm_lxc_config
    parameters: list[PlaybookParameter] = []
    presets: list[PlaybookPreset] = []
    approval: dict | None = None  # PROJ-50: optionaler approval:-Block für Approval-Workflow
    # PROJ-83: Gast-Playbook-Erkennung. Default "localhost" = 100% rückwärtskompatibel
    # (bestehende Playbooks laufen unverändert ohne Inventory). "guest" blendet im
    # Formular Scope-Wahl + Host-Selektor ein und lässt den Run über das dynamische
    # Inventory + TOFU-SSH gegen die Gäste laufen.
    targets: Literal["localhost", "guest"] = "localhost"
    # PROJ-83: steuert --become zur Laufzeit (nur Gast-Playbooks). Kein become-Passwort.
    become: bool = False


class PlaybookSummary(BaseModel):
    id: str
    name: str
    description: str
    required_role: str | None = None
    category: str | None = None
    can_execute: bool | None = None  # PROJ-49: gesetzt wenn user_id bekannt
    targets: Literal["localhost", "guest"] = "localhost"  # PROJ-83


class PlaybookDetail(PlaybookSummary):
    parameters: list[PlaybookParameter]
    presets: list[PlaybookPreset] = []
