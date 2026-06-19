# Playbook Editor

Build an Ansible playbook **visually** – task by task on a canvas, similar to a workflow editor. The result is saved as a playbook definition in the `ansible/` directory and shows up in the **Playbooks** list, from where it is launched through the normal flow. (Plus feature, admins only.)

## Canvas

- **Playbook node** (left): sets the **target** (managed guest or local/Proxmox API) plus `become` (root) and `gather_facts`.
- **Task nodes**: one Ansible module per node. The connection lines define the **task order**.
- **+ Add task** (top left) or the **+** button on a node's right edge appends the next task. Use **↑ / ↓** to reorder and **×** to remove a task.

## Building a task

1. **Pick a module** – via search (e.g. `copy`, `apt`, `service`). Only **core modules** (`ansible.builtin.*`) are available.
2. **Required fields** (marked `*`) appear immediately; for common modules the usual fields are also expanded right away (for `copy` e.g. `src`/`dest`/`owner`/`mode`).
3. **+ Add parameter** opens a **searchable** list of all other parameters of the module. Each parameter carries a small **(i)** – clicking it shows the explanation from the Ansible documentation.
4. **+ Option** attaches general task fields: `when` (condition), `register`, `loop`, `become`, `tags`, `notify`.

The offered parameters come straight from `ansible-doc` – so only fields the module actually supports are shown.

### Values, variables and complex parameters
- Every field accepts a literal value **or** a **Jinja expression** (`{{ … }}`). For numbers/booleans the **ƒx** symbol toggles between value and Jinja.
- Nested parameters (lists/dictionaries) are entered as a **raw YAML field**.

## Running roles conditionally (OS switches)

The playbook layer lets you **include Ansible roles conditionally** – e.g. branch into a different role depending on the operating system. No special feature needed:

1. In the **playbook node** enable `gather_facts` (so `ansible_facts.os_family` is available).
2. Add a task with the **`include_role`** module, parameter `name` = role name (e.g. `debian_setup`).
3. Via **+ Option** attach a `when`, e.g. `ansible_facts.os_family == 'Debian'`.
4. Add more tasks for other OSes the same way (`'RedHat'` for RHEL/Rocky/Alma).

This produces a playbook that only runs the role matching the condition – example for one task:

    - name: Set up Debian/Ubuntu
      ansible.builtin.include_role:
        name: debian_setup
      when: ansible_facts.os_family == 'Debian'

This separates **orchestration** (the playbook in the editor) from the **roles** themselves: you provide the role directories (`debian_setup/` …) separately (ZIP upload, Git sync or directly in the `ansible/` mount) – the editor only includes them. `include_role` includes the role **dynamically** when the condition holds; `import_role` would push the `when` down to every task of the role (different behaviour).

## Side files

Under **Side files** you create text files referenced by a task (e.g. the `index.html` for a `copy` task). This is **plain text input** – no files are uploaded. Content and file name are size-limited and hardened against path tricks on the server.

## YAML tab

The **YAML** tab always shows the generated playbook (read-only). The structured model is the source of truth – the YAML is just a projection. **Validate** checks the playbook against the module schema (required fields, module existence); **Save** creates the definition.

## Re-editing

Only definitions **created in the editor** can be reopened here. Playbooks brought in via ZIP/Git are left untouched (and never overwritten).
