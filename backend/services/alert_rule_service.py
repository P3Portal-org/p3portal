# p3portal.org
"""PROJ-34: CRUD + Merge-Logik für Alert-Regeln, Presets, Assignments und Overrides.

Layer-Priorität (höher = gewinnt):
  3 – VM-spezifische Regeln  (scope=vm, selbe Metrik → gewinnt immer)
  2 – Preset-Regeln          (scope=preset, zugewiesenes Preset)
  1 – Globale Regeln         (scope=global, Fallback für VMs ohne Preset)

Threshold-Overrides (Plus) können Preset-Schwellenwerte pro VM überschreiben,
ohne die Preset-Zuweisung zu ändern.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from backend.db.database import get_db
from backend.db.dialect import upsert_or_ignore


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_rule(row) -> dict:
    r = dict(row)
    r["enabled"] = bool(r.get("enabled", 1))
    r["notify_recovery"] = bool(r.get("notify_recovery", 1))
    # JSON-decode numeric thresholds stored as strings
    for field in ("warning_threshold", "critical_threshold"):
        raw = r.get(field)
        if raw is not None:
            try:
                r[field] = json.loads(raw)
            except (TypeError, ValueError):
                r[field] = None
    # Strip encrypted webhook_token from responses
    r.pop("webhook_token", None)
    return r


def _encode_threshold(value: float | None) -> str | None:
    return json.dumps(value) if value is not None else None


# ── Global Rules ──────────────────────────────────────────────────────────────

async def list_global_rules() -> list[dict]:
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT id, scope, preset_id, vmid, node_id, name, metric,
                          warning_threshold, critical_threshold, sustained_polls,
                          enabled, notify_recovery, filesystem,
                          webhook_url, webhook_receiver_type, email_recipients,
                          created_by, created_at, updated_at
                   FROM alert_rules
                   WHERE scope = 'global'
                   ORDER BY created_at"""
            )
        )
        rows = result.mappings().fetchall()
    return [_row_to_rule(r) for r in rows]


