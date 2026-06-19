# Image Factory – Build Editor (Plus)

Create a **Packer build definition** through a form – without writing any Packer HCL by hand. The editor is Plus-only and visible to administrators only.

## What the editor produces
A **build definition**, not a finished template. It is saved as a real directory in the Packer mount (`packer/<id>/` with `<id>.pkr.hcl` + `meta.yaml` + optional `http/` and `files/`). It then appears in the **VM Images** tab and is **built** there like any other definition.

## The two build modes (Source)
- **From ISO (`proxmox-iso`)** – builds a template **from scratch**: Packer boots an ISO image and installs the OS unattended (via the preseed/kickstart file from the Installer Builder). Choose this for a fresh OS image.
- **From template (`proxmox-clone`)** – **clones an existing Proxmox template** and only adjusts it (no OS setup, much faster). The **Source template** field is the name (or VM ID) of the existing template.

## Form sections
- **Metadata** – display name, description, required role. The internal **ID** (directory name) is derived from the name.
- **Source** – type (ISO/clone) + VM settings (CPU, RAM, disk, network, SSH) and – ISO only – `boot_command` & HTTP port.
- **Installer Builder** (ISO only) – assembles the preseed/kickstart file from typed fields (locale, passwords, packages, SSH key). Mandatory fields are shown directly, optional ones can be added. Use **Edit directly** to override the raw content (raw override).
- **Provisioners** – an ordered list (shell / file / ansible) that runs after installation.
- **Side files** – freely managed files (e.g. `cloud.cfg`, SSH key) generated into the directory.

## HCL tab (preview & direct editing)
The **HCL** tab shows the generated `.pkr.hcl` + the side files so you can see what P3 produces. For a still-unnamed new definition the preview renders with placeholder names.

With **Edit HCL directly** you take the generated HCL as a starting point and adjust it freely (raw override). In this mode the HCL is saved **verbatim** – the source/build form fields no longer generate it. `meta.yaml` and the side files (installer, provisioners, side files) still come from the form, and the HCL references them via `http/` and `files/`. Use **Regenerate from form** to discard the override. *(For fully custom HCL without a form, the ZIP upload in the VM Images tab remains.)*

## Quick-start templates
When creating, the templates fill a buildable ISO baseline with the matching installer profile – then just add the ISO, passwords and SSH key:
- **Debian 13** – generic (English defaults), preseed.
- **Debian 13 (my template)** – faithful reproduction of the provided `debian-13` reference (de_DE, `sysadm`, cloud-init provisioners + `cloud.cfg`). The private SSH key (`files/sysadm`) is a secret and is **not** included – only referenced; place it on the host as before.
- **Ubuntu 24.04** – uses the **autoinstall** profile (cloud-init `user-data`/`meta-data`), matching current Ubuntu Server versions (not preseed).
- **Rocky / Alma (RHEL 9)** – kickstart.

## Installer profiles
The Installer Builder supports **Debian (preseed)**, **Ubuntu (autoinstall)** and **RHEL/Rocky (kickstart)**. Ubuntu autoinstall generates a cloud-init `user-data` + empty `meta-data` and wires the boot_command to the NoCloud datasource (`autoinstall ds="nocloud-net;s=http://…/"`).

## Save & build
**Validate** checks mandatory fields (blocking) and shows hints (non-blocking). **Save** creates the definition; it is then built in the **VM Images** tab. Credentials (Proxmox token/login) are **never** in the editor – they are injected at build time.

## Security
Only your own editor-created definitions are editable here. Definitions brought in via ZIP upload or Git sync stay external and are never overwritten.

<!-- p3portal.org -->
