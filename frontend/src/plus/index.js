// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// SPDX-License-Identifier: AGPL-3.0-only
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// p3portal.org

/**
 * Core-Edition Stub für die Plus-Komponenten-Registry.
 *
 * Wird beim Core-only Docker Build (EDITION=core) vor `npm run build`
 * über index.js kopiert. Alle PlusComponents-Lookups liefern `undefined`,
 * was von den isPlus-Gates in Core-Komponenten korrekt abgefangen wird.
 */

export const PlusComponents = {};

// PROJ-68: Stub – Core-Build hat keinen Git-Sync → immer leeres Set zurückgeben.
// eslint-disable-next-line no-unused-vars
export const useGitSyncConflictIds = (_repoType, _enabled) => new Set()
