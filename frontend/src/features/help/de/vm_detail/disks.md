<!-- p3portal.org -->
# Festplatten im Gast nutzbar machen

P3 verwaltet Festplatten **nur auf der Proxmox-Ebene**: die virtuelle Disk über die
Proxmox-API anhängen, vergrößern und entfernen. Was **im Gast** passiert —
partitionieren, formatieren, mounten, das Dateisystem mitwachsen lassen — ist Aufgabe
des Betriebssystems und wird **nicht** vom Portal erledigt.

Diese Seite ist eine manuelle Copy-&-Paste-Anleitung, um das per SSH selbst zu tun,
nachdem du in der Festplatten-Sektion **Hinzufügen / Vergrößern / Entfernen** benutzt hast.

> ⚠️ **Diese Befehle verändern Partitionen und Dateisysteme. Formatieren löscht alle
> Daten auf dem Zielgerät.** Prüfe den Gerätenamen immer doppelt, bevor du etwas ausführst.

Beim Anhängen setzt P3 eine Seriennummer `p3-<id>`, dadurch erscheint die neue Disk im
Gast unter einem stabilen Pfad:

```bash
ls -l /dev/disk/by-id/ | grep p3-
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,SERIAL
```

Werkzeuge einmalig installieren (passende Zeile für deine Distribution wählen):

```bash
# Debian / Ubuntu
sudo apt-get update && sudo apt-get install -y cloud-guest-utils e2fsprogs xfsprogs parted

# RHEL / Rocky / AlmaLinux
sudo dnf install -y cloud-utils-growpart e2fsprogs xfsprogs parted
```

---

## A) Bestehende Festplatte vergrößern (nach „Vergrößern" in P3)

P3 hat die virtuelle Disk vergrößert, aber Partition und Dateisystem im Gast haben noch
die alte Größe. Ersetze `/dev/sdX`, die Partitionsnummer und den Mountpunkt durch deine
Werte aus `lsblk`.

```bash
# 1. Gerät und Partition finden (z. B. /dev/sdb mit Partition /dev/sdb1)
lsblk

# 2. Partition auf die volle Disk vergrößern  (LEERZEICHEN beachten: Gerät, dann Partitionsnummer)
sudo growpart /dev/sdb 1

# 3. Dateisystem vergrößern — passendes auswählen:
#    ext4 (auf der Partition, egal ob gemountet oder nicht)
sudo resize2fs /dev/sdb1
#    xfs  (auf dem MOUNTPUNKT, muss gemountet sein)
sudo xfs_growfs /data

# 4. Prüfen
df -h
```

Unsicher, welches Dateisystem du hast?

```bash
lsblk -no FSTYPE /dev/sdb1      # oder: blkid /dev/sdb1
```

---

## B) Neue Festplatte formatieren und einbinden (nach „Hinzufügen" in P3)

Die neue Disk ist roh — sie hat noch keine Partition, kein Dateisystem und keinen
Mountpunkt. Ersetze `/dev/sdX`, das Dateisystem und `/data` durch deine Werte.

```bash
# 1. Die neue (rohe) Disk finden — sie trägt die p3--Seriennummer
ls -l /dev/disk/by-id/ | grep p3-
lsblk

# 2. GPT-Partitionstabelle und eine Partition über die ganze Disk anlegen
sudo parted -s /dev/sdb mklabel gpt
sudo parted -s /dev/sdb mkpart primary 0% 100%

# 3. Dateisystem anlegen — EINES wählen:
sudo mkfs.ext4 /dev/sdb1      # ext4
sudo mkfs.xfs  /dev/sdb1      # xfs

# 4. Mountpunkt anlegen
sudo mkdir -p /data

# 5. Dauerhaften Eintrag in /etc/fstab über die stabile UUID
UUID=$(sudo blkid -s UUID -o value /dev/sdb1)
echo "UUID=$UUID  /data  ext4  defaults,nofail  0  2" | sudo tee -a /etc/fstab
#    ↑ „ext4" durch „xfs" ersetzen, wenn du mit xfs formatiert hast

# 6. Alles aus fstab mounten und prüfen
sudo mount -a
df -h /data
```

`nofail` sorgt dafür, dass der Gast weiter bootet, falls die Disk einmal fehlt.

---

## C) Festplatte sauber entfernen (vor „Entfernen" in P3)

Erledige das **zuerst im Gast**, dann hänge die Disk in P3 ab — so bleibt kein
verwaister Mount oder fstab-Eintrag zurück.

```bash
# 1. Aushängen
sudo umount /data

# 2. Passende Zeile aus /etc/fstab entfernen (im Editor öffnen)
sudo nano /etc/fstab     # die /data-Zeile löschen, speichern
```

Danach in der P3-Festplatten-Sektion **Entfernen** benutzen, um das Volume abzuhängen
und zu löschen.

---

**Viele Hosts zu verwalten?** Statt das von Hand zu machen, kannst du dieselben Schritte
in ein eigenes Ansible-Playbook packen und über **Automation → Ansible-Inventar** gegen
den Gast ausführen — P3 stellt nur den SSH-Pfad bereit, der Playbook-Inhalt bleibt deiner.
