# Node-Zugriffsrechte (Plus)

Node-Zugriffsregeln geben Nutzern oder Gruppen das Recht, bestimmte Aktionen auf einem Proxmox-Node durchzuführen.

## Aktionen
- `node:view_tasks` – Task-Log des Nodes sehen
- `node:view_backups` – Backup-Ergebnisse sehen
- `node:upload_iso` – ISO-Images auf den Node hochladen
- `node:view_updates` – APT-Update-Liste des Nodes einsehen
- `node:refresh_updates` – Neuen APT-Update-Check auslösen

## Anwendungsfall
Einem Entwickler erlauben, ISOs auf einen Dev-Node hochzuladen, ohne ihn zum Portal-Operator zu machen.

> **Erfordert** Plus-Lizenz.

<!-- p3portal.org -->