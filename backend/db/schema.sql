CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL DEFAULT 'ansible',
    playbook    TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'success', 'failed')),
    created_at  TEXT NOT NULL,
    started_at  TEXT,
    finished_at TEXT,
    username    TEXT NOT NULL,
    params      TEXT NOT NULL DEFAULT '{}',
    log_path    TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_username   ON jobs(username);
CREATE INDEX IF NOT EXISTS idx_jobs_status     ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

CREATE TABLE IF NOT EXISTS local_users (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    username              TEXT    NOT NULL UNIQUE,
    password_hash         TEXT    NOT NULL,
    role                  TEXT    NOT NULL DEFAULT 'operator'
                              CHECK (role IN ('admin', 'operator', 'viewer', 'restricted')),
    active                INTEGER NOT NULL DEFAULT 1,
    created_at            TEXT    NOT NULL,
    must_change_password  INTEGER NOT NULL DEFAULT 0,
    last_login_at         TEXT,
    last_login_ip         TEXT,
    portal_permissions    TEXT    NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_local_users_username ON local_users(username);
CREATE INDEX IF NOT EXISTS idx_local_users_active   ON local_users(active);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_presets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    description TEXT    NOT NULL DEFAULT '',
    permissions TEXT    NOT NULL DEFAULT '[]',
    created_at  TEXT    NOT NULL,
    created_by  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_role_presets_name ON role_presets(name);

CREATE TABLE IF NOT EXISTS resource_assignments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    resource_type TEXT    NOT NULL CHECK (resource_type IN ('vm', 'lxc')),
    resource_id   INTEGER NOT NULL,
    preset_id     INTEGER NOT NULL,
    created_at    TEXT    NOT NULL,
    created_by    TEXT    NOT NULL,
    UNIQUE (user_id, resource_type, resource_id),
    FOREIGN KEY (user_id)   REFERENCES local_users(id)  ON DELETE CASCADE,
    FOREIGN KEY (preset_id) REFERENCES role_presets(id)
);

CREATE INDEX IF NOT EXISTS idx_resource_assignments_user_id   ON resource_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_resource_assignments_preset_id ON resource_assignments(preset_id);

CREATE TABLE IF NOT EXISTS user_profiles (
    username             TEXT    PRIMARY KEY,
    auth_type            TEXT    NOT NULL DEFAULT 'local',
    ssh_public_key       TEXT,
    ssh_private_key_enc  TEXT,
    last_login_at        TEXT,
    last_login_ip        TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id           TEXT    PRIMARY KEY,
    username     TEXT    NOT NULL,
    jti          TEXT    NOT NULL UNIQUE,
    created_at   TEXT    NOT NULL,
    expires_at   TEXT    NOT NULL,
    ip_address   TEXT,
    user_agent   TEXT,
    revoked      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_username   ON user_sessions(username);
CREATE INDEX IF NOT EXISTS idx_user_sessions_jti        ON user_sessions(jti);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- PROJ-18: Custom themes (built-in themes are seeded at startup, is_builtin=1)
CREATE TABLE IF NOT EXISTS themes (
    id         TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL,
    author     TEXT    NOT NULL DEFAULT '',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    file_path  TEXT,
    created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_themes_is_builtin ON themes(is_builtin);

CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type  TEXT NOT NULL,
    username    TEXT,
    auth_type   TEXT,
    ip_address  TEXT,
    user_agent  TEXT,
    detail      TEXT,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_username   ON audit_logs(username);

-- PROJ-21: Infrastructure configuration (replaces .env for runtime settings)
CREATE TABLE IF NOT EXISTS portal_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    is_secret  INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT 'system'
);

-- PROJ-21: Proxmox node registry (Basis: 1 node, Plus: unlimited)
CREATE TABLE IF NOT EXISTS nodes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    url          TEXT    NOT NULL,
    proxmox_node TEXT    NOT NULL,
    verify_ssl   INTEGER NOT NULL DEFAULT 1,
    token_id     TEXT    NOT NULL DEFAULT '',
    token_secret TEXT    NOT NULL DEFAULT '',
    viewer_token_id     TEXT NOT NULL DEFAULT '',
    viewer_token_secret TEXT NOT NULL DEFAULT '',
    operator_token_id     TEXT NOT NULL DEFAULT '',
    operator_token_secret TEXT NOT NULL DEFAULT '',
    admin_token_id     TEXT NOT NULL DEFAULT '',
    admin_token_secret TEXT NOT NULL DEFAULT '',
    packer_token_id     TEXT NOT NULL DEFAULT '',
    packer_token_secret TEXT NOT NULL DEFAULT '',
    tofu_token_id       TEXT NOT NULL DEFAULT '',
    tofu_token_secret   TEXT NOT NULL DEFAULT '',
    cluster_nodes TEXT    NOT NULL DEFAULT '',
    poll_interval INTEGER NOT NULL DEFAULT 30,
    position     INTEGER NOT NULL DEFAULT 0,
    is_default   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL,
    created_by   TEXT    NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_nodes_is_default ON nodes(is_default);

-- Multi SSH keys per user
CREATE TABLE IF NOT EXISTS user_ssh_keys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL,
    label       TEXT    NOT NULL,
    public_key  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    UNIQUE (username, label)
);