async def get_rule_by_id(rule_id: int) -> dict | None:
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT id, scope, preset_id, vmid, node_id, name, metric,
                          warning_threshold, critical_threshold, sustained_polls,
                          enabled, notify_recovery, filesystem,
                          webhook_url, webhook_receiver_type, email_recipients,
                          created_by, created_at, updated_at
                   FROM alert_rules WHERE id = :id"""
            ),
            {"id": rule_id},
        )
        row = result.mappings().fetchone()
    return _row_to_rule(row) if row else None


async def create_rule(
    scope: str,
    name: str,
    metric: str,
    created_by: str,
    warning_threshold: float | None = None,
    critical_threshold: float | None = None,
    sustained_polls: int = 1,
    enabled: bool = True,
    notify_recovery: bool = True,
    filesystem: str | None = None,
    webhook_url: str | None = None,
    webhook_token: str | None = None,
    webhook_receiver_type: str | None = "custom",
    webhook_verify_ssl: bool = True,
    email_recipients: str | None = None,
    preset_id: int | None = None,
    vmid: str | None = None,
    node_id: int | None = None,
) -> dict:
    now = _now()
    # Encrypt webhook_token if present
    enc_token: str | None = None
    if webhook_token:
        from backend.services.config_service import encrypt_secret
        enc_token = encrypt_secret(webhook_token)

    async with get_db() as session:
        result = await session.execute(
            text(
                """INSERT INTO alert_rules
                   (scope, preset_id, vmid, node_id, name, metric,
                    warning_threshold, critical_threshold, sustained_polls,
                    enabled, notify_recovery, filesystem,
                    webhook_url, webhook_token, webhook_receiver_type, webhook_verify_ssl, email_recipients,
                    created_by, created_at, updated_at)
                   VALUES (:scope, :preset_id, :vmid, :node_id, :name, :metric,
                           :wt, :ct, :sp,
                           :enabled, :notify_recovery, :filesystem,
                           :webhook_url, :webhook_token, :webhook_receiver_type, :webhook_verify_ssl, :email_recipients,
                           :created_by, :now, :now)
                   RETURNING id"""
            ),
            {
                "scope": scope,
                "preset_id": preset_id,
                "vmid": vmid,
                "node_id": node_id,
                "name": name,
                "metric": metric,
                "wt": _encode_threshold(warning_threshold),
                "ct": _encode_threshold(critical_threshold),
                "sp": sustained_polls,
                "enabled": 1 if enabled else 0,
                "notify_recovery": 1 if notify_recovery else 0,
                "filesystem": filesystem,
                "webhook_url": webhook_url,
                "webhook_token": enc_token,
                "webhook_receiver_type": webhook_receiver_type or "custom",
                "webhook_verify_ssl": 1 if webhook_verify_ssl else 0,
                "email_recipients": email_recipients,
                "created_by": created_by,
                "now": now,
            },
        )
        row = result.fetchone()
        await session.commit()
    return await get_rule_by_id(row[0])  # type: ignore[index]


async def update_rule(rule_id: int, updates: dict) -> dict | None:
    existing = await get_rule_by_id(rule_id)
    if not existing:
        return None

    fields_map = {
        "name": "name",
        "metric": "metric",
        "warning_threshold": "wt",
        "critical_threshold": "ct",
        "sustained_polls": "sp",
        "enabled": "enabled",
        "notify_recovery": "notify_recovery",
        "filesystem": "filesystem",
        "webhook_url": "webhook_url",
        "webhook_receiver_type": "webhook_receiver_type",
        "webhook_verify_ssl": "webhook_verify_ssl",
        "email_recipients": "email_recipients",
    }

    set_clauses = []
    params: dict[str, Any] = {"id": rule_id, "now": _now()}

    for field, param in fields_map.items():
        if field in updates:
            val = updates[field]
            if field in ("warning_threshold", "critical_threshold"):
                val = _encode_threshold(val)
            elif field in ("enabled", "notify_recovery", "webhook_verify_ssl"):
                val = 1 if val else 0
            set_clauses.append(f"{field} = :{param}")
            params[param] = val

    if "webhook_token" in updates and updates["webhook_token"]:
        from backend.services.config_service import encrypt_secret
        set_clauses.append("webhook_token = :webhook_token")
        params["webhook_token"] = encrypt_secret(updates["webhook_token"])

    set_clauses.append("updated_at = :now")

    if not set_clauses:
        return existing

    async with get_db() as session:
        await session.execute(
            text(f"UPDATE alert_rules SET {', '.join(set_clauses)} WHERE id = :id"),
            params,
        )
        await session.commit()
    return await get_rule_by_id(rule_id)


async def _get_raw_webhook_token(rule_id: int) -> str | None:
    """Return the encrypted webhook_token for a rule (for notification dispatch)."""
    async with get_db() as session:
        result = await session.execute(
            text("SELECT webhook_token FROM alert_rules WHERE id = :id"),
            {"id": rule_id},
        )
        row = result.fetchone()
    return row[0] if row else None


async def delete_rule(rule_id: int) -> bool:
    async with get_db() as session:
        result = await session.execute(
            text("DELETE FROM alert_rules WHERE id = :id"),
            {"id": rule_id},
        )
        await session.commit()
    return result.rowcount > 0


# ── Preset Rules ──────────────────────────────────────────────────────────────

async def list_preset_rules(preset_id: int) -> list[dict]:
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT id, scope, preset_id, vmid, node_id, name, metric,
                          warning_threshold, critical_threshold, sustained_polls,
                          enabled, notify_recovery, filesystem,
                          webhook_url, webhook_receiver_type, email_recipients,
                          created_by, created_at, updated_at
                   FROM alert_rules
                   WHERE scope = 'preset' AND preset_id = :preset_id
                   ORDER BY created_at"""
            ),
            {"preset_id": preset_id},
        )
        rows = result.mappings().fetchall()
    return [_row_to_rule(r) for r in rows]


# ── VM-specific Rules ─────────────────────────────────────────────────────────

