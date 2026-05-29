# p3portal.org
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

import httpx

from backend.core.config import settings

# In-memory session store: proxmox_username → session data
# Cleared on server restart (acceptable for MVP).
_sessions: dict[str, dict] = {}


@dataclass(frozen=True)
class ProxmoxAuth:
    """Unified auth context for Proxmox API calls.

    kind="cookie": session-ticket auth (Proxmox-login users)
    kind="token":  API-token auth (service accounts / local users)
    """
    kind: str        # "cookie" | "token"
    value: str       # ticket for cookie, token_id for token
    secret: str = field(default="")   # empty for cookie, token_secret for token
    csrf: str = field(default="")     # CSRF token (cookie kind only, POST/DELETE)


class ProxmoxClient:
    """Thin async wrapper around the Proxmox REST API.

    PROJ-21: _base and _verify are resolved dynamically from config_service
    (DB with env-var override) on every call instead of being fixed at startup.

    Per-node override: pass base_url and/or verify_ssl to the constructor to
    pin the client to a specific node (used for multi-node Plus deployments).
    """

    def __init__(self, base_url: str | None = None, verify_ssl: bool | None = None):
        self._base_url_override: str | None = base_url.rstrip("/") if base_url else None
        self._verify_override: bool | None = verify_ssl

    @property
    def _base(self) -> str:
        if self._base_url_override:
            return self._base_url_override
        from backend.services.config_service import get_config_sync
        host = get_config_sync("proxmox_host") or settings.proxmox_host
        return host.rstrip("/")

    @property
    def _verify(self) -> bool:
        if self._verify_override is not None:
            return self._verify_override
        from backend.services.config_service import get_proxmox_verify_ssl
        return get_proxmox_verify_ssl()

    def _client(self) -> httpx.AsyncClient:
        from backend.services.proxmox_audit_service import (
            is_audit_enabled,
            is_debug_user_enabled,
            is_log_body_enabled,
            portal_user_var,
            write_audit_line,
        )

        if not is_audit_enabled():
            return httpx.AsyncClient(verify=self._verify, timeout=10.0)

        log_body = is_log_body_enabled()
        debug_user = is_debug_user_enabled()

        async def _on_request(request: httpx.Request) -> None:
            if log_body:
                try:
                    request.extensions["_audit_body"] = request.content.decode("utf-8", errors="replace")[:500]
                except Exception:
                    request.extensions["_audit_body"] = ""
            if debug_user:
                user = portal_user_var.get()
                if user:
                    request.headers["X-Portal-User"] = user

        async def _on_response(response: httpx.Response) -> None:
            request = response.request
            method = request.method
            path = str(request.url.path)
            if request.url.query:
                path += f"?{request.url.query}"

            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("PVEAPIToken="):
                token_full = auth_header[len("PVEAPIToken="):]
                token = token_full.rsplit("=", 1)[0]
            else:
                token = "cookie-auth"

            user = portal_user_var.get() if debug_user else ""
            raw_body = request.extensions.get("_audit_body", "") if log_body else ""
            # PROJ-67 Phase 1 – F-005: mask credentials before writing to audit log
            from backend.core.secret_masking import mask_login_body
            body = mask_login_body(path, raw_body) if raw_body else ""

            write_audit_line(token, method, path, str(response.status_code), user=user, body=body)

        return httpx.AsyncClient(
            verify=self._verify,
            timeout=10.0,
            event_hooks={"request": [_on_request], "response": [_on_response]},
        )

    def _auth_kwargs(self, auth: ProxmoxAuth) -> dict:
        """Build httpx request kwargs (cookies / headers) for the given auth context."""
        if auth.kind == "cookie":
            kwargs: dict = {"cookies": {"PVEAuthCookie": auth.value}}
            if auth.csrf:
                kwargs["headers"] = {"CSRFPreventionToken": auth.csrf}
            return kwargs
        else:
            return {"headers": {"Authorization": f"PVEAPIToken={auth.value}={auth.secret}"}}

    # ── Authentication ────────────────────────────────────────────────────────

    async def authenticate(self, username: str, password: str, realm: str) -> dict:
        """Authenticate against Proxmox and return the raw data dict.

        Raises httpx.HTTPStatusError on bad credentials (4xx).
        """
        async with self._client() as client:
            resp = await client.post(
                f"{self._base}/api2/json/access/ticket",
                data={"username": f"{username}@{realm}", "password": password},
            )
            resp.raise_for_status()
            return resp.json()["data"]

    # ── Session store (server-side, never sent to frontend) ───────────────────

    def store_session(self, username: str, data: dict) -> None:
        _sessions[username] = {
            "ticket": data["ticket"],
            "csrf": data["CSRFPreventionToken"],
            "cap": data.get("cap", {}),
        }

    def get_session(self, username: str) -> dict | None:
        return _sessions.get(username)

    def clear_session(self, username: str) -> None:
        _sessions.pop(username, None)

    # ── Legacy helpers (session-ticket, kept for backward compat) ─────────────

    async def get_user_info(self, ticket: str, username: str) -> dict:
        """Fetch user info (incl. groups) from Proxmox."""
        async with self._client() as client:
            resp = await client.get(
                f"{self._base}/api2/json/access/users/{username}",
                cookies={"PVEAuthCookie": ticket},
            )
            resp.raise_for_status()
            return resp.json().get("data", {})

    async def get_cluster_resources(self, ticket: str, resource_type: str) -> list[dict]:
        """Fetch cluster resources filtered by type ('node' or 'vm')."""
        auth = ProxmoxAuth(kind="cookie", value=ticket)
        return await self.get_cluster_resources_v2(auth, resource_type)

    async def get_cluster_status(self, ticket: str) -> list[dict]:
        """Fetch cluster status entries (mixed cluster + node records)."""
        auth = ProxmoxAuth(kind="cookie", value=ticket)
        return await self.get_cluster_status_v2(auth)

    async def get_ha_status(self, ticket: str) -> str:
        """Return HA status string; returns 'none' when HA is not configured."""
        auth = ProxmoxAuth(kind="cookie", value=ticket)
        return await self.get_ha_status_v2(auth)

    # ── Unified cluster reads (ProxmoxAuth) ───────────────────────────────────

    async def get_cluster_resources_v2(self, auth: ProxmoxAuth, resource_type: str) -> list[dict]:
        """Fetch cluster resources filtered by type ('node' or 'vm')."""
        async with self._client() as client:
            resp = await client.get(
                f"{self._base}/api2/json/cluster/resources",
                params={"type": resource_type},
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", [])

    async def get_cluster_status_v2(self, auth: ProxmoxAuth) -> list[dict]:
        """Fetch cluster status entries (mixed cluster + node records)."""
        async with self._client() as client:
            resp = await client.get(
                f"{self._base}/api2/json/cluster/status",
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", [])

    async def get_ha_status_v2(self, auth: ProxmoxAuth) -> str:
        """Return HA status string; returns 'none' when HA is not configured."""
        async with self._client() as client:
            resp = await client.get(
                f"{self._base}/api2/json/cluster/ha/status/current",
                **self._auth_kwargs(auth),
            )
            if resp.status_code == 404:
                return "none"
            resp.raise_for_status()
            data = resp.json().get("data", {})
            return data.get("status", "none") if isinstance(data, dict) else "none"

    # ── Single-Node reads – Basis edition (PROJ-16) ──────────────────────────

    async def get_node_status(self, auth: ProxmoxAuth, node: str) -> dict:
        """Fetch a single node's status and return a NodeInfo-compatible dict.

        Calls /nodes/{node}/status instead of the cluster-wide resource endpoint.
        Used in Basis edition; Plus edition uses get_cluster_resources_v2.
        """
        async with self._client() as client:
            resp = await client.get(
                f"{self._base}/api2/json/nodes/{node}/status",
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            data = resp.json().get("data", {})
        memory = data.get("memory", {})
        rootfs = data.get("rootfs", {})
        cpuinfo = data.get("cpuinfo", {})
        return {
            "node": node,
            "status": "online",
            "cpu": data.get("cpu", 0.0),
            "maxcpu": cpuinfo.get("cpus", data.get("maxcpu", 0)),
            "mem": memory.get("used", data.get("mem", 0)),
            "maxmem": memory.get("total", data.get("maxmem", 0)),
            "disk": rootfs.get("used", data.get("disk", 0)),
            "maxdisk": rootfs.get("total", data.get("maxdisk", 0)),
            "uptime": data.get("uptime", 0),
        }

    async def get_node_vms(self, auth: ProxmoxAuth, node: str) -> list[dict]:
        """Fetch all QEMU VMs and LXC containers for a single node.

        Merges /nodes/{node}/qemu + /nodes/{node}/lxc into one list,
        injecting node and type fields to match the cluster-resource shape.
        Used in Basis edition; Plus edition uses get_cluster_resources_v2.
        """
        auth_kwargs = self._auth_kwargs(auth)
        async with self._client() as client:
            qemu_resp, lxc_resp = await asyncio.gather(
                client.get(f"{self._base}/api2/json/nodes/{node}/qemu", **auth_kwargs),
                client.get(f"{self._base}/api2/json/nodes/{node}/lxc", **auth_kwargs),
            )
        qemu_resp.raise_for_status()
        lxc_resp.raise_for_status()
        vms: list[dict] = []
        for vm in qemu_resp.json().get("data", []):
            vm["node"] = node
            vm["type"] = "qemu"
            vms.append(vm)
        for ct in lxc_resp.json().get("data", []):
            ct["node"] = node
            ct["type"] = "lxc"
            vms.append(ct)
        return vms

    async def get_next_vmid(self, auth: ProxmoxAuth, min_id: int, max_id: int) -> int:
        """Return the next free VM ID in [min_id, max_id].

        Proxmox cluster/nextid?vmid=N returns N when free, HTTP error when taken.
        We loop through the range until we find a free slot.
        """
        async with self._client() as client:
            for vmid in range(min_id, max_id + 1):
                resp = await client.get(
                    f"{self._base}/api2/json/cluster/nextid",
                    params={"vmid": str(vmid)},
                    **self._auth_kwargs(auth),
                )
                if resp.status_code == 200:
                    return int(resp.json()["data"])
                # non-200 means vmid is taken – try next
        raise ValueError(f"VM-ID-Bereich {min_id}–{max_id} erschöpft")

    async def get_vm_ctime(self, auth: ProxmoxAuth, node: str, vmid: int, vm_type: str = "qemu") -> int | None:
        """Fetch VM creation timestamp from config meta field.

        Proxmox stores creation info in the config meta field:
        e.g. "creation-qemu=8.2.2,ctime=1714003200"
        """
        kind = "lxc" if vm_type == "lxc" else "qemu"
        try:
            async with self._client() as client:
                resp = await client.get(
                    f"{self._base}/api2/json/nodes/{node}/{kind}/{vmid}/config",
                    **self._auth_kwargs(auth),
                )
                resp.raise_for_status()
            meta = resp.json().get("data", {}).get("meta", "")
            for part in meta.split(","):
                if part.startswith("ctime="):
                    return int(part.split("=", 1)[1])
        except Exception:
            pass
        return None

    # ── VM Operations (ProxmoxAuth) ───────────────────────────────────────────

    def _vm_base(self, node: str, vmid: int, vm_type: str) -> str:
        """Return the Proxmox API base path for a VM or LXC container."""
        kind = "lxc" if vm_type == "lxc" else "qemu"
        return f"{self._base}/api2/json/nodes/{node}/{kind}/{vmid}"

    async def vm_power_action(
        self, auth: ProxmoxAuth, node: str, vmid: int, action: str, vm_type: str = "qemu"
    ) -> str:
        """Send a power action to a VM or LXC. Returns the Proxmox task UPID.

        action: "start" | "stop" | "shutdown" | "reboot"
        """
        async with self._client() as client:
            resp = await client.post(
                f"{self._vm_base(node, vmid, vm_type)}/status/{action}",
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", "")

    async def get_snapshots(
        self, auth: ProxmoxAuth, node: str, vmid: int, vm_type: str = "qemu"
    ) -> list[dict]:
        """List snapshots for a VM or LXC container."""
        async with self._client() as client:
            resp = await client.get(
                f"{self._vm_base(node, vmid, vm_type)}/snapshot",
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", [])

    async def create_snapshot(
        self,
        auth: ProxmoxAuth,
        node: str,
        vmid: int,
        name: str,
        description: str = "",
        vm_type: str = "qemu",
    ) -> str:
        """Create a snapshot. Returns the task UPID."""
        body: dict = {"snapname": name}
        if description:
            body["description"] = description
        async with self._client() as client:
            resp = await client.post(
                f"{self._vm_base(node, vmid, vm_type)}/snapshot",
                data=body,
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", "")

    async def rollback_snapshot(
        self, auth: ProxmoxAuth, node: str, vmid: int, name: str, vm_type: str = "qemu"
    ) -> str:
        """Rollback to a snapshot. Returns the task UPID."""
        async with self._client() as client:
            resp = await client.post(
                f"{self._vm_base(node, vmid, vm_type)}/snapshot/{name}/rollback",
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", "")

    async def delete_snapshot(
        self, auth: ProxmoxAuth, node: str, vmid: int, name: str, vm_type: str = "qemu"
    ) -> str:
        """Delete a snapshot. Returns the task UPID."""
        async with self._client() as client:
            resp = await client.delete(
                f"{self._vm_base(node, vmid, vm_type)}/snapshot/{name}",
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", "")

    async def get_vm_ip(self, auth: ProxmoxAuth, node: str, vmid: int, vm_type: str = "qemu") -> str | None:
        """Return the first non-loopback IPv4 address of a running VM/LXC.

        QEMU: uses QEMU Guest Agent network-get-interfaces endpoint.
        LXC:  uses the LXC interfaces endpoint (no guest agent needed).
        Returns None on any error (agent not installed, VM stopped, timeout, etc.).
        """
        try:
            async with httpx.AsyncClient(verify=self._verify, timeout=3.0) as client:
                if vm_type == "lxc":
                    resp = await client.get(
                        f"{self._base}/api2/json/nodes/{node}/lxc/{vmid}/interfaces",
                        **self._auth_kwargs(auth),
                    )
                    resp.raise_for_status()
                    for iface in resp.json().get("data", []):
                        inet = iface.get("inet", "")
                        if inet and not inet.startswith("127."):
                            return inet.split("/")[0]
                else:
                    resp = await client.get(
                        f"{self._base}/api2/json/nodes/{node}/qemu/{vmid}/agent/network-get-interfaces",
                        **self._auth_kwargs(auth),
                    )
                    resp.raise_for_status()
                    result = resp.json().get("data", {}).get("result", [])
                    for iface in result:
                        if iface.get("name") == "lo":
                            continue
                        for addr in iface.get("ip-addresses", []):
                            if addr.get("ip-address-type") == "ipv4":
                                ip = addr.get("ip-address", "")
                                if ip and not ip.startswith("127."):
                                    return ip
        except Exception:
            pass
        return None

    async def delete_vm(self, auth: ProxmoxAuth, node: str, vmid: int, vm_type: str = "qemu") -> str:
        """Destroy a VM or LXC container. Returns the task UPID."""
        async with self._client() as client:
            resp = await client.delete(
                self._vm_base(node, vmid, vm_type),
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", "")

    # ── VM Detail Page methods (PROJ-29) ──────────────────────────────────────

    async def get_vm_status_current(
        self, auth: ProxmoxAuth, node: str, vmid: int, vm_type: str = "qemu"
    ) -> dict:
        """Fetch live status (CPU, RAM, uptime) for a single VM or LXC."""
        async with self._client() as client:
            resp = await client.get(
                f"{self._vm_base(node, vmid, vm_type)}/status/current",
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", {})

    async def get_vm_config(
        self, auth: ProxmoxAuth, node: str, vmid: int, vm_type: str = "qemu"
    ) -> dict:
        """Fetch configuration (networks, disks, BIOS, OS type) for a VM or LXC."""
        async with self._client() as client:
            resp = await client.get(
                f"{self._vm_base(node, vmid, vm_type)}/config",
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", {})

    async def put_vm_config(
        self,
        auth: ProxmoxAuth,
        node: str,
        vmid: int,
        updates: dict,
        delete_keys: list[str] | None = None,
        vm_type: str = "qemu",
    ) -> None:
        """Apply a config diff to a VM or LXC via a single PUT request.

        ``updates`` contains keys to set/change; ``delete_keys`` lists keys
        to remove (passed as the ``delete`` query parameter to Proxmox).
        """
        params: dict = {}
        if delete_keys:
            params["delete"] = ",".join(delete_keys)
        async with self._client() as client:
            resp = await client.put(
                f"{self._vm_base(node, vmid, vm_type)}/config",
                json=updates,
                params=params,
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()

    async def get_node_backup_storages(self, auth: ProxmoxAuth, node: str) -> list[dict]:
        """Return all storages on *node* that have backup content enabled."""
        async with self._client() as client:
            resp = await client.get(
                f"{self._base}/api2/json/nodes/{node}/storage",
                params={"content": "backup"},
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", [])

    async def get_storage_contents(
        self, auth: ProxmoxAuth, node: str, storage: str
    ) -> list[dict]:
        """List backup volumes in a storage on *node*."""
        async with self._client() as client:
            resp = await client.get(
                f"{self._base}/api2/json/nodes/{node}/storage/{storage}/content",
                params={"content": "backup"},
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", [])

    async def get_datacenter_backup_jobs(self, auth: ProxmoxAuth) -> list[dict]:
        """Return datacenter-wide backup schedules. Returns [] on 403 (no permission)."""
        try:
            async with self._client() as client:
                resp = await client.get(
                    f"{self._base}/api2/json/cluster/backup",
                    **self._auth_kwargs(auth),
                )
                resp.raise_for_status()
                return resp.json().get("data", [])
        except httpx.HTTPStatusError:
            return []

    async def create_vzdump_backup(
        self,
        auth: ProxmoxAuth,
        node: str,
        vmid: int,
        storage: str,
        mode: str,
        compress: str,
    ) -> str:
        """Start an vzdump backup job. Returns the task UPID."""
        async with self._client() as client:
            resp = await client.post(
                f"{self._base}/api2/json/nodes/{node}/vzdump",
                data={"vmid": str(vmid), "storage": storage, "mode": mode, "compress": compress},
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", "")

    async def delete_storage_content(
        self, auth: ProxmoxAuth, node: str, storage: str, volid: str
    ) -> None:
        """Delete a backup file from storage. volid is the full volume ID."""
        import urllib.parse
        encoded = urllib.parse.quote(volid, safe="")
        async with self._client() as client:
            resp = await client.delete(
                f"{self._base}/api2/json/nodes/{node}/storage/{storage}/content/{encoded}",
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()

    # ── PROJ-32: Guest-Info & LXC interfaces ─────────────────────────────────

    _PSEUDO_FS = frozenset(
        ["tmpfs", "devtmpfs", "proc", "sysfs", "cgroup", "cgroup2", "devpts", "hugetlbfs"]
    )

    async def get_guest_info(
        self, auth: ProxmoxAuth, node: str, vmid: int
    ) -> "dict":
        """Call 4 QEMU Guest Agent commands in parallel and return a raw dict.

        Each call has a 5 s timeout.  Failures are caught individually so that
        a single unavailable command never causes a 500 error.
        Returns a dict compatible with GuestInfoResponse.
        """
        from backend.models.vms import FilesystemInfo, GuestInfoResponse

        base = f"{self._base}/api2/json/nodes/{node}/qemu/{vmid}/agent"
        auth_kwargs = self._auth_kwargs(auth)

        async def _agent_call(command: str) -> dict | None:
            try:
                async with httpx.AsyncClient(verify=self._verify, timeout=5.0) as client:
                    resp = await client.get(f"{base}/{command}", **auth_kwargs)
                    resp.raise_for_status()
                    return resp.json().get("data", {}).get("result")
            except Exception:
                return None

        osinfo_raw, hostname_raw, timezone_raw, fsinfo_raw = await asyncio.gather(
            _agent_call("get-osinfo"),
            _agent_call("get-host-name"),
            _agent_call("get-timezone"),
            _agent_call("get-fsinfo"),
        )

        os_name = os_version = kernel = arch = hostname = timezone = None
        timezone_offset: int | None = None

        if isinstance(osinfo_raw, dict):
            os_name = osinfo_raw.get("pretty-name") or osinfo_raw.get("name")
            os_version = osinfo_raw.get("version-id")
            kernel = osinfo_raw.get("kernel-release")
            arch = osinfo_raw.get("machine")

        if isinstance(hostname_raw, dict):
            hostname = hostname_raw.get("host-name")

        if isinstance(timezone_raw, dict):
            timezone = timezone_raw.get("zone")
            raw_offset = timezone_raw.get("offset")
            if raw_offset is not None:
                try:
                    timezone_offset = int(raw_offset)
                except (ValueError, TypeError):
                    pass

        filesystems: list[FilesystemInfo] = []
        if isinstance(fsinfo_raw, list):
            for fs in fsinfo_raw:
                fstype = fs.get("type", "")
                if fstype in self._PSEUDO_FS:
                    continue
                total = fs.get("total-bytes", 0)
                used = fs.get("used-bytes", 0)
                mp = fs.get("mountpoint", "")
                filesystems.append(FilesystemInfo(
                    mountpoint=mp,
                    total_bytes=total,
                    used_bytes=used,
                    fstype=fstype,
                ))
            filesystems.sort(key=lambda f: f.total_bytes, reverse=True)

        truncated_count = 0
        if len(filesystems) > 10:
            truncated_count = len(filesystems) - 10
            filesystems = filesystems[:10]

        return GuestInfoResponse(
            os_name=os_name,
            os_version=os_version,
            kernel=kernel,
            arch=arch,
            hostname=hostname,
            timezone=timezone,
            timezone_offset=timezone_offset,
            filesystems=filesystems,
            truncated_count=truncated_count,
        ).model_dump()

    # ── PROJ-40: Node Tasks ───────────────────────────────────────────────────

    async def get_node_tasks(
        self,
        auth: ProxmoxAuth,
        node: str,
        limit: int = 50,
        typefilter: str | None = None,
    ) -> list[dict]:
        """Return the latest tasks for a node from /nodes/{node}/tasks."""
        params: dict[str, int | str] = {"limit": limit}
        if typefilter:
            params["typefilter"] = typefilter
        async with self._client() as client:
            resp = await client.get(
                f"{self._base}/api2/json/nodes/{node}/tasks",
                params=params,
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", [])

    async def get_lxc_interfaces(
        self, auth: ProxmoxAuth, node: str, vmid: int
    ) -> list[dict]:
        """Return all network interfaces of an LXC container including IPs and MAC.

        Unlike get_vm_ip (which returns only the first non-loopback IPv4),
        this returns the complete interface list for the detail page.
        """
        from backend.models.vms import LxcNetworkInterface
        try:
            async with httpx.AsyncClient(verify=self._verify, timeout=5.0) as client:
                resp = await client.get(
                    f"{self._base}/api2/json/nodes/{node}/lxc/{vmid}/interfaces",
                    **self._auth_kwargs(auth),
                )
                resp.raise_for_status()
                raw = resp.json().get("data", [])
        except Exception:
            return []

        interfaces = []
        for iface in raw:
            name = iface.get("name", "")
            inet = iface.get("inet")
            inet6 = iface.get("inet6")
            hwaddr = iface.get("hwaddr")
            interfaces.append(LxcNetworkInterface(
                name=name,
                inet=inet,
                inet6=inet6,
                hwaddr=hwaddr,
            ).model_dump())
        return interfaces


    # ── APT update methods (PROJ-73) ──────────────────────────────────────────

    async def apt_update_post(self, auth: ProxmoxAuth, node: str) -> str:
        """Trigger `apt-get update` on a Proxmox node; returns the UPID string.

        Requires Sys.Modify on the node (admin token).
        """
        async with self._client() as client:
            resp = await client.post(
                f"{self._base}/api2/json/nodes/{node}/apt/update",
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", "")

    async def get_task_status(self, auth: ProxmoxAuth, node: str, upid: str) -> dict:
        """Return the current status dict for a Proxmox task (UPID)."""
        async with self._client() as client:
            resp = await client.get(
                f"{self._base}/api2/json/nodes/{node}/tasks/{upid}/status",
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", {})

    async def apt_get_updates(self, auth: ProxmoxAuth, node: str) -> list[dict]:
        """Return the list of available APT updates for a Proxmox node.

        Requires Sys.Audit on the node (viewer token sufficient).
        """
        async with self._client() as client:
            resp = await client.get(
                f"{self._base}/api2/json/nodes/{node}/apt/update",
                **self._auth_kwargs(auth),
            )
            resp.raise_for_status()
            return resp.json().get("data", [])


proxmox_client = ProxmoxClient()
