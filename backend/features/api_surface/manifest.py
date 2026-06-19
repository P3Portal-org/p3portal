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
    # PROJ-77: Auto-Snapshots (Schreib-Scope folgt sobald write-EPs nötig werden)
    ScopeManifestEntry(
        name="auto_snapshots:read",
        description_key="scope.auto_snapshots_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/auto-snapshots/runs/{run_id}/details", "scope.auto_snapshots_read.ep.run_details"),
            ScopeEndpoint("GET", "/api/auto-snapshots/native-snapshots", "scope.auto_snapshots_read.ep.native"),
        ),
        plus_only=True,
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/auto-snapshots/native-snapshots?portal_node_id=1&proxmox_node=pve&vmid=100&kind=qemu"
        ),
    ),
    # PROJ-76: Stacks (deklaratives Infrastructure-Modell)
    ScopeManifestEntry(
        name="stacks:read",
        description_key="scope.stacks_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/stacks", "scope.stacks_read.ep.list"),
            ScopeEndpoint("GET", "/api/stacks/{id}", "scope.stacks_read.ep.detail"),
            ScopeEndpoint("GET", "/api/stacks/{id}/versions", "scope.stacks_read.ep.versions"),
            ScopeEndpoint("GET", "/api/stacks/{id}/diff", "scope.stacks_read.ep.diff"),
        ),
        plus_only=True,
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/stacks"
        ),
    ),
    ScopeManifestEntry(
        name="stacks:write",
        description_key="scope.stacks_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/stacks", "scope.stacks_write.ep.create"),
            ScopeEndpoint("PUT", "/api/stacks/{id}", "scope.stacks_write.ep.update"),
            ScopeEndpoint("POST", "/api/stacks/{id}/restore-version", "scope.stacks_write.ep.restore"),
        ),
        plus_only=True,
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-H "Content-Type: application/json" '
            '-d \'{"yaml_text":"name: web\\nresources: []"}\' '
            "<HOST>/api/stacks"
        ),
    ),
    ScopeManifestEntry(
        name="stacks:delete",
        description_key="scope.stacks_delete.desc",
        endpoints=(
            ScopeEndpoint("DELETE", "/api/stacks/{id}", "scope.stacks_delete.ep.delete"),
        ),
        plus_only=True,
        curl_example=(
            'curl -X DELETE -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/stacks/1"
        ),
    ),
    # ── PROJ-97: Scope-Nachzug für neuere Features ────────────────────────────
    # PROJ-78: Backup-Job-Verwaltung (Core)
    ScopeManifestEntry(
        name="backup_jobs:read",
        description_key="scope.backup_jobs_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/backup-jobs", "scope.backup_jobs_read.ep.list"),
            ScopeEndpoint("GET", "/api/backup-jobs/pools", "scope.backup_jobs_read.ep.pools"),
            ScopeEndpoint("GET", "/api/backup-jobs/storages", "scope.backup_jobs_read.ep.storages"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/backup-jobs?node=pve"
        ),
    ),
    ScopeManifestEntry(
        name="backup_jobs:write",
        description_key="scope.backup_jobs_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/backup-jobs", "scope.backup_jobs_write.ep.create"),
            ScopeEndpoint("PUT", "/api/backup-jobs/{job_id}", "scope.backup_jobs_write.ep.update"),
            ScopeEndpoint("DELETE", "/api/backup-jobs/{job_id}", "scope.backup_jobs_write.ep.delete"),
            ScopeEndpoint("POST", "/api/backup-jobs/{job_id}/run", "scope.backup_jobs_write.ep.run"),
        ),
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-H "Content-Type: application/json" '
            '-d \'{"storage":"local","schedule":"02:00","mode":"snapshot","all":1}\' '
            "<HOST>/api/backup-jobs?node=pve"
        ),
    ),
    # PROJ-79: Netzwerk-Verwaltung (Core)
    ScopeManifestEntry(
        name="networks:read",
        description_key="scope.networks_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/networks", "scope.networks_read.ep.list"),
            ScopeEndpoint("GET", "/api/networks/devices", "scope.networks_read.ep.devices"),
            ScopeEndpoint("GET", "/api/networks/{iface}/usage", "scope.networks_read.ep.usage"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/networks?node=pve"
        ),
    ),
    ScopeManifestEntry(
        name="networks:write",
        description_key="scope.networks_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/networks", "scope.networks_write.ep.create"),
            ScopeEndpoint("PUT", "/api/networks/{iface}", "scope.networks_write.ep.update"),
            ScopeEndpoint("DELETE", "/api/networks/{iface}", "scope.networks_write.ep.delete"),
            ScopeEndpoint("POST", "/api/networks/reload", "scope.networks_write.ep.reload"),
            ScopeEndpoint("POST", "/api/networks/revert", "scope.networks_write.ep.revert"),
        ),
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-H "Content-Type: application/json" '
            '-d \'{"type":"bridge","iface":"vmbr1","autostart":true}\' '
            "<HOST>/api/networks?node=pve"
        ),
    ),
    # PROJ-80: SDN-Verwaltung (Core, cluster-weit)
    ScopeManifestEntry(
        name="sdn:read",
        description_key="scope.sdn_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/sdn/zones", "scope.sdn_read.ep.zones"),
            ScopeEndpoint("GET", "/api/sdn/vnets", "scope.sdn_read.ep.vnets"),
            ScopeEndpoint("GET", "/api/sdn/subnets", "scope.sdn_read.ep.subnets"),
            ScopeEndpoint("GET", "/api/sdn", "scope.sdn_read.ep.pending"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/sdn/zones"
        ),
    ),
    ScopeManifestEntry(
        name="sdn:write",
        description_key="scope.sdn_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/sdn/zones", "scope.sdn_write.ep.zone_create"),
            ScopeEndpoint("POST", "/api/sdn/vnets", "scope.sdn_write.ep.vnet_create"),
            ScopeEndpoint("POST", "/api/sdn/subnets", "scope.sdn_write.ep.subnet_create"),
            ScopeEndpoint("POST", "/api/sdn/apply", "scope.sdn_write.ep.apply"),
            ScopeEndpoint("POST", "/api/sdn/revert", "scope.sdn_write.ep.revert"),
        ),
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/sdn/apply"
        ),
    ),
    # PROJ-90: Firewall-Verwaltung (Core, alle 3 Ebenen datacenter/nodes/vms)
    ScopeManifestEntry(
        name="firewall:read",
        description_key="scope.firewall_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/firewall/datacenter/rules", "scope.firewall_read.ep.dc_rules"),
            ScopeEndpoint("GET", "/api/firewall/nodes/{node}/rules", "scope.firewall_read.ep.node_rules"),
            ScopeEndpoint("GET", "/api/firewall/vms/{vmid}/rules", "scope.firewall_read.ep.vm_rules"),
            ScopeEndpoint("GET", "/api/firewall/datacenter/macros", "scope.firewall_read.ep.macros"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/firewall/datacenter/rules?installation=1"
        ),
    ),
    ScopeManifestEntry(
        name="firewall:write",
        description_key="scope.firewall_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/firewall/datacenter/rules", "scope.firewall_write.ep.dc_rule_create"),
            ScopeEndpoint("PUT", "/api/firewall/datacenter/options", "scope.firewall_write.ep.dc_options"),
            ScopeEndpoint("POST", "/api/firewall/vms/{vmid}/rules", "scope.firewall_write.ep.vm_rule_create"),
            ScopeEndpoint("DELETE", "/api/firewall/datacenter/rules/{pos}", "scope.firewall_write.ep.dc_rule_delete"),
        ),
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-H "Content-Type: application/json" '
            '-d \'{"type":"in","action":"ACCEPT","proto":"tcp","dport":"22"}\' '
            "<HOST>/api/firewall/vms/100/rules?node=pve"
        ),
    ),
    # PROJ-10/63/81: VM-Mutationen (Core). VM-Reads bleiben unter cluster:read.
    ScopeManifestEntry(
        name="vms:write",
        description_key="scope.vms_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/vms/{vmid}/start", "scope.vms_write.ep.start"),
            ScopeEndpoint("POST", "/api/vms/{vmid}/stop", "scope.vms_write.ep.stop"),
            ScopeEndpoint("POST", "/api/vms/{vmid}/reboot", "scope.vms_write.ep.reboot"),
            ScopeEndpoint("PATCH", "/api/vms/{vmid}/config", "scope.vms_write.ep.config"),
            ScopeEndpoint("POST", "/api/vms/{vmid}/snapshots", "scope.vms_write.ep.snapshot"),
            ScopeEndpoint("POST", "/api/vms/{vmid}/disks", "scope.vms_write.ep.disk"),
            ScopeEndpoint("DELETE", "/api/vms/{vmid}", "scope.vms_write.ep.delete"),
        ),
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/vms/100/start?node=pve"
        ),
    ),
    # PROJ-83/84: Ansible-Inventory & Onboarding (Core; Plus-EPs zusätzlich 404 ohne Lizenz)
    ScopeManifestEntry(
        name="ansible_inventory:read",
        description_key="scope.ansible_inventory_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/ansible-inventory/hosts", "scope.ansible_inventory_read.ep.hosts"),
            ScopeEndpoint("GET", "/api/ansible-inventory/onboarding-block", "scope.ansible_inventory_read.ep.onboarding"),
            ScopeEndpoint("GET", "/api/ansible-inventory/discovery", "scope.ansible_inventory_read.ep.discovery"),
        ),
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/ansible-inventory/hosts"
        ),
    ),
    ScopeManifestEntry(
        name="ansible_inventory:write",
        description_key="scope.ansible_inventory_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/ansible-inventory/hosts/{node_id}/{kind}/{vmid}/mark-managed", "scope.ansible_inventory_write.ep.mark"),
            ScopeEndpoint("POST", "/api/ansible-inventory/hosts/{node_id}/{kind}/{vmid}/test-connection", "scope.ansible_inventory_write.ep.test"),
            ScopeEndpoint("POST", "/api/ansible-inventory/onboard", "scope.ansible_inventory_write.ep.onboard"),
            ScopeEndpoint("POST", "/api/ansible-inventory/keys/global/rotate", "scope.ansible_inventory_write.ep.rotate"),
        ),
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/ansible-inventory/hosts/1/qemu/100/mark-managed"
        ),
    ),
    # PROJ-92: Packer Visual Editor (Plus)
    ScopeManifestEntry(
        name="packer_editor:read",
        description_key="scope.packer_editor_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/packer-editor/definitions", "scope.packer_editor_read.ep.list"),
            ScopeEndpoint("GET", "/api/packer-editor/definitions/{definition_id}", "scope.packer_editor_read.ep.detail"),
        ),
        plus_only=True,
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/packer-editor/definitions"
        ),
    ),
    ScopeManifestEntry(
        name="packer_editor:write",
        description_key="scope.packer_editor_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/packer-editor/definitions", "scope.packer_editor_write.ep.create"),
            ScopeEndpoint("PUT", "/api/packer-editor/definitions/{definition_id}", "scope.packer_editor_write.ep.update"),
            ScopeEndpoint("DELETE", "/api/packer-editor/definitions/{definition_id}", "scope.packer_editor_write.ep.delete"),
            ScopeEndpoint("POST", "/api/packer-editor/validate", "scope.packer_editor_write.ep.validate"),
        ),
        plus_only=True,
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-H "Content-Type: application/json" '
            '-d \'{"meta":{"id":"deb13"}}\' '
            "<HOST>/api/packer-editor/definitions"
        ),
    ),
    # PROJ-93: Ansible Visual Editor (Plus)
    ScopeManifestEntry(
        name="ansible_editor:read",
        description_key="scope.ansible_editor_read.desc",
        endpoints=(
            ScopeEndpoint("GET", "/api/ansible-editor/definitions", "scope.ansible_editor_read.ep.list"),
            ScopeEndpoint("GET", "/api/ansible-editor/definitions/{definition_id}", "scope.ansible_editor_read.ep.detail"),
            ScopeEndpoint("GET", "/api/ansible-editor/modules", "scope.ansible_editor_read.ep.modules"),
            ScopeEndpoint("GET", "/api/ansible-editor/modules/{name}/schema", "scope.ansible_editor_read.ep.schema"),
        ),
        plus_only=True,
        curl_example=(
            'curl -H "Authorization: Bearer <KEY>" '
            "<HOST>/api/ansible-editor/definitions"
        ),
    ),
    ScopeManifestEntry(
        name="ansible_editor:write",
        description_key="scope.ansible_editor_write.desc",
        endpoints=(
            ScopeEndpoint("POST", "/api/ansible-editor/definitions", "scope.ansible_editor_write.ep.create"),
            ScopeEndpoint("PUT", "/api/ansible-editor/definitions/{definition_id}", "scope.ansible_editor_write.ep.update"),
            ScopeEndpoint("DELETE", "/api/ansible-editor/definitions/{definition_id}", "scope.ansible_editor_write.ep.delete"),
            ScopeEndpoint("POST", "/api/ansible-editor/validate", "scope.ansible_editor_write.ep.validate"),
        ),
        plus_only=True,
        curl_example=(
            'curl -X POST -H "Authorization: Bearer <KEY>" '
            '-H "Content-Type: application/json" '
            '-d \'{"meta":{"id":"setup"}}\' '
            "<HOST>/api/ansible-editor/definitions"
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
