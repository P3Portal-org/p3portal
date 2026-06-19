# Netzwerk

Verwaltung der **geteilten** Proxmox-Netzwerk-Infrastruktur. Zwei Bereiche über die Reiter oben:

## Node-Interfaces (pro Node)
Linux-**Bridges** und **VLAN-Interfaces** eines einzelnen Proxmox-Nodes (`/nodes/<node>/network`). Node oben auswählen.

- **Anlegen / Bearbeiten / Löschen** von Bridges (`vmbrN`) und VLAN-Interfaces.
- **Apply-Modell:** Änderungen sind zunächst *ausstehend* (Banner „N ausstehende Änderungen"). Erst **Reload** aktiviert sie auf dem Node, **Verwerfen** macht sie rückgängig.
- ⚠️ Ein Reload kann die **Node-Konnektivität** kurz beeinträchtigen (z. B. wenn die Management-Bridge betroffen ist) – der Dialog warnt entsprechend.
- **Löschen** prüft, ob VMs/LXC die Bridge noch nutzen (`netX: bridge=…`), und warnt bei Verwendung.

## SDN (Cluster)
Cluster-weites **Software-Defined Networking** (`/cluster/sdn`): **Zonen**, **VNets** und **Subnets**.

- ⚠️ **Cluster-weite Wirkung:** „Übernehmen" (`PUT /cluster/sdn`) aktiviert **alle** ausstehenden SDN-Objekte auf **allen** Nodes gleichzeitig.
- Ausstehende Objekte tragen ein Status-Badge (neu / geändert / gelöscht), bis sie übernommen werden.
- **Löschen** prüft die Nutzung cluster-weit (VNet ← VM-Referenzen, Zone ← VNets).

## Rechte
- Node-Interfaces: Admin, `manage_networks` oder Node-Scope `node:manage_network`.
- SDN: Admin oder `manage_sdn` (cluster-weit, kein Node-Scope).
- Schreibzugriff braucht ein Admin-Token mit `Sys.Modify` (Bridges) bzw. `SDN.Allocate` (SDN).

> **Hinweis:** Stack-eigene Netze (deklarativ über Stacks) sind ein eigener Mechanismus – diese Seite verwaltet **geteilte**, manuell gepflegte Infrastruktur.

<!-- p3portal.org -->
