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

// A sliding window of WINDOW_SIZE month pills that always keeps the selected
// month visible: it defaults to the WINDOW_SIZE most recent months ending at
// "now", but slides forward for a future selection and BACKWARD for a past
// one outside that default range (e.g. backfilling January while "now" is
// September) — sliding only forward here was the original bug: paging back
// past the default window's start left no pill active at all.
export default function MonthPillNav({ month, onChange }) {
  const nowYm = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const defaultStart = shiftMonth(nowYm, -(WINDOW_SIZE - 1));
  let windowStart;
  if (month > nowYm) windowStart = shiftMonth(month, -(WINDOW_SIZE - 1));
  else if (month < defaultStart) windowStart = month;
  else windowStart = defaultStart;
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
