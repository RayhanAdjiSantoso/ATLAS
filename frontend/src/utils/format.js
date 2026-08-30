// Single shared percentage formatter -- Indonesian locale (comma decimal),
// replacing scattered raw `.toFixed(N)+'%'` calls that render period-decimal
// ("12.5%") inconsistently with the rest of the dashboard's Intl.NumberFormat
// currency/number formatting ("Rp12.500", "1.250").
//
// `value` is already on the 0-100 percentage scale (e.g. 12.5 for "12.5%"),
// matching the dominant existing convention (`(fraction * 100).toFixed(N)`).
export function formatPercent(value, decimals = 1) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value))}%`;
}
