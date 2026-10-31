import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const WINDOW_SIZE = 6;

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthsBetween(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`;
}

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// The WINDOW_SIZE-month page that holds `month`. Pages are counted back from
// the current month, so the first page always ends at "now" — the same paging
// as Data Collection Hub's month rail. A future month (left over in session
// storage) gets a page of its own ending on it.
function windowEndFor(month, nowYm) {
  const back = monthsBetween(month, nowYm);
  if (back <= 0) return month;
  return shiftMonth(nowYm, -WINDOW_SIZE * Math.floor(back / WINDOW_SIZE));
}

// WINDOW_SIZE month pills. The arrows page the whole window by WINDOW_SIZE
// months without changing the selection; picking a pill selects that month.
// Paging forward stops at the page ending on the current month.
export default function MonthPillNav({ month, onChange }) {
  const nowYm = currentYm();
  const [windowEnd, setWindowEnd] = useState(() => windowEndFor(month, nowYm));

  // A month chosen from outside (session restore, brand switch) that sits off
  // the visible page brings its page into view.
  useEffect(() => {
    setWindowEnd((end) => {
      const offset = monthsBetween(month, end);
      return offset >= 0 && offset < WINDOW_SIZE ? end : windowEndFor(month, currentYm());
    });
  }, [month]);

  const latest = windowEnd > nowYm ? windowEnd : nowYm;
  const canNext = windowEnd < latest;
  const months = [];
  for (let i = WINDOW_SIZE - 1; i >= 0; i -= 1) months.push(shiftMonth(windowEnd, -i));

  return (
    <div className="dt-month-nav" role="tablist" aria-label="Pilih bulan">
      <button
        type="button"
        className="dt-month-arrow"
        onClick={() => setWindowEnd(shiftMonth(windowEnd, -WINDOW_SIZE))}
        aria-label={`${WINDOW_SIZE} bulan sebelumnya`}
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
        onClick={() => {
          const next = shiftMonth(windowEnd, WINDOW_SIZE);
          setWindowEnd(next > latest ? latest : next);
        }}
        disabled={!canNext}
        aria-label={`${WINDOW_SIZE} bulan berikutnya`}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
