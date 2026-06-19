# p3portal.org
from __future__ import annotations

import io
import re
import shutil
import zipfile
from pathlib import Path

import yaml
from pydantic import ValidationError

from backend.core.config import settings
from backend.models.packer import PackerDetail, PackerMeta, PackerParameter, PackerSummary
from backend.services._zip_safety import UnsafeZipMember, extract_zip_safely

_CREDENTIAL_IDS = {"proxmox_api_url", "proxmox_api_token_id", "proxmox_api_token_secret"}
_TEMPLATE_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")


def _packer_dir() -> Path:
    return Path(settings.packer_dir)


def _filter_credentials(params: list[PackerParameter]) -> list[PackerParameter]:
    """Remove credential parameters that are injected automatically."""
    return [p for p in params if p.id not in _CREDENTIAL_IDS]


def _load_template(template_dir: Path) -> tuple[str, PackerMeta] | None:
    meta_file = template_dir / "meta.yaml"
    if not meta_file.is_file():
        return None
    try:
        raw = yaml.safe_load(meta_file.read_text())
        meta = PackerMeta.model_validate(raw)
        return template_dir.name, meta
    except (yaml.YAMLError, ValidationError, OSError):
        return None


def _list_all() -> list[tuple[str, PackerMeta]]:
    packer_dir = _packer_dir()
    if not packer_dir.is_dir():
        return []
    results = []
    for entry in sorted(packer_dir.iterdir()):
        if entry.is_dir():
            loaded = _load_template(entry)
            if loaded:
                results.append(loaded)
    return results


def list_packer_templates() -> list[PackerSummary]:
    return [
        PackerSummary(id=tid, name=meta.name, description=meta.description, required_role=meta.required_role)
        for tid, meta in _list_all()
    ]


def get_packer_template(template_id: str) -> PackerDetail | None:
    for tid, meta in _list_all():
        if tid == template_id:
            return PackerDetail(
                id=tid,
                name=meta.name,
                description=meta.description,
                required_role=meta.required_role,
                parameters=_filter_credentials(meta.parameters),
            )
    return None


def find_definition_file(template_id: str) -> Path | None:
    """Return the build-definition file for a template, or None if not found.

    Accepts a hand-written/ZIP/Git ``*.pkr.hcl`` **or** an editor-generated
    ``*.pkr.json`` (PROJ-92, HCL2-JSON). ``packer build <file>`` works with
    either. If both extensions are present, ``.pkr.hcl`` wins (a real HCL file
    takes precedence over a stale generated JSON).
    """
    template_dir = _packer_dir() / template_id
    if not template_dir.is_dir():
        return None
    hcl_files = sorted(template_dir.glob("*.pkr.hcl"))
    if hcl_files:
        return hcl_files[0]
    json_files = sorted(template_dir.glob("*.pkr.json"))
    return json_files[0] if json_files else None


# Backwards-compatible alias (pre-PROJ-92 name).
find_hcl_file = find_definition_file


def get_sensitive_packer_param_ids(template_id: str) -> set[str]:
    """Return parameter IDs that must not be persisted (type ssh_key)."""
    detail = get_packer_template(template_id)
    if detail is None:
        return set()
    return {p.id for p in detail.parameters if p.type == "ssh_key"}


def validate_params(template_id: str, params: dict) -> list[str]:
    """Validate params against meta.yaml constraints. Returns list of error messages."""
    detail = get_packer_template(template_id)
    if detail is None:
        return [f"Template '{template_id}' not found"]

    errors: list[str] = []
    for p in detail.parameters:
        value = params.get(p.id)

        if p.required and (value is None or value == ""):
            errors.append(f"Parameter '{p.id}' is required")
            continue

        if value is None:
            continue

        if p.type == "integer":
            try:
                int_val = int(value)
            except (TypeError, ValueError):
                errors.append(f"Parameter '{p.id}' must be an integer")
                continue
            if p.min is not None and int_val < p.min:
                errors.append(f"Parameter '{p.id}' must be >= {p.min}")
            if p.max is not None and int_val > p.max:
                errors.append(f"Parameter '{p.id}' must be <= {p.max}")

        if p.type == "dropdown" and p.options:
            valid = [str(opt["value"]) for opt in p.options if "value" in opt]
            if valid and str(value) not in valid:
                errors.append(f"Parameter '{p.id}' must be one of: {', '.join(valid)}")

    return errors


