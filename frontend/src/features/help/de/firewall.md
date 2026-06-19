# Firewall

Verwaltung der **Proxmox-Firewall** auf drei Ebenen. Die Firewall *filtert* Verkehr – sie routet/NAT-et nicht (Internet-Egress kommt aus dem SDN-Subnet bzw. einer Router-VM).

## Ebenen
- **Datacenter** (über die Reiter oben) – cluster-weite Regeln, **Security-Groups**, **IP-Sets** und **Aliases**. Bei mehreren Installationen oben auswählen.
- **Node** – Regeln + Optionen eines einzelnen Hosts (Node oben auswählen).
- **VM / LXC** – die Firewall eines Gastes liegt auf dessen Detailseite (Tab „Firewall").

## Bedienen
- **Live-Apply:** Änderungen wirken sofort (kein Pending/Reload wie bei den Node-Interfaces).
- **Regel-Reihenfolge zählt** (von oben nach unten ausgewertet) → Regeln per Hoch/Runter umsortieren.
- **Regel-Editor:** Richtung (in/out), Aktion (ACCEPT/DROP/REJECT oder Security-Group), Protokoll/Port **oder** Makro, Quelle/Ziel (IP/CIDR oder Alias/IPSet einsetzen), ICMP-Typ.
- **Löschen** von Security-Group/IPSet/Alias prüft cluster-weit, ob sie noch referenziert werden.

## Damit eine Regel greift
Eine Regel wirkt nur, wenn **alle** zutreffen:
1. globale Datacenter-Firewall aktiv,
2. die Firewall-Optionen der jeweiligen Ebene aktiv,
3. **und** `firewall=1` an der jeweiligen VM-Netzwerkkarte (`netX`).

Die globale Datacenter-**Aktivierung** ist hier bewusst nur lesbar (Footgun-Schutz „Cluster aussperren").

## Rechte
- Datacenter/Node: Admin oder `manage_firewall` (Node zusätzlich Node-Scope `node:manage_firewall`).
- VM/LXC: Owner oder Operator-Recht auf dem Gast.
- Schreibzugriff braucht `Sys.Modify` (DC/Node) bzw. `VM.Config.Network` (Gast) im Token.

<!-- p3portal.org -->
