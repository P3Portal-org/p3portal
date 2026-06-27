# p3portal.org
"""Tests für backend/core/http_client.py (PROJ-67 Phase 1)."""
import pytest

from backend.core.http_client import (
    _matches_allowlist,
    check_dns_rebinding,
    is_private_ip,
    is_unsafe_setup_target,
    pin_url_to_ip,
    validate_setup_target_url,
    validate_webhook_url,
)


class TestIsPrivateIp:
    def test_loopback_v4(self):
        assert is_private_ip("127.0.0.1")

    def test_rfc1918_10(self):
        assert is_private_ip("10.0.0.1")

    def test_rfc1918_172(self):
        assert is_private_ip("172.16.0.1")
        assert is_private_ip("172.31.255.255")

    def test_rfc1918_192(self):
        assert is_private_ip("192.168.1.1")

    def test_link_local(self):
        assert is_private_ip("169.254.0.1")

    def test_ipv6_loopback(self):
        assert is_private_ip("::1")

    def test_public_ip_allowed(self):
        assert not is_private_ip("8.8.8.8")

    def test_public_ip_cloudflare(self):
        assert not is_private_ip("1.1.1.1")

    def test_invalid_ip_blocked(self):
        assert is_private_ip("not-an-ip")

    def test_ipv4_mapped_ipv6_loopback_blocked(self):
        # ::ffff:127.0.0.1 ist ein IPv6Address und liegt in keinem IPv4-Netz –
        # ohne ipv4_mapped-Normalisierung ein SSRF-Bypass (attacker-AAAA).
        assert is_private_ip("::ffff:127.0.0.1")

    def test_ipv4_mapped_ipv6_imds_blocked(self):
        assert is_private_ip("::ffff:169.254.169.254")

    def test_ipv4_mapped_ipv6_rfc1918_blocked(self):
        assert is_private_ip("::ffff:10.0.0.5")

    def test_cgnat_blocked(self):
        assert is_private_ip("100.64.0.1")

    def test_nat64_blocked(self):
        assert is_private_ip("64:ff9b::7f00:1")

    def test_ipv4_mapped_public_allowed(self):
        # ::ffff:8.8.8.8 darf NICHT fälschlich blockiert werden.
        assert not is_private_ip("::ffff:8.8.8.8")


class TestMatchesAllowlist:
    def test_exact_match(self):
        assert _matches_allowlist("hooks.example.com", ["hooks.example.com"])

    def test_wildcard_match(self):
        assert _matches_allowlist("sub.example.com", ["*.example.com"])

    def test_wildcard_no_match_other_domain(self):
        assert not _matches_allowlist("sub.other.com", ["*.example.com"])

    def test_no_match_empty_list(self):
        assert not _matches_allowlist("example.com", [])

    def test_case_insensitive(self):
        assert _matches_allowlist("HOOKS.EXAMPLE.COM", ["hooks.example.com"])


class TestValidateWebhookUrl:
    def test_valid_https_public(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "1.2.3.4")
        validate_webhook_url("https://hooks.example.com/webhook")  # should not raise

    def test_http_without_flag_raises(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "1.2.3.4")
        with pytest.raises(ValueError, match="HTTPS"):
            validate_webhook_url("http://example.com/hook")

    def test_http_with_flag_allowed(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "1.2.3.4")
        validate_webhook_url("http://example.com/hook", allow_http=True)

    def test_private_ip_blocked(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "192.168.1.1")
        with pytest.raises(ValueError, match="private"):
            validate_webhook_url("https://internal.lan/hook")

    def test_loopback_blocked(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "127.0.0.1")
        with pytest.raises(ValueError, match="private"):
            validate_webhook_url("https://localhost/hook")

    def test_empty_url_raises(self):
        with pytest.raises(ValueError, match="leer"):
            validate_webhook_url("")

    def test_invalid_scheme_raises(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "1.2.3.4")
        with pytest.raises(ValueError, match="Schema"):
            validate_webhook_url("ftp://example.com/hook")

    def test_allowlist_match_passes(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "1.2.3.4")
        validate_webhook_url(
            "https://hooks.example.com/notify",
            allowlist_patterns=["hooks.example.com"],
        )

    def test_allowlist_no_match_raises(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "1.2.3.4")
        with pytest.raises(ValueError, match="Allowlist"):
            validate_webhook_url(
                "https://other.com/notify",
                allowlist_patterns=["hooks.example.com"],
            )

    def test_dns_resolve_failure_raises(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: None)
        with pytest.raises(ValueError, match="aufgelöst"):
            validate_webhook_url("https://nonexistent.invalid/hook")


class TestCheckDnsRebinding:
    def test_public_ip_is_safe(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "8.8.8.8")
        safe, ip = check_dns_rebinding("dns.google")
        assert safe is True
        assert ip == "8.8.8.8"

    def test_private_ip_not_safe(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "192.168.1.1")
        safe, ip = check_dns_rebinding("evil.lan")
        assert safe is False
        assert ip == "192.168.1.1"

    def test_resolve_failure(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: None)
        safe, ip = check_dns_rebinding("nxdomain.invalid")
        assert safe is False
        assert ip == ""


