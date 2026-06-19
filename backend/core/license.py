# p3portal.org
"""PROJ-17: Plus-Lizenz-Verifikation via Envelope Encryption + HMAC.

Entschlüsselungsablauf beim ersten Aufruf von get_license_status():
  1. plus.lic lesen → license_id, expiry, edition, contact_*, key_field, mac
  2. customer_secret = HMAC-SHA256(VENDOR_SALT, license_id)
  3. master_key      = AES-256-GCM-decrypt(key_field, customer_secret)
  4. token           = AES-256-GCM-decrypt(plus.enc, master_key)
  5. token == "P3PLUS_VALID_TOKEN"
  6. mac == HMAC-SHA256(master_key, "license_id|edition|expiry|contact_name|contact_email")
  →  is_plus_edition() = True

PROJ-53: Edition-Rename „Basis" → „Core"
  - Default-Edition (keine/fehlerhafte Lizenz) ist jetzt „core" statt „basis"
  - Backward-Compat: alte Lizenzen mit edition="basis" im JSON werden nach
    MAC-Verifikation intern auf "core" normalisiert (HMAC läuft mit Originalwert)
"""
import base64
import hashlib
import hmac as _hmac
import json
import logging
import time
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)

# Hardcoded in the container image – provides per-customer key derivation uniqueness.
# Not a secret on its own; master_key (never in container) is the actual secret.
VENDOR_SALT: bytes = bytes.fromhex(
    "0d5d6cb71d74d246e8f3136848e7143039b18565f2651a6dfa8e1d1ae9c65c02"
)

_PLUS_TOKEN = b"P3PLUS_VALID_TOKEN"

# PROJ-94: license status cache with a 60-second TTL (was: cached once forever).
# A date-based trial must expire lazily without a restart, so the status is
# re-evaluated at most once per minute. reset_license_cache() forces an immediate
# re-evaluation (license upload / trial start / deactivate).
_TTL_SECONDS = 60.0
_cache: "LicenseStatus | None" = None
_cache_loaded_at: float = 0.0

# PROJ-94: duration of the opt-in Plus trial. Single source of truth — raising it
# later is a one-line release. Honor-based (source-available); the legal boundary
# stays LICENSE-PLUS.
TRIAL_DURATION_DAYS = 30

# PROJ-20: Core edition resource limits
CORE_MAX_USERS = 6
CORE_MAX_PRESETS = 5
# PROJ-45: Core edition group limit
CORE_MAX_GROUPS = 3
# PROJ-46: Core edition pool limit (Plus-only feature in MVP)
CORE_MAX_POOLS = 0
# PROJ-47: Node-Assignments Limit (Plus-only in MVP)
CORE_MAX_NODE_ASSIGNMENTS = 0
# PROJ-48: Owner-Einträge Limit pro User in Core-Edition
CORE_MAX_OWNERSHIPS = 10
# PROJ-54: Sidebar-Pins Limits
CORE_MAX_SIDEBAR_PINS = 5     # hartes Limit für Core-Edition
PLUS_SOFT_WARN_PINS = 10      # Soft-Warnung für Plus (nicht blockierend)
PLUS_HARD_MAX_PINS = 25       # Sanity-Cap für Plus (blockierend)
# PROJ-50: Approval-Workflow Limits
CORE_MAX_APPROVAL_RULES = 3   # max. aktive (required=true) Approval-Regeln in Core
# PROJ-57: P3 Handbuch Limits
CORE_MAX_HELP_OVERRIDES_PER_USER = 10  # max. persönliche Hilfe-Overrides pro User in Core
CORE_MAX_HELP_GLOBAL_OVERRIDES = 0     # globale Overrides sind Plus-only (Admin-Promote)
# Scheduled Jobs: Core-Edition-Limit pro Nutzer (3 Jobs/User → max. 15 bei 5 aktiven Nutzern)
CORE_MAX_SCHEDULED_JOBS_PER_USER = 3


