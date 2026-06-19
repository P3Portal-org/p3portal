# rootq.de
# syntax=docker/dockerfile:1

# ── Stage 1: Frontend build ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /build

COPY frontend/package*.json ./
RUN npm ci --prefer-offline

ARG FRONTEND_CACHE_BUST=1
COPY frontend/ ./

# PROJ-69: EDITION=core ersetzt die echte Plus-Registry durch einen leeren Stub,
# sodass keine Plus-Komponenten in den Vite-Bundle gelangen.
# EDITION=plus (Default) lässt den echten index.js unberührt.
ARG EDITION=plus
RUN if [ "$EDITION" = "core" ]; then \
        cp src/plus/index.core.js src/plus/index.js; \
    fi

RUN npm run build

# ── Stage 2: Final image ─────────────────────────────────────────────────────
FROM python:3.12-slim

# PROJ-69: EDITION steuert ob Plus-Code im Image enthalten ist.
#   EDITION=plus  (Default) — vollständiges Image mit backend/plus/ + Plus-Frontend
#   EDITION=core            — reines AGPLv3-Image, backend/plus/ wird entfernt
# Verwendung: docker build --build-arg EDITION=core -t p3portal:latest .
ARG EDITION=plus

ARG PACKER_VERSION=1.11.2

# PROJ-76 Phase 2a: OpenTofu engine + bpg/proxmox provider (Plus-only, MPL-2.0).
# Pinned; the exact patch + SHA256 are verified at build time (SHA256SUMS file).
ARG OPENTOFU_VERSION=1.9.1
ARG BPG_PROVIDER_VERSION=0.109.0

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_ROOT_USER_ACTION=ignore

