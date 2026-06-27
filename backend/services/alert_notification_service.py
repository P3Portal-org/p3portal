# p3portal.org
"""PROJ-34: Alert-Benachrichtigungen via Webhook (httpx) und E-Mail (aiosmtplib).

Beide Kanäle sind fire-and-forget; Fehler werden geloggt aber nicht propagiert.
Webhook und SMTP sind Plus-only; bei Core-Edition wird nichts gesendet.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from backend.core.http_client import secure_outbound_client

logger = logging.getLogger(__name__)


_METRIC_LABEL: dict[str, str] = {
    "cpu_percent":  "CPU",
    "mem_percent":  "RAM",
    "disk_percent": "Disk",
    "status":       "Status",
}

_STATE_LABEL: dict[str, str] = {
    "firing":   "Ausgelöst",
    "resolved": "Behoben",
}

_SEVERITY_LABEL: dict[str, str] = {
    "critical": "Kritisch",
    "warning":  "Warnung",
    "info":     "Info",
}


def _format_value(value: Any, metric: str) -> str:
    if value is None:
        return "N/A"
    if metric == "status":
        return str(value)
    try:
        return f"{float(value):.1f}%"
    except (TypeError, ValueError):
        return str(value)


def _format_ts(iso: str) -> str:
    """ISO-Timestamp → lesbares 'DD.MM.YYYY HH:MM'."""
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(iso)
        dt = dt.astimezone(timezone.utc)
        return dt.strftime("%d.%m.%Y %H:%M")
    except Exception:
        return iso


def _metric_label(metric: str) -> str:
    return _METRIC_LABEL.get(metric, metric)


def _subject(rule_name: str, vm_name: str | None, metric: str, value: Any, state: str) -> str:
    prefix = "[P3 Alert] " if state == "firing" else "[P3 Resolved] "
    val_str = _format_value(value, metric)
    m = _metric_label(metric)
    return f"{prefix}{rule_name} – {vm_name or 'unknown'} ({m}: {val_str})"


# ── Receiver detection / payload adapters ─────────────────────────────────────

def _is_gotify_url(url: str) -> bool:
    """True if the URL looks like a Gotify /message endpoint with ?token=..."""
    from urllib.parse import urlparse, parse_qs
    try:
        u = urlparse(url)
        if not u.path.rstrip("/").endswith("/message"):
            return False
        return "token" in parse_qs(u.query)
    except Exception:
        return False


def _to_gotify_payload(p: dict) -> dict:
    """Map the native P3 alert payload to Gotify's expected shape."""
    state = p.get("state", "firing")
    severity = (p.get("severity") or "").lower()
    is_test = bool(p.get("test"))
    alert = p.get("alert") or "P3 Portal Alert"
    vm = p.get("vm") or ""
    metric = p.get("metric") or ""
    value = p.get("value")
    threshold = p.get("threshold")
    m_label = _metric_label(metric)

    if is_test:
        title = f"[P3 Test] {alert}"
        priority = 2
    elif state == "resolved":
        title = f"[P3 Behoben] {alert}"
        priority = 3
    else:
        title = f"[P3 Alert] {alert}" + (f" – {vm}" if vm else "")
        priority = 8 if severity == "critical" else 5

    lines: list[str] = []
    if vm and not is_test:
        lines.append(f"VM: {vm}")
    if metric:
        val_str = _format_value(value, metric)
        if threshold is not None:
            lines.append(f"{m_label}: {val_str} (Grenzwert: {_format_value(threshold, metric)})")
        else:
            lines.append(f"{m_label}: {val_str}")
    if severity:
        sev_str = _SEVERITY_LABEL.get(severity, severity.capitalize())
        state_str = _STATE_LABEL.get(state, state.capitalize())
        lines.append(f"{sev_str} · {state_str}")
    if p.get("timestamp"):
        lines.append(_format_ts(p["timestamp"]))

    return {
        "title": title,
        "message": "\n".join(lines) or "P3 Portal notification",
        "priority": priority,
    }