CREATE INDEX IF NOT EXISTS idx_user_ssh_keys_username ON user_ssh_keys(username);

-- PROJ-9: Machine-to-Machine API keys
CREATE TABLE IF NOT EXISTS api_keys (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    description  TEXT,
    key_hash     TEXT    NOT NULL UNIQUE,
    key_prefix   TEXT    NOT NULL,
    scopes       TEXT    NOT NULL DEFAULT '[]',
    created_at   TEXT    NOT NULL,
    expires_at   TEXT,
    revoked_at   TEXT,
    last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash  ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_revoked   ON api_keys(revoked_at);

-- PROJ-9: Audit log for external API calls
CREATE TABLE IF NOT EXISTS external_api_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id   INTEGER REFERENCES api_keys(id),
    api_key_name TEXT    NOT NULL,
    scope_used   TEXT    NOT NULL,
    method       TEXT    NOT NULL,
    endpoint     TEXT    NOT NULL,
    status_code  INTEGER,
    job_id       TEXT,
    playbook     TEXT,
    node         TEXT,
    callback_url TEXT,
    called_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_external_api_log_called_at  ON external_api_log(called_at);
CREATE INDEX IF NOT EXISTS idx_external_api_log_api_key_id ON external_api_log(api_key_id);

-- PROJ-24: Personal User API Keys
CREATE TABLE IF NOT EXISTS user_api_keys (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
    name          TEXT    NOT NULL,
    key_hash      TEXT    NOT NULL UNIQUE,
    key_prefix    TEXT    NOT NULL,
    scopes        TEXT    NOT NULL DEFAULT '[]',
    expires_at    TEXT,
    last_used_at  TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id  ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_key_hash ON user_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_active   ON user_api_keys(is_active);

-- PROJ-28: Dashboard announcements
CREATE TABLE IF NOT EXISTS announcements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    message     TEXT    NOT NULL,
    type        TEXT    NOT NULL DEFAULT 'info'
                    CHECK (type IN ('info', 'warn', 'error')),
    active      INTEGER NOT NULL DEFAULT 1,
    expires_at  TEXT,
    created_by  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(active);

-- PROJ-36: User notification settings (personal alert preferences)
CREATE TABLE IF NOT EXISTS user_notification_settings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
    email_enabled   INTEGER NOT NULL DEFAULT 0,
    email_address   TEXT,
    webhook_url     TEXT,
    webhook_token   TEXT,
    min_severity    TEXT    NOT NULL DEFAULT 'high'
                        CHECK (min_severity IN ('low', 'medium', 'high', 'critical')),
    updated_at      TEXT    NOT NULL,
    UNIQUE(user_id)
);