# System-Abhängigkeiten
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        unzip \
        git \
        openssh-client \
        openssl \
        gosu \
    && rm -rf /var/lib/apt/lists/*

# Packer Binary installieren
RUN curl -fsSL \
        "https://releases.hashicorp.com/packer/${PACKER_VERSION}/packer_${PACKER_VERSION}_linux_amd64.zip" \
        -o /tmp/packer.zip \
    && unzip /tmp/packer.zip -d /usr/local/bin/ \
    && rm /tmp/packer.zip \
    && chmod +x /usr/local/bin/packer

# Non-root User anlegen (UID 1001 > SYS_UID_MAX, daher kein -r)
RUN useradd -u 1001 -g users -s /bin/bash -m -d /home/portal portal

WORKDIR /app

# Python-Abhängigkeiten
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir ansible ansible-runner

# Ansible Collections
COPY ansible/requirements.yml ./ansible/requirements.yml
RUN ansible-galaxy collection install -r ./ansible/requirements.yml

# Packer-Plugin-Verzeichnis (shared, für alle User lesbar)
ENV PACKER_PLUGIN_PATH=/app/.packer.d/plugins
RUN mkdir -p "${PACKER_PLUGIN_PATH}"

# packer-plugin-proxmox installieren (benötigt Netzwerkzugriff beim Build)
RUN packer plugins install github.com/hashicorp/proxmox || true

# ── PROJ-76 Phase 2a: OpenTofu engine + bpg/proxmox provider offline mirror ───
# Plus-only: gated behind EDITION!=core so the Core image stays 100% AGPLv3 and
# tofu-free (tools/verify-core-build.sh enforces absence). OpenTofu and the
# provider are both MPL-2.0 (see docs/opentofu-foundation.md for the NOTICE).
# The provider is mirrored into the image at build time (needs network, like
# the packer plugin above); at runtime `tofu init` resolves it purely from the
# local mirror — no call to registry.opentofu.org (air-gapped, Edge Case 1).
RUN if [ "$EDITION" != "core" ]; then \
        set -eux; \
        cd /tmp; \
        curl -fsSL "https://github.com/opentofu/opentofu/releases/download/v${OPENTOFU_VERSION}/tofu_${OPENTOFU_VERSION}_linux_amd64.zip" -o "tofu_${OPENTOFU_VERSION}_linux_amd64.zip"; \
        curl -fsSL "https://github.com/opentofu/opentofu/releases/download/v${OPENTOFU_VERSION}/tofu_${OPENTOFU_VERSION}_SHA256SUMS" -o tofu_SHA256SUMS; \
        grep "tofu_${OPENTOFU_VERSION}_linux_amd64.zip" tofu_SHA256SUMS | sha256sum -c -; \
        unzip -o "tofu_${OPENTOFU_VERSION}_linux_amd64.zip" -d /usr/local/bin/ tofu; \
        chmod +x /usr/local/bin/tofu; \
        rm -f "tofu_${OPENTOFU_VERSION}_linux_amd64.zip" tofu_SHA256SUMS; \
        mkdir -p /opt/tofu/plugin-mirror /tmp/mirror-cfg; \
        printf 'terraform {\n  required_providers {\n    proxmox = {\n      source  = "bpg/proxmox"\n      version = "%s"\n    }\n  }\n}\n' "${BPG_PROVIDER_VERSION}" > /tmp/mirror-cfg/providers.tf; \
        ( cd /tmp/mirror-cfg && tofu providers mirror -platform=linux_amd64 /opt/tofu/plugin-mirror ); \
        rm -rf /tmp/mirror-cfg; \
        printf 'provider_installation {\n  filesystem_mirror {\n    path = "/opt/tofu/plugin-mirror"\n  }\n}\n' > /opt/tofu/tofurc; \
        chmod -R a+rX /opt/tofu; \
        echo "PROJ-76: OpenTofu ${OPENTOFU_VERSION} + bpg/proxmox ${BPG_PROVIDER_VERSION} bundled (EDITION=$EDITION)"; \
    else \
        echo "PROJ-76: OpenTofu skipped (EDITION=core)"; \
    fi

# Global tofu CLI config → forces filesystem_mirror (air-gapped). Harmless in
# the Core image: no tofu binary exists there to read it.
ENV TF_CLI_CONFIG_FILE=/opt/tofu/tofurc

# Anwendungscode
COPY backend/ ./backend/
COPY ansible/ ./ansible/
COPY packer/ ./packer/
COPY examples/ ./examples/

# PROJ-93: Ansible Visual Editor — Build-Zeit-Schema-Cache aus ansible-doc.
# Plus-only (der Editor ist Core-404); generiert die ~71 ansible.builtin-Modul-
# Schemas nach /opt/p3/ansible-doc-cache/ (world-readable für den non-root
# portal-User). Muss VOR dem Core-Strip laufen (braucht backend/plus/).
# SECRET_KEY: der `python -m backend.plus.…`-Aufruf lädt über die Paket-Mechanik
# backend/plus/__init__.py → backend.core.config.Settings(), das einen gültigen
# SECRET_KEY (≥32 Zeichen, kein Default) verlangt. Der Cache-Build nutzt ihn NICHT
# (ruft nur ansible-doc). Daher ein Build-Wegwerf-Wert NUR für diesen einen
# Befehl (inline, keine persistente ENV) — zur Laufzeit setzt entrypoint.sh den
# echten SECRET_KEY.
RUN if [ "$EDITION" != "core" ]; then \
        SECRET_KEY="build-time-throwaway-key-for-ansible-doc-cache-not-used-at-runtime" \
        python -m backend.plus.ansible_editor.doc_cache --build && \
        chmod -R a+rX /opt/p3/ansible-doc-cache && \
        echo "PROJ-93: ansible-doc schema cache built (EDITION=$EDITION)"; \
    else \
        echo "PROJ-93: ansible-doc cache skipped (EDITION=core)"; \
    fi

# PROJ-69: Plus-Backend im Core-Build entfernen.
# rm-after-COPY ist die Docker-idiomatische Lösung, da COPY keine Bedingungen kennt.
# backend/core/plus_protocol.py bleibt in beiden Builds erhalten (Core-Infrastruktur).
RUN if [ "$EDITION" = "core" ]; then \
        rm -rf /app/backend/plus/ && \
        echo "PROJ-69: backend/plus/ removed (EDITION=core)"; \
    fi

# PROJ-72: Lizenz-Dateien ins Image kopieren.
# LICENSE ist immer im Build-Context (AGPLv3 Core-Lizenz).
# LICENSE-PLUS nur im Plus-Build-Context (durch Plus-CI-Overlay platziert)
# bzw. heute auch noch in github/ als Phase-A-Übergangszustand.
# Das Glob `LICENSE*` löst sich immer auf, weil LICENSE garantiert vorhanden ist.
COPY LICENSE* /app/

# PROJ-17: Plus-Lizenz-Token (verschlüsselt, gleich für alle Kunden)
COPY plus.enc /app/plus.enc

# Frontend-Build aus Stage 1
COPY --from=frontend-builder /build/dist/ ./frontend/dist/

# Daten-Verzeichnis & Entrypoint
RUN mkdir -p /app/data /app/ssl \
    && chown -R portal:users /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -fk https://localhost:8443/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
