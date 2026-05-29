# p3portal.org
"""PROJ-73: Tests für security_patterns.py."""
import pytest

from backend.features.node_updates.security_patterns import (
    SECURITY_PATTERNS,
    is_security_package,
)


class TestIsSecurityPackage:
    def test_known_kernel_package(self):
        assert is_security_package("proxmox-kernel-6.2") is True

    def test_pve_firmware(self):
        assert is_security_package("pve-firmware") is True

    def test_pve_kernel_prefix(self):
        assert is_security_package("pve-kernel-6.5.11-1-pve") is True

    def test_pve_qemu_kvm(self):
        assert is_security_package("pve-qemu-kvm") is True

    def test_qemu_server(self):
        assert is_security_package("qemu-server") is True

    def test_libpve_prefix(self):
        assert is_security_package("libpve-storage-perl") is True

    def test_openssh_server(self):
        assert is_security_package("openssh-server") is True

    def test_openssh_client(self):
        assert is_security_package("openssh-client") is True

    def test_sudo(self):
        assert is_security_package("sudo") is True

    def test_systemd(self):
        assert is_security_package("systemd") is True

    def test_libc6(self):
        assert is_security_package("libc6") is True

    def test_libssl_prefix(self):
        assert is_security_package("libssl3") is True

    def test_openssl(self):
        assert is_security_package("openssl") is True

    def test_linux_image_prefix(self):
        assert is_security_package("linux-image-6.1.0-amd64") is True

    def test_random_package_false(self):
        assert is_security_package("htop") is False

    def test_vim_false(self):
        assert is_security_package("vim") is False

    def test_curl_false(self):
        assert is_security_package("curl") is False

    def test_python3_false(self):
        assert is_security_package("python3") is False

    def test_empty_string_false(self):
        assert is_security_package("") is False

    def test_case_insensitive(self):
        assert is_security_package("OpenSSL") is True
        assert is_security_package("OPENSSH-SERVER") is True

    def test_partial_match_no_false_positive(self):
        # 'sudo' is a security package but 'pseudocode' should not match
        # because matching is prefix-based from lowercase
        assert is_security_package("pseudocode") is False

    def test_security_patterns_non_empty(self):
        assert len(SECURITY_PATTERNS) > 0
