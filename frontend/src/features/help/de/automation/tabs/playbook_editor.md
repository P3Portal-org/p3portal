# Playbook-Editor

Baue ein Ansible-Playbook **visuell** – Task für Task auf einer Canvas, ähnlich einem Workflow-Editor. Das Ergebnis wird als Playbook-Definition im `ansible/`-Verzeichnis gespeichert und erscheint in der **Playbooks**-Liste, von wo es über den normalen Flow gestartet wird. (Plus-Funktion, nur für Admins.)

## Canvas

- **Playbook-Knoten** (links): legt das **Ziel** fest (verwalteter Gast oder lokal/Proxmox-API) sowie `become` (Root-Rechte) und `gather_facts`.
- **Task-Knoten**: ein Ansible-Modul pro Knoten. Über die Verbindungslinien ergibt sich die **Reihenfolge** der Tasks.
- **+ Task hinzufügen** (oben links) bzw. der **+**-Knopf am rechten Rand eines Knotens hängt den nächsten Task an. Mit **↑ / ↓** änderst du die Reihenfolge, mit **×** entfernst du einen Task.

## Einen Task bauen

1. **Modul wählen** – über die Suche (z. B. `copy`, `apt`, `service`). Es stehen nur **Core-Module** (`ansible.builtin.*`) zur Verfügung.
2. **Pflichtfelder** (mit `*`) erscheinen sofort; bei gängigen Modulen werden zusätzlich die üblichen Felder direkt aufgeklappt (bei `copy` z. B. `src`/`dest`/`owner`/`mode`).
3. **+ Parameter hinzufügen** öffnet eine **durchsuchbare** Liste aller weiteren Parameter des Moduls. Jeder Parameter trägt ein kleines **(i)** – ein Klick zeigt die Erklärung aus der Ansible-Dokumentation.
4. **+ Option** heftet allgemeine Task-Felder an: `when` (Bedingung), `register`, `loop`, `become`, `tags`, `notify`.

Die angebotenen Parameter stammen direkt aus `ansible-doc` – es gibt also nur Felder, die das Modul auch wirklich kennt.

### Werte, Variablen und komplexe Parameter
- Jedes Feld akzeptiert einen festen Wert **oder** einen **Jinja-Ausdruck** (`{{ … }}`). Bei Zahlen/Ja-Nein schaltet das **ƒx**-Symbol zwischen Wert und Jinja um.
- Verschachtelte Parameter (Listen/Dictionaries) werden als **Raw-YAML-Feld** eingegeben.

## Rollen bedingt ausführen (OS-Weichen)

Über die Playbook-Ebene lassen sich **Ansible-Rollen bedingt einbinden** – z. B. je nach Betriebssystem in eine andere Rolle springen. Dafür brauchst du kein Sonderfeature:

1. Im **Playbook-Knoten** `gather_facts` aktivieren (damit `ansible_facts.os_family` verfügbar ist).
2. Einen Task mit dem Modul **`include_role`** anlegen, Parameter `name` = Rollenname (z. B. `debian_setup`).
3. Über **+ Option** ein `when` anheften, z. B. `ansible_facts.os_family == 'Debian'`.
4. Weitere Tasks für andere OS analog (`'RedHat'` für RHEL/Rocky/Alma).

Das erzeugt ein Playbook, das nur die zur Bedingung passende Rolle ausführt – Beispiel für einen Task:

    - name: Debian/Ubuntu einrichten
      ansible.builtin.include_role:
        name: debian_setup
      when: ansible_facts.os_family == 'Debian'

So trennst du **Orchestrierung** (das Playbook im Editor) von den **Rollen** selbst: Die Rollen-Verzeichnisse (`debian_setup/` …) stellst du separat bereit (ZIP-Upload, Git-Sync oder direkt im `ansible/`-Mount) – der Editor bindet sie nur ein. `include_role` bindet die Rolle **dynamisch** ein, wenn die Bedingung stimmt; `import_role` würde das `when` an alle Rollen-Tasks weitergeben (anderes Verhalten).

## Nebendateien

Unter **Nebendateien** legst du Textdateien an, die ein Task referenziert (z. B. die `index.html` für einen `copy`-Task). Es handelt sich um **reine Texteingabe** – es werden keine Dateien hochgeladen. Inhalt und Dateiname sind serverseitig begrenzt und gegen Pfad-Tricks gehärtet.

## YAML-Tab

Der **YAML**-Tab zeigt jederzeit das generierte Playbook (read-only). Das strukturierte Modell ist die Quelle der Wahrheit – das YAML ist nur die Projektion. **Validieren** prüft das Playbook gegen das Modul-Schema (Pflichtfelder, Modul-Existenz), **Speichern** legt die Definition an.

## Wieder bearbeiten

Nur **im Editor erstellte** Definitionen lassen sich hier erneut öffnen. Per ZIP/Git eingebrachte Playbooks werden nicht angetastet (und nicht überschrieben).
