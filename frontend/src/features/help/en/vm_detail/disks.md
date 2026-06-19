<!-- p3portal.org -->
# Making disks usable inside the guest

P3 manages disks **only at the Proxmox layer**: attaching, growing and removing the
virtual disk via the Proxmox API. What happens **inside the guest** — partitioning,
formatting, mounting, growing the filesystem — is the operating system's job and is
**not** done by the portal.

This page is a manual, copy‑paste guide for doing it yourself over SSH after you used
**Add / Grow / Remove** in the disk section.

> ⚠️ **These commands change partitions and filesystems. Formatting destroys all data
> on the target device.** Always double‑check the device name before running anything.

When P3 attaches a disk it sets a serial `p3-<id>`, so the new disk shows up under a
stable path in the guest:

```bash
ls -l /dev/disk/by-id/ | grep p3-
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,SERIAL
```

Install the tools once (pick the line for your distro):

```bash
# Debian / Ubuntu
sudo apt-get update && sudo apt-get install -y cloud-guest-utils e2fsprogs xfsprogs parted

# RHEL / Rocky / AlmaLinux
sudo dnf install -y cloud-utils-growpart e2fsprogs xfsprogs parted
```

---

## A) Grow an existing disk (after "Grow" in P3)

P3 enlarged the virtual disk, but the partition and filesystem inside the guest are
still the old size. Replace `/dev/sdX`, the partition number and the mountpoint with
your values from `lsblk`.

```bash
# 1. Find the device and its partition (e.g. /dev/sdb with partition /dev/sdb1)
lsblk

# 2. Grow the partition to fill the disk  (note the SPACE: device, then partition number)
sudo growpart /dev/sdb 1

# 3. Grow the filesystem — pick the matching one:
#    ext4 (works on the partition, mounted or not)
sudo resize2fs /dev/sdb1
#    xfs  (works on the MOUNTPOINT, must be mounted)
sudo xfs_growfs /data

# 4. Verify
df -h
```

Not sure which filesystem you have?

```bash
lsblk -no FSTYPE /dev/sdb1      # or: blkid /dev/sdb1
```

---

## B) Format and mount a new disk (after "Add" in P3)

The new disk is raw — it has no partition, no filesystem and no mountpoint yet.
Replace `/dev/sdX`, the filesystem and `/data` with your values.

```bash
# 1. Identify the new (raw) disk — it carries the p3- serial
ls -l /dev/disk/by-id/ | grep p3-
lsblk

# 2. Create a GPT partition table and one partition spanning the whole disk
sudo parted -s /dev/sdb mklabel gpt
sudo parted -s /dev/sdb mkpart primary 0% 100%

# 3. Create a filesystem — pick ONE:
sudo mkfs.ext4 /dev/sdb1      # ext4
sudo mkfs.xfs  /dev/sdb1      # xfs

# 4. Create the mountpoint
sudo mkdir -p /data

# 5. Add a persistent entry to /etc/fstab using the stable UUID
UUID=$(sudo blkid -s UUID -o value /dev/sdb1)
echo "UUID=$UUID  /data  ext4  defaults,nofail  0  2" | sudo tee -a /etc/fstab
#    ↑ change "ext4" to "xfs" if you formatted with xfs

# 6. Mount everything from fstab and verify
sudo mount -a
df -h /data
```

`nofail` makes sure the guest still boots if the disk is ever missing.

---

## C) Remove a disk cleanly (before "Remove" in P3)

Do this **inside the guest first**, then detach the disk in P3, so no stale mount or
fstab entry is left behind.

```bash
# 1. Unmount
sudo umount /data

# 2. Remove the matching line from /etc/fstab (open in an editor)
sudo nano /etc/fstab     # delete the /data line, save
```

Then use **Remove** in the P3 disk section to detach and delete the volume.

---

**Managing many hosts?** Instead of doing this by hand you can put the same steps into
your own Ansible playbook and run it against the guest via **Automation → Ansible
Inventory** — P3 only provides the SSH path, the playbook content stays yours.