async def list_vm_rules(node_id: int, vmid: str) -> list[dict]:
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT id, scope, preset_id, vmid, node_id, name, metric,
                          warning_threshold, critical_threshold, sustained_polls,
                          enabled, notify_recovery, filesystem,
                          webhook_url, webhook_receiver_type, email_recipients,
                          created_by, created_at, updated_at
                   FROM alert_rules
                   WHERE scope = 'vm' AND node_id = :node_id AND vmid = :vmid
                   ORDER BY created_at"""
            ),
            {"node_id": node_id, "vmid": vmid},
        )
        rows = result.mappings().fetchall()
    return [_row_to_rule(r) for r in rows]


# ── Presets ───────────────────────────────────────────────────────────────────

async def list_presets() -> list[dict]:
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT p.id, p.name, p.description, p.created_by, p.created_at,
                          COUNT(DISTINCT r.id) AS rule_count,
                          COUNT(DISTINCT a.id) AS vm_count
                   FROM alert_presets p
                   LEFT JOIN alert_rules r ON r.preset_id = p.id
                   LEFT JOIN alert_preset_assignments a ON a.preset_id = p.id
                   GROUP BY p.id
                   ORDER BY p.name"""
            )
        )
        rows = result.mappings().fetchall()
    return [dict(r) for r in rows]


