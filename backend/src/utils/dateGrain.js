// Shared rule for the dashboard's monthly-snapshot metrics.
//
// A handful of Business Overview figures can only be read from
// shopee.product_performance_summary / shopee.product_variant_performance,
// which store ONE row per calendar month (period_id -> report_periods). Every
// other domain re-aggregates from daily (daily_order_performance,
// daily_channel_performance) or per-order (orders/order_items) data, so an
// arbitrary date range is exact. These snapshot-sourced figures cannot be:
//
//  - a multi-month range sums whole monthly snapshots (Jul + Aug), and
//  - a partial-month range still pulls the ENTIRE month it overlaps.
//
// snapshotGrainWarning() returns the caveat to show for such a figure, or
// null when the selected range is exactly one whole calendar month (the one
// case where the snapshot IS the right answer).

const ID_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ID_MONTHS[m - 1]} ${y}`;
}

function lastDayOfMonth(year, month1) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

// startDate / endDate: 'YYYY-MM-DD' strings, inclusive on both ends.
export function snapshotGrain(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  const monthsSpanned = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    monthsSpanned.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`,
    );
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const startsOnFirst = start.getUTCDate() === 1;
  const endsOnLast = end.getUTCDate() === lastDayOfMonth(end.getUTCFullYear(), end.getUTCMonth() + 1);
  const isWholeCalendarMonth = monthsSpanned.length === 1 && startsOnFirst && endsOnLast;

  return { isWholeCalendarMonth, monthsSpanned };
}

// `subject` names the figure(s) in the sentence, e.g.
// 'Angka Product Performance' or 'Funnel (Kunjungan → Keranjang → Pesanan)'.
export function snapshotGrainWarning(startDate, endDate, subject) {
  if (!startDate || !endDate) return null;
  const { isWholeCalendarMonth, monthsSpanned } = snapshotGrain(startDate, endDate);
  if (isWholeCalendarMonth) return null;

  const labels = monthsSpanned.map(monthLabel);
  const detail = monthsSpanned.length > 1
    ? `Rentang ini mencakup ${monthsSpanned.length} snapshot bulanan (${labels.join(', ')}) yang dijumlahkan begitu saja.`
    : `Rentang ini bukan ${labels[0]} secara penuh, namun snapshot ${labels[0]} tetap dihitung utuh.`;

  return {
    grain: 'monthly-snapshot',
    isApprox: true,
    monthsSpanned,
    message: `${subject} dibaca dari snapshot bulanan (tidak ada data harian di sumbernya). ${detail} `
      + 'Pilih rentang tepat satu bulan kalender untuk angka yang presisi.',
  };
}
