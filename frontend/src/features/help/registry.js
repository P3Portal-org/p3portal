// p3portal.org
// PROJ-57: Statische Help-Key-Registry.
// Jeder Eintrag: { key, titleDe, titleEn, category, order }
// Punkte im Key = Pfad-Trenner (system_settings.tabs.nodes → help/en/system_settings/tabs/nodes.md)

export const HELP_CATEGORIES = {
  dashboard:      { de: 'Dashboard',          en: 'Dashboard' },
  deployment:     { de: 'Deployment',          en: 'Deployment' },
  packer:         { de: 'Template-Builder',    en: 'Template Builder' },
  logs:           { de: 'Logs & Events',       en: 'Logs & Events' },
  settings:       { de: 'System Settings',     en: 'System Settings' },
  account:        { de: 'Mein Account',        en: 'My Account' },
  permissions:    { de: 'Berechtigungen',      en: 'Permissions' },
  pools_groups:   { de: 'Pools & Gruppen',     en: 'Pools & Groups' },
  compute:        { de: 'Compute Nodes',       en: 'Compute Nodes' },
  vm_detail:      { de: 'VM / LXC Detail',      en: 'VM / LXC Detail' },
  network:        { de: 'Netzwerk & Firewall', en: 'Networking & Firewall' },
  stacks:         { de: 'Stacks',              en: 'Stacks' },
  automation:     { de: 'Automation',          en: 'Automation' },
  modals:         { de: 'Formulare & Dialoge', en: 'Forms & Dialogs' },
  help_page:      { de: 'Handbuch',            en: 'Manual' },
}

