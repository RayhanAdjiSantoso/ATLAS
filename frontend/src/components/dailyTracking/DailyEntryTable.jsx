import { useEffect, useRef } from 'react';
import { Check, Loader2, Lock, Sparkles, TriangleAlert } from 'lucide-react';
import { NOTES_SALES_CHANNEL_KEYS } from '../../dailyTracking/lib/constants.js';
import { sumMaybe, fmtNum } from '../../dailyTracking/lib/summary.js';
import { isWeekend, rowFilled, todayIso, WEEKDAYS, weekday } from '../../dailyTracking/lib/daily.js';

// Enter / ↓ move to the same column one day down, Shift+Enter / ↑ one day up
// — typing a month in is a column at a time, the way the reference
// spreadsheet is filled. Week header rows have no inputs and are skipped.
// Number inputs would otherwise eat the arrows.
function moveFocus(e) {
  const down = (e.key === 'Enter' && !e.shiftKey) || e.key === 'ArrowDown';
  const up = (e.key === 'Enter' && e.shiftKey) || e.key === 'ArrowUp';
  if (!down && !up) return;
  const cell = e.currentTarget.closest('td');
  const rows = [...e.currentTarget.closest('table').querySelectorAll('tr[data-date]')];
  const i = rows.indexOf(cell.parentElement);
  const target = rows[down ? i + 1 : i - 1]?.children[cell.cellIndex]?.querySelector('input');
  if (!target) return;
  e.preventDefault();
  target.focus();
  target.select();
}

// Amount Spent is currency — shown with thousand separators ("1.500.000")
// rather than a bare number, unlike revenue/transaksi/qty which stay plain
// <input type="number">. Kept as a controlled text input so the separators
// can render at all (a native number input rejects non-digit characters).
function formatThousands(v) {
  if (v === '' || v == null || Number.isNaN(Number(v))) return '';
  return new Intl.NumberFormat('id-ID').format(Number(v));
}
function parseThousandsInput(str) {
  const digits = str.replace(/[^\d]/g, '');
  return digits === '' ? '' : Number(digits);
}
// Sales revenue can be negative (retur/return lines), so it keeps a leading
// "-". A lone "-" is a valid in-progress edit and has to survive the round
// trip through formatThousands, or the minus sign could never be typed.
function formatSignedThousands(v) {
  return v === '-' ? '-' : formatThousands(v);
}
function parseSignedThousandsInput(str) {
  const negative = str.trim().startsWith('-');
  const digits = str.replace(/[^\d]/g, '');
  if (digits === '') return negative ? '-' : '';
  return (negative ? -1 : 1) * Number(digits);
}

const isZero = (v) => v !== '' && v != null && Number(v) === 0;
const monthOf = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { month: 'short' });
const weekRange = (week) => {
  const first = Number(week[0].slice(8));
  const last = Number(week[week.length - 1].slice(8));
  return `${first === last ? first : `${first}–${last}`} ${monthOf(week[0])}`;
};

// Calendar weeks, Monday first; the month's first and last weeks may be short.
function weeksOf(days) {
  const weeks = [];
  days.forEach((d) => {
    if (!weeks.length || weekday(d) === 1) weeks.push([]);
    weeks[weeks.length - 1].push(d);
  });
  return weeks;
}

function SaveMark({ status }) {
  if (status === 'saving') return <span className="dt-save is-busy"><Loader2 size={13} className="dt-spin" aria-hidden="true" /> Menyimpan</span>;
  if (status === 'saved') return <span className="dt-save is-saved"><Check size={13} aria-hidden="true" /> Tersimpan</span>;
  if (status === 'error') return <span className="dt-save is-error"><TriangleAlert size={13} aria-hidden="true" /> Gagal</span>;
  return null;
}

