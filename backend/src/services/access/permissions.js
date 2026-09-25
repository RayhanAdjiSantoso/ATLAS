import pool from '../../config/db.js';

// Who may open which part of ATLAS.
//
// Roles are fixed in code (superadmin, admin, user, client); what each role may
// open is not. The superadmin edits it in Pengaturan Akses, and only the
// changes are stored (role_permissions). A role/module pair with no stored row
// uses DEFAULTS below, so a fresh install behaves sensibly with an empty table.
//
// Two things are deliberately NOT editable, so no one can lock the company out
// of its own system:
//   • superadmin always has every module;
//   • Pengaturan Akses itself belongs to superadmin and admin only.

export const ROLES = ['superadmin', 'admin', 'user', 'client'];

export const ROLE_LABELS = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  user: 'User (internal)',
  client: 'Client',
};

// Module keys are the unit of permission; the frontend maps each to its menu
// entry and route, the backend to its API routers.
export const MODULES = [
  { key: 'dashboard', label: 'Dashboard Business Overview' },
  { key: 'daily_tracking', label: 'Daily Tracking' },
  { key: 'brand_settings', label: 'Pengaturan Brand' },
  { key: 'report_generator', label: 'Report Generator' },
  { key: 'history', label: 'History Upload' },
  { key: 'meta_automation', label: 'Meta Ads Automation' },
  { key: 'internal_dashboard', label: 'Internal Dashboard' },
  { key: 'control_center', label: 'Pusat Kendali' },
];
const MODULE_KEYS = new Set(MODULES.map((m) => m.key));

// Starting point, from the brief: admin runs everything; user does the ads
// work (dashboard, report generator, brand data) but not the internal
// dashboard or the operational tools; client sees its dashboard and nothing
// else.
export const DEFAULTS = {
  admin: {
    dashboard: true, daily_tracking: true, brand_settings: true, report_generator: true,
    history: true, meta_automation: true, internal_dashboard: true, control_center: true,
  },
  user: {
    dashboard: true, daily_tracking: true, brand_settings: true, report_generator: true,
    history: true, meta_automation: false, internal_dashboard: false, control_center: false,
  },
  client: {
    dashboard: true, daily_tracking: false, brand_settings: false, report_generator: false,
    history: false, meta_automation: false, internal_dashboard: false, control_center: false,
  },
};

export const isAdminRole = (role) => role === 'admin' || role === 'superadmin';

// Every request checks permissions, so the table is read at most every 30s per
// instance; an edit clears the cache on the instance that made it.
const CACHE_MS = 30_000;
let cache = null;
let cachedAt = 0;

async function overrides() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
  const { rows } = await pool.query('SELECT role, module, allowed FROM role_permissions');
  const map = {};
  for (const r of rows) (map[r.role] ??= {})[r.module] = r.allowed;
  cache = map;
  cachedAt = Date.now();
  return map;
}

export function invalidatePermissions() {
  cache = null;
}

// The full matrix as the page shows it: every role × module, effective value.
export async function getPermissionMatrix() {
  const o = await overrides();
  const matrix = {};
  for (const role of ROLES) {
    matrix[role] = {};
    for (const { key } of MODULES) {
      matrix[role][key] = role === 'superadmin' ? true : (o[role]?.[key] ?? DEFAULTS[role]?.[key] ?? false);
    }
  }
  return matrix;
}

export async function modulesFor(role) {
  if (role === 'superadmin') return MODULES.map((m) => m.key);
  const matrix = await getPermissionMatrix();
  return Object.entries(matrix[role] ?? {}).filter(([, v]) => v).map(([k]) => k);
}

export async function hasModule(role, module) {
  if (role === 'superadmin') return true;
  const matrix = await getPermissionMatrix();
  return Boolean(matrix[role]?.[module]);
}

export async function setPermission(role, module, allowed, actorId) {
  if (!ROLES.includes(role) || role === 'superadmin') throw new Error('Role ini tidak bisa diubah.');
  if (!MODULE_KEYS.has(module)) throw new Error('Modul tidak dikenal.');
  await pool.query(
    `INSERT INTO role_permissions (role, module, allowed, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (role, module) DO UPDATE SET allowed = EXCLUDED.allowed, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [role, module, Boolean(allowed), actorId],
  );
  invalidatePermissions();
}
