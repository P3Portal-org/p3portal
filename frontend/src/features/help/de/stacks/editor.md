# Stack-Editor

Hier definierst du den Stack. Zwei Ansichten, **bidirektional synchron**:

- **Formular** (Standard) – geführte Karten für VMs, LXC-Container und Netze.
- **YAML** – die rohe Definition (Single Source of Truth). Bei ungültigem YAML erscheint ein Inline-Hinweis; der letzte gültige Stand bleibt erhalten.

## Ressourcen
- **VM** – Template, Node, CPU/RAM, Root-Disk, optional **zusätzliche Festplatten** (Größe + Datastore + Bus) und **VMID**.
- **LXC** – ostemplate (aus der Image Factory), rootfs, **Mountpoints**, **Features** (nesting/keyctl/fuse), **unprivilegiert** (sicherer Standard).
- **Anzahl (Instanzen)** > 1 erzeugt mehrere benannte Gäste.

## Cloud-Init (Login & IP)
Eigener Tab. Login (Benutzer/Passwort/SSH-Keys) und IP-Modus (DHCP/statisch) werden **verschlüsselt** und getrennt vom YAML gespeichert – **kein Klartext-Secret im Versionsverlauf**. Stack-Default + Per-VM-Override.

## Netzwerke
- **Node-Bridge** – node-lokal, risikoarm.
- **SDN-VNet** – stack-eigenes Overlay mit Subnet/Gateway, optional **SNAT** (Internet-Egress). **Cluster-weite Wirkung** – im Editor entsprechend gekennzeichnet.
- Gäste hängen über den Netz-**Namen** am erstellten Netz; stack-eigene Netze werden beim Zerstören mitgelöscht.

## Validieren & Versionen
- **Validieren** prüft Struktur + Semantik (Node/Template/Pool); Warnungen blockieren das Speichern nicht.
- Jede Speicherung erzeugt eine **Version** (Verlauf, Diff, Wiederherstellen). Gleichzeitige Bearbeitung wird per **ETag** erkannt (Konflikt-Dialog).

> **Ausrollen** geschieht erst auf der Detailseite. **Erfordert** Plus-Lizenz.

<!-- p3portal.org -->
