# p3portal.org
from pydantic import BaseModel, field_validator


class LoginRequest(BaseModel):
    username: str
    password: str
    realm: str = "pam"

    @field_validator("username", "password")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be empty")
        return v


class LocalLoginRequest(BaseModel):
    username: str
    password: str

    @field_validator("username", "password")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be empty")
        return v


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class PermissionsResponse(BaseModel):
    username: str
    capabilities: dict
    groups: list[str]


class MeResponse(BaseModel):
    username: str
    auth_type: str
    role: str


class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: str = "operator"

    @field_validator("username")
    @classmethod
    def no_at_sign(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be empty")
        if "@" in v:
            raise ValueError("local usernames must not contain '@'")
        return v

    @field_validator("password")
    @classmethod
    def min_length(cls, v: str) -> str:
        if len(v) < 10:
            raise ValueError("password must be at least 10 characters")
        return v

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in ("admin", "operator", "viewer", "restricted"):
            raise ValueError("role must be admin, operator, viewer, or restricted")
        return v


class UserUpdateRequest(BaseModel):
    password: str | None = None
    role: str | None = None
    active: bool | None = None

    @field_validator("password")
    @classmethod
    def min_length(cls, v: str | None) -> str | None:
        if v is not None and len(v) < 10:
            raise ValueError("password must be at least 10 characters")
        return v

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str | None) -> str | None:
        if v is not None and v not in ("admin", "operator", "viewer", "restricted"):
            raise ValueError("role must be admin, operator, viewer, or restricted")
        return v


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    active: bool
    created_at: str
    portal_permissions: list[str] = []
    group_names: list[str] = []
    preset_names: list[str] = []


class PortalPermissionsRequest(BaseModel):
    portal_permissions: list[str]

    @field_validator("portal_permissions")
    @classmethod
    def valid_permissions(cls, v: list[str]) -> list[str]:
        from backend.core.plus_protocol import plus_behavior
        # PROJ-64: approve_jobs ist Plus-only → kommt via get_extra_portal_permissions()
        core_perms = {"view_logs", "manage_users", "manage_nodes", "manage_settings", "manage_api_keys", "manage_announcements", "manage_groups", "manage_help", "manage_backup_jobs", "manage_networks", "manage_sdn", "manage_firewall"}
        try:
            extra = set(plus_behavior.get_extra_portal_permissions())
        except Exception:
            extra = set()
        allowed = core_perms | extra
        invalid = set(v) - allowed
        if invalid:
            raise ValueError(f"Unknown portal permissions: {invalid}. Allowed: {allowed}")
        return list(dict.fromkeys(v))
