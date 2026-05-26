# P3 Portal

[![Core: AGPLv3](https://img.shields.io/badge/Core-AGPLv3-blue.svg)](LICENSE)
[![Plus: Source-Available](https://img.shields.io/badge/Plus-Source--Available%20%2B%20Key-orange.svg)](LICENSE-PLUS)

> **This repository is the Core Edition (100 % AGPLv3).**
>
> Plus Edition source was part of this repository **up to and including release `v1.74.9-beta`** (in `backend/plus/` and `frontend/src/plus/`). With release `v1.75.0-beta` it has been moved to a separate **Source-Available** repository at https://github.com/P3Portal-org/p3portal-plus under [`LICENSE-PLUS`](LICENSE-PLUS) (proprietary, license-key gated; the source can be read for review and audit, but modification and redistribution are prohibited). Plus-related historical commits remain reachable in this repo's git history (each historical Plus source file carries its own `SPDX-License-Identifier: LicenseRef-LICENSE-PLUS` header — `LICENSE-PLUS` text stays at the repo root for transparent resolution).
>
> The Plus image is published independently at `ghcr.io/p3portal-org/p3portal-plus` and is **not** built from this repository. See [docs/repo-split-migration.md](docs/repo-split-migration.md) for the image-tag migration if you used the previous combined image.

### P3 Portal Plus Edition (briefly)

Plus is the commercial superset of Core. It adds (non-exhaustive list):

- **Pools with resource quotas** — own portal pools with CPU/RAM/disk limits
- **Approval workflow** — four-eyes principle for playbook runs, packer builds, template deletions, owner-change requests
- **Git-Sync** — auto-sync of playbooks and packer templates from external Git repos (HTTPS+PAT or SSH key)
- **Scheduled Jobs** — cron-based Ansible / SSH / VM-power-action automation
- **Theme Editor** — visual theme customisation (Plus-only)
- **Extended User-API-Keys** — Plus-only scopes
- **Owner auto-assignment on deploy** — deployer becomes VM owner via resolver pipeline, with co-ownership and external-VM adoption
- **Node-scope permissions** — preset rules for all VMs/LXCs on a chosen node
- **Functional permissions** — playbook whitelist per user/group, ISO-upload gate
- **Multi-node dashboard** — independent Proxmox installations side by side
- **VM/LXC monitoring & alerting** — threshold alerts (webhook / e-mail / banner), preset rules

Plus image: `ghcr.io/p3portal-org/p3portal-plus:latest`
Plus source: https://github.com/P3Portal-org/p3portal-plus
License: requires a valid `plus.lic` key to activate Plus features at runtime. See `LICENSE-PLUS` and `COMMERCIAL.md` for terms. Plus-Verkauf is currently inactive (`LEGAL_ENTITY = None`); no new commercial licenses are being issued at this time.

**P3 Portal** is a self-contained Docker/Podman container that provides a web GUI for managing Proxmox clusters. Users are managed locally in the portal; Proxmox API tokens are used by the backend to execute operations on the cluster.

![Cluster dashboard](docs/screenshots/dashboard.png)

### What it does

- **Cluster Dashboard** — live overview of nodes, VMs, LXC containers, CPU/RAM/storage
- **Ansible Playbook Runner** — parametrised playbook execution with live log streaming
- **Packer Template Builder** — build Proxmox VM templates from `.pkr.hcl` definitions
- **Job History** — all runs logged with full output, filterable and searchable
- **Permission-aware UI** — users see only what their Proxmox role permits

Everything needed to run (Python, Ansible, Packer, the React frontend) is bundled in the image. Nothing needs to be installed on the host.

| | |
|---|---|
| ![Playbook form](docs/screenshots/provisioning.png) | ![Packer build](docs/screenshots/packer-build.png) |
| ![Setup wizard](docs/screenshots/setup-wizard.png) | |

---

## Requirements

- Docker ≥ 24 **or** Podman ≥ 4.4 with `podman-compose`
- A reachable Proxmox VE instance (≥ 7.x)
- Proxmox API tokens for the portal service accounts (see [Proxmox Setup](#proxmox-setup))

---

## Deployment

### 1 — Clone and prepare

```bash
git clone https://github.com/P3Portal-org/p3portal.git
cd p3portal

cp .env.example .env
$EDITOR .env
```

### 2 — Configure `.env`

Minimum required values:

```dotenv
SECRET_KEY=<random string, at least 32 characters>
TZ=Europe/Berlin
```

Generate a secure `SECRET_KEY`:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
# or
openssl rand -hex 32
```

The admin account is created through the **Setup Wizard** on first start — no credentials needed in `.env`.

See `.env.example` for the full list of options including Proxmox tokens, Packer settings, and the optional audit log.

### 3 — Get the image

The default `docker-compose.yml` and `podman-compose.host-mode.yml` reference `ghcr.io/p3portal-org/p3portal:latest` — pre-built **Core** images (100 % AGPLv3) published on GitHub Container Registry. No local build needed for the default path:

```bash
# Docker
docker pull ghcr.io/p3portal-org/p3portal:latest

# Podman
podman pull ghcr.io/p3portal-org/p3portal:latest
```

Available tags:

| Tag | Plus code | Licence |
|---|---|---|
| `ghcr.io/p3portal-org/p3portal:latest` / `:core` | — excluded | 100 % AGPLv3 |
| `ghcr.io/p3portal-org/p3portal:plus` | ✓ included | AGPLv3 (Core) + LICENSE-PLUS (Plus) |

Versioned tags like `:1.74.0-beta` and `:1.74.0-beta-plus` are also published — use them to pin a specific release.

### 3a — Use the Plus image

If you want the Plus image (extra features that require a `plus.lic` key at runtime), point the compose files at the `:plus` tag instead — easiest via an override:

```bash
# docker-compose.override.yml
services:
  portal:
    image: ghcr.io/p3portal-org/p3portal:plus
  celery-worker:
    image: ghcr.io/p3portal-org/p3portal:plus
```

Without a `plus.lic` key the Plus image behaves identically to Core; the Plus features only unlock once a valid key is uploaded in **System Settings → License**.

### 3b — Build locally (optional)

If you want to build the image yourself (e.g. for development or behind an air-gapped network):

```bash
# Core (default, AGPLv3 only)
docker build --build-arg EDITION=core -t ghcr.io/p3portal-org/p3portal:latest .

# Plus
docker build --build-arg EDITION=plus -t ghcr.io/p3portal-org/p3portal:plus .
```

Celery, Valkey, and Scheduled Jobs are present in **both** image variants. Core-edition limits apply automatically when no Plus licence key is loaded.

To verify that a Core build contains no Plus artifacts:

```bash
./tools/verify-core-build.sh ghcr.io/p3portal-org/p3portal:latest
```

### 4 — Start

```bash
# Docker Compose (bridge network — recommended default)
docker compose up -d

# Podman Compose (bridge network — recommended default)
podman-compose up -d

# Podman Compose — host network (required for Packer HTTP-preseed builds)
podman-compose -f podman-compose.host-mode.yml up -d
```

The portal starts on **https://\<host\>:8443**. A self-signed TLS certificate is generated automatically on first start — accept the browser warning or replace the certificate (see below).

### 5 — Setup wizard

Open `https://<host>:8443` in your browser. The built-in wizard guides you through:

1. Licence info (Core is free, no key needed)
2. Database selection (SQLite default / PostgreSQL optional)
3. Admin account
4. Proxmox node connection
5. API tokens
6. Packer token *(optional)*
7. Done — auto-login

---

## Volumes & persistent data

All state lives in `./data/`, which is mounted into every container:

| Path | Contents |
|---|---|
| `data/portal.db` | SQLite database — jobs, config, users |
| `data/*.log` | Job output and Proxmox audit logs |
| `data/valkey.pwd` | Auto-generated Valkey password (created on first start) |

Mount your own playbooks and Packer definitions via the existing volume declarations in `docker-compose.yml`:

```yaml
volumes:
  - ./ansible:/app/ansible      # Ansible playbooks + meta.yaml
  - ./packer:/app/packer        # Packer .pkr.hcl + meta.yaml
  - ./data:/app/data            # logs & database (persistent)
```

Both `ansible/` and `packer/` are mounted read-write so the portal's upload features (playbook bundles, Packer templates) can drop files there at runtime.

### Starter pack

Ready-to-use example playbooks and Packer templates live in [`examples/starter-pack/`](examples/starter-pack/) and are included in the image. Copy them into your mounted `ansible/` and `packer/` directories to get going quickly — they show all `meta.yaml` patterns documented in [`docs/meta-yaml-reference.md`](docs/meta-yaml-reference.md).

---

## TLS / HTTPS

### Default — self-signed certificate

The container generates `ssl/portal.crt` + `ssl/portal.key` on first start and serves directly on port `8443` via TLS. To use your own certificate, place `portal.crt` and `portal.key` in `./ssl/` before starting.

### Optional — Caddy reverse proxy

Generate a self-signed cert for your server IP and let Caddy terminate TLS:

```bash
SERVER_IP=$(hostname -I | awk '{print $1}')
mkdir -p ssl
openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout ssl/portal.key -out ssl/portal.crt \
    -days 3650 -subj "/CN=p3portal.local" \
    -addext "subjectAltName=IP:${SERVER_IP}"
```

A `Caddyfile` is included in the repository for reference.

---

## Network modes

The default setup uses a bridge network (`portal-net`), which is right for most LAN/VPN environments.

If you need host networking — for example when Packer's HTTP-preseed server (port `8103`) must be reachable directly by Proxmox VMs during a template build — two options are available:

**Docker Compose** — copy and activate the override example:

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
# adjust if needed, then:
docker compose up -d
```

**Podman Compose** — use the dedicated host-mode file:

```bash
podman-compose -f podman-compose.host-mode.yml up -d
```

> After switching to host mode, set the **Packer HTTP IP** in System Settings to the IP address of the host machine.

> P3 Portal is designed for **LAN / VPN** environments. Exposing it to the public internet is outside the supported scope.

---

## Updating

Default (pulling pre-built images from GHCR):

```bash
# Docker
docker compose pull && docker compose up -d

# Podman
podman-compose pull && podman-compose up -d
```

If you build locally instead:

```bash
git pull
docker build --build-arg EDITION=core -t ghcr.io/p3portal-org/p3portal:latest .
docker compose up -d
```

Database schema migrations run automatically on startup.

---

## Proxmox Setup

The portal needs up to four API tokens with different privilege levels. The first three are mandatory; the `packer` token is only required if you want to use the Image Factory / Packer builds.

| Token | Role | Purpose |
|---|---|---|
| `portal-viewer@pve!portal-viewer` | `PVEAuditor` | Read cluster state |
| `portal-operator@pve!portal-operator` | `PVEVMAdmin` | Ansible playbook execution |
| `portal-admin@pve!portal-admin` | `Administrator` | Full management actions |
| `portal-packer@pve!portal-packer` *(optional)* | custom role | Packer template builds + ISO download |

The `portal-packer` role needs `VM.Allocate`, `VM.Clone`, `Datastore.AllocateTemplate`, `VM.Config.Disk`, and on PVE ≥ 8 also `Sys.AccessNetwork` (required by Proxmox's `download-url` endpoint).

Step-by-step `pveum` instructions are in [`docs/proxmox-setup.md`](docs/proxmox-setup.md). Per-endpoint token usage is documented in [`docs/token-usage.md`](docs/token-usage.md).

---

## Core vs. Plus

P3 Portal ships as **two separate images** — choose at build/pull time:

- **Core image** (`p3portal:latest`, `p3portal:core`) — 100 % AGPLv3. `backend/plus/` and `frontend/src/plus/` are physically removed during build (see `EDITION=core` in [Dockerfile](Dockerfile)). Plus features are **not present in this image** — no licence key can activate them; they simply do not exist in the binary. To use Plus features you must pull or build the Plus image.
- **Plus image** (`p3portal:plus`) — same Core code plus the proprietary `backend/plus/` / `frontend/src/plus/` modules. Without a `plus.lic` key the Plus features stay locked and the runtime behaves like Core. With a valid key the features below unlock.

| Feature | Core image | Plus image (no key) | Plus image (licence key) |
|---|---|---|---|
| Proxmox cluster dashboard | ✓ | ✓ | ✓ |
| Ansible playbook runner | ✓ | ✓ | ✓ |
| Packer template builder | ✓ | ✓ | ✓ |
| Job history & live logs | ✓ | ✓ | ✓ |
| Scheduled jobs | — | ✓  up to 3 | ✓ |
| User accounts | ✓ up to 6 | ✓ up to 6 | ✓ |
| User groups & teams | ✓ up to 3 | ✓ up to 3 | ✓ |
| Role presets | ✓ up to 5 | ✓ up to 5 | ✓ |
| Resource ownerships (VM / LXC) | ✓ up to 10 | ✓ up to 10 | ✓ |
| Multi-node / multi-cluster | — | — | ✓ |
| Resource pools with quotas | — | — | ✓ |
| Approval workflow (4-eyes) | — | — | ✓ |
| Playbook permission whitelists | — | — | ✓ |
| Alert presets & SMTP / webhook | — | — | ✓ |
| Theme editor (colour picker) | — | — | ✓ |
| Git sync for playbooks & Packer | — | — | ✓ |

Upload your licence key in **System Settings → Licence** or through the Setup Wizard. See [COMMERCIAL.md](COMMERCIAL.md) for details on obtaining a key.

---

## Development

```bash
# Backend (with hot-reload)
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8443

# Frontend (Vite dev server)
cd frontend && npm install && npm run dev

# Tests
cd backend && pytest
cd frontend && npm run lint && npm run build
```

---

## Contributing & Bug Reports

P3 Portal is **dual-licensed**: the Core codebase is open source under AGPLv3, the Plus modules are source-available under a separate licence (see [Licensing](#licensing)).

This is an **early beta**. External pull requests are **not accepted at this time** — incoming PRs will be closed automatically by a workflow. Please use **GitHub Issues** for bug reports, feature ideas and questions.

Contribution policy may change after beta. Until then: code changes come from the maintainer.

---

## Built with AI assistance

Significant portions of this codebase were written with the help of AI coding assistants (primarily Anthropic Claude). The maintainer designs the architecture, drives every feature, reviews each change and is responsible for the resulting code and its licensing.

This disclosure is made in the interest of transparency. It does not affect the licence terms: the codebase is covered by [LICENSE](LICENSE) (AGPLv3) and [LICENSE-PLUS](LICENSE-PLUS) as specified below.

---

## Licensing

| Path | Licence |
|---|---|
| `backend/` (excl. `backend/plus/`) | [AGPLv3](LICENSE) |
| `frontend/src/` (excl. `frontend/src/plus/`) | [AGPLv3](LICENSE) |
| `backend/plus/` | [LICENSE-PLUS](LICENSE-PLUS) |
| `frontend/src/plus/` | [LICENSE-PLUS](LICENSE-PLUS) |

- [LICENSE](LICENSE) — AGPLv3 + §7(b) Author Attribution
- [LICENSE-PLUS](LICENSE-PLUS) — Source-Available, key-required, no redistribution
- [COMMERCIAL.md](COMMERCIAL.md) — Plus licence details and feature comparison
- [TRADEMARK.md](TRADEMARK.md) — Trade names, author pseudonym, domain notice

---

*[p3portal.org](https://p3portal.org)*