def _normalize_edition(edition: str) -> str:
    """PROJ-53 backward-compat: maps old 'basis' value to 'core'.

    Applied AFTER MAC verification so the HMAC runs over the original edition
    string from the license file. All other edition values pass through unchanged.
    """
    return "core" if edition == "basis" else edition


@dataclass
class LicenseStatus:
    edition: str        # "plus_v1" | "plus_v2" | "core" | "plus_trial"
    valid: bool
    contact_name: str | None
    contact_email: str | None
    expiry: str | None
    reason: str | None  # None | "decryption_failed" | "expired" | "missing" | "tampered" | "trial" | "trial_expired"
    # PROJ-94: trial flags (populated only in the trial branch; default False on all
    # license/key paths). trial_active == valid && edition == "plus_trial".
    trial_used: bool = False
    trial_active: bool = False


def _aes_gcm_decrypt(data: bytes, key: bytes) -> bytes:
    """data = nonce(12 bytes) + ciphertext+tag"""
    return AESGCM(key).decrypt(data[:12], data[12:], None)


def _derive_customer_secret(license_id: str) -> bytes:
    return _hmac.new(VENDOR_SALT, license_id.encode("utf-8"), hashlib.sha256).digest()


def _mac_payload(license_id: str, edition: str, expiry: str | None, contact_name: str | None, contact_email: str | None) -> bytes:
    return "|".join([license_id, edition, expiry or "", contact_name or "", contact_email or ""]).encode("utf-8")


def _verify_mac(payload: bytes, mac_hex: str, master_key: bytes) -> bool:
    expected = _hmac.new(master_key, payload, hashlib.sha256).hexdigest()
    return _hmac.compare_digest(expected, mac_hex)


def _trial_status() -> LicenseStatus:
    """PROJ-94: trial branch — reached ONLY when no plus.lic exists (the 'missing' path).

    Reads the two trial flags DIRECTLY (sync) from the DB — NOT via
    config_service's process-local in-memory cache — so a trial started in the
    web process is also seen by the celery-worker process (Tech-Design §E).
    The 60s TTL of get_license_status() throttles this DB read to ~1×/min/process.

    Never masks a broken key (this is the missing path, no key present).
    """
    # lazy import to avoid a circular import at module load (mirrors the settings import)
    from backend.services.config_service import get_trial_flags_sync

    trial_used, trial_started_at = get_trial_flags_sync()
    if not trial_used or not trial_started_at:
        return LicenseStatus("core", False, None, None, None, "missing")

    try:
        start_date = date.fromisoformat(trial_started_at)
    except (ValueError, TypeError):
        # corrupt start date → treat as never started; do not crash
        logger.warning("PROJ-94: invalid trial_started_at %r", trial_started_at)
        return LicenseStatus("core", False, None, None, None, "missing")

    end_date = start_date + timedelta(days=TRIAL_DURATION_DAYS)
    expiry_str = end_date.isoformat()
    if date.today() <= end_date:
        # active trial → unlocks all Plus capabilities via valid=True
        return LicenseStatus(
            "plus_trial", True, None, None, expiry_str, "trial",
            trial_used=True, trial_active=True,
        )
    # expired trial → hard fall back to Core, exactly like an expired license
    return LicenseStatus(
        "core", False, None, None, expiry_str, "trial_expired",
        trial_used=True, trial_active=False,
    )


