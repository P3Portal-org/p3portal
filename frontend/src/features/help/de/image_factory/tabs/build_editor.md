# Image Factory – Build Editor (Plus)

Erstelle eine **Packer-Build-Definition** über ein Formular – ganz ohne Packer-HCL von Hand zu schreiben. Der Editor ist Plus-only und nur für Administratoren sichtbar.

## Was der Editor erzeugt
Eine **Build-Definition**, kein fertiges Template. Gespeichert wird sie als echtes Verzeichnis im Packer-Mount (`packer/<id>/` mit `<id>.pkr.hcl` + `meta.yaml` + ggf. `http/` und `files/`). Sie erscheint danach im Tab **VM Images** und wird dort wie jede andere Definition **gebaut**.

## Die zwei Bauweisen (Quelle / Source)
- **Von ISO (`proxmox-iso`)** – baut ein Template **von Grund auf neu**: Packer bootet ein ISO-Image und installiert das Betriebssystem unbeaufsichtigt (über die preseed-/kickstart-Datei aus dem Installer-Builder). Wähle dies für ein frisches OS-Image.
- **Aus Template (`proxmox-clone`)** – **klont ein vorhandenes Proxmox-Template** und passt es nur an (kein OS-Setup, deutlich schneller). Das Feld **Quell-Template** ist der Name (oder die VM-ID) der vorhandenen Vorlage.

## Bereiche im Formular
- **Metadaten** – Anzeigename, Beschreibung, erforderliche Rolle. Die interne **ID** (Verzeichnisname) wird aus dem Namen abgeleitet.
- **Quelle (Source)** – Typ (ISO/Clone) + VM-Einstellungen (CPU, RAM, Disk, Netz, SSH) und – nur bei ISO – `boot_command` & HTTP-Port.
- **Installer-Builder** (nur ISO) – stellt die preseed-/kickstart-Datei über typisierte Felder zusammen (Locale, Passwörter, Pakete, SSH-Key). Pflichtfelder stehen direkt da, optionale lassen sich hinzufügen. Über **Direkt bearbeiten** kannst du den Roh-Inhalt überschreiben (Raw-Override).
- **Provisioner** – geordnete Liste (shell / file / ansible), die nach der Installation läuft.
- **Nebendateien** – frei verwaltete Dateien (z. B. `cloud.cfg`, SSH-Key), die ins Verzeichnis generiert werden.

## HCL-Tab (Vorschau & Direktbearbeitung)
Der **HCL**-Tab zeigt die generierte `.pkr.hcl` + die Nebendateien, damit du nachvollziehst, was P3 erzeugt. Bei einer noch unbenannten neuen Definition wird die Vorschau mit Platzhalter-Namen gerendert.

Mit **HCL direkt bearbeiten** übernimmst du die generierte HCL als Startinhalt und kannst sie frei anpassen (Raw-Override). In diesem Modus wird die HCL **verbatim gespeichert** – die Formularfelder für source/build erzeugen sie dann nicht mehr. `meta.yaml` und die Nebendateien (Installer, Provisioner, Nebendateien) kommen weiterhin aus dem Formular, die HCL referenziert sie über `http/` und `files/`. Mit **Aus Formular neu generieren** verwirfst du den Override wieder. *(Für komplett eigene HCL ohne Formular bleibt der ZIP-Upload im Tab VM Images.)*

## Schnellstart-Vorlagen
Beim Erstellen füllen die Vorlagen ein baubares ISO-Grundgerüst mit passendem Installer-Profil – danach nur noch ISO, Passwörter und SSH-Key ergänzen:
- **Debian 13** – generisch (englische Defaults), preseed.
- **Debian 13 (meine Vorlage)** – originalgetreue Reproduktion der bereitgestellten `debian-13`-Referenz (de_DE, `sysadm`, Cloud-Init-Provisioner + `cloud.cfg`). Der private SSH-Key (`files/sysadm`) ist ein Secret und wird **nicht** mitgeliefert – nur referenziert; lege ihn wie gehabt auf dem Host ab.
- **Ubuntu 24.04** – nutzt das **autoinstall**-Profil (cloud-init `user-data`/`meta-data`), passend zu aktuellen Ubuntu-Server-Versionen (nicht preseed).
- **Rocky / Alma (RHEL 9)** – kickstart.

## Installer-Profile
Der Installer-Builder unterstützt **Debian (preseed)**, **Ubuntu (autoinstall)** und **RHEL/Rocky (kickstart)**. Ubuntu autoinstall erzeugt eine cloud-init `user-data` + leere `meta-data` und verdrahtet das boot_command auf die NoCloud-Datasource (`autoinstall ds="nocloud-net;s=http://…/"`).

## Speichern & Bauen
**Validieren** prüft Pflichtfelder (blockierend) und zeigt Hinweise (nicht blockierend). **Speichern** legt die Definition an; gebaut wird sie anschließend im Tab **VM Images**. Zugangsdaten (Proxmox-Token/Login) stehen **nie** im Editor – sie werden erst zur Build-Zeit injiziert.

## Sicherheit
Nur eigene, editor-erzeugte Definitionen sind hier editierbar. Per ZIP-Upload oder Git-Sync eingebrachte Definitionen bleiben extern und werden nicht überschrieben.

<!-- p3portal.org -->
