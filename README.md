# P3 Portal

[![Core: AGPLv3](https://img.shields.io/badge/Core-AGPLv3-blue.svg)](LICENSE)
[![Plus: Source-Available](https://img.shields.io/badge/Plus-Source--Available%20%2B%20Key-orange.svg)](LICENSE-PLUS)

> This is the **Core repository** (100 % AGPLv3). The Plus Edition source moved out of this repository with `v1.75.0-beta` and lives at https://github.com/P3Portal-org/p3portal-plus. See [Core vs. Plus](#core-vs-plus) below.

**P3 Portal** is a self-hosted web platform for managing Proxmox VE — a live cluster dashboard, Ansible/Packer automation, networking & firewall management, VM/LXC lifecycle and fine-grained access control. It runs as a single Docker/Podman container; users are managed locally in the portal, and Proxmox API tokens are used by the backend to execute operations on the cluster. An optional **Plus** edition extends it with declarative *Stacks* (infrastructure as code via OpenTofu) and more — see [Core vs. Plus](#core-vs-plus).

![Cluster dashboard](docs/screenshots/dashboard.png)

### What it does (Core)

- **Cluster dashboard** — live overview of nodes, VMs, LXC containers, CPU/RAM/storage
- **Automation** — parametrised Ansible playbooks with live logs plus in-guest runs via dynamic inventory; Packer template builds from `.pkr.hcl`
- **Networking & firewall** — Linux bridges/VLANs, SDN (zones / VNets / subnets), datacenter / node / VM firewall rules, security groups, IP sets
- **VM/LXC lifecycle** — detail pages, power & snapshots, disk attach/resize, backup-job management, ISO & LXC template management (Image Factory)
- **Access control** — fine-grained per-VM/LXC RBAC with custom role presets, resource ownership (incl. adopting externally-created VMs), teams and granular admin delegation; permission-aware UI throughout
- **Job history & API** — every run logged with full output, filterable and searchable; scoped API keys, external jobs API, webhooks
- **Notifications, theming & i18n** — notification hub, built-in themes, DE/EN

> The **Plus** edition adds declarative **Stacks** (VMs / LXC / networks / firewall as code via OpenTofu), an interactive **topology** view, **scheduled jobs & auto-snapshots**, **config snapshots**, resource **pools with quotas**, a **4-eyes approval** workflow, **multi-cluster** dashboards, **Git-sync**, alert presets (SMTP / webhook), a theme editor, and **visual editors** for Packer & Ansible. Full breakdown: [Core vs. Plus](#core-vs-plus).

Everything needed to run (Python, Ansible, Packer, the React frontend — plus OpenTofu in the Plus image) is bundled. Nothing needs to be installed on the host.

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

Available Core tags:

| Tag | Licence |
|---|---|
| `ghcr.io/p3portal-org/p3portal:latest` / `:core` | 100 % AGPLv3 |

Versioned tags like `:1.75.0-beta` are also published — use them to pin a specific release.

For the Plus Edition image see the [Core vs. Plus](#core-vs-plus) section below.

### 3a — Build locally (optional)

If you want to build the Core image yourself (e.g. for development or behind an air-gapped network):

```bash
docker build -t p3portal:local .
```

To verify that the build contains no Plus artifacts:

```bash
./tools/verify-core-build.sh p3portal:local
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
docker build -t p3portal:local .
docker compose up -d   # adjust image: in docker-compose.yml to p3portal:local
```

Database schema migrations run automatically on startup.

### PostgreSQL (optional)

SQLite is the default and works well for single-server deployments. For multi-user team setups or when you need concurrent write access, PostgreSQL 14+ is supported as a production database.

Quick setup — add to `.env` and start with the overlay:

```bash
# .env
DB_URL=postgresql+asyncpg://p3portal:changeme@postgres:5432/p3portal
POSTGRES_PASSWORD=changeme

# start
docker-compose -f docker-compose.yml -f docker-compose.postgres.yml up -d
```

The overlay adds a `postgres:17-alpine` service and a `postgres-backup` sidecar that runs nightly `pg_dump` into `./data/db-backup/` (keeps the last 7 dumps by default).

See [docs/postgres-deployment.md](docs/postgres-deployment.md) for full details including backup, restore, and pool tuning.

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

Two independent image streams. Choose at pull time.

| Image | Built from | Licence |
|---|---|---|
| `ghcr.io/p3portal-org/p3portal:latest` (= `:core`) | this repository (AGPLv3) | 100 % AGPLv3 |
| `ghcr.io/p3portal-org/p3portal-plus:latest` | https://github.com/P3Portal-org/p3portal-plus (Source-Available) | AGPLv3 (Core) + [LICENSE-PLUS](LICENSE-PLUS) (Plus modules) |

The Plus image embeds the same Core code plus the proprietary `backend/plus/` / `frontend/src/plus/` modules. Without a `plus.lic` runtime key the Plus features stay locked and the image behaves like Core. With a valid key the features below unlock.

| Feature | Core image | Plus image (no key) | Plus image (key) |
|---|---|---|---|
| Proxmox cluster dashboard | ✓ | ✓ | ✓ |
| Ansible playbook runner | ✓ | ✓ | ✓ |
| Packer template builder | ✓ | ✓ | ✓ |
| Job history & live logs | ✓ | ✓ | ✓ |
| Network management (Linux bridges & VLANs) | ✓ | ✓ | ✓ |
| SDN management (zones / VNets / subnets) | ✓ | ✓ | ✓ |
| Proxmox firewall (datacenter / node / VM rules, security groups, IP sets) | ✓ | ✓ | ✓ |
| VM disk management (attach / resize / remove) | ✓ | ✓ | ✓ |
| 30-day Plus trial (one-time, unlocks all Plus features) | ✓ | ✓ | ✓ |
| Scheduled jobs | — | ✓ up to 3 | ✓ |
| User accounts | ✓ up to 6 | ✓ up to 6 | ✓ |
| User groups & teams | ✓ up to 3 | ✓ up to 3 | ✓ |
| Role presets | ✓ up to 5 | ✓ up to 5 | ✓ |
| Resource ownerships (VM / LXC) | ✓ up to 10 | ✓ up to 10 | ✓ |
| Multi-node / multi-cluster | — | — | ✓ |
| Resource pools with quotas | — | — | ✓ |
| Approval workflow (4-eyes) | — | — | ✓ |
| Per-node permission scopes (view tasks / view backups / upload ISO) | — | — | ✓ |
| Playbook permission whitelists | — | — | ✓ |
| Alert presets & SMTP / webhook | — | — | ✓ |
| Theme editor (colour picker) | — | — | ✓ |
| Git sync for playbooks & Packer | — | — | ✓ |
| VM / LXC config snapshots (JSON snapshot + diff + restore) | — | — | ✓ |
| Auto-snapshots on schedule (Proxmox-native + config, GFS retention) | — | — | ✓ |
| Stacks (declarative VM/LXC infrastructure via OpenTofu — plan / deploy / destroy / drift) | — | — | ✓ |
| Stacks extras (multi-disk, cloud-init login, LXC containers, stack-private bridge & SDN networks, declarative firewall) | — | — | ✓ |
| Cluster topology view (interactive React Flow graph) | — | — | ✓ |
| VM dependencies & action-impact warnings | — | — | ✓ |
| Packer visual editor (form-driven build definitions) | — | — | ✓ |
| Ansible visual editor (schema-driven task builder) | — | — | ✓ |

The Plus image without a key can be unlocked once for a **30-day trial** (System Settings → Licence or the Setup Wizard); afterwards it falls back to Core. Upload a licence key in **System Settings → Licence** or through the Setup Wizard for a permanent unlock. Plus sales are currently inactive — see [COMMERCIAL.md](COMMERCIAL.md).

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

P3 Portal is an **early beta**. External pull requests are **not accepted at this time** — incoming PRs will be closed automatically by a workflow. Please use **GitHub Issues** for bug reports, feature ideas and questions.

Contribution policy may change after beta. Until then: code changes come from the maintainer.

---

## Built with AI assistance

Significant portions of this codebase were written with the help of AI coding assistants (primarily Anthropic Claude). The maintainer designs the architecture, drives every feature, reviews each change and is responsible for the resulting code and its licensing.

This disclosure is made in the interest of transparency. It does not affect the licence terms: this repository's source is covered by [LICENSE](LICENSE) (AGPLv3) as specified below.

---

## Licensing

| Path | Licence |
|---|---|
| `backend/` (everything in this repo) | [AGPLv3](LICENSE) |
| `frontend/src/` (everything in this repo) | [AGPLv3](LICENSE) |
| `backend/plus/` / `frontend/src/plus/` | Stubs only in this repo. Full source lives in [p3portal-plus](https://github.com/P3Portal-org/p3portal-plus) under [LICENSE-PLUS](LICENSE-PLUS). |

- [LICENSE](LICENSE) — AGPLv3 + §7(b) Author Attribution (governs all source files in this repository)
- [LICENSE-PLUS](LICENSE-PLUS) — Source-Available, key-required, no redistribution (governs source files in the separate p3portal-plus repository, and historical Plus commits in this repository's git history)
- [COMMERCIAL.md](COMMERCIAL.md) — Plus licence details and feature comparison
- [TRADEMARK.md](TRADEMARK.md) — Trade names, author pseudonym, domain notice

---

*[p3portal.org](https://p3portal.org)*
