# p3portal.org
from __future__ import annotations

from typing import Literal

from pydantic import AnyHttpUrl, BaseModel


class GuestScopeRef(BaseModel):
    """PROJ-83: Scope-Auswahl für einen In-Guest-Run."""
    kind: Literal["user", "pool", "global"]
    ref: int | None = None   # pool_id bei kind="pool"


class JobCreate(BaseModel):
    playbook: str
    params: dict = {}
    auto_assign_owner: bool = True       # PROJ-48: Checkbox „Mich als Owner eintragen"
    callback_url: AnyHttpUrl | None = None  # PROJ-44: optionaler Webhook nach Job-Abschluss
    pool_id: int | None = None           # PROJ-62: optionaler Pool-Kontext für Auto-Member-Add + Quota-Check
    # PROJ-83: In-Guest-Playbook-Run (nur bei meta.targets == "guest")
    guest_scope: GuestScopeRef | None = None
    target_hosts: list[str] | None = None    # host_refs; leer/None = ganzer Scope
    # Deploy-Onboarding-Haken (nur bei Deploy-Playbooks relevant; hier durchgereicht)
    manage_for_ansible: bool = True
    global_opt_in: bool = False


class JobResponse(BaseModel):
    id: str
    type: str
    playbook: str
    status: str
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    username: str
    params: dict
