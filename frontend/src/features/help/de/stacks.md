# Stacks – Übersicht

Ein **Stack** beschreibt eine Gruppe zusammengehöriger Infrastruktur (VMs, LXC-Container und optional eigene Netze) **deklarativ** – du sagst, *was* existieren soll, nicht *wie* es erstellt wird. P3 setzt den Stack über die **OpenTofu**-Engine real um.

## Was ein Stack umfasst
- **VMs** (geklont aus einem Template) und **LXC-Container** (aus einem ostemplate-Tarball)
- optional **mehrere Festplatten** pro VM
- optional **Login/IP** (Cloud-Init: Benutzer, Passwort, SSH-Keys, statische IP)
- optional **stack-eigene Netze** (Node-Bridge oder SDN-VNet mit Subnet/SNAT)

## Lebenszyklus
1. **Entwurf** – Stack anlegen/bearbeiten (YAML oder Formular), validieren.
2. **Ausrollen** – auf der Detailseite den **Plan** prüfen und anwenden → die Ressourcen entstehen real.
3. **Drift / Bearbeiten** – Abweichungen erkennen, Definition ändern, erneut ausrollen.
4. **Zerstören** – der ganze Stack (inkl. stack-eigener Netze) wird wieder entfernt.

## Wichtige Regeln
- **Stack-verwaltete VMs/LXC sind gesperrt** für manuelle Änderungen (CPU/RAM/Disk) im Dashboard – Änderungen laufen über die Stack-Definition (Single Source of Truth).
- Der **State** jedes Stacks ist die Wahrheit über die von ihm verwaltete reale Infrastruktur – fremde VMs werden nie angefasst.
- Ein Stack gehört zu **einer** Proxmox-Installation.

## Bedienung der Liste
- **Suchen** nach Name, **+ Stack erstellen** öffnet den Editor.
- Pro Zeile: Version, Status, Deployment-Zustand, Owner, **Bearbeiten** / **Löschen**.

> **Erfordert** Plus-Lizenz.

<!-- p3portal.org -->