class TestIsUnsafeSetupTarget:
    """Setup-spezifische Block-Liste: RFC1918 erlaubt, Loopback/IMDS/Multicast blockiert."""

    def test_imds_blocked(self):
        assert is_unsafe_setup_target("169.254.169.254")

    def test_link_local_range_blocked(self):
        assert is_unsafe_setup_target("169.254.1.1")

    def test_loopback_blocked(self):
        assert is_unsafe_setup_target("127.0.0.1")
        assert is_unsafe_setup_target("127.99.99.99")

    def test_multicast_blocked(self):
        assert is_unsafe_setup_target("224.0.0.1")

    def test_unspecified_blocked(self):
        assert is_unsafe_setup_target("0.0.0.0")

    def test_ipv6_loopback_blocked(self):
        assert is_unsafe_setup_target("::1")

    def test_ipv6_link_local_blocked(self):
        assert is_unsafe_setup_target("fe80::1")

    def test_rfc1918_10_allowed(self):
        """LAN must be allowed – Proxmox usually lives on RFC1918."""
        assert not is_unsafe_setup_target("10.0.0.1")

    def test_rfc1918_172_allowed(self):
        assert not is_unsafe_setup_target("172.16.0.1")

    def test_rfc1918_192_allowed(self):
        assert not is_unsafe_setup_target("192.168.1.1")

    def test_public_ip_allowed(self):
        assert not is_unsafe_setup_target("1.1.1.1")

    def test_invalid_blocked(self):
        assert is_unsafe_setup_target("not-an-ip")

    def test_ipv4_mapped_ipv6_loopback_blocked(self):
        assert is_unsafe_setup_target("::ffff:127.0.0.1")

    def test_ipv4_mapped_ipv6_imds_blocked(self):
        assert is_unsafe_setup_target("::ffff:169.254.169.254")

    def test_ipv4_mapped_rfc1918_still_allowed(self):
        # Setup erlaubt RFC1918 – auch in IPv4-mapped-Form, kein False-Positive.
        assert not is_unsafe_setup_target("::ffff:192.168.1.10")


class TestValidateSetupTargetUrl:
    def test_imds_url_blocked(self, monkeypatch):
        """The IMDS attack from the disclosure must be rejected."""
        monkeypatch.setattr(
            "backend.core.http_client._resolve_host", lambda h: "169.254.169.254"
        )
        with pytest.raises(ValueError, match="blockiert"):
            validate_setup_target_url("http://169.254.169.254")

    def test_loopback_blocked(self, monkeypatch):
        monkeypatch.setattr(
            "backend.core.http_client._resolve_host", lambda h: "127.0.0.1"
        )
        with pytest.raises(ValueError, match="blockiert"):
            validate_setup_target_url("http://localhost:8080")

    def test_dns_rebinding_via_public_hostname_blocked(self, monkeypatch):
        """A public-looking hostname that resolves to IMDS must be rejected."""
        monkeypatch.setattr(
            "backend.core.http_client._resolve_host", lambda h: "169.254.169.254"
        )
        with pytest.raises(ValueError, match="blockiert"):
            validate_setup_target_url("https://innocent-name.example.com")

    def test_rfc1918_allowed(self, monkeypatch):
        """LAN host accepted – returns the resolved IP."""
        monkeypatch.setattr(
            "backend.core.http_client._resolve_host", lambda h: "192.168.10.5"
        )
        ip = validate_setup_target_url("https://pve.lan:8006")
        assert ip == "192.168.10.5"

    def test_public_ip_allowed(self, monkeypatch):
        monkeypatch.setattr(
            "backend.core.http_client._resolve_host", lambda h: "203.0.113.10"
        )
        ip = validate_setup_target_url("https://pve.example.com:8006")
        assert ip == "203.0.113.10"

    def test_empty_url_raises(self):
        with pytest.raises(ValueError, match="leer"):
            validate_setup_target_url("")

    def test_invalid_scheme_raises(self, monkeypatch):
        monkeypatch.setattr(
            "backend.core.http_client._resolve_host", lambda h: "1.2.3.4"
        )
        with pytest.raises(ValueError, match="Schema"):
            validate_setup_target_url("ftp://example.com")

    def test_dns_resolve_failure_raises(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: None)
        with pytest.raises(ValueError, match="aufgelöst"):
            validate_setup_target_url("https://nx.invalid")

    def test_error_message_is_generic(self, monkeypatch):
        """Error message must not leak internal details."""
        monkeypatch.setattr(
            "backend.core.http_client._resolve_host", lambda h: "169.254.169.254"
        )
        try:
            validate_setup_target_url("https://aws-metadata.evil.com")
        except ValueError as exc:
            msg = str(exc)
            # Must not echo back the resolved IP or the original hostname
            assert "169.254" not in msg
            assert "evil" not in msg


class TestPinUrlToIp:
    def test_rewrites_host_to_ip(self):
        url, headers = pin_url_to_ip("https://pve.example.com:8006/api2/json/version", "203.0.113.10")
        assert url == "https://203.0.113.10:8006/api2/json/version"
        assert headers["Host"] == "pve.example.com:8006"

    def test_preserves_path_and_query(self):
        url, _ = pin_url_to_ip(
            "https://host.example.com/api2/json/version?x=1", "1.2.3.4"
        )
        assert url == "https://1.2.3.4/api2/json/version?x=1"

    def test_ipv6_literal_brackets(self):
        url, headers = pin_url_to_ip("https://example.com:443/x", "2001:db8::1")
        assert url == "https://[2001:db8::1]:443/x"
        assert headers["Host"] == "example.com:443"

    def test_default_port_omitted(self):
        url, headers = pin_url_to_ip("https://host.example.com/x", "1.2.3.4")
        assert url == "https://1.2.3.4/x"
        assert headers["Host"] == "host.example.com"
