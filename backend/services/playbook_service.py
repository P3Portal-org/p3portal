# p3portal.org
from __future__ import annotations

import io
import itertools
import re
import shutil
import zipfile
from pathlib import Path

import yaml
from pydantic import ValidationError

from backend.core.config import settings
from backend.models.playbooks import PlaybookDetail, PlaybookMeta, PlaybookSummary
from backend.services._zip_safety import UnsafeZipMember, extract_zip_safely

_PLAYBOOK_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$")


def _playbook_id(playbook_file: str) -> str:
    return Path(playbook_file).stem


def _load_all_metas() -> list[tuple[str, PlaybookMeta]]:
    ansible_dir = Path(settings.ansible_dir)
    if not ansible_dir.is_dir():
        return []

    # Only search at depth 0 (ansible root) and depth 1 (direct subdirectories).
    # Deeper meta.yaml files belong to Ansible roles, not to portal playbook definitions.
    meta_files = sorted(itertools.chain(
        ansible_dir.glob("meta.yaml"),
        ansible_dir.glob("*/meta.yaml"),
    ))

    results: list[tuple[str, PlaybookMeta]] = []
    seen_ids: set[str] = set()
    for meta_file in meta_files:
        try:
            raw = yaml.safe_load(meta_file.read_text())
            meta = PlaybookMeta.model_validate(raw)
            pid = _playbook_id(meta.playbook)
            if pid in seen_ids:
                continue
            seen_ids.add(pid)
            results.append((pid, meta))
        except (yaml.YAMLError, ValidationError, OSError):
            continue
    return results


def list_playbooks() -> list[PlaybookSummary]:
    return [
        PlaybookSummary(
            id=pid,
            name=meta.name,
            description=meta.description,
            required_role=meta.required_role,
            category=meta.category,
            targets=meta.targets,
        )
        for pid, meta in _load_all_metas()
    ]


def get_playbook(playbook_id: str) -> PlaybookDetail | None:
    for pid, meta in _load_all_metas():
        if pid == playbook_id:
            return PlaybookDetail(
                id=pid,
                name=meta.name,
                description=meta.description,
                required_role=meta.required_role,
                category=meta.category,
                parameters=meta.parameters,
                presets=meta.presets,
                targets=meta.targets,
            )
    return None


def get_playbook_description(playbook_id: str) -> str | None:
    """Return content of description.md next to the playbook's meta.yaml, or None."""
    ansible_dir = Path(settings.ansible_dir)
    if not ansible_dir.is_dir():
        return None
    for meta_file in sorted(ansible_dir.rglob("meta.yaml")):
        try:
            raw = yaml.safe_load(meta_file.read_text())
            meta = PlaybookMeta.model_validate(raw)
            if _playbook_id(meta.playbook) == playbook_id:
                desc_file = meta_file.parent / "description.md"
                return desc_file.read_text(encoding="utf-8") if desc_file.is_file() else None
        except (yaml.YAMLError, ValidationError, OSError):
            continue
    return None


def get_sensitive_param_ids(playbook_id: str) -> set[str]:
    """Return parameter ids that must not be persisted (type ssh_key or password)."""
    detail = get_playbook(playbook_id)
    if detail is None:
        return set()
    return {p.id for p in detail.parameters if p.type in ("ssh_key", "password")}


def validate_params(playbook_id: str, params: dict) -> list[str]:
    """Validate params against meta.yaml constraints. Returns list of error messages."""
    detail = get_playbook(playbook_id)
    if detail is None:
        return [f"Playbook '{playbook_id}' not found"]

    errors: list[str] = []
    for p in detail.parameters:
        if p.type in ("vm_access", "ssh_key"):
            continue

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


def save_playbook_zip(zip_content: bytes) -> str:
    """Extract a ZIP archive into the ansible directory. Returns the playbook_id."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_content))
    except zipfile.BadZipFile:
        raise ValueError("Ungültige ZIP-Datei")

    names = [n for n in zf.namelist() if n]
    for name in names:
        parts = [p for p in name.replace("\\", "/").split("/") if p]
        if any(p == ".." for p in parts):
            raise ValueError(f"Ungültiger Pfad in ZIP: {name}")

    # Detect flat vs. wrapped (single top-level directory)
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

    # Find and validate meta.yaml
    meta_entries = [n for n in names if n[len(prefix):] == "meta.yaml" and n.startswith(prefix)]
    if not meta_entries:
        raise ValueError("ZIP enthält keine meta.yaml")
    try:
        raw_dict = yaml.safe_load(zf.read(meta_entries[0]))
        meta = PlaybookMeta.model_validate(raw_dict)
    except (yaml.YAMLError, ValidationError) as exc:
        raise ValueError(f"meta.yaml ungültig: {exc}")

    # Derive and validate playbook_id from meta.playbook filename
    playbook_id = _playbook_id(meta.playbook)
    if not _PLAYBOOK_ID_RE.match(playbook_id):
        raise ValueError(f"Playbook-Dateiname '{playbook_id}' ist ungültig (erlaubt: Buchstaben, Ziffern, - _ .)")

    # Ensure playbook yml exists in ZIP
    yml_entries = [n for n in names if n.startswith(prefix) and n[len(prefix):] == meta.playbook]
    if not yml_entries:
        raise ValueError(f"Playbook-Datei '{meta.playbook}' fehlt im ZIP")

    # Check for existing playbook with same ID
    if any(pid == playbook_id for pid, _ in _load_all_metas()):
        raise FileExistsError(f"Playbook '{playbook_id}' existiert bereits")

    ansible_dir = Path(settings.ansible_dir)
    dest_dir = ansible_dir / playbook_id
    if dest_dir.exists():
        raise FileExistsError(f"Verzeichnis '{playbook_id}' existiert bereits")

    dest_dir.mkdir(parents=True, exist_ok=False)
    try:
        extract_zip_safely(
            zf,
            dest_dir,
            name_filter=names,
            name_strip_prefix=prefix,
        )
    except UnsafeZipMember as exc:
        # Roll back the directory we just created so a rejected upload
        # leaves no half-written state behind.
        shutil.rmtree(dest_dir, ignore_errors=True)
        raise ValueError(f"Ungültiger Pfad in ZIP: {exc}") from exc
    except Exception:
        shutil.rmtree(dest_dir, ignore_errors=True)
        raise

    return playbook_id


def delete_playbook(playbook_id: str) -> bool:
    """Remove the playbook subdirectory. Returns False if not found or root-level."""
    ansible_dir = Path(settings.ansible_dir)
    if not ansible_dir.is_dir():
        return False
    for meta_file in ansible_dir.glob("*/meta.yaml"):
        try:
            raw = yaml.safe_load(meta_file.read_text())
            meta = PlaybookMeta.model_validate(raw)
            if _playbook_id(meta.playbook) == playbook_id:
                shutil.rmtree(meta_file.parent)
                return True
        except (yaml.YAMLError, ValidationError, OSError):
            continue
    return False
