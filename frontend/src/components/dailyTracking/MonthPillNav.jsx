import { ChevronLeft, ChevronRight } from 'lucide-react';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const WINDOW_SIZE = 6;

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`;
}

// A sliding window of WINDOW_SIZE month pills ending at whichever month is
// furthest along (the selected one, or "now" if the user has paged back) —
// paging with the arrows shifts the whole window by one month.
export default function MonthPillNav({ month, onChange }) {
  const nowYm = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const windowEnd = month > nowYm ? month : nowYm;
  const windowStart = shiftMonth(windowEnd, -(WINDOW_SIZE - 1));
  const months = [];
  for (let i = 0; i < WINDOW_SIZE; i += 1) months.push(shiftMonth(windowStart, i));

  return (
    <div className="dt-month-nav" role="tablist" aria-label="Pilih bulan">
      <button
        type="button"
        className="dt-month-arrow"
        onClick={() => onChange(shiftMonth(month, -1))}
        aria-label="Bulan sebelumnya"
      >
        <ChevronLeft size={16} />
      </button>
      {months.map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={m === month}
          className={`dt-month-pill${m === month ? ' is-active' : ''}`}
          onClick={() => onChange(m)}
        >
          {monthLabel(m)}
        </button>
      ))}
      <button
        type="button"
        className="dt-month-arrow"
        onClick={() => onChange(shiftMonth(month, 1))}
        aria-label="Bulan berikutnya"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
