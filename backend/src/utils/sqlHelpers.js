// Ported from the standalone report generator (src/sqlHelpers.ts) — logic
// unchanged, just stripped of TypeScript types for ATLAS's plain-JS backend.

// Builds a parameterized multi-row INSERT statement. Values are always bound
// as query parameters — never string-interpolated — so this is safe for any
// row content, including user-controlled strings.
export function buildBulkInsert(table, columns, rows) {
  if (!rows.length) return null;
  const values = [];
  const tuples = rows.map((row) => {
    const placeholders = row.map((_, i) => `$${values.length + i + 1}`);
    values.push(...row);
    return `(${placeholders.join(', ')})`;
  });
  return { text: `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, values };
}