def _to_ntfy_payload(p: dict) -> dict:
    """Map a P3 alert payload to ntfy's JSON shape."""
    state = p.get("state", "firing")
    severity = (p.get("severity") or "").lower()
    is_test = bool(p.get("test"))
    alert = p.get("alert") or "P3 Portal Alert"
    vm = p.get("vm") or ""
    metric = p.get("metric") or ""
    value = p.get("value")
    threshold = p.get("threshold")
    m_label = _metric_label(metric)

    if is_test:
        title = f"[P3 Test] {alert}"
        priority = 2
        tags = ["white_check_mark"]
    elif state == "resolved":
        title = f"[P3 Behoben] {alert}"
        priority = 3
        tags = ["green_circle"]
    elif severity == "critical":
        title = f"[P3 Alert] {alert}"
        priority = 5
        tags = ["rotating_light"]
    else:
        title = f"[P3 Alert] {alert}"
        priority = 4
        tags = ["warning"]

    lines: list[str] = []
    if vm and not is_test:
        lines.append(f"VM: {vm}")
    if metric:
        val_str = _format_value(value, metric)
        if threshold is not None:
            lines.append(f"{m_label}: {val_str} (Grenzwert: {_format_value(threshold, metric)})")
        else:
            lines.append(f"{m_label}: {val_str}")
    if severity:
        sev_str = _SEVERITY_LABEL.get(severity, severity.capitalize())
        state_str = _STATE_LABEL.get(state, state.capitalize())
        lines.append(f"{sev_str} · {state_str}")
    if p.get("timestamp"):
        lines.append(_format_ts(p["timestamp"]))

    return {
        "title": title,
        "message": "\n".join(lines) or "P3 Portal notification",
        "priority": priority,
        "tags": tags,
    }


def _to_slack_payload(p: dict) -> dict:
    """Map a P3 alert payload to Slack/Mattermost incoming-webhook shape (attachments)."""
    state = p.get("state", "firing")
    severity = (p.get("severity") or "").lower()
    is_test = bool(p.get("test"))
    alert = p.get("alert") or "P3 Portal Alert"
    vm = p.get("vm") or ""
    metric = p.get("metric") or ""
    value = p.get("value")
    threshold = p.get("threshold")
    m_label = _metric_label(metric)

    if is_test:
        color = "#808080"
        title = f"[P3 Test] {alert}"
    elif state == "resolved":
        color = "#36a64f"
        title = f"[P3 Behoben] {alert}"
    elif severity == "critical":
        color = "#dc2626"
        title = f"[P3 Alert] {alert}"
    else:
        color = "#f59e0b"
        title = f"[P3 Alert] {alert}"

    lines: list[str] = []
    if vm and not is_test:
        lines.append(f"*VM:* {vm}")
    if metric:
        val_str = _format_value(value, metric)
        if threshold is not None:
            lines.append(f"*{m_label}:* {val_str} (Grenzwert: {_format_value(threshold, metric)})")
        else:
            lines.append(f"*{m_label}:* {val_str}")
    if severity:
        sev_str = _SEVERITY_LABEL.get(severity, severity.capitalize())
        state_str = _STATE_LABEL.get(state, state.capitalize())
        lines.append(f"*Schweregrad:* {sev_str} · {state_str}")
    if p.get("timestamp"):
        lines.append(f"*Zeit:* {_format_ts(p['timestamp'])}")

    return {
        "attachments": [{
            "color": color,
            "title": title,
            "text": "\n".join(lines) or "P3 Portal notification",
            "footer": "P3 Portal",
        }]
    }


def _to_discord_payload(p: dict) -> dict:
    """Map a P3 alert payload to Discord webhook embed shape."""
    state = p.get("state", "firing")
    severity = (p.get("severity") or "").lower()
    is_test = bool(p.get("test"))
    alert = p.get("alert") or "P3 Portal Alert"
    vm = p.get("vm") or ""
    metric = p.get("metric") or ""
    value = p.get("value")
    threshold = p.get("threshold")

    # Discord embed color as decimal integer (RGB)
    if is_test:
        color = 8_421_504   # gray
        title = f"[P3 Test] {alert}"
    elif state == "resolved":
        color = 3_066_993   # green
        title = f"[P3 Resolved] {alert}"
    elif severity == "critical":
        color = 15_158_332  # red
        title = f"[P3 Alert] {alert}"
    else:
        color = 16_753_920  # orange
        title = f"[P3 Alert] {alert}"

    m_label = _metric_label(metric)
    lines: list[str] = []
    if vm and not is_test:
        lines.append(f"**VM:** {vm}")
    if metric:
        val_str = _format_value(value, metric)
        if threshold is not None:
            lines.append(f"**{m_label}:** {val_str} (Grenzwert: {_format_value(threshold, metric)})")
        else:
            lines.append(f"**{m_label}:** {val_str}")
    if severity:
        sev_str = _SEVERITY_LABEL.get(severity, severity.capitalize())
        state_str = _STATE_LABEL.get(state, state.capitalize())
        lines.append(f"**Schweregrad:** {sev_str} · {state_str}")
    if p.get("timestamp"):
        lines.append(f"**Zeit:** {_format_ts(p['timestamp'])}")

    return {
        "embeds": [{
            "title": title,
            "description": "\n".join(lines) or "P3 Portal notification",
            "color": color,
            "footer": {"text": "P3 Portal"},
        }]
    }


