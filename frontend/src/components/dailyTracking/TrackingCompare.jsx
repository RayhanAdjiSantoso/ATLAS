import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import api from '../../api/client.js';
import useSessionState from '../../hooks/useSessionState.js';
import DateRangePicker from '../dashboard/DateRangePicker.jsx';
import { fmtNum, fmtRp, fmtRpShort, sumMaybe } from '../../dailyTracking/lib/summary.js';
import { todayIso } from '../../dailyTracking/lib/daily.js';

// Any two stretches of days, side by side: the brand's totals and every
// channel's revenue and ad spend (with its share of period A) in period A
// against period B. The month
// view above always compares with the month before; this is where a client
// asks their own question — this Ramadan against last, a campaign week
// against the week before it. Ranges may cross months (and years): the
// months they touch are fetched once each and kept for the brand.

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000) + 1;
const lastDayOf = (ym) => { const [y, m] = ym.split('-').map(Number); return iso(new Date(y, m, 0)); };
const shiftMonths = (s, n) => {
  const d = parse(s);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return iso(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last)));
};
// Whole calendar months differ in length by nature (30 vs 31 days) — no
// warning needed for comparing one with another.
const isFullMonth = ({ startDate, endDate }) => startDate.endsWith('-01') && endDate === lastDayOf(startDate.slice(0, 7));
const fmtRange = ({ startDate, endDate }) => {
  const a = parse(startDate);
  const b = parse(endDate);
  const sameYear = a.getFullYear() === b.getFullYear();
  const left = a.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  const right = b.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return startDate === endDate ? right : `${left} – ${right}`;
};

// The latest day worth reading: yesterday in the running month (today is
// still being sold, spend lands H-1), the month's last day otherwise.
function anchorOf(month) {
  const yesterday = addDays(todayIso(), -1);
  const end = lastDayOf(month);
  return end < yesterday ? end : yesterday;
}

const PRESETS = [
  { id: 'month', label: 'Bulan ini vs bulan lalu' },
  { id: '7d', label: '7 hari vs 7 hari sebelumnya' },
  { id: '30d', label: '30 hari vs 30 hari sebelumnya' },
  { id: 'yoy', label: 'vs tahun lalu' },
];

function presetRanges(id, month) {
  const end = anchorOf(month);
  const monthStart = `${month}-01`;
  if (id === '7d' || id === '30d') {
    const n = id === '7d' ? 7 : 30;
    const a = { startDate: addDays(end, -(n - 1)), endDate: end };
    return { a, b: { startDate: addDays(a.startDate, -n), endDate: addDays(a.startDate, -1) } };
  }
  const a = { startDate: end < monthStart ? end : monthStart, endDate: end };
  const back = id === 'yoy' ? -12 : -1;
  const bStart = shiftMonths(a.startDate, back);
  // A finished month is compared with the whole of the other month (all 31
  // days of August, not its first 30); a running one with the same days.
  const bEnd = end === lastDayOf(month) ? lastDayOf(bStart.slice(0, 7)) : shiftMonths(a.endDate, back);
  return { a, b: { startDate: bStart, endDate: bEnd } };
}

const monthsIn = ({ startDate, endDate }) => {
  const out = [];
  let ym = startDate.slice(0, 7);
  while (ym <= endDate.slice(0, 7)) {
    out.push(ym);
    const [y, m] = ym.split('-').map(Number);
    ym = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  }
  return out;
};

// Sum one range out of the loaded months.
function measure(months, range, channels) {
  const inRange = (d) => d >= range.startDate && d <= range.endDate;
  const pick = (kind, key, field) => sumMaybe(months.flatMap((g) => Object.entries(g?.[kind]?.[key] || {})
    .filter(([d]) => inRange(d)).map(([, r]) => r?.[field])));
  const sales = (channels.sales || []).map((c) => ({
    key: c.key, label: c.label,
    revenue: pick('sales', c.key, 'revenue'), transaksi: pick('sales', c.key, 'transaksi'), qty: pick('sales', c.key, 'qtySold'),
  }));
  const spend = (channels.spend || []).map((c) => ({ key: c.key, label: c.label, amount: pick('spend', c.key, 'amount') }));
  const revenue = sumMaybe(sales.map((s) => s.revenue));
  const transaksi = sumMaybe(sales.map((s) => s.transaksi));
  const qty = sumMaybe(sales.map((s) => s.qty));
  const ads = sumMaybe(spend.map((s) => s.amount));
  return {
    sales, spend,
    totals: {
      revenue, transaksi, qty, ads,
      aov: revenue != null && transaksi > 0 ? revenue / transaksi : null,
      cpr: revenue > 0 && ads != null ? ads / revenue : null,
    },
  };
}

