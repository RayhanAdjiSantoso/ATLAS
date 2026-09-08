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

  // Resolve a whole column's worth of values in two round trips instead of
  // two per value. getOrCreate() costs an INSERT + a SELECT every time it
  // misses the cache, which is fine for a handful of statuses and ruinous
  // for customers: one order file introduces thousands of new usernames, so
  // an import spent most of its life waiting on ~2 network round trips each.
  // Warming the cache up front turns that into two statements for the file.
  async warmSingle(table, idCol, valueCol, values) {
    const missing = [...new Set(
      values.filter((v) => !isEmpty(v)).map((v) => String(v)),
    )].filter((v) => !this._cache.has(`${table}:${v}`));
    if (!missing.length) return;

    await this.client.query(
      `INSERT INTO ${table} (${valueCol}) SELECT unnest($1::text[]) ON CONFLICT (${valueCol}) DO NOTHING`,
      [missing],
    );
    const result = await this.client.query(
      `SELECT ${idCol}, ${valueCol} FROM ${table} WHERE ${valueCol} = ANY($1::text[])`,
      [missing],
    );
    for (const row of result.rows) this._cache.set(`${table}:${row[valueCol]}`, row[idCol]);
  }

  // Same, for a two-column natural key (locations is city + province).
  async warmPair(table, idCol, [colA, colB], pairs) {
    const seen = new Map();
    for (const [a, b] of pairs) {
      if (isEmpty(a) || isEmpty(b)) continue;
      const key = `${table}:${a}|${b}`;
      if (!this._cache.has(key)) seen.set(key, [String(a), String(b)]);
    }
    if (!seen.size) return;

    const rows = [...seen.values()];
    const as = rows.map((r) => r[0]);
    const bs = rows.map((r) => r[1]);
    await this.client.query(
      `INSERT INTO ${table} (${colA}, ${colB})
       SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT (${colA}, ${colB}) DO NOTHING`,
      [as, bs],
    );
    const result = await this.client.query(
      `SELECT ${idCol}, ${colA}, ${colB} FROM ${table}
       WHERE (${colA}, ${colB}) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
      [as, bs],
    );
    for (const row of result.rows) this._cache.set(`${table}:${row[colA]}|${row[colB]}`, row[idCol]);
  }
}

function isEmpty(v) {
  if (v == null) return true;
  if (typeof v === 'number' && Number.isNaN(v)) return true;
  const s = String(v).trim();
  return s === '' || s.toLowerCase() === 'nan';
}
