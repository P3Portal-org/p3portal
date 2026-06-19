# Node anlegen / bearbeiten

Registriere oder aktualisiere einen Proxmox-Node oder Cluster.

## URL
Vollständige URL mit Port, z.B. `https://pve.example.com:8006`.

## Cluster-Modus
Aktivieren, wenn die URL eine Proxmox-Cluster-VIP ist. Alle Nodes des Clusters werden automatisch importiert.

## API-Tokens
Das Portal benötigt mindestens einen **Viewer-Token** (`PVEAuditor`-Rolle). Operator- und Admin-Token aktivieren weitere Aktionen.

Der **Admin-Token** deckt auch die Node-Netzwerkverwaltung (Bridges & VLANs) und das cluster-weite **SDN** ab. Die SDN-Verwaltung (Zonen / VNets / Subnets) benötigt das Privileg `SDN.Allocate` auf dem Admin-Token — `SDN.Use` allein genügt nicht. Die vollständige `pveum`-Rolle steht in der Proxmox-Setup-Doku.

<!-- p3portal.org -->