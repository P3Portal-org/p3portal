# Stack-Detail

Hier siehst du den Stack und rollst ihn aus. Der Zustands-**Badge** im Kopf zeigt: nicht ausgerollt / wird ausgerollt / ausgerollt / teilweise / out-of-sync / wird zerstört / zerstört.

## Tabs
- **YAML** – die aktuelle Definition.
- **Reale VMs** – die tatsächlich erstellten Gäste (Link zur Detailseite).
- **Deployments** – Verlauf der Ausroll-/Zerstör-Läufe mit Live-Log.
- **Versionen** – Definitions-Historie (Diff, Wiederherstellen).

## Ausrollen (zweistufiges Plan-Gate)
1. **Ausrollen** öffnet den **Plan**: erstellen / ändern / **zerstören** pro Ressource.
2. Erst nach Bestätigung wird **exakt dieser Plan** angewandt (als Job mit Live-Log).
- **Datenverlust** (Disk/Mountpoint entfernt/verkleinert) verlangt zusätzlich das Eintippen des Stack-Namens.
- Ändert sich die Definition zwischen Plan und Anwenden → **409**, neu planen.

## Drift
**Drift prüfen** vergleicht Definition gegen Realität (nur stack-eigene Gäste); nach jedem Ausrollen automatisch.

## Zerstören
Entfernt alle Ressourcen des Stacks (inkl. stack-eigener Netze). **Blockiert (409)**, wenn **fremde** Gäste an einem stack-eigenen Netz hängen – die werden aufgelistet.

## SDN-Besonderheiten
Ein SDN-Netz wirkt **cluster-weit**. Parallele SDN-Deploys werden **serialisiert** (sonst kurz „SDN läuft gerade"). Vor dem Apply wird gewarnt, falls der cluster-weite Apply **fremde ausstehende** SDN-Änderungen mit-committet (fortsetzbar).

> **Erfordert** Plus-Lizenz + ein `PortalTofu`-Token mit den nötigen Rechten am Node.

<!-- p3portal.org -->
