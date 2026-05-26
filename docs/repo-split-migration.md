<!-- p3portal.org -->
# Repo Split — Migration Guide for Image Users

**Effective release:** `v1.75.0-beta` (2026-05-26)

P3 Portal's source repository has been split into two:

| Repository | Visibility | Contents | License |
|---|---|---|---|
| `github.com/P3Portal-org/p3portal` | Public | Core Edition (this repo) | AGPLv3 |
| `github.com/P3Portal-org/p3portal-plus` | Private | Plus Edition | LICENSE-PLUS |

The Plus Edition source was part of the public repository **up to and
including `v1.74.9-beta`** in `backend/plus/` and `frontend/src/plus/`.
Starting with `v1.75.0-beta` those paths in this repository are empty Stubs.
The Plus Edition source code now lives in the private `p3portal-plus`
repository and is built independently.

## What changed for image users

### Core Edition users

If you used `ghcr.io/p3portal-org/p3portal:latest` or `:core` — **nothing
changes for you**. Same image stream, same tags. New tags continue:
`:v1.75.0-beta`, `:v1.75.1-beta`, etc.

### Plus Edition users (license-key holders)

If you used `ghcr.io/p3portal-org/p3portal:plus` for the combined
Core+Plus image — **the image-tag path changes**:

| Old (≤ v1.74.9-beta) | New (≥ v1.75.0-beta) |
|---|---|
| `ghcr.io/p3portal-org/p3portal:plus` | `ghcr.io/p3portal-org/p3portal-plus:latest` |
| `ghcr.io/p3portal-org/p3portal:v1.74.9-beta` (Plus build via build-arg) | `ghcr.io/p3portal-org/p3portal-plus:v1.75.0-beta` |

The functional behaviour is identical — same Plus features, same license
verification (`plus.lic` and `plus.enc`), same upgrade path. Only the
container image registry name changes.

#### How to migrate your `docker-compose.yml` or `podman-compose.yml`

Before:

```yaml
services:
  portal:
    image: ghcr.io/p3portal-org/p3portal:plus
```

After:

```yaml
services:
  portal:
    image: ghcr.io/p3portal-org/p3portal-plus:latest
```

Pull the new image:

```bash
docker pull ghcr.io/p3portal-org/p3portal-plus:latest
# or
podman pull ghcr.io/p3portal-org/p3portal-plus:latest
```

#### How to authenticate to GHCR for the Plus image

The Plus image package on GHCR inherits the visibility of the private
Plus repository (private by default). You need a GitHub Personal Access
Token with the `read:packages` scope:

```bash
echo "ghp_..." | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

Generate the token at https://github.com/settings/tokens (Classic, scope
`read:packages` is sufficient).

The maintainer may opt to make the Plus image package publicly pullable
in the future; until then, authentication is required.

### Old `:plus` tag — no longer rebuilt

The combined `ghcr.io/p3portal-org/p3portal:plus` tag is **no longer
rebuilt** starting `v1.75.0-beta`. Previously published `:plus` tag
points to the `v1.74.9-beta` Plus image and remains there for
reproducibility but receives no further updates.

For security patches, switch to `ghcr.io/p3portal-org/p3portal-plus`.

## What stays in the public Core repo

The Core repository (`github.com/P3Portal-org/p3portal`) continues to
contain:

- All Core source code (AGPLv3)
- `LICENSE-PLUS` text file at repo root — kept for transparent resolution
  of historical Plus commits in this repo's git history (every historical
  Plus source file carries an `SPDX-License-Identifier: LicenseRef-LICENSE-PLUS`
  header that references this text)
- `TRADEMARK.md` — trade name and pseudonym notices (repo-spanning)
- `COMMERCIAL.md` — information about the Plus Edition commercial licensing
- All historical commits, including those that contained Plus source code

Git history is unchanged. `git checkout v1.74.9-beta` still reveals the
combined Core+Plus tree exactly as it was published.

## How Plus image is built going forward

The Plus image at `ghcr.io/p3portal-org/p3portal-plus` is produced by:

1. Cloning the public Core repository at a pinned tag (see `.core-version`
   in the Plus repository)
2. Overlaying Plus paths from the Plus repository on top
3. Standard Docker build with `EDITION=plus`

This is the same image content as before the split. Only the build
location changed.

## Reverting

This change is intentional and not expected to be reverted. If for some
reason the repositories need to be re-merged, the operation is
straightforward (`git subtree add`) and would be communicated via a
release note.

## Questions

License questions: `license@p3portal.org`

Core-related security issues: see [SECURITY.md](../SECURITY.md) in this repository

Plus-related security issues: `license@p3portal.org` (private)