def _build_effective_url(url: str, token: str | None, receiver_type: str) -> str:
    """For Gotify: append /message?token= to the base URL; all other types unchanged."""
    if receiver_type == "gotify" and url and token:
        return url.rstrip("/") + "/message?token=" + token
    return url


def adapt_webhook_request(
    url: str,
    payload: dict,
    token: str | None,
    receiver_type: str = "custom",
) -> tuple[dict, dict[str, str]]:
    """Return ``(body, headers)`` adapted to the chosen receiver type.

    Dispatch order:
      gotify        → Gotify JSON shape, token already in URL
      ntfy          → ntfy JSON shape, optional Bearer token
      slack /
      mattermost    → Slack attachment shape, no auth header (token in URL)
      discord       → Discord embed shape, no auth header (token in URL)
      custom (default) → native P3 payload, optional Bearer token
    Backward-compat: if receiver_type is 'custom' but URL looks like Gotify,
    still use Gotify shape (handles old stored full-URL rows).
    """
    ct = {"Content-Type": "application/json"}

    if receiver_type == "gotify" or _is_gotify_url(url):
        return _to_gotify_payload(payload), ct

    if receiver_type == "ntfy":
        headers = dict(ct)
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return _to_ntfy_payload(payload), headers

    if receiver_type in ("slack", "mattermost"):
        return _to_slack_payload(payload), ct

    if receiver_type == "discord":
        return _to_discord_payload(payload), ct

    # custom
    headers = dict(ct)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return payload, headers


# ── Webhook ───────────────────────────────────────────────────────────────────

async def _send_webhook(
    rule: dict,
    event_id: int,
    vmid: str,
    vm_name: str | None,
    metric: str,
    value: Any,
    threshold: Any,
    severity: str,
    event_state: str,
    timestamp: str,
) -> None:
    webhook_url = rule.get("webhook_url")
    if not webhook_url:
        return

    # Decrypt bearer/app token if present
    bearer_token: str | None = None
    try:
        from backend.services.alert_rule_service import _get_raw_webhook_token
        raw_token = await _get_raw_webhook_token(rule["id"])
        if raw_token:
            from backend.services.config_service import decrypt_secret
            bearer_token = decrypt_secret(raw_token)
    except Exception:
        pass

    receiver_type = rule.get("webhook_receiver_type") or "custom"
    effective_url = _build_effective_url(webhook_url, bearer_token, receiver_type)

    vm_label = vm_name or str(vmid)
    payload = {
        "alert": rule["name"],
        "vm": vm_label,
        "metric": metric,
        "value": value,
        "threshold": threshold,
        "severity": severity,
        "state": event_state,
        "timestamp": timestamp,
        "event_id": event_id,
    }

    body, headers = adapt_webhook_request(effective_url, payload, bearer_token, receiver_type)

    # PROJ-67 BUG-67-1: per-receiver TLS verify override (admin-configured only)
    verify_ssl = bool(rule.get("webhook_verify_ssl", 1))

    try:
        # PROJ-67 Phase 1 – F-002: use secure outbound client
        async with secure_outbound_client(timeout=10.0, verify=verify_ssl) as client:
            response = await client.post(effective_url, json=body, headers=headers)
            if not response.is_success:
                logger.warning(
                    "Alert webhook HTTP %d for rule %s event %d",
                    response.status_code,
                    rule["name"],
                    event_id,
                )
            else:
                logger.debug("Alert webhook sent: rule=%s event=%d", rule["name"], event_id)
    except Exception as exc:
        logger.warning("Alert webhook failed for rule %s event %d: %s", rule["name"], event_id, exc)


# ── Test Webhook ──────────────────────────────────────────────────────────────

async def send_test_webhook(
    webhook_url: str,
    webhook_token: str | None,
    *,
    username: str,
    source_label: str,
    receiver_type: str = "custom",
    verify_ssl: bool = True,
) -> dict:
    """Send a test notification to the given webhook URL.

    Uses the real alert payload shape with ``test=true`` so the receiver can
    validate field mapping. Returns a structured result instead of raising.
    """
    from datetime import datetime, timezone
    timestamp = datetime.now(timezone.utc).isoformat()

    payload = {
        "test": True,
        "alert": f"P3 Portal Test ({source_label})",
        "vm": "test/0",
        "metric": "cpu_percent",
        "value": 99.0,
        "threshold": 90.0,
        "severity": "warning",
        "state": "firing",
        "timestamp": timestamp,
        "event_id": 0,
        "source": "p3portal",
        "source_label": source_label,
        "triggered_by": username,
    }

    body, headers = adapt_webhook_request(webhook_url, payload, webhook_token, receiver_type)
    adapter = receiver_type if receiver_type != "custom" else (
        "gotify" if _is_gotify_url(webhook_url) else "native"
    )

    body_preview = ""
    try:
        # PROJ-67 Phase 1 / BUG-67-1: use secure outbound client with per-receiver verify override
        async with secure_outbound_client(timeout=10.0, verify=verify_ssl) as client:
            response = await client.post(webhook_url, json=body, headers=headers)
            body_preview = (response.text or "")[:500]
            return {
                "ok": response.is_success,
                "status_code": response.status_code,
                "body_preview": body_preview,
                "error": None,
                "adapter": adapter,
            }
    except httpx.HTTPError as exc:
        return {
            "ok": False,
            "status_code": None,
            "body_preview": body_preview,
            "error": str(exc),
            "adapter": adapter,
        }