// One row per day of the selected month, every cell inline-editable — the
// point is fast bulk daily entry, closer to the reference spreadsheet than
// MonthlyMetricsForm's one-row-at-a-time edit mode. Days are grouped by week
// with a subtotal on each week's header, so thirty rows read as four or five
// blocks instead of one wall of numbers.
export default function DailyEntryTable({ kind, channelKey, days, data, onCellChange, saveStatus, readOnly = false, focusDate, onFocusDone, header }) {
  const sales = kind === 'sales';
  const showNotes = sales && NOTES_SALES_CHANNEL_KEYS.includes(channelKey);
  const rowStatus = (date) => saveStatus?.[`${kind}:${channelKey}:${date}`];
  const today = todayIso();
  const tableRef = useRef(null);
  const sum = (list, field) => sumMaybe(list.map((d) => data?.[d]?.[field]));
  const fields = sales ? ['revenue', 'transaksi', 'qtySold'] : ['amount'];

  // Arriving from the fill map: bring that day into view, put the cursor in
  // its first cell and mark the row for a moment so the eye lands on it.
  useEffect(() => {
    if (!focusDate) return undefined;
    const row = tableRef.current?.querySelector(`tr[data-date="${focusDate}"]`);
    if (!row) return undefined;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.querySelector('input:not([readonly])')?.focus({ preventScroll: true });
    row.classList.add('is-flash');
    const t = setTimeout(() => { row.classList.remove('is-flash'); onFocusDone?.(); }, 1400);
    return () => clearTimeout(t);
  }, [focusDate, channelKey, onFocusDone]);

  const input = (date, field, value, onChange, extra = {}) => (
    <input
      readOnly={readOnly}
      onKeyDown={moveFocus}
      className={isZero(value) ? 'is-zero' : undefined}
      aria-label={`${field} ${date}`}
      value={value}
      onChange={onChange}
      {...extra}
    />
  );

  return (
    <div className="dt-table-wrap">
      {header}
      <table className={`dt-table is-${kind}`} ref={tableRef}>
        <colgroup>
          <col className="dt-col-date" />
          {fields.map((f) => <col key={f} className={f === 'revenue' || f === 'amount' ? 'dt-col-money' : 'dt-col-count'} />)}
          {showNotes && <col className="dt-col-notes" />}
          {!sales && <col className="dt-col-source" />}
          <col className="dt-col-status" />
        </colgroup>
        <thead>
          <tr>
            <th>Tanggal</th>
            {sales ? (
              <>
                <th className="is-num">Revenue <small>Rp</small></th>
                <th className="is-num">Transaksi</th>
                <th className="is-num">Qty terjual</th>
                {showNotes && <th>Notes</th>}
              </>
            ) : (
              <>
                <th className="is-num">Amount spent <small>Rp</small></th>
                <th>Sumber</th>
              </>
            )}
            <th aria-label="Status simpan" />
          </tr>
        </thead>
        {weeksOf(days).map((week, w) => (
          <tbody key={week[0]}>
            <tr className="dt-week">
              <th scope="rowgroup">
                Minggu {w + 1}
                <small>{weekRange(week)}</small>
              </th>
              {fields.map((f) => <td key={f} className="is-num">{week.some((d) => d <= today) ? fmtNum(sum(week, f)) : ''}</td>)}
              {showNotes && <td />}
              {!sales && <td />}
              <td />
            </tr>
            {week.map((date) => {
              const row = data?.[date] || {};
              const missing = date < today && !rowFilled(kind, row);
              return (
                <tr
                  key={date}
                  data-date={date}
                  className={`${isWeekend(date) ? 'is-weekend' : ''}${date === today ? ' is-today' : ''}${date > today ? ' is-future' : ''}${missing ? ' is-missing' : ''}`}
                >
                  <td className="dt-table-date">
                    <b>{date.slice(8)}</b>
                    <span>{WEEKDAYS[weekday(date)]}</span>
                    {date === today && <em>Hari ini</em>}
                    {missing && <i className="dt-missing" title="Belum diisi" aria-label="Belum diisi" />}
                  </td>
                  {sales ? (
                    <>
                      <td>{input(date, 'revenue', formatSignedThousands(row.revenue), (e) => onCellChange(date, 'revenue', parseSignedThousandsInput(e.target.value)), { type: 'text', inputMode: 'numeric' })}</td>
                      <td>{input(date, 'transaksi', row.transaksi ?? '', (e) => onCellChange(date, 'transaksi', e.target.value), { type: 'number', inputMode: 'numeric' })}</td>
                      <td>{input(date, 'qty', row.qtySold ?? '', (e) => onCellChange(date, 'qtySold', e.target.value), { type: 'number', inputMode: 'numeric' })}</td>
                      {showNotes && (
                        <td>{input(date, 'notes', row.notes ?? '', (e) => onCellChange(date, 'notes', e.target.value), { type: 'text', maxLength: 500, placeholder: 'mis. RETUR', className: 'dt-notes-input' })}</td>
                      )}
                    </>
                  ) : (
                    <>
                      <td>{input(date, 'amount', formatThousands(row.amount), (e) => onCellChange(date, 'amount', parseThousandsInput(e.target.value)), { type: 'text', inputMode: 'numeric' })}</td>
                      <td className="dt-table-source">
                        {/* Quiet text, not pills: on most sheets every row has the
                            same source, and thirty identical badges are noise. Only
                            an automatic sync is coloured. */}
                        {row.lockedManual ? (
                          <span className="dt-src" title="Diubah manual — tidak akan ditimpa sync otomatis"><Lock size={11} aria-hidden="true" /> Manual</span>
                        ) : (row.source === 'meta_api' || row.source === 'google_ads_api') ? (
                          <span className="dt-src is-synced" title={row.source === 'google_ads_api' ? 'Terisi otomatis dari Google Ads' : 'Terisi otomatis dari Meta API'}>
                            <Sparkles size={11} aria-hidden="true" /> {row.source === 'google_ads_api' ? 'Google Ads' : 'Meta API'}
                          </span>
                        ) : null}
                      </td>
                    </>
                  )}
                  <td className="dt-table-status"><SaveMark status={rowStatus(date)} /></td>
                </tr>
              );
            })}
          </tbody>
        ))}
        <tfoot>
          <tr>
            <th scope="row">Total bulan ini</th>
            {fields.map((f) => <td key={f} className="is-num">{fmtNum(sum(days, f))}</td>)}
            {showNotes && <td />}
            {!sales && <td />}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
