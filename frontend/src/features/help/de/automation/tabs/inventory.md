# Ansible-Inventar

Hier siehst du die Gäste (VMs/LXC), die P3 per Ansible konfigurieren kann. Das Inventar wird **live aus Proxmox** erzeugt – es gibt keine gepflegte Inventar-Datei, und außerhalb von P3 gelöschte VMs verschwinden automatisch.

## Scopes
- **Eigene** – deine eigenen Gäste (du bist Owner). Verfügbar in jeder Edition.
- **Pool** – die Gäste eines Pools (Plus).
- **Global** – nur Gäste, die ausdrücklich mit dem Global-Schlüssel eingebunden wurden (Plus).

## Gruppen
- **verwaltet** – Service-User `p3-ansible` + Schlüssel sind eingerichtet **und** eine IP ist bekannt → kann angesteuert werden.
- **nicht verwaltet** – kein Verwaltungs-Schlüssel eingebunden (Opt-out beim Deploy oder extern erstellt).
- **keine IP** – verwaltet, aber es ist keine IP ermittelbar (z.B. QEMU-Guest-Agent läuft nicht).

## Gast-Onboarding
Damit ein Gast verwaltet werden kann, richtet P3 einen Service-User **`p3-ansible`** (mit NOPASSWD-sudo) ein und hinterlegt die zutreffenden Public Keys.

- **Beim Deploy** geschieht das automatisch über cloud-init (vendor-data) – der vom Ersteller gewählte Benutzer bleibt unverändert.
- **Bestehende Gäste** bindest du manuell ein: Klick auf **Onboarding-Block anzeigen** und füge den Block als root im Gast ein. Er ist idempotent und benötigt **kein** erhöhtes Proxmox-Token-Privileg.

## Host-Key zurücksetzen
P3 merkt sich beim ersten Kontakt den SSH-Host-Key (TOFU). Wurde ein Gast neu aufgesetzt (gleiche IP, neuer Host-Key), bricht der nächste Run aus Sicherheitsgründen ab. Mit **Host-Key zurücksetzen** wird der gemerkte Eintrag gelöscht und beim nächsten Run der neue Key akzeptiert.

## Ausführung
Gast-Playbooks (die nicht auf `localhost` laufen) zeigen im Playbook-Formular eine **Scope- und Host-Auswahl**. Du kannst den ganzen Scope oder einzelne verwaltete Hosts als Ziel wählen. Der Run läuft über das normale Job-System mit Live-Log.

## Bestehende Gäste aufnehmen

VMs/LXC werden **beim Deploy** automatisch verwaltbar. Vor P3 erstellte oder extern erstellte Gäste musst du nachträglich aufnehmen – auf zwei Wegen:

### Eigene/adoptierte Hosts: „Als verwaltet markieren"
Ein dir gehörender Gast, der als **nicht verwaltet** gelistet ist, bekommt in der **Eigene**-Sicht die Aktion **Als verwaltet markieren**. Führe **zuerst** den Onboarding-Block im Gast aus (Service-User `p3-ansible` + dein Schlüssel), dann markieren – andernfalls schlägt der spätere Run fehl. Der Host wird im **eigenen Scope** ausführbar.

### Installations-weit (Plus, `manage_ansible_inventory`)
Mit der Berechtigung „Ansible-Inventar verwalten" erscheint der Scope **Installation**. Er listet **alle** Gäste einer Installation – unabhängig von Ownership – mit Managed-Status. Hier kannst du Gäste **einzeln oder als Stapel** onboarden:

- Onboarding bindet den **Global-Schlüssel** ein und macht den Gast **ohne Owner** im **Global-Scope** ausführbar (optional zusätzlich den Pool-Schlüssel).
- Der zurückgegebene **Onboarding-Block** ist für bestehende Gäste manuell einzufügen (cloud-init greift nur beim ersten Boot).
- Idempotent: bereits global onboardete Gäste werden übersprungen.

### Verbindung testen (optional)
**Verbindung testen** prüft per SSH als `p3-ansible`, ob der Onboarding-Block im Gast tatsächlich gewirkt hat. Der Test ist **rein informativ** – er ändert nichts und blockt das Markieren/Onboarden nicht. Für Gäste ohne ermittelbare IP ist er nicht verfügbar.

### „kein Run-Scope"
Ein als **verwaltet** markierter Gast, der in **keinem** ausführbaren Scope liegt (kein Owner, kein Pool, nicht global), wird in der Discovery-Sicht klar gekennzeichnet. Onboarden bindet den Global-Schlüssel ein und behebt das.