# ── SMTP / E-Mail ─────────────────────────────────────────────────────────────

async def _send_email(
    rule: dict,
    vm_name: str | None,
    metric: str,
    value: Any,
    threshold: Any,
    severity: str,
    event_state: str,
    timestamp: str,
) -> None:
    recipients_str = rule.get("email_recipients")
    if not recipients_str:
        return

    recipients = [r.strip() for r in recipients_str.split(",") if r.strip()]
    if not recipients:
        return

    try:
        from backend.services.alert_rule_service import get_smtp_config
        smtp = await get_smtp_config()
    except Exception as exc:
        logger.debug("SMTP config unavailable: %s", exc)
        return

    if not smtp.get("configured"):
        return

    subject = _subject(rule["name"], vm_name, metric, value, event_state)
    val_str = _format_value(value, metric)
    thr_str = _format_value(threshold, metric) if threshold is not None else "N/A"
    m_label = _metric_label(metric)
    sev_str = _SEVERITY_LABEL.get(severity.lower(), severity.capitalize())
    state_str = _STATE_LABEL.get(event_state, event_state.capitalize())

    body = (
        f"P3 Portal Alert\n"
        f"{'=' * 40}\n"
        f"Regel:        {rule['name']}\n"
        f"VM:           {vm_name or 'unknown'}\n"
        f"{m_label}:{'':>{12 - len(m_label)}}{val_str} (Grenzwert: {thr_str})\n"
        f"Schweregrad:  {sev_str}\n"
        f"Status:       {state_str}\n"
        f"Zeit:         {_format_ts(timestamp)}\n"
    )

    try:
        import aiosmtplib
        from email.mime.text import MIMEText

        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"]    = smtp.get("from_address") or "p3portal@localhost"
        msg["To"]      = ", ".join(recipients)

        host     = smtp["host"]
        port     = smtp.get("port") or 587
        username = smtp.get("username")
        # SMTP-Passwort lesen
        password: str | None = None
        try:
            # Code-Review-Fix: config_service exportiert get_config (NICHT get) und
            # entschlüsselt is_secret-Keys bereits intern → KEIN zweites decrypt_secret
            # (das hätte den Klartext erneut zu entschlüsseln versucht → InvalidToken).
            from backend.services.config_service import get_config as cfg_get
            password = (await cfg_get("smtp_password")) or None
        except Exception:
            pass

        use_tls = smtp.get("use_tls", True)

        await aiosmtplib.send(
            msg,
            hostname=host,
            port=port,
            username=username,
            password=password,
            use_tls=use_tls,
            start_tls=not use_tls,
        )
        logger.debug("Alert email sent: rule=%s recipients=%s", rule["name"], recipients)
    except ImportError:
        logger.warning("aiosmtplib not installed; cannot send alert email")
    except Exception as exc:
        logger.warning("Alert email failed for rule %s: %s", rule["name"], exc)


# ── Dispatch ──────────────────────────────────────────────────────────────────

async def dispatch(
    rule: dict,
    event_id: int,
    vmid: str,
    vm_name: str | None,
    metric: str,
    value: Any,
    threshold: Any,
    severity: str,
    event_state: str,
    is_plus: bool,
) -> None:
    """Dispatch alert notifications for all configured channels.

    Basis: no external channels (banner only).
    Plus: webhook + email if configured.
    """
    from datetime import datetime, timezone
    timestamp = datetime.now(timezone.utc).isoformat()

    if not is_plus:
        return

    # Webhook (Plus)
    if rule.get("webhook_url"):
        await _send_webhook(
            rule=rule,
            event_id=event_id,
            vmid=vmid,
            vm_name=vm_name,
            metric=metric,
            value=value,
            threshold=threshold,
            severity=severity,
            event_state=event_state,
            timestamp=timestamp,
        )

    # E-Mail (Plus)
    if rule.get("email_recipients"):
        await _send_email(
            rule=rule,
            vm_name=vm_name,
            metric=metric,
            value=value,
            threshold=threshold,
            severity=severity,
            event_state=event_state,
            timestamp=timestamp,
        )