def _load_status() -> LicenseStatus:
    from backend.core.config import settings  # lazy to avoid circular import at module load

    lic_path = Path(settings.plus_license_path)
    enc_path = Path(settings.plus_enc_path)

    if not lic_path.exists():
        # PROJ-94: no key file → trial branch may unlock Plus (or report expired/missing)
        return _trial_status()

    # Parse plus.lic
    try:
        lic = json.loads(lic_path.read_bytes())
        license_id: str = lic["license_id"]
        expiry_str: str | None = lic.get("expiry")  # None = unlimited
        key_b64: str = lic["key"]
        edition: str = lic.get("edition", "plus_v1")
        contact_name: str | None = lic.get("contact_name")
        contact_email: str | None = lic.get("contact_email")
    except Exception:
        logger.warning("PROJ-17: plus.lic parse/structure error")
        return LicenseStatus("core", False, None, None, None, "decryption_failed")

    # Expiry check (None = unlimited, skip check)
    if expiry_str is not None:
        try:
            expiry_date = date.fromisoformat(expiry_str)
        except ValueError:
            logger.warning("PROJ-17: plus.lic invalid expiry %r", expiry_str)
            return LicenseStatus("core", False, contact_name, contact_email, expiry_str, "decryption_failed")

        if expiry_date < date.today():
            logger.warning("PROJ-17: plus.lic expired on %s", expiry_str)
            return LicenseStatus(edition, False, contact_name, contact_email, expiry_str, "expired")

    # Decrypt key_field → master_key
    try:
        customer_secret = _derive_customer_secret(license_id)
        master_key = _aes_gcm_decrypt(base64.b64decode(key_b64), customer_secret)
    except Exception:
        logger.warning("PROJ-17: plus.lic key decryption failed")
        return LicenseStatus(edition, False, contact_name, contact_email, expiry_str, "decryption_failed")

    # Decrypt plus.enc → verify token
    if not enc_path.exists():
        logger.warning("PROJ-17: plus.enc not found at %s (deployment error)", enc_path)
        return LicenseStatus(edition, False, contact_name, contact_email, expiry_str, "decryption_failed")

    try:
        token = _aes_gcm_decrypt(enc_path.read_bytes(), master_key)
    except Exception:
        logger.warning("PROJ-17: plus.enc decryption failed (wrong master_key)")
        return LicenseStatus(edition, False, contact_name, contact_email, expiry_str, "decryption_failed")

    if token != _PLUS_TOKEN:
        logger.warning("PROJ-17: plus.enc token mismatch")
        return LicenseStatus(edition, False, contact_name, contact_email, expiry_str, "decryption_failed")

    # Verify HMAC integrity over all tamper-sensitive fields
    mac_hex: str | None = lic.get("mac")
    if not mac_hex:
        logger.warning("PROJ-17: plus.lic missing mac field – old format or tampered")
        return LicenseStatus(edition, False, contact_name, contact_email, expiry_str, "tampered")

    payload = _mac_payload(license_id, edition, expiry_str, contact_name, contact_email)
    if not _verify_mac(payload, mac_hex, master_key):
        logger.warning("PROJ-17: plus.lic mac verification failed – fields tampered")
        return LicenseStatus(edition, False, contact_name, contact_email, expiry_str, "tampered")

    # PROJ-53: normalize "basis" → "core" AFTER MAC verification (MAC uses original edition string)
    return LicenseStatus(_normalize_edition(edition), True, contact_name, contact_email, expiry_str, None)


def get_license_status() -> LicenseStatus:
    """Returns the license status with a 60-second TTL cache (PROJ-94).

    Re-evaluated at most once per minute so a date-based trial expires lazily
    without a restart. The expensive AES-GCM decryption (only with a key present)
    therefore runs at most ~1×/minute. reset_license_cache() forces an immediate
    re-evaluation (license upload / trial start / deactivate).
    """
    global _cache, _cache_loaded_at
    now = time.monotonic()
    if _cache is None or (now - _cache_loaded_at) >= _TTL_SECONDS:
        _cache = _load_status()
        _cache_loaded_at = now
    return _cache


def is_plus_edition() -> bool:
    return get_license_status().valid


def reset_license_cache() -> None:
    """Resets the cached status so the next call re-evaluates immediately.

    Idempotent. Used by license upload / trial start / deactivate, and by tests.
    """
    global _cache, _cache_loaded_at
    _cache = None
    _cache_loaded_at = 0.0