function Change({ a, b, tone = 'up', percentPoint }) {
  if (a == null || b == null) return <span className="bt-cmp-ch is-flat">—</span>;
  if (percentPoint) {
    const pp = (a - b) * 100;
    if (Math.abs(pp) < 0.05) return <span className="bt-cmp-ch is-flat">±0 pp</span>;
    const good = tone === 'down' ? pp < 0 : pp > 0;
    return <span className={`bt-cmp-ch ${good ? 'is-good' : 'is-bad'}`}>{pp > 0 ? '▲' : '▼'} {Math.abs(pp).toLocaleString('id-ID', { maximumFractionDigits: 1 })} pp</span>;
  }
  if (b === 0) return <span className="bt-cmp-ch is-flat">{a === 0 ? '±0%' : 'baru'}</span>;
  const ch = (a - b) / Math.abs(b);
  if (Math.abs(ch) < 0.005) return <span className="bt-cmp-ch is-flat">±0%</span>;
  const cls = tone === 'neutral' ? 'is-flat' : (tone === 'down' ? ch < 0 : ch > 0) ? 'is-good' : 'is-bad';
  return (
    <span className={`bt-cmp-ch ${cls}`}>
      {ch > 0 ? '▲' : '▼'} {Math.abs(ch * 100).toLocaleString('id-ID', { maximumFractionDigits: Math.abs(ch) < 0.1 ? 1 : 0 })}%
    </span>
  );
}

function Bars({ a, b, max, kind }) {
  const w = (v) => (max > 0 && v > 0 ? v / max : 0);
  return (
    <span className={`bt-cmp-bars is-${kind}`} aria-hidden="true">
      <i className="is-a" style={{ transform: `scaleX(${w(a)})` }} />
      <i className="is-b" style={{ transform: `scaleX(${w(b)})` }} />
    </span>
  );
}

