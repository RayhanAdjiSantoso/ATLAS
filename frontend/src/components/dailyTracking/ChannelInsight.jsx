import { CheckCircle2 } from 'lucide-react';
import { fmtRp, fmtRpShort, fmtNum, sumMaybe } from '../../dailyTracking/lib/summary.js';
import { rowFilled, todayIso, weekday } from '../../dailyTracking/lib/daily.js';

// Beside the sheet, for the channel being filled in: its month as a strip of
// days, where it stands against last month, its weeks, and the days still
// empty (each one a jump to its row). The sheet holds the numbers; this says
// what they amount to while they are being typed.

const pct = (v) => `${Math.abs(v * 100).toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) < 0.1 ? 1 : 0 })}%`;
const dayNum = (iso) => Number(iso.slice(8));

export default function ChannelInsight({ kind, channel, days, data, prevData, prevMonthLabel, onFocusDate }) {
  const sales = kind === 'sales';
  const field = sales ? 'revenue' : 'amount';
  const today = todayIso();
  const values = days.map((d) => {
    const v = data?.[d]?.[field];
    return v == null || v === '' || v === '-' ? null : Number(v);
  });
  const max = Math.max(0, ...values.filter((v) => v != null));
  const total = sumMaybe(values);
  const prevTotal = sumMaybe(Object.values(prevData || {}).map((r) => r?.[field]));
  const change = total != null && prevTotal ? (total - prevTotal) / prevTotal : null;
  const missing = days.filter((d) => d < today && !rowFilled(kind, data?.[d]));

  // Calendar weeks, Monday first — the same blocks as the sheet.
  const weeks = [];
  days.forEach((d, i) => {
    if (!weeks.length || weekday(d) === 1) weeks.push({ from: d, to: d, value: null });
    const w = weeks[weeks.length - 1];
    w.to = d;
    if (values[i] != null) w.value = (w.value ?? 0) + values[i];
  });
  const weekMax = Math.max(0, ...weeks.map((w) => w.value ?? 0));

  const filledDays = values.filter((v) => v != null).length;
  const best = values.reduce((b, v, i) => (v != null && (b == null || v > values[b]) ? i : b), null);
  const synced = sales ? 0 : days.filter((d) => ['meta_api', 'google_ads_api'].includes(data?.[d]?.source) && !data?.[d]?.lockedManual).length;
  const manual = sales ? 0 : days.filter((d) => data?.[d]?.lockedManual).length;

  return (
    <aside className={`bt-insight is-${kind}`} aria-label={`Ringkasan ${channel?.label ?? 'channel'}`}>
      <section className="bt-insight-block">
        <header>
          <span>{sales ? 'Revenue' : 'Ads spend'} harian</span>
          <b>{fmtRpShort(total)}</b>
        </header>
        <div className="bt-insight-days" style={{ '--n': days.length || 1 }} aria-hidden="true">
          {days.map((d, i) => (
            <span
              key={d}
              className={`${d === today ? 'is-today' : ''}${missing.includes(d) ? ' is-missing' : ''}${d > today ? ' is-future' : ''}`}
              title={`${dayNum(d)} — ${values[i] == null ? 'kosong' : fmtRp(values[i])}`}
            >
              <i style={{ transform: `scaleY(${max && values[i] > 0 ? values[i] / max : 0})` }} />
            </span>
          ))}
        </div>
        <div className="bt-insight-axis" aria-hidden="true"><span>1</span><span>{days.length}</span></div>
        {best != null && <p className="bt-insight-note">Tertinggi tgl {dayNum(days[best])}: <b>{fmtRpShort(values[best])}</b> · {filledDays} hari berisi angka</p>}
      </section>

      <section className="bt-insight-block">
        <header><span>Dibanding {prevMonthLabel}</span></header>
        {change == null ? (
          <p className="bt-insight-note">Belum ada pembanding di {prevMonthLabel}.</p>
        ) : (
          <div className="bt-insight-compare">
            <strong className={sales ? (change >= 0 ? 'is-good' : 'is-bad') : ''}>{change >= 0 ? '▲' : '▼'} {pct(change)}</strong>
            <span>{fmtRpShort(total)} vs {fmtRpShort(prevTotal)}</span>
          </div>
        )}
      </section>

      <section className="bt-insight-block">
        <header><span>Per minggu</span></header>
        <ul className="bt-insight-weeks">
          {weeks.map((w, i) => (
            <li key={w.from} className={w.from > today ? 'is-future' : ''}>
              <span>M{i + 1} <small>{dayNum(w.from)}–{dayNum(w.to)}</small></span>
              <span className="bt-insight-bar"><i style={{ transform: `scaleX(${weekMax && w.value > 0 ? w.value / weekMax : 0})` }} /></span>
              <b>{w.value == null ? '—' : fmtRpShort(w.value)}</b>
            </li>
          ))}
        </ul>
      </section>

      <section className="bt-insight-block">
        <header>
          <span>Belum diisi</span>
          {missing.length > 0 && <b className="is-warn">{missing.length} hari</b>}
        </header>
        {missing.length ? (
          <div className="bt-insight-missing">
            {missing.map((d) => (
              <button key={d} type="button" onClick={() => onFocusDate(d)} title={`Isi tanggal ${dayNum(d)}`}>{dayNum(d)}</button>
            ))}
          </div>
        ) : (
          <p className="bt-insight-ok"><CheckCircle2 size={14} aria-hidden="true" /> Semua hari sampai kemarin sudah terisi</p>
        )}
      </section>

      {!sales && (synced + manual) > 0 && (
        <section className="bt-insight-block">
          <header><span>Sumber angka</span></header>
          <dl className="bt-insight-source">
            <div><dt>Sync otomatis</dt><dd>{fmtNum(synced)} hari</dd></div>
            <div><dt>Diubah manual</dt><dd>{fmtNum(manual)} hari</dd></div>
          </dl>
        </section>
      )}
    </aside>
  );
}
