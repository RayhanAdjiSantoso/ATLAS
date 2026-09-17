// Pure aggregation over the month grid loaded from
// GET /api/daily-tracking/entries. Mirrors the semantics of
// reportGenerator/lib/business.ts's bizTotalMetric/bizAOV/bizCostPerRevenue
// (sumMaybe treats null/NaN as "absent", never as 0), reimplemented in plain
// JS since this page isn't part of the CSS-scoped reportGenerator sub-app.

// null/NaN entries are "absent"; the result is null only if EVERY value is
// absent, so a channel with no data yet never drags a total down to 0.
export function sumMaybe(vals) {
  let total = 0;
  let has = false;
  for (const v of vals) {
    const n = Number(v);
    if (v == null || Number.isNaN(n)) continue;
    total += n;
    has = true;
  }
  return has ? total : null;
}

// Sum one channel's one field across every day in the grid.
export function channelTotal(grid, kind, channelKey, field) {
  const byDate = grid?.[kind]?.[channelKey];
  if (!byDate) return null;
  return sumMaybe(Object.values(byDate).map((row) => row?.[field]));
}

// Sum one field across every channel of `kind`.
export function totalForKind(grid, channels, kind, field) {
  const keys = (channels?.[kind] || []).map((c) => c.key);
  return sumMaybe(keys.map((k) => channelTotal(grid, kind, k, field)));
}

export function aov(grid, channels) {
  const revenue = totalForKind(grid, channels, 'sales', 'revenue');
  const transaksi = totalForKind(grid, channels, 'sales', 'transaksi');
  return revenue != null && transaksi != null && transaksi > 0 ? revenue / transaksi : null;
}

export function costPerRevenue(grid, channels) {
  const revenue = totalForKind(grid, channels, 'sales', 'revenue');
  const spend = totalForKind(grid, channels, 'spend', 'amount');
  return revenue != null && revenue > 0 && spend != null ? spend / revenue : null;
}

export function computeKpis(grid, channels) {
  return {
    totalRevenue: totalForKind(grid, channels, 'sales', 'revenue'),
    totalTransaksi: totalForKind(grid, channels, 'sales', 'transaksi'),
    totalQty: totalForKind(grid, channels, 'sales', 'qtySold'),
    aov: aov(grid, channels),
    totalSpend: totalForKind(grid, channels, 'spend', 'amount'),
    costPerRevenue: costPerRevenue(grid, channels),
  };
}

const idFmt = (decimals = 0) => new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
});

export function fmtNum(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return idFmt(0).format(Number(v));
}

export function fmtRp(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `Rp${idFmt(0).format(Number(v))}`;
}

// Compact currency for the KPI strip — mirrors dashboard/domains.js's idrShort.
export function fmtRpShort(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `Rp${idFmt(2).format(n / 1e9)} M`;
  if (abs >= 1e6) return `Rp${idFmt(1).format(n / 1e6)} jt`;
  if (abs >= 1e3) return `Rp${idFmt(0).format(n / 1e3)} rb`;
  return fmtRp(n);
}

export function fmtPct(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${idFmt(1).format(Number(v) * 100)}%`;
}
