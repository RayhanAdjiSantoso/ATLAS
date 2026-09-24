// Ported from the standalone report generator (src/sqlHelpers.ts) — logic
// unchanged, just stripped of TypeScript types for ATLAS's plain-JS backend.

// Builds a parameterized multi-row INSERT statement. Values are always bound
// as query parameters — never string-interpolated — so this is safe for any
// row content, including user-controlled strings.
// One INSERT per chunk of rows. A single statement covering thousands of
// rows binds tens of thousands of parameters, and the driver fails the whole
// save with "bind message has N parameter formats but 0 parameters" — which
// is what a Meta report of ~10k raw rows was hitting. Chunking keeps every
// statement well inside the protocol's limits.
export function buildBulkInserts(table, columns, rows, chunkSize = 500) {
  const out = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const statement = buildBulkInsert(table, columns, rows.slice(i, i + chunkSize));
    if (statement) out.push(statement);
  }
  return out;
}

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
