# Release notes archive

Markdown copies of the release notes published on the
[GitHub Releases page](https://github.com/P3Portal-org/p3portal/releases).

Kept in the repository for offline access, `grep`-able lookups, and
permanent auditable record in the git history.

## Files

- [`v1.74.8-beta.md`](v1.74.8-beta.md) — Clean-room re-implementation
  of Issue #3 / #4 security fixes. Current supported release.
- [`v1.74.7-beta.md`](v1.74.7-beta.md) — Packer Zip-Slip
  defense-in-depth + `require_admin_or` proxmox-auth bypass closure.
  **Superseded by v1.74.8-beta.**
- [`v1.74.6-beta.md`](v1.74.6-beta.md) — Original Zip-Slip and
  `require_admin` / `require_operator` proxmox-auth bypass fixes
  (GitHub #4). **Superseded by v1.74.8-beta.**

Earlier releases (v1.74.0 .. v1.74.5-beta) are documented only via
their git tags and commit messages.

## Why the superseded markers

v1.74.5-beta through v1.74.7-beta contained security-fix code adopted
directly from the "Suggested Fix" blocks in their respective GitHub
Issues. GitHub Terms of Service § D.5 grants only display rights on
the platform — not redistribution rights inside this codebase. To
remove that ambiguity, the same protections were independently
re-implemented in v1.74.8-beta from the bug description only, without
referring to the externally-suggested code. Functional behaviour is
identical between v1.74.6-beta, v1.74.7-beta, and v1.74.8-beta. See
the [v1.74.8-beta release notes](v1.74.8-beta.md) for the full
explanation.
