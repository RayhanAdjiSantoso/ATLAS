import MonthPicker from './MonthPicker.jsx';

// Google Reviews › a period filter by month and year (no day): two month
// pickers, limited to the months between the earliest and latest review so
// every choice can match something, and to each other ("from" never after
// "to"). Values are 'YYYY-MM'; monthStart / monthEnd turn them into the day
// range the API takes. Months are Jakarta time.

const NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const jakartaMonth = (iso) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 7);

export const monthStart = (ym) => (ym ? `${ym}-01` : undefined);
export function monthEnd(ym) {
  if (!ym) return undefined;
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${NAMES[m - 1]} ${y}`;
};

export default function MonthRange({ earliest, latest, from, to, onChange }) {
  if (!earliest || !latest) return null;
  const min = jakartaMonth(earliest);
  const max = jakartaMonth(latest);
  return (
    <>
      <div className="gr-month">
        <span>Dari bulan</span>
        <MonthPicker label="Dari bulan" value={from} min={min} max={to || max} onChange={(v) => onChange({ from: v, to })} />
      </div>
      <div className="gr-month">
        <span>Sampai bulan</span>
        <MonthPicker label="Sampai bulan" value={to} min={from || min} max={max} onChange={(v) => onChange({ from, to: v })} />
      </div>
    </>
  );
}