async def get_preset_by_id(preset_id: int) -> dict | None:
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT p.id, p.name, p.description, p.created_by, p.created_at,
                          COUNT(DISTINCT r.id) AS rule_count,
                          COUNT(DISTINCT a.id) AS vm_count
                   FROM alert_presets p
                   LEFT JOIN alert_rules r ON r.preset_id = p.id
                   LEFT JOIN alert_preset_assignments a ON a.preset_id = p.id
                   WHERE p.id = :id
                   GROUP BY p.id"""
            ),
            {"id": preset_id},
        )
        row = result.mappings().fetchone()
    return dict(row) if row else None


async def create_preset(
    name: str,
    description: str | None,
    created_by: str,
    rules: list[dict] | None = None,
) -> dict:
    now = _now()
    async with get_db() as session:
        result = await session.execute(
            text(
                """INSERT INTO alert_presets (name, description, created_by, created_at)
                   VALUES (:name, :description, :created_by, :now)
                   RETURNING id"""
            ),
            {"name": name, "description": description, "created_by": created_by, "now": now},
        )
        preset_id = result.fetchone()[0]
        await session.commit()

    if rules:
        for rule_data in rules:
            await create_rule(
                scope="preset",
                preset_id=preset_id,
                created_by=created_by,
                **{k: v for k, v in rule_data.items() if k not in ("scope", "preset_id")},
            )

    preset = await get_preset_by_id(preset_id)
    if preset:
        preset["rules"] = await list_preset_rules(preset_id)
    return preset or {}


async def update_preset(
    preset_id: int,
    name: str | None = None,
    description: str | None = None,
    rules: list[dict] | None = None,
    updated_by: str = "admin",
) -> dict | None:
    existing = await get_preset_by_id(preset_id)
    if not existing:
        return None

    set_clauses = []
    params: dict[str, Any] = {"id": preset_id}

    if name is not None:
        set_clauses.append("name = :name")
        params["name"] = name
    if description is not None:
        set_clauses.append("description = :description")
        params["description"] = description

    if set_clauses:
        async with get_db() as session:
            await session.execute(
                text(f"UPDATE alert_presets SET {', '.join(set_clauses)} WHERE id = :id"),
                params,
            )
            await session.commit()

    if rules is not None:
        # Snapshot encrypted webhook tokens of the existing preset rules so we
        # can preserve them across the DELETE+INSERT cycle when the client
        # didn't resend the token (server never exposes tokens in clear text,
        # so the user can't be expected to retype them on every preset edit).
        async with get_db() as session:
            tok_result = await session.execute(
                text(
                    """SELECT name, metric, webhook_token
                       FROM alert_rules
                       WHERE scope = 'preset' AND preset_id = :id
                         AND webhook_token IS NOT NULL"""
                ),
                {"id": preset_id},
            )
            existing_tokens: dict[tuple[str, str], str] = {
                (row["name"], row["metric"]): row["webhook_token"]
                for row in tok_result.mappings().fetchall()
            }

        async with get_db() as session:
            await session.execute(
                text("DELETE FROM alert_rules WHERE scope = 'preset' AND preset_id = :id"),
                {"id": preset_id},
            )
            await session.commit()
        for rule_data in rules:
            new_rule = await create_rule(
                scope="preset",
                preset_id=preset_id,
                created_by=updated_by,
                **{k: v for k, v in rule_data.items() if k not in ("scope", "preset_id")},
            )
            # If the client did NOT supply a new token but we had one for the
            # same (name, metric) before, re-attach it without re-encrypting.
            if not rule_data.get("webhook_token"):
                key = (rule_data.get("name"), rule_data.get("metric"))
                prior = existing_tokens.get(key)
                if prior and new_rule:
                    async with get_db() as session:
                        await session.execute(
                            text("UPDATE alert_rules SET webhook_token = :tok WHERE id = :id"),
                            {"tok": prior, "id": new_rule["id"]},
                        )
                        await session.commit()

    preset = await get_preset_by_id(preset_id)
    if preset:
        preset["rules"] = await list_preset_rules(preset_id)
    return preset


async def delete_preset(preset_id: int) -> bool:
    async with get_db() as session:
        result = await session.execute(
            text("DELETE FROM alert_presets WHERE id = :id"),
            {"id": preset_id},
        )
        await session.commit()
    return result.rowcount > 0


# ── Preset Assignments ────────────────────────────────────────────────────────

async def assign_preset(preset_id: int, vmid: str, node_id: int) -> dict | None:
    now = _now()
    # Remove any existing assignment for this VM first (one preset per VM)
    async with get_db() as session:
        await session.execute(
            text(
                "DELETE FROM alert_preset_assignments WHERE vmid = :vmid AND node_id = :node_id"
            ),
            {"vmid": vmid, "node_id": node_id},
        )
        # Also reset alert states for this VM so they re-evaluate under new preset
        await session.execute(
            text(
                "DELETE FROM alert_states WHERE vmid = :vmid AND node_id = :node_id"
            ),
            {"vmid": vmid, "node_id": node_id},
        )
        result = await session.execute(
            text(
                """INSERT INTO alert_preset_assignments (preset_id, vmid, node_id, assigned_at)
                   VALUES (:preset_id, :vmid, :node_id, :now)
                   RETURNING id"""
            ),
            {"preset_id": preset_id, "vmid": vmid, "node_id": node_id, "now": now},
        )
        assignment_id = result.fetchone()[0]
        await session.commit()

    preset = await get_preset_by_id(preset_id)
    return {
        "id": assignment_id,
        "preset_id": preset_id,
        "preset_name": preset["name"] if preset else "",
        "vmid": vmid,
        "node_id": node_id,
        "assigned_at": now,
    }


async def remove_assignment(preset_id: int, vmid: str, node_id: int) -> bool:
    async with get_db() as session:
        result = await session.execute(
            text(
                """DELETE FROM alert_preset_assignments
                   WHERE preset_id = :preset_id AND vmid = :vmid AND node_id = :node_id"""
            ),
            {"preset_id": preset_id, "vmid": vmid, "node_id": node_id},
        )
        # Reset states so global rules take over on next poll
        await session.execute(
            text("DELETE FROM alert_states WHERE vmid = :vmid AND node_id = :node_id"),
            {"vmid": vmid, "node_id": node_id},
        )
        await session.commit()
    return result.rowcount > 0


async def get_vm_preset(vmid: str, node_id: int) -> dict | None:
    """Return the preset assigned to a VM, or None."""
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT a.preset_id
                   FROM alert_preset_assignments a
                   WHERE a.vmid = :vmid AND a.node_id = :node_id"""
            ),
            {"vmid": vmid, "node_id": node_id},
        )
        row = result.fetchone()
    if not row:
        return None
    preset = await get_preset_by_id(row[0])
    if preset:
        preset["rules"] = await list_preset_rules(row[0])
    return preset


# ── Threshold Overrides ───────────────────────────────────────────────────────

