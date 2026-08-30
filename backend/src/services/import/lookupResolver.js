/**
 * Generic get-or-create resolver for lookup/dimension tables.
 * Ported from lookup_cache.py — same design, no hardcoded reference values.
 */
export class LookupResolver {
  constructor(client) {
    this.client = client;
    this._cache = new Map();
  }

  async getOrCreate(table, idCol, valueCols, values) {
    if (values == null || values.some(isEmpty)) {
      return null;
    }

    const normalized = valueCols.length === 1 ? [values[0]] : [...values];
    const cacheKey = `${table}:${normalized.join('|')}`;

    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const colsSql = valueCols.join(', ');
    const placeholders = valueCols.map((_, i) => `$${i + 1}`).join(', ');
    const conflictCols = valueCols.join(', ');

    await this.client.query(
      `INSERT INTO ${table} (${colsSql}) VALUES (${placeholders})
       ON CONFLICT (${conflictCols}) DO NOTHING`,
      normalized,
    );

    const whereSql = valueCols.map((c, i) => `${c} = $${i + 1}`).join(' AND ');
    const result = await this.client.query(
      `SELECT ${idCol} FROM ${table} WHERE ${whereSql}`,
      normalized,
    );

    const resolvedId = result.rows[0]?.[idCol] ?? null;
    this._cache.set(cacheKey, resolvedId);
    return resolvedId;
  }

  async getOrCreateOne(table, idCol, valueCol, value) {
    return this.getOrCreate(table, idCol, [valueCol], [value]);
  }
}

function isEmpty(v) {
  if (v == null) return true;
  if (typeof v === 'number' && Number.isNaN(v)) return true;
  const s = String(v).trim();
  return s === '' || s.toLowerCase() === 'nan';
}
