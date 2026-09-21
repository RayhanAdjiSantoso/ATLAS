import { Lock, Sparkles } from 'lucide-react';
import { NOTES_SALES_CHANNEL_KEYS } from '../../dailyTracking/lib/constants.js';

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
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

// One row per day of the selected month, every cell inline-editable — the
// point is fast bulk daily entry, closer to the reference spreadsheet than
// MonthlyMetricsForm's one-row-at-a-time edit mode.
export default function DailyEntryTable({ kind, channelKey, days, data, onCellChange, saveStatus }) {
  const showNotes = kind === 'sales' && NOTES_SALES_CHANNEL_KEYS.includes(channelKey);
  const rowStatus = (date) => saveStatus?.[`${kind}:${channelKey}:${date}`];

  return (
    <div className="dt-table-wrap">
      <table className="dt-table">
        <thead>
          <tr>
            <th className="dt-table-no">No</th>
            <th>Tanggal</th>
            {kind === 'sales' ? (
              <>
                <th>Revenue</th>
                <th>Transaksi</th>
                <th>Qty Terjual</th>
                {showNotes && <th>Notes</th>}
              </>
            ) : (
              <th>Amount Spent</th>
            )}
            <th className="dt-table-status-col" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {days.map((date, i) => {
            const row = data?.[date] || {};
            const status = rowStatus(date);
            return (
              <tr key={date}>
                <td className="dt-table-no">{i + 1}</td>
                <td className="dt-table-date">{formatDate(date)}</td>
                {kind === 'sales' ? (
                  <>
                    <td>
                      <input
                        type="text" inputMode="numeric"
                        value={formatSignedThousands(row.revenue)}
                        onChange={(e) => onCellChange(date, 'revenue', parseSignedThousandsInput(e.target.value))}
                      />
                    </td>
                    <td>
                      <input
                        type="number" inputMode="numeric"
                        value={row.transaksi ?? ''}
                        onChange={(e) => onCellChange(date, 'transaksi', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number" inputMode="numeric"
                        value={row.qtySold ?? ''}
                        onChange={(e) => onCellChange(date, 'qtySold', e.target.value)}
                      />
                    </td>
                    {showNotes && (
                      <td>
                        <input
                          type="text" maxLength={500} className="dt-notes-input"
                          placeholder="mis. RETUR"
                          value={row.notes ?? ''}
                          onChange={(e) => onCellChange(date, 'notes', e.target.value)}
                        />
                      </td>
                    )}
                  </>
                ) : (
                  <td className="dt-table-spend-cell">
                    <input
                      type="text" inputMode="numeric"
                      value={formatThousands(row.amount)}
                      onChange={(e) => onCellChange(date, 'amount', parseThousandsInput(e.target.value))}
                    />
                    {row.source === 'meta_api' && !row.lockedManual && (
                      <span className="dt-badge dt-badge-synced" title="Terisi otomatis dari Meta API">
                        <Sparkles size={11} /> Synced
                      </span>
                    )}
                    {row.lockedManual && (
                      <span className="dt-badge dt-badge-locked" title="Diubah manual — tidak akan ditimpa sync Meta">
                        <Lock size={11} /> Manual
                      </span>
                    )}
                  </td>
                )}
                <td className="dt-table-status-col">
                  {status === 'saving' && <span className="dt-save-status">Menyimpan…</span>}
                  {status === 'saved' && <span className="dt-save-status is-saved">Tersimpan</span>}
                  {status === 'error' && <span className="dt-save-status is-error">Gagal</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