function ChannelTable({ title, kind, rowsA, rowsB, field }) {
  const rows = rowsA
    .map((r, i) => ({ ...r, a: r[field], b: rowsB[i]?.[field] }))
    .filter((r) => (r.a ?? 0) !== 0 || (r.b ?? 0) !== 0)
    .sort((x, y) => (y.a ?? 0) - (x.a ?? 0));
  const max = Math.max(0, ...rows.flatMap((r) => [r.a ?? 0, r.b ?? 0]));
  // Each channel's share of period A — what the composition chart used to say.
  const totalA = rows.reduce((t, r) => t + Math.max(r.a ?? 0, 0), 0);
  return (
    <div className="bt-cmp-block">
      <h3>{title}</h3>
      {!rows.length ? <p className="bt-empty">Belum ada data di kedua periode.</p> : (
        <div className="bt-cmp-table is-channels" role="table">
          <div className="bt-cmp-row is-head" role="row">
            <span role="columnheader">Channel</span>
            <span role="columnheader" className="is-num">Periode A</span>
            <span role="columnheader" className="is-num">Periode B</span>
            <span role="columnheader" className="is-num">Selisih</span>
            <span role="columnheader" className="is-num">Perubahan</span>
          </div>
          {rows.map((r) => (
            <div className="bt-cmp-row" role="row" key={r.key}>
              <span role="cell" className="bt-cmp-name">
                <span className="bt-cmp-label">
                  {r.label}
                  {totalA > 0 && r.a > 0 && <small>{(r.a / totalA * 100).toLocaleString('id-ID', { maximumFractionDigits: r.a / totalA < 0.1 ? 1 : 0 })}%</small>}
                </span>
                <Bars a={r.a} b={r.b} max={max} kind={kind} />
              </span>
              <span role="cell" className="is-num is-strong">{fmtRp(r.a)}</span>
              <span role="cell" className="is-num">{fmtRp(r.b)}</span>
              <span role="cell" className="is-num is-muted">{r.a != null && r.b != null ? `${r.a - r.b >= 0 ? '+' : '−'}${fmtRpShort(Math.abs(r.a - r.b))}` : '—'}</span>
              <span role="cell" className="is-num"><Change a={r.a} b={r.b} tone={kind === 'sales' ? 'up' : 'neutral'} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TrackingCompare({ brandId, channels, month }) {
  const [preset, setPreset] = useSessionState('daily-tracking:cmp-preset', 'month');
  const [custom, setCustom] = useSessionState('daily-tracking:cmp-ranges', null);
  const ranges = preset === 'custom' && custom ? custom : presetRanges(preset === 'custom' ? 'month' : preset, month);
  const { a, b } = ranges;

  // Months already fetched for this brand, reused across every range change.
  const cache = useRef({ brandId: null, months: new Map() });
  const [months, setMonths] = useState({});
  const [loading, setLoading] = useState(false);
  const needed = useMemo(() => [...new Set([...monthsIn(a), ...monthsIn(b)])], [a.startDate, a.endDate, b.startDate, b.endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!brandId) return undefined;
    if (cache.current.brandId !== brandId) cache.current = { brandId, months: new Map() };
    const store = cache.current.months;
    const missing = needed.filter((m) => !store.has(m));
    let alive = true;
    const publish = () => alive && setMonths(Object.fromEntries(needed.map((m) => [m, store.get(m)])));
    if (!missing.length) { publish(); return undefined; }
    setLoading(true);
    Promise.all(missing.map((m) => api.get('/daily-tracking/entries', { params: { brandId, month: m } })
      .then((res) => store.set(m, res.data))
      .catch(() => store.set(m, { days: [], sales: {}, spend: {} }))))
      .then(publish)
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [brandId, needed]);

  const loaded = needed.map((m) => months[m]).filter(Boolean);
  const A = measure(loaded, a, channels);
  const B = measure(loaded, b, channels);

  const setRange = (which, next) => {
    setCustom({ a, b, [which]: next });
    setPreset('custom');
  };

  const summary = [
    { label: 'Total revenue', a: A.totals.revenue, b: B.totals.revenue, fmt: fmtRp },
    { label: 'Transaksi', a: A.totals.transaksi, b: B.totals.transaksi, fmt: fmtNum },
    { label: 'Qty terjual', a: A.totals.qty, b: B.totals.qty, fmt: fmtNum },
    { label: 'AOV', a: A.totals.aov, b: B.totals.aov, fmt: fmtRp },
    { label: 'Ads spend', a: A.totals.ads, b: B.totals.ads, fmt: fmtRp, tone: 'neutral' },
    { label: 'Cost per revenue', a: A.totals.cpr, b: B.totals.cpr, fmt: (v) => (v == null ? '—' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`), tone: 'down', pp: true },
  ];

  return (
    <section className="soft-card bt-panel bt-cmp" aria-label="Bandingkan periode">
      <header className="bt-panel-head">
        <div>
          <h2>Bandingkan periode</h2>
          <p>Pilih dua rentang tanggal — revenue dan ads spend per channel disandingkan.</p>
        </div>
        {loading && <span className="bt-cmp-loading"><Loader2 size={14} className="dt-spin" aria-hidden="true" /> Memuat…</span>}
      </header>

      <div className="bt-cmp-controls">
        <div className="bt-mini-seg bt-cmp-presets" role="tablist" aria-label="Pilihan cepat">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={preset === p.id} className={preset === p.id ? 'is-on' : ''} onClick={() => setPreset(p.id)}>
              {p.label}
            </button>
          ))}
          <button type="button" role="tab" aria-selected={preset === 'custom'} className={preset === 'custom' ? 'is-on' : ''} onClick={() => { setCustom({ a, b }); setPreset('custom'); }}>
            Atur sendiri
          </button>
        </div>
        <div className="bt-cmp-ranges">
          <div className="bt-cmp-range is-a">
            <span className="bt-cmp-tag">Periode A</span>
            <DateRangePicker startDate={a.startDate} endDate={a.endDate} onChange={(r) => setRange('a', r)} />
            <small>{daysBetween(a.startDate, a.endDate)} hari</small>
          </div>
          <ArrowRight size={16} className="bt-cmp-vs" aria-hidden="true" />
          <div className="bt-cmp-range is-b">
            <span className="bt-cmp-tag">Periode B · pembanding</span>
            <DateRangePicker startDate={b.startDate} endDate={b.endDate} onChange={(r) => setRange('b', r)} />
            <small>{daysBetween(b.startDate, b.endDate)} hari</small>
          </div>
        </div>
        {daysBetween(a.startDate, a.endDate) !== daysBetween(b.startDate, b.endDate) && !(isFullMonth(a) && isFullMonth(b)) && (
          <p className="bt-cmp-warn">Jumlah hari kedua periode berbeda — total akan condong ke periode yang lebih panjang; bandingkan juga AOV dan cost per revenue.</p>
        )}
      </div>

      <div className="bt-cmp-block">
        <h3>Ringkasan · <span>{fmtRange(a)}</span> vs <span>{fmtRange(b)}</span></h3>
        <div className="bt-cmp-table" role="table">
          <div className="bt-cmp-row is-head" role="row">
            <span role="columnheader">Metrik</span>
            <span role="columnheader" className="is-num">Periode A</span>
            <span role="columnheader" className="is-num">Periode B</span>
            <span role="columnheader" className="is-num">Selisih</span>
            <span role="columnheader" className="is-num">Perubahan</span>
          </div>
          {summary.map((r) => (
            <div className="bt-cmp-row" role="row" key={r.label}>
              <span role="cell" className="bt-cmp-name">{r.label}</span>
              <span role="cell" className="is-num is-strong">{r.fmt(r.a)}</span>
              <span role="cell" className="is-num">{r.fmt(r.b)}</span>
              <span role="cell" className="is-num is-muted">
                {r.a == null || r.b == null || r.pp ? '—' : `${r.a - r.b >= 0 ? '+' : '−'}${r.fmt === fmtNum ? fmtNum(Math.abs(r.a - r.b)) : fmtRpShort(Math.abs(r.a - r.b))}`}
              </span>
              <span role="cell" className="is-num"><Change a={r.a} b={r.b} tone={r.tone} percentPoint={r.pp} /></span>
            </div>
          ))}
        </div>
      </div>

      <div className="bt-cmp-split">
        <ChannelTable title="Revenue per channel" kind="sales" rowsA={A.sales} rowsB={B.sales} field="revenue" />
        <ChannelTable title="Ads spend per channel" kind="spend" rowsA={A.spend} rowsB={B.spend} field="amount" />
      </div>
    </section>
  );
}