async def list_overrides(vmid: str, node_id: int) -> list[dict]:
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT id, rule_id, vmid, node_id, warning_threshold, critical_threshold
                   FROM alert_threshold_overrides
                   WHERE vmid = :vmid AND node_id = :node_id"""
            ),
            {"vmid": vmid, "node_id": node_id},
        )
        rows = result.mappings().fetchall()

    out = []
    for r in rows:
        row = dict(r)
        for f in ("warning_threshold", "critical_threshold"):
            raw = row.get(f)
            if raw is not None:
                try:
                    row[f] = json.loads(raw)
                except (TypeError, ValueError):
                    row[f] = None
        out.append(row)
    return out


async def upsert_overrides(vmid: str, node_id: int, overrides: list[dict]) -> list[dict]:
    """Replace all overrides for this VM with the provided list."""
    async with get_db() as session:
        await session.execute(
            text(
                "DELETE FROM alert_threshold_overrides WHERE vmid = :vmid AND node_id = :node_id"
            ),
            {"vmid": vmid, "node_id": node_id},
        )
        for ov in overrides:
            await session.execute(
                text(
                    """INSERT INTO alert_threshold_overrides
                       (rule_id, vmid, node_id, warning_threshold, critical_threshold)
                       VALUES (:rule_id, :vmid, :node_id, :wt, :ct)"""
                ),
                {
                    "rule_id": ov["rule_id"],
                    "vmid": vmid,
                    "node_id": node_id,
                    "wt": _encode_threshold(ov.get("warning_threshold")),
                    "ct": _encode_threshold(ov.get("critical_threshold")),
                },
            )
        await session.commit()
    return await list_overrides(vmid, node_id)


# ── Merge Logic ───────────────────────────────────────────────────────────────

async def get_effective_rules(vmid: str, node_id: int, is_plus: bool = False) -> list[dict]:
    """Return the effective (merged) rules for a VM.

    Priority (highest wins per metric):
      3 – VM-specific rules
      2 – Preset rules (if Plus and a preset is assigned)
      1 – Global rules (fallback)

    Plus: threshold overrides are applied on top of preset rules.
    """
    global_rules = await list_global_rules()
    vm_rules     = await list_vm_rules(node_id, vmid)
    preset       = await get_vm_preset(vmid, node_id) if is_plus else None
    overrides    = await list_overrides(vmid, node_id) if is_plus and preset else []

    # Build override map: rule_id → {warning_threshold, critical_threshold}
    override_map: dict[int, dict] = {
        ov["rule_id"]: ov for ov in overrides
    }

    # Build a metric → rule map (highest priority wins)
    effective: dict[str, dict] = {}

    # Layer 1: global rules
    for rule in global_rules:
        if not rule.get("enabled"):
            continue
        metric = rule["metric"]
        if metric not in effective:
            effective[metric] = {**rule, "source": "global", "override_applied": False}

    # Layer 2: preset rules (replace global for same metric; Plus only)
    if preset:
        for rule in preset.get("rules", []):
            if not rule.get("enabled"):
                continue
            metric = rule["metric"]
            rule_out = {**rule, "source": "preset", "override_applied": False}
            # Apply threshold override if present
            if rule["id"] in override_map:
                ov = override_map[rule["id"]]
                if ov.get("warning_threshold") is not None:
                    rule_out["warning_threshold"] = ov["warning_threshold"]
                    rule_out["override_applied"] = True
                if ov.get("critical_threshold") is not None:
                    rule_out["critical_threshold"] = ov["critical_threshold"]
                    rule_out["override_applied"] = True
            effective[metric] = rule_out

    # Layer 3: VM-specific rules (override for same metric)
    for rule in vm_rules:
        if not rule.get("enabled"):
            continue
        metric = rule["metric"]
        effective[metric] = {**rule, "source": "vm", "override_applied": False}

    # BUG-34-6: EffectiveRule schema expects rule_id (= underlying alert_rules.id).
    # Add rule_id alongside id so that the router can construct EffectiveRule
    # without ValidationError, while alert_check_service consumers that read
    # rule["id"] keep working unchanged.
    out: list[dict] = []
    for v in effective.values():
        item = dict(v)
        item["rule_id"] = item["id"]
        out.append(item)
    return out


# ── Alert States ──────────────────────────────────────────────────────────────

async def list_alert_states(
    username: str | None = None,
    is_admin: bool = False,
    active_only: bool = True,
) -> list[dict]:
    """Return alert states; non-admins see only 'firing' states."""
    base_q = """
        SELECT s.id, s.rule_id, r.name AS rule_name, r.metric, s.vmid, s.node_id,
               s.severity, s.state, s.pending_count,
               s.last_value, s.last_checked_at, s.last_changed_at,
               (SELECT e.id FROM alert_events e
                WHERE e.rule_id = s.rule_id AND e.vmid = s.vmid AND e.node_id = s.node_id
                  AND e.severity = s.severity
                ORDER BY e.id DESC LIMIT 1) AS last_event_id
        FROM alert_states s
        JOIN alert_rules r ON r.id = s.rule_id
    """
    conditions = []
    params: dict[str, Any] = {}

    if active_only:
        conditions.append("s.state IN ('warning', 'critical')")

    # Ausgeblendet: States, deren letzten Event der Nutzer bereits bestätigt hat.
    # last_event_id bleibt dieselbe solange der Alert kontinuierlich feuert →
    # eine Bestätigung reicht, um den Banner dauerhaft zu verstecken bis die
    # Bedingung sich auflöst und ein neues Event erzeugt wird.
    if username:
        conditions.append(
            """NOT EXISTS (
                SELECT 1 FROM alert_acknowledgements aa
                WHERE aa.username = :ack_username
                  AND aa.alert_event_id = (
                      SELECT e2.id FROM alert_events e2
                      WHERE e2.rule_id = s.rule_id AND e2.vmid = s.vmid
                        AND e2.node_id = s.node_id AND e2.severity = s.severity
                      ORDER BY e2.id DESC LIMIT 1
                  )
            )"""
        )
        params["ack_username"] = username

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    async with get_db() as session:
        result = await session.execute(text(f"{base_q} {where} ORDER BY s.last_changed_at DESC"), params)
        rows = result.mappings().fetchall()

    out = []
    for r in rows:
        row = dict(r)
        raw = row.get("last_value")
        if raw is not None:
            try:
                row["last_value"] = json.loads(raw)
            except (TypeError, ValueError):
                row["last_value"] = None
        out.append(row)
    return out


# ── Alert Events ──────────────────────────────────────────────────────────────

async def list_alert_events(
    vmid: str | None = None,
    rule_id: int | None = None,
    metric: str | None = None,
    state: str | None = None,
    since: str | None = None,
    until: str | None = None,
    limit: int = 200,
    allowed_vmids: set[str] | None = None,
) -> list[dict]:
    """Return alert events; if allowed_vmids is provided, only return events for those VMs."""
    if allowed_vmids is not None and len(allowed_vmids) == 0:
        return []

    conditions = []
    params: dict[str, Any] = {"limit": limit}

    if allowed_vmids is not None:
        placeholders = ", ".join(f":avm{i}" for i in range(len(allowed_vmids)))
        conditions.append(f"e.vmid IN ({placeholders})")
        for i, vid in enumerate(sorted(allowed_vmids)):
            params[f"avm{i}"] = vid

    if vmid:
        conditions.append("e.vmid = :vmid")
        params["vmid"] = vmid
    if rule_id:
        conditions.append("e.rule_id = :rule_id")
        params["rule_id"] = rule_id
    if metric:
        conditions.append("e.metric = :metric")
        params["metric"] = metric
    if state:
        conditions.append("e.state = :state")
        params["state"] = state
    if since:
        conditions.append("e.timestamp >= :since")
        params["since"] = since
    if until:
        conditions.append("e.timestamp <= :until")
        params["until"] = until

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    async with get_db() as session:
        result = await session.execute(
            text(
                f"""SELECT e.id, e.rule_id, e.rule_name, e.vmid, e.node_id,
                           e.vm_name, e.metric, e.value, e.threshold,
                           e.severity, e.state, e.timestamp
                    FROM alert_events e
                    {where}
                    ORDER BY e.timestamp DESC
                    LIMIT :limit"""
            ),
            params,
        )
        rows = result.mappings().fetchall()

    events = []
    for r in rows:
        row = dict(r)
        for f in ("value", "threshold"):
            raw = row.get(f)
            if raw is not None:
                try:
                    row[f] = json.loads(raw)
                except (TypeError, ValueError):
                    row[f] = None
        row["acknowledged_by"] = []
        events.append(row)

    if events:
        # Fetch acknowledgements for all returned events
        event_ids = [e["id"] for e in events]
        placeholders = ", ".join(f":eid{i}" for i in range(len(event_ids)))
        eid_params = {f"eid{i}": eid for i, eid in enumerate(event_ids)}
        async with get_db() as session:
            ack_result = await session.execute(
                text(
                    f"SELECT alert_event_id, username FROM alert_acknowledgements WHERE alert_event_id IN ({placeholders})"
                ),
                eid_params,
            )
            ack_rows = ack_result.mappings().fetchall()

        ack_map: dict[int, list[str]] = {}
        for ack in ack_rows:
            ack_map.setdefault(ack["alert_event_id"], []).append(ack["username"])
        for event in events:
            event["acknowledged_by"] = ack_map.get(event["id"], [])

    return events


async def acknowledge_event(event_id: int, username: str) -> dict | None:
    now = _now()
    async with get_db() as session:
        # Check event exists
        check = await session.execute(
            text("SELECT id FROM alert_events WHERE id = :id"),
            {"id": event_id},
        )
        if not check.fetchone():
            return None
        # PROJ-71: upsert_or_ignore statt INSERT OR IGNORE (dialect-portabel, PG+SQLite)
        try:
            sql, params = upsert_or_ignore(
                "alert_acknowledgements",
                ["alert_event_id", "username", "acknowledged_at"],
                {"event_id": event_id, "username": username, "now": now},
            )
            # upsert_or_ignore gibt Columns und Values als Listen zurück –
            # hier manuell bauen da Param-Namen fix sind
            await session.execute(
                text(
                    "INSERT INTO alert_acknowledgements "
                    "(alert_event_id, username, acknowledged_at) "
                    "VALUES (:event_id, :username, :now) "
                    "ON CONFLICT DO NOTHING"
                ),
                {"event_id": event_id, "username": username, "now": now},
            )
            await session.commit()
        except Exception:
            await session.rollback()

    return {"alert_event_id": event_id, "username": username, "acknowledged_at": now}


# ── SMTP Config (Plus) ────────────────────────────────────────────────────────

_SMTP_KEYS = ("smtp_host", "smtp_port", "smtp_username", "smtp_password", "smtp_use_tls", "smtp_from")


async def get_smtp_config() -> dict:
    # Code-Review-Fix: config_service exportiert get_config, NICHT get
    # (unvollständiger Refactor → ImportError → 500 auf der SMTP-Settings-Route).
    from backend.services.config_service import get_config as cfg_get
    host      = await cfg_get("smtp_host")
    port_str  = await cfg_get("smtp_port")
    username  = await cfg_get("smtp_username")
    use_tls   = await cfg_get("smtp_use_tls")
    from_addr = await cfg_get("smtp_from")
    return {
        "host": host or None,
        "port": int(port_str) if port_str else None,
        "username": username or None,
        "use_tls": (use_tls or "true").lower() != "false",
        "from_address": from_addr or None,
        "configured": bool(host and port_str),
    }


async def update_smtp_config(config: dict) -> dict:
    # Code-Review-Fix: config_service exportiert set_config, NICHT set.
    from backend.services.config_service import set_config as cfg_set
    if "host" in config and config["host"] is not None:
        await cfg_set("smtp_host", config["host"], is_secret=False)
    if "port" in config and config["port"] is not None:
        await cfg_set("smtp_port", str(config["port"]), is_secret=False)
    if "username" in config and config["username"] is not None:
        await cfg_set("smtp_username", config["username"], is_secret=False)
    if "password" in config and config["password"] is not None:
        await cfg_set("smtp_password", config["password"], is_secret=True)
    if "use_tls" in config:
        await cfg_set("smtp_use_tls", "true" if config["use_tls"] else "false", is_secret=False)
    if "from_address" in config and config["from_address"] is not None:
        await cfg_set("smtp_from", config["from_address"], is_secret=False)
    return await get_smtp_config()