/** @type {Array<{key: string, titleDe: string, titleEn: string, category: string, order: number}>} */
export const HELP_REGISTRY = [
  // ── Dashboard ──────────────────────────────────────────────────────────────
  { key: 'dashboard',                 titleDe: 'Dashboard',                   titleEn: 'Dashboard',                  category: 'dashboard',   order: 1 },

  // ── Deployment ─────────────────────────────────────────────────────────────
  { key: 'deploy',                         titleDe: 'VM/LXC Deployment',           titleEn: 'VM/LXC Deployment',          category: 'deployment',  order: 1 },
  { key: 'deploy.tabs.vm_deployment',      titleDe: 'VM Deployment Tab',           titleEn: 'VM Deployment Tab',          category: 'deployment',  order: 2 },
  { key: 'deploy.tabs.lxc_deployment',     titleDe: 'LXC Deployment Tab',          titleEn: 'LXC Deployment Tab',         category: 'deployment',  order: 3 },

  // ── Packer ─────────────────────────────────────────────────────────────────
  { key: 'packer',                    titleDe: 'Template-Builder',            titleEn: 'Template Builder',           category: 'packer',      order: 1 },

  // ── Logs & Events ──────────────────────────────────────────────────────────
  { key: 'logs',                      titleDe: 'Logs & Events',               titleEn: 'Logs & Events',              category: 'logs',        order: 1 },

  // ── System Settings ────────────────────────────────────────────────────────
  { key: 'system_settings',           titleDe: 'System Settings',             titleEn: 'System Settings',            category: 'settings',    order: 1 },
  { key: 'system_settings.tabs.nodes',titleDe: 'Nodes verwalten',             titleEn: 'Manage Nodes',               category: 'settings',    order: 2 },
  { key: 'system_settings.tabs.users',titleDe: 'Nutzer & Rechte',             titleEn: 'Users & Rights',             category: 'settings',    order: 3 },
  { key: 'system_settings.tabs.portal',titleDe: 'Portal-Einstellungen',       titleEn: 'Portal Settings',            category: 'settings',    order: 4 },
  { key: 'system_settings.tabs.content',titleDe: 'Inhalte verwalten',         titleEn: 'Content Management',         category: 'settings',    order: 5 },

  // ── My Account ─────────────────────────────────────────────────────────────
  { key: 'account',                   titleDe: 'Mein Account',                titleEn: 'My Account',                 category: 'account',     order: 1 },

  // ── Permissions ────────────────────────────────────────────────────────────
  { key: 'permissions',               titleDe: 'Meine Berechtigungen',        titleEn: 'My Permissions',             category: 'permissions', order: 1 },

  // ── Pools & Gruppen ────────────────────────────────────────────────────────
  { key: 'pools',                     titleDe: 'Pools (Ressourcen-Quotas)',    titleEn: 'Pools (Resource Quotas)',    category: 'pools_groups',order: 1 },
  { key: 'groups',                    titleDe: 'Gruppen / Teams',             titleEn: 'Groups / Teams',             category: 'pools_groups',order: 2 },

  // ── Image Factory ──────────────────────────────────────────────────────────
  { key: 'image_factory',                  titleDe: 'Image Factory',               titleEn: 'Image Factory',              category: 'settings',    order: 6 },
  { key: 'image_factory.tabs.vm_images',   titleDe: 'VM Images (Packer Builds)',   titleEn: 'VM Images (Packer Builds)',  category: 'settings',    order: 7 },
  { key: 'image_factory.tabs.vm_templates',titleDe: 'VM Templates',                titleEn: 'VM Templates',               category: 'settings',    order: 8 },
  { key: 'image_factory.tabs.lxc_templates',titleDe: 'LXC Templates',              titleEn: 'LXC Templates',              category: 'settings',    order: 9 },
  { key: 'image_factory.tabs.isos',        titleDe: 'ISOs',                        titleEn: 'ISOs',                       category: 'settings',    order: 10 },
  { key: 'image_factory.tabs.build_editor',titleDe: 'Build Editor (Plus)',         titleEn: 'Build Editor (Plus)',        category: 'settings',    order: 11 },

  // ── Compute Nodes ──────────────────────────────────────────────────────────
  { key: 'compute',                   titleDe: 'Compute Nodes',               titleEn: 'Compute Nodes',              category: 'compute',     order: 1 },
  { key: 'compute.tabs.alerting',     titleDe: 'Node Alerting',               titleEn: 'Node Alerting',              category: 'compute',     order: 2 },
  { key: 'compute.tabs.scheduled_jobs',titleDe: 'Zeitgesteuerte Jobs (Node)', titleEn: 'Scheduled Jobs (Node)',      category: 'compute',     order: 3 },

  // ── VM / LXC Detail ────────────────────────────────────────────────────────
  { key: 'vm_detail.disks',           titleDe: 'Festplatten im Gast nutzbar machen', titleEn: 'Making disks usable in the guest', category: 'vm_detail', order: 1 },

  // ── Netzwerk & Firewall ────────────────────────────────────────────────────
  { key: 'network',                   titleDe: 'Netzwerk (Node-Bridges & SDN)', titleEn: 'Networking (Node Bridges & SDN)', category: 'network', order: 1 },
  { key: 'firewall',                  titleDe: 'Firewall',                    titleEn: 'Firewall',                   category: 'network',     order: 2 },

  // ── Stacks (Plus) ──────────────────────────────────────────────────────────
  { key: 'stacks',                    titleDe: 'Stacks – Übersicht',          titleEn: 'Stacks – Overview',          category: 'stacks',      order: 1 },
  { key: 'stacks.editor',             titleDe: 'Stack-Editor (YAML / Formular / Cloud-Init / Netze)', titleEn: 'Stack Editor (YAML / Form / Cloud-Init / Networks)', category: 'stacks', order: 2 },
  { key: 'stacks.detail',             titleDe: 'Stack-Detail (Ausrollen / Drift / Zerstören)', titleEn: 'Stack Detail (Deploy / Drift / Destroy)', category: 'stacks', order: 3 },

  // ── Automation ─────────────────────────────────────────────────────────────
  { key: 'automation',                     titleDe: 'Automation / Scheduled Jobs', titleEn: 'Automation / Scheduled Jobs',category: 'automation',  order: 1 },
  { key: 'automation.tabs.playbooks',      titleDe: 'Playbooks',                   titleEn: 'Playbooks',                  category: 'automation',  order: 2 },
  { key: 'automation.tabs.scheduled',      titleDe: 'Zeitgesteuerte Jobs',         titleEn: 'Scheduled Jobs',             category: 'automation',  order: 3 },
  { key: 'automation.tabs.inventory',      titleDe: 'Ansible-Inventar',            titleEn: 'Ansible Inventory',          category: 'automation',  order: 4 },
  { key: 'automation.tabs.playbook_editor', titleDe: 'Playbook-Editor',             titleEn: 'Playbook Editor',            category: 'automation',  order: 5 },

  // ── Modals ─────────────────────────────────────────────────────────────────
  { key: 'modal.deploy_form',         titleDe: 'Deploy-Formular',             titleEn: 'Deploy Form',                category: 'modals',      order: 1 },
  { key: 'modal.packer_build_form',   titleDe: 'Packer Build-Formular',       titleEn: 'Packer Build Form',          category: 'modals',      order: 2 },
  { key: 'modal.user_form',           titleDe: 'Nutzer anlegen / bearbeiten', titleEn: 'Create / Edit User',         category: 'modals',      order: 3 },
  { key: 'modal.node_form',           titleDe: 'Node anlegen / bearbeiten',   titleEn: 'Create / Edit Node',         category: 'modals',      order: 4 },
  { key: 'modal.alert_preset_form',   titleDe: 'Alert-Preset-Formular',       titleEn: 'Alert Preset Form',          category: 'modals',      order: 5 },
  { key: 'modal.scheduled_job',       titleDe: 'Zeitgesteuerter Job',         titleEn: 'Scheduled Job',              category: 'modals',      order: 6 },
  { key: 'modal.iso_download',        titleDe: 'ISO herunterladen / verwalten',titleEn: 'ISO Download / Management', category: 'modals',      order: 7 },
  { key: 'modal.group_form',          titleDe: 'Gruppe anlegen / bearbeiten', titleEn: 'Create / Edit Group',        category: 'modals',      order: 8 },
  { key: 'modal.pool_form',           titleDe: 'Pool anlegen / bearbeiten',   titleEn: 'Create / Edit Pool',         category: 'modals',      order: 9 },
  { key: 'modal.node_access',         titleDe: 'Node-Zugriffsrechte',         titleEn: 'Node Access Rights',         category: 'modals',      order: 10 },
  { key: 'modal.api_key_create',      titleDe: 'API-Key erstellen',           titleEn: 'Create API Key',             category: 'modals',      order: 11 },
  { key: 'modal.setup_wizard',        titleDe: 'Setup-Assistent',             titleEn: 'Setup Wizard',               category: 'modals',      order: 12 },
  { key: 'modal.approval_detail',     titleDe: 'Freigabe-Details',            titleEn: 'Approval Details',           category: 'modals',      order: 13 },

  // ── Handbuch (diese Seite) ─────────────────────────────────────────────────
  { key: 'help',                      titleDe: 'P3 Handbuch',                 titleEn: 'P3 Manual',                  category: 'help_page',   order: 1 },
]

/** Schnell-Lookup Key → Registry-Eintrag */
export const REGISTRY_MAP = Object.fromEntries(HELP_REGISTRY.map(e => [e.key, e]))

/** Gibt true zurück wenn Key in Registry existiert */
export function isValidHelpKey(key) {
  return Object.prototype.hasOwnProperty.call(REGISTRY_MAP, key)
}

/** Gibt alle Keys gruppiert nach Kategorie zurück */
export function getRegistryByCategory() {
  const result = {}
  for (const [catId] of Object.entries(HELP_CATEGORIES)) {
    result[catId] = HELP_REGISTRY.filter(e => e.category === catId)
      .sort((a, b) => a.order - b.order)
  }
  return result
}
