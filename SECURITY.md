# Security Policy

Thanks for taking the time to look at the security of P3 Portal.

## Important context before you report

P3 Portal is maintained by **a single person** in their spare time.
Please keep this in mind when you set expectations on response times —
the process below describes the maintainer's best-effort intent, not a
contractual service-level agreement.

P3 Portal is designed for **internal LAN / VPN deployment** only. It is
not hardened against public-internet exposure. Wrapping it with a
reverse proxy, VPN, or other external access path is the operator's
responsibility and falls outside the scope of this security policy and
this project. Findings that only apply to public-internet deployments
are out of scope.

This document is published in English and was prepared with the help of
machine translation tools. If any wording is unclear or appears to
conflict with the LICENSE / LICENSE-PLUS files, the licence files are
authoritative. Please ask in a GitHub Discussion if anything is
ambiguous.

If P3 Portal is archived on GitHub or otherwise marked as no longer
maintained, the reporting and disclosure process described below ends
immediately. No further advisories will be published, including for
reports already in flight. Operators should treat an archived project
as unsupported and migrate or fork at their own discretion.

## No warranty, no liability

P3 Portal is provided **"AS IS"** and **"AS AVAILABLE"**, without
warranty of any kind, express or implied, including but not limited to
the warranties of merchantability, fitness for a particular purpose,
title, and non-infringement.

To the **maximum extent permitted by applicable law**, the maintainer
disclaims and excludes **all liability** for any direct, indirect,
incidental, special, consequential, exemplary, or punitive damages —
including but not limited to loss of data, loss of revenue, business
interruption, damage to infrastructure, or any other commercial damages
or losses — arising out of or in connection with the use of, or
inability to use, P3 Portal, even if advised of the possibility of
such damages.

Nothing in this document creates a warranty, a guarantee, a service
contract, or any other binding obligation. This security policy
describes a best-effort process only. Operators run P3 Portal at their
own risk.

The full warranty and liability disclaimers in the AGPLv3 (Core) and
LICENSE-PLUS (Plus) take precedence over this summary. See those files
for the complete text.

Where applicable law does not permit the exclusion or limitation of
certain liabilities (such as liability for intent, gross negligence, or
personal injury under German law), liability is limited to the minimum
extent required by that law.

## Reporting

**Security vulnerabilities — use GitHub Private Vulnerability
Reporting:**
<https://github.com/P3Portal-org/p3portal/security/advisories/new>

This is private. Only the maintainer sees the report until an advisory
is published. Please do not open a public GitHub issue for security
problems — a public issue exposes other operators to the same attack
before a fix is available.

**Regular bugs (not security) — open a public issue:**
<https://github.com/P3Portal-org/p3portal/issues>

## What to include

- Affected component (file path, route, or feature) and the P3 Portal
  version or commit you tested against
- **Host OS** (distribution and version, e.g. `Debian 12.5`,
  `Fedora 41`)
- **Container runtime and version** – Podman (`podman --version`) or
  Docker (`docker --version`), plus `podman-compose` /
  `docker compose` version
- Reproducer (smallest possible, including request payload or ZIP /
  file contents)
- Impact – what a malicious user can read, write, or escalate to
- Suggested fix or mitigation, if you have one

Runtime matters because P3 Portal supports both Podman (rootless,
default in the docs) and Docker, and a few behaviours differ between
them.

## Disclosure approach (not a commitment)

The numbers below are **guidelines, not promises**. P3 Portal is a
single-maintainer hobby project; concrete timelines depend on
real-world availability.

- The maintainer **aims to** publish a GitHub Security Advisory within
  roughly **90 calendar days** after a report is received via PVR.
  90 days is the industry default (Google Project Zero) and serves as
  an orientation, not a deadline.
- **Critical issues** (remote code execution, authentication bypass to
  admin, arbitrary file write outside the sandbox) may be disclosed
  earlier than 90 days if operators clearly need to react urgently.
  Whether this is feasible depends on whether a fix can be produced in
  time.
- **Longer windows** are possible if a fix requires upstream changes
  (Proxmox, Ansible, Packer), if the maintainer is unavailable, or for
  any other reason the maintainer judges appropriate. There is no
  obligation to disclose by a specific date.
- Where possible, the maintainer **will try to** include practical
  mitigations (disable feature, restrict network, rotate token, …) in
  the advisory so operators can react even before a fix is released.
  Whether usable mitigations exist depends on the nature of the issue
  and cannot be guaranteed.

**Credit** in the advisory if you want it – tell me how you'd like to
be named (handle, real name, link). Anonymous reports are also fine.

## Scope

In scope:

- The portal backend (`backend/`), frontend (`frontend/src/`), and the
  container image published at `ghcr.io/p3portal-org/p3portal`
- Default configuration and the bundled `examples/starter-pack`
- Authentication, authorization, file upload paths, secret handling

Out of scope:

- Issues that require a malicious Proxmox cluster the operator already
  trusts (the trust boundary is the cluster, not P3 Portal)
- Denial of service from a fully privileged admin user
- Findings against forks or significantly modified deployments
- **Public-internet exposure** (see "Important context" above)

## Supported versions

Only **v1.74.8-beta and later** receive security patches and are
supported. Earlier tags remain available on `ghcr.io/p3portal-org`
for reproducibility but are not patched.

Specifically, **v1.74.5-beta through v1.74.7-beta are superseded** by
v1.74.8-beta. Those releases contained security-fix code adopted
directly from GitHub issue "Suggested Fix" blocks; v1.74.8-beta
re-implements the same protections independently. Functional
behaviour is identical. New deployments should use v1.74.8-beta or
later. See the
[v1.74.8-beta release notes](https://github.com/P3Portal-org/p3portal/releases/tag/v1.74.8-beta)
for details.

The `:latest`, `:core`, and `:plus` image tags on
`ghcr.io/p3portal-org` follow the supported version automatically.

## Hall of thanks

Researchers who have reported security issues in P3 Portal.

**About the credit given here:** acknowledgment is for the bug
**report** — for finding the issue, describing it precisely, and
reporting it through an appropriate channel. **Code suggestions that
appeared inside the reports are not used in the current supported
release.** The fixes shipping in v1.74.8-beta are independent
re-implementations written from the bug description only, using a
different design, different APIs, and different test structure. See
the [v1.74.8-beta release notes](https://github.com/P3Portal-org/p3portal/releases/tag/v1.74.8-beta)
and [`docs/release-notes/v1.74.8-beta.md`](docs/release-notes/v1.74.8-beta.md)
for the technical detail. This separation exists because GitHub
Issues are not automatically covered by the repository's licence
(GitHub Terms of Service § D.5 grants only display rights on the
platform, not redistribution rights inside this codebase), so any
code from issue text needs an explicit contributor licence agreement
that the project does not currently have in place.

- [@cutetux](https://github.com/cutetux) – reported the SQLite
  `database is locked` concurrency issue
  ([#3](https://github.com/P3Portal-org/p3portal/issues/3)) and the
  Zip-Slip + `require_admin` / `require_operator` proxmox-auth
  bypass class
  ([#4](https://github.com/P3Portal-org/p3portal/issues/4)). The
  bugs themselves were originally addressed in v1.74.5-beta and
  v1.74.6-beta using code adopted from the reports; both are now
  independently re-implemented in v1.74.8-beta.

Thank you. Open source is only as safe as the people who take the
time to look at the code.