def save_template_zip(zip_content: bytes) -> str:
    """
    Validate and persist a new packer template from a ZIP archive.
    ZIP may be flat (files at root) or wrapped in a single subdirectory.
    Returns the new template_id.
    Raises ValueError on validation failure.
    Raises FileExistsError if the template already exists.
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_content))
    except zipfile.BadZipFile:
        raise ValueError("Ungültige ZIP-Datei")

    names = [n for n in zf.namelist() if n]

    # Security: reject path traversal
    for name in names:
        parts = [p for p in name.replace("\\", "/").split("/") if p]
        if any(p == ".." for p in parts):
            raise ValueError(f"Ungültiger Pfad in ZIP: {name}")

    # Detect wrapping: all non-empty paths start with one common directory
    top_level: set[str] = set()
    for name in names:
        first = name.rstrip("/").split("/")[0]
        top_level.add(first)

    prefix = ""
    if len(top_level) == 1:
        candidate = list(top_level)[0]
        files_under = [n for n in names if n.startswith(candidate + "/") and not n.endswith("/")]
        if files_under:
            prefix = candidate + "/"

    # Find .pkr.hcl at the template root (not in subdirs)
    hcl_entries = [
        n for n in names
        if n.startswith(prefix) and n.endswith(".pkr.hcl")
        and "/" not in n[len(prefix):]
    ]
    if not hcl_entries:
        raise ValueError("ZIP enthält keine .pkr.hcl Datei im Template-Verzeichnis")
    if len(hcl_entries) > 1:
        raise ValueError("ZIP enthält mehrere .pkr.hcl Dateien")

    hcl_basename = hcl_entries[0][len(prefix):]
    stem = hcl_basename[: -len(".pkr.hcl")]
    if not _TEMPLATE_ID_RE.match(stem):
        raise ValueError(
            f"HCL-Dateiname '{stem}' ist ungültig. Erlaubt: Buchstaben, Ziffern, - und _ (max. 64 Zeichen)"
        )

    # Find and validate meta.yaml
    meta_name: str | None = None
    for candidate in (prefix + "meta.yaml", prefix + "meta.yml"):
        if candidate in names:
            meta_name = candidate
            break
    if meta_name is None:
        raise ValueError("ZIP enthält keine meta.yaml")

    try:
        raw = yaml.safe_load(zf.read(meta_name).decode("utf-8"))
    except yaml.YAMLError as exc:
        raise ValueError(f"meta.yaml ist kein gültiges YAML: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValueError("meta.yaml muss ein YAML-Mapping sein")
    if not raw.get("name"):
        raise ValueError("meta.yaml: Pflichtfeld 'name' fehlt")
    if not raw.get("description"):
        raise ValueError("meta.yaml: Pflichtfeld 'description' fehlt")
    try:
        PackerMeta.model_validate(raw)
    except ValidationError as exc:
        raise ValueError(f"meta.yaml Validierungsfehler: {exc}") from exc

    # Check for existing template
    template_dir = _packer_dir() / stem
    if template_dir.exists():
        raise FileExistsError(f"Template '{stem}' existiert bereits")

    # Extract all files under prefix into template_dir
    template_dir.mkdir(parents=True, exist_ok=False)
    try:
        extract_zip_safely(
            zf,
            template_dir,
            name_filter=names,
            name_strip_prefix=prefix,
        )
    except UnsafeZipMember as exc:
        shutil.rmtree(template_dir, ignore_errors=True)
        raise ValueError(f"Ungültiger Pfad in ZIP: {exc}") from exc
    except Exception:
        shutil.rmtree(template_dir, ignore_errors=True)
        raise

    return stem


def delete_packer_template(template_id: str) -> bool:
    """Remove the template directory. Returns False if it does not exist."""
    template_dir = _packer_dir() / template_id
    if not template_dir.is_dir():
        return False
    shutil.rmtree(template_dir)
    return True
