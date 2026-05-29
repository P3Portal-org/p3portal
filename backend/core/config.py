# p3portal.org
from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# PROJ-67: Bekannte Default/Placeholder-Strings die nicht als SECRET_KEY akzeptiert werden
_FORBIDDEN_SECRET_KEYS = frozenset({
    "change-me-min-32-chars-random-string",
    "secret",
    "admin",
    "test",
    "password",
    "changeme",
    "default",
})


class Settings(BaseSettings):
    proxmox_host: str = ""           # optional – configured via setup wizard (stored in DB)
    proxmox_node: str = ""          # optional – configured via setup wizard (stored in DB)
    proxmox_verify_ssl: bool = True
    secret_key: str
    data_dir: str = "/app/data"
    plus_license_path: str = "/app/data/plus.lic"  # PROJ-16: Plus edition gate (in data volume)
    plus_enc_path: str = "/app/plus.enc"            # PROJ-17: Encrypted token (built into image)

    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 8

    ansible_dir: str = "/app/ansible"

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:8080"]

    admin_username: str = "admin"
    admin_password: str = "change-me-on-first-start"

    # PROJ-9: External API rate limiting + webhook timeout
    external_job_max_concurrent: int = 0     # 0 = unlimited
    webhook_timeout_seconds: int = 10

    # DB-URL: leer = SQLite in data_dir; für PostgreSQL/MariaDB hier setzen
    # Beispiele:
    #   postgresql+asyncpg://user:pass@host/dbname
    #   mysql+aiomysql://user:pass@host/dbname
    db_url: str = ""

    # PROJ-71: Connection-Pool-Tuning (PostgreSQL; ignoriert von SQLite/aiosqlite)
    db_pool_size: int = 10
    db_pool_max_overflow: int = 20

    packer_dir: str = "/app/packer"
    # PROJ-6: Proxmox API-Token für Packer-Builds (beide optional – Build-Start schlägt fehl wenn nicht gesetzt)
    packer_token_id: str | None = None
    packer_token_secret: str | None = None
    # IP des Portal-Hosts, die Proxmox-VMs während des Builds erreichen können (für preseed HTTP-Server)
    packer_http_ip: str | None = None

    # PROJ-10: Proxmox Service-Account API-Tokens (alle optional – App startet ohne sie)
    proxmox_viewer_token_id: str | None = None
    proxmox_viewer_token_secret: str | None = None
    proxmox_operator_token_id: str | None = None
    proxmox_operator_token_secret: str | None = None
    proxmox_admin_token_id: str | None = None
    proxmox_admin_token_secret: str | None = None

    # PROJ-67 Phase 1 – F-016: API-Docs standardmäßig deaktiviert
    expose_api_docs: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("secret_key", mode="after")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        """Strict SECRET_KEY validation.

        Aborts startup if the key is too short or a known default string.
        Generate a new key with: python -c "import secrets; print(secrets.token_urlsafe(48))"
        """
        stripped = v.strip()
        if len(stripped) < 32:
            raise ValueError(
                f"SECRET_KEY ist zu kurz ({len(stripped)} Zeichen). "
                "Mindestens 32 Zeichen erforderlich. "
                "Generiere einen sicheren Key: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        if stripped.lower() in _FORBIDDEN_SECRET_KEYS:
            raise ValueError(
                "SECRET_KEY ist ein bekannter Placeholder/Default-String und darf nicht verwendet werden. "
                "Generiere einen sicheren Key: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        return v


settings = Settings()
