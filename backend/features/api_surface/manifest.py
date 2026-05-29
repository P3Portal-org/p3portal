# p3portal.org
"""PROJ-44: Statisches Scope-Manifest – Grundlage für GET /api/scopes/manifest."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ScopeEndpoint:
    method: str
    path: str
    summary_key: str


@dataclass(frozen=True)
class ScopeManifestEntry:
    name: str
    description_key: str
    endpoints: tuple[ScopeEndpoint, ...]
    plus_only: bool = False
    curl_example: str = ""


SCOPE_MANIFEST: tuple[ScopeManifestEntry, ...] = (
    ScopeManifestEntry(
        name="cluster:read",
        description_key="scope.cluster_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/cluster", "scope.cluster_read.ep.status"),
            ScopeEndpoint("GET", "/api/cluster/nodes", "scope.cluster_read.ep.nodes"),
            ScopeEndpoint("GET", "/api/cluster/vms", "scope.cluster_read.ep.vms"),
            ScopeEndpoint("GET", "/api/cluster/lxc", "scope.cluster_read.ep.lxc"),
            ScopeEndpoint("GET", "/api/vms/{node}/{vmid}", "scope.cluster_read.ep.vm_detail"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/cluster"
        ),
    ),
    ScopeManifestEntry(
        name="jobs:read",
        description_key="scope.jobs_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/jobs", "scope.jobs_read.ep.list"),
            ScopeEndpoint("GET", "/api/jobs/{id}", "scope.jobs_read.ep.detail"),
            ScopeEndpoint("GET", "/api/jobs/{id}/log", "scope.jobs_read.ep.log"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/jobs"
        ),
    ),
    ScopeManifestEntry(
        name="jobs:write",
        description_key="scope.jobs_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/jobs", "scope.jobs_write.ep.start"),
            ScopeEndpoint("DELETE", "/api/jobs/{id}", "scope.jobs_write.ep.cancel"),
        ),
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-H "Content-Type: application/json" '
            '-d \'{"playbook":"my-playbook","params":{}}\' '
            "<HOST>/api/jobs"
        ),
    ),
    ScopeManifestEntry(
        name="playbooks:read",
        description_key="scope.playbooks_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/playbooks", "scope.playbooks_read.ep.list"),
            ScopeEndpoint("GET", "/api/playbooks/{name}", "scope.playbooks_read.ep.detail"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/playbooks"
        ),
    ),
    ScopeManifestEntry(
        name="playbooks:write",
        description_key="scope.playbooks_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/playbooks/upload", "scope.playbooks_write.ep.upload"),
            ScopeEndpoint("DELETE", "/api/playbooks/{name}", "scope.playbooks_write.ep.delete"),
        ),
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-F "file=@playbook.zip" '
            "<HOST>/api/playbooks/upload"
        ),
    ),
    ScopeManifestEntry(
        name="packer:read",
        description_key="scope.packer_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/packer/templates", "scope.packer_read.ep.list"),
            ScopeEndpoint("GET", "/api/packer/templates/{name}", "scope.packer_read.ep.detail"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/packer/templates"
        ),
    ),
    ScopeManifestEntry(
        name="packer:write",
        description_key="scope.packer_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/packer/builds", "scope.packer_write.ep.start"),
            ScopeEndpoint("POST", "/api/packer/upload", "scope.packer_write.ep.upload"),
            ScopeEndpoint("DELETE", "/api/packer/templates/{name}", "scope.packer_write.ep.delete"),
        ),
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-H "Content-Type: application/json" '
            '-d \'{"template":"ubuntu-22.04","params":{}}\' '
            "<HOST>/api/packer/builds"
        ),
    ),
    ScopeManifestEntry(
        name="groups:read",
        description_key="scope.groups_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/groups", "scope.groups_read.ep.list"),
            ScopeEndpoint("GET", "/api/groups/{id}", "scope.groups_read.ep.detail"),
            ScopeEndpoint("GET", "/api/me/groups", "scope.groups_read.ep.me"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/groups"
        ),
    ),
    ScopeManifestEntry(
        name="groups:write",
        description_key="scope.groups_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/groups", "scope.groups_write.ep.create"),
            ScopeEndpoint("PUT", "/api/groups/{id}", "scope.groups_write.ep.update"),
            ScopeEndpoint("DELETE", "/api/groups/{id}", "scope.groups_write.ep.delete"),
        ),
        plus_only=True,
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-H "Content-Type: application/json" '
            '-d \'{"name":"my-group"}\' '
            "<HOST>/api/groups"
        ),
    ),
    ScopeManifestEntry(
        name="pools:read",
        description_key="scope.pools_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/pools", "scope.pools_read.ep.list"),
            ScopeEndpoint("GET", "/api/pools/{id}", "scope.pools_read.ep.detail"),
            ScopeEndpoint("GET", "/api/me/pools", "scope.pools_read.ep.me"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/pools"
        ),
    ),
    ScopeManifestEntry(
        name="pools:write",
        description_key="scope.pools_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/pools", "scope.pools_write.ep.create"),
            ScopeEndpoint("PUT", "/api/pools/{id}", "scope.pools_write.ep.update"),
            ScopeEndpoint("DELETE", "/api/pools/{id}", "scope.pools_write.ep.delete"),
        ),
        plus_only=True,
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-H "Content-Type: application/json" '
            '-d \'{"name":"my-pool"}\' '
            "<HOST>/api/pools"
        ),
    ),
    ScopeManifestEntry(
        name="pools:deploy",
        description_key="scope.pools_deploy.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/jobs", "scope.pools_deploy.ep.jobs"),
        ),
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-H "Content-Type: application/json" '
            '-d \'{"playbook":"vm-deploy","params":{"pool_id":1}}\' '
            "<HOST>/api/jobs"
        ),
    ),
    ScopeManifestEntry(
        name="owners:read",
        description_key="scope.owners_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/owners", "scope.owners_read.ep.list"),
            ScopeEndpoint("GET", "/api/owners/bulk", "scope.owners_read.ep.bulk"),
            ScopeEndpoint("GET", "/api/me/owners", "scope.owners_read.ep.me"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/me/owners"
        ),
    ),
    ScopeManifestEntry(
        name="approvals:read",
        description_key="scope.approvals_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/approvals", "scope.approvals_read.ep.list"),
            ScopeEndpoint("GET", "/api/approvals/{id}", "scope.approvals_read.ep.detail"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/approvals"
        ),
    ),
    ScopeManifestEntry(
        name="approvals:approve",
        description_key="scope.approvals_approve.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/approvals/{id}/approve", "scope.approvals_approve.ep.approve"),
            ScopeEndpoint("POST", "/api/approvals/{id}/reject", "scope.approvals_approve.ep.reject"),
        ),
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/approvals/APPROVAL_ID/approve"
        ),
    ),
    ScopeManifestEntry(
        name="config_snapshots:read",
        description_key="scope.config_snapshots_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/config-snapshots", "scope.config_snapshots_read.ep.list"),
            ScopeEndpoint("GET", "/api/config-snapshots/{id}", "scope.config_snapshots_read.ep.detail"),
            ScopeEndpoint("GET", "/api/config-snapshots/{id}/diff-live", "scope.config_snapshots_read.ep.diff_live"),
            ScopeEndpoint("GET", "/api/config-snapshots/by-node/{portal_node_id}", "scope.config_snapshots_read.ep.by_node"),
        ),
        plus_only=True,
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/config-snapshots"
        ),
    ),
    ScopeManifestEntry(
        name="config_snapshots:write",
        description_key="scope.config_snapshots_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/config-snapshots/{pni}/{pn}/{vmid}/create", "scope.config_snapshots_write.ep.create"),
            ScopeEndpoint("POST", "/api/config-snapshots/{id}/restore", "scope.config_snapshots_write.ep.restore"),
            ScopeEndpoint("DELETE", "/api/config-snapshots/{id}", "scope.config_snapshots_write.ep.delete"),
        ),
        plus_only=True,
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-H "Content-Type: application/json" '
            '-d \'{"note":"before maintenance"}\' '
            "<HOST>/api/config-snapshots/1/pve/100/create"
        ),
    ),
)

# Lookup-Dict für schnellen Zugriff per Name
SCOPE_MANIFEST_BY_NAME: dict[str, ScopeManifestEntry] = {
    e.name: e for e in SCOPE_MANIFEST
}

# Alias-Mapping: alte v1-Scope-Namen → kanonische :write-Bezeichner (PROJ-44)
SCOPE_ALIASES: dict[str, str] = {
    "jobs:start": "jobs:write",
    "packer:start": "packer:write",
}
