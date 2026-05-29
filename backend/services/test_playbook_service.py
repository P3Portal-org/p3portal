# p3portal.org
from __future__ import annotations

import io
import zipfile

import pytest

from backend.services.playbook_service import save_playbook_zip

_VALID_META = """\
name: Test Playbook
description: A test
playbook: pb_test.yml
required_role: operator
parameters: []
"""


def _make_zip(*extra_entries: tuple[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("meta.yaml", _VALID_META)
        zf.writestr("pb_test.yml", "---")
        for entry_name, content in extra_entries:
            zf.writestr(zipfile.ZipInfo(entry_name), content)
    return buf.getvalue()


def test_save_playbook_zip_rejects_absolute_path(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.playbook_service.settings.ansible_dir", str(tmp_path))
    zip_bytes = _make_zip(("/etc/pwned", "should not land here"))
    with pytest.raises(ValueError, match=r"Ungültiger Pfad|absolute path"):
        save_playbook_zip(zip_bytes)


def test_save_playbook_zip_rejects_backslash_absolute(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.playbook_service.settings.ansible_dir", str(tmp_path))
    zip_bytes = _make_zip(("\\windows\\system32\\evil", "x"))
    with pytest.raises(ValueError, match=r"Ungültiger Pfad|absolute path"):
        save_playbook_zip(zip_bytes)


def test_save_playbook_zip_rejects_dotdot_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.playbook_service.settings.ansible_dir", str(tmp_path))
    zip_bytes = _make_zip(("../outside", "x"))
    with pytest.raises(ValueError, match=r"Ungültiger Pfad|Path traversal"):
        save_playbook_zip(zip_bytes)


def test_save_playbook_zip_accepts_valid_zip(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.playbook_service.settings.ansible_dir", str(tmp_path))
    monkeypatch.setattr("backend.services.playbook_service._load_all_metas", lambda: [])
    zip_bytes = _make_zip(("files/extra.txt", "content"))
    playbook_id = save_playbook_zip(zip_bytes)
    assert playbook_id == "pb_test"
    assert (tmp_path / "pb_test" / "meta.yaml").exists()
    assert (tmp_path / "pb_test" / "files" / "extra.txt").read_text() == "content"
