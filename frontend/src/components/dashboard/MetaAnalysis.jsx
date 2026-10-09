import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import useSessionState from '../../hooks/useSessionState.js';
import {
  DATASET_META, SELLING, byDataset, comparisonRange, daily, groupBy, loadMetaRecords, roasDrivers, selling, totals,
} from './metaAnalysis.js';
import './metaOverview.css';
import './metaAnalysis.css';

// Business Overview › Meta Ads, the analysis tabs. All five read one set of
// records (metaAnalysis.js) for the period and its comparison, so every
// number on every tab adds up to the same account.

const rp = (v) => (v == null ? '—' : `Rp${Math.round(v).toLocaleString('id-ID')}`);
const rpShort = (v) => {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `Rp${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
  if (a >= 1e6) return `Rp${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (a >= 1e3) return `Rp${(v / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return `Rp${Math.round(v)}`;
};
const n0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('id-ID'));
const pct = (v, d = 2) => (v == null ? '—' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: d })}%`);
const x = (v) => (v == null ? '—' : `${v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`);
const x2 = (v) => Math.abs(v).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const change = (now, before) => (now != null && before ? (now - before) / Math.abs(before) : null);
const fmtDay = (iso, opts = { day: 'numeric', month: 'short' }) => new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', opts);
const fmtRange = (a, b) => `${fmtDay(a)} – ${fmtDay(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;

function Delta({ now, before, inverse, abs }) {
  if (now == null || before == null || (!abs && before === 0)) return null;
  if (abs) {
    const d = now - before;
    if (Math.abs(d) < 0.005) return <span className="mo-delta is-flat">±0</span>;
    const good = inverse ? d < 0 : d > 0;
    return <span className={`mo-delta ${good ? 'is-up' : 'is-down'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString('id-ID', { maximumFractionDigits: 2 })}</span>;
  }
  const ch = (now - before) / Math.abs(before);
  if (Math.abs(ch) < 0.005) return <span className="mo-delta is-flat">±0%</span>;
  const good = inverse ? ch < 0 : ch > 0;
  return <span className={`mo-delta ${good ? 'is-up' : 'is-down'}`}>{ch > 0 ? '▲' : '▼'} {Math.abs(ch * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</span>;
}

function Chips({ value, onChange, options, label }) {
  return (
    <div className="ma-chips" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'is-on' : ''} onClick={() => onChange(id)}>{text}</button>
      ))}
    </div>
  );
}

function Card({ title, sub, aside, children, className = '' }) {
  return (
    <section className={`ma-card ${className}`}>
      {(title || aside) && (
        <header className="ma-card-head">
          <div>{title && <h3>{title}</h3>}{sub && <p>{sub}</p>}</div>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

function Insights({ items }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="ma-insights">
      <span className="ma-insights-head"><Sparkles size={14} aria-hidden="true" /> Bacaan cepat</span>
      <ul>{list.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

const dsTag = (ds) => <span key={ds} className={`ma-ds is-${ds}`}>{DATASET_META[ds].short}</span>;

// ── Business Growth ────────────────────────────────────────────────────

function DailyChart({ days }) {
  const [hover, setHover] = useState(null);
  const W = 1000, H = 240, L = 56, R = 48, T = 14, B = 26;
  const maxSpend = Math.max(1, ...days.map((d) => d.spend));
  const roasVals = days.map((d) => d.roas).filter((v) => v != null);
  const maxRoas = Math.max(1, ...roasVals) * 1.1;
  const bw = (W - L - R) / Math.max(days.length, 1);
  const y = (v) => T + (H - T - B) * (1 - v / maxSpend);
  const yr = (v) => T + (H - T - B) * (1 - v / maxRoas);
  const line = days.map((d, i) => (d.roas == null ? null : [L + bw * i + bw / 2, yr(d.roas)]));
  let path = '';
  line.forEach((p, i) => { if (!p) return; path += `${path && line[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`; });
  const ticks = [0, .5, 1].map((f) => maxSpend * f);
  const h = hover != null ? days[hover] : null;
  const labelEvery = Math.ceil(days.length / 10);
  return (
    <div className="ma-chart">
      <div className="ma-chart-readout">
        {h ? (
          <>
            <b>{fmtDay(h.day, { weekday: 'short', day: 'numeric', month: 'short' })}</b>
            {['boost', 'nonboost', 'cpas'].map((ds) => <span key={ds}><i style={{ background: DATASET_META[ds].color }} />{DATASET_META[ds].short} {rpShort(h[ds])}</span>)}
            <span>Value {rpShort(h.value)}</span>
            <span className="is-roas">ROAS {x(h.roas)}</span>
          </>
        ) : (
          <>
            {['boost', 'nonboost', 'cpas'].map((ds) => <span key={ds}><i style={{ background: DATASET_META[ds].color }} />Spend {DATASET_META[ds].short}</span>)}
            <span className="is-roas"><i className="is-line" />ROAS iklan (Non Boost + CPAS)</span>
          </>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spend harian per jenis iklan dan ROAS iklan" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="ma-grid" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="ma-axis">{rpShort(t)}</text>
          </g>
        ))}
        {[0, maxRoas / 2, maxRoas].map((t) => <text key={t} x={W - R + 8} y={yr(t) + 4} className="ma-axis is-roas">{t.toFixed(1)}x</text>)}
        {days.map((d, i) => {
          let acc = 0;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={L + bw * i} y={T} width={bw} height={H - T - B} className={`ma-hit${hover === i ? ' is-on' : ''}`} />
              {['cpas', 'nonboost', 'boost'].map((ds) => {
                const v = d[ds];
                if (!v) return null;
                const top = y(acc + v);
                const hgt = y(acc) - top;
                acc += v;
                return <rect key={ds} x={L + bw * i + bw * 0.18} width={bw * 0.64} y={top} height={Math.max(hgt, 0.5)} rx={2} fill={DATASET_META[ds].color} />;
              })}
              {i % labelEvery === 0 && <text x={L + bw * i + bw / 2} y={H - 8} textAnchor="middle" className="ma-axis">{fmtDay(d.day, { day: 'numeric' })}</text>}
            </g>
          );
        })}
        <path d={path} className="ma-roas-line" />
        {line.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 4.5 : 2.6} className="ma-roas-dot" />)}
      </svg>
    </div>
  );
}

function GrowthView({ cur, prev, range, cmp }) {
  const all = totals(cur);
  const allPrev = prev.length ? totals(prev) : null;
  const sell = totals(selling(cur));
  const sellPrev = prev.length ? totals(selling(prev)) : null;
  const ds = byDataset(cur);
  const dsPrev = prev.length ? byDataset(prev) : {};
  const days = daily(cur, range.start, range.end);

  const tiles = [
    ['Total spend Meta', rp(all.spend), all.spend, allPrev?.spend],
    ['Purchase value', rp(sell.value), sell.value, sellPrev?.value],
    ['ROAS iklan', x(sell.roas), sell.roas, sellPrev?.roas],
    ['Purchases', n0(sell.purchases), sell.purchases, sellPrev?.purchases],
    ['Cost / purchase', rp(sell.cpa), sell.cpa, sellPrev?.cpa, true],
  ];

  // Which dataset moved purchase value the most, and how spend shifted.
  const moves = SELLING.map((k) => ({ k, dv: (ds[k]?.value ?? 0) - (dsPrev[k]?.value ?? 0), ds: (ds[k]?.spend ?? 0) - (dsPrev[k]?.spend ?? 0) }))
    .sort((a, b) => Math.abs(b.dv) - Math.abs(a.dv));
  const vCh = change(sell.value, sellPrev?.value);
  const sCh = change(all.spend, allPrev?.spend);
  const best = days.filter((d) => d.roas != null && d.sellSpend > 0).sort((a, b) => b.roas - a.roas)[0];
  const insights = sellPrev ? [
    vCh != null && `Purchase value ${vCh >= 0 ? 'naik' : 'turun'} ${pct(Math.abs(vCh), 1)} (${rpShort(sell.value - sellPrev.value)}) dengan spend ${sCh >= 0 ? 'naik' : 'turun'} ${pct(Math.abs(sCh ?? 0), 1)} — ROAS iklan ${x(sellPrev.roas)} → ${x(sell.roas)}.`,
    moves[0] && moves[0].dv !== 0 && `Pergerakan terbesar dari ${DATASET_META[moves[0].k].label}: purchase value ${moves[0].dv >= 0 ? '+' : '−'}${rpShort(Math.abs(moves[0].dv))} dengan spend ${moves[0].ds >= 0 ? '+' : '−'}${rpShort(Math.abs(moves[0].ds))}.`,
    ds.boost && `Boost Post menyerap ${pct(ds.boost.spend / (all.spend || 1), 0)} spend untuk awareness — tidak dihitung di ROAS iklan.`,
    best && `Hari dengan ROAS iklan tertinggi: ${fmtDay(best.day, { weekday: 'long', day: 'numeric', month: 'short' })} (${x(best.roas)}).`,
  ] : [`Periode pembanding (${fmtRange(cmp.start, cmp.end)}) belum punya file Meta, jadi angka ditampilkan tanpa perbandingan.`];

  return (
    <div className="ma">
      <div className="ma-tiles">
        {tiles.map(([label, textValue, now, before, inverse]) => (
          <article key={label} className="ma-tile">
            <span>{label}</span>
            <strong>{textValue}</strong>
            <Delta now={now} before={before} inverse={inverse} />
          </article>
        ))}
      </div>
      <Insights items={insights} />
      <Card title="Spend harian & ROAS iklan" sub="Batang = spend per jenis iklan; garis = ROAS iklan harian (purchase value Non Boost + CPAS ÷ spend keduanya). Arahkan kursor ke hari mana pun.">
        <DailyChart days={days} />
      </Card>
      <Card title="Pertumbuhan per jenis iklan" sub="Dibanding periode pembanding.">
        <div className="ma-table-wrap">
          <table className="ma-table">
            <thead><tr><th>Jenis iklan</th><th>Spend</th><th>Porsi spend</th><th>Purchase value</th><th>ROAS</th><th>Purchases</th><th>Cost / purchase</th></tr></thead>
            <tbody>
              {Object.keys(DATASET_META).map((k) => {
                const d = ds[k];
                const p = dsPrev[k];
                const sells = SELLING.includes(k);
                return (
                  <tr key={k}>
                    <th scope="row">{dsTag(k)} {DATASET_META[k].label}</th>
                    <td>{d ? rp(d.spend) : '—'} {d && p && <Delta now={d.spend} before={p.spend} />}</td>
                    <td><span className="ma-bar"><i style={{ width: `${((d?.spend ?? 0) / (all.spend || 1)) * 100}%`, background: DATASET_META[k].color }} /></span> {pct((d?.spend ?? 0) / (all.spend || 1), 0)}</td>
                    <td>{sells && d ? rp(d.value) : '—'} {sells && d && p && <Delta now={d.value} before={p.value} />}</td>
                    <td>{sells && d ? x(d.roas) : '—'} {sells && d && p && <Delta now={d.roas} before={p.roas} />}</td>
                    <td>{sells && d ? n0(d.purchases) : '—'}</td>
                    <td>{sells && d ? rp(d.cpa) : '—'} {sells && d && p && <Delta now={d.cpa} before={p.cpa} inverse />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Traffic & Funnel ───────────────────────────────────────────────────

const FUNNEL_SETS = [['sell', 'Gabungan penjualan'], ['nonboost', 'Non Boost Post'], ['cpas', 'CPAS'], ['boost', 'Boost Post']];
const pickSet = (records, set) => (set === 'sell' ? selling(records) : records.filter((r) => r.ds === set));

function FunnelView({ cur, prev }) {
  const [set, setSet] = useSessionState('dashboard:meta-funnel-set', 'sell');
  const t = totals(pickSet(cur, set));
  const p = prev.length ? totals(pickSet(prev, set)) : null;
  const steps = set === 'boost'
    ? [['impressions', 'Impressions'], ['clicks', 'Link clicks'], ['visits', 'Profile visits']]
    : [['impressions', 'Impressions'], ['clicks', 'Link clicks'], ['views', 'Content views'], ['atc', 'Adds to cart'], ['purchases', 'Purchases']].filter(([k]) => k !== 'views' || t.views > 0);
  const rows = steps.map(([k, label], i) => {
    const prevKey = i ? steps[i - 1][0] : null;
    const rate = prevKey ? (t[prevKey] ? t[k] / t[prevKey] : null) : null;
    const ratePrev = prevKey && p ? (p[prevKey] ? p[k] / p[prevKey] : null) : null;
    return { k, label, v: t[k], vPrev: p?.[k], rate, ratePrev, cost: t[k] ? t.spend / t[k] : null, costPrev: p?.[k] ? p.spend / p[k] : null };
  });
  const top = Math.log10(Math.max(rows[0].v, 10));
  const leaks = rows.slice(1).filter((r) => r.rate != null && r.ratePrev > 0).map((r) => ({ ...r, ch: (r.rate - r.ratePrev) / r.ratePrev })).sort((a, b) => a.ch - b.ch);
  const weakest = rows.slice(1).filter((r) => r.rate != null).sort((a, b) => a.rate - b.rate)[0];
  const insights = [
    weakest && `Penurunan terbesar di langkah ke ${weakest.label}: hanya ${pct(weakest.rate)} dari langkah sebelumnya yang lanjut.`,
    leaks[0] && leaks[0].ch < -0.05 && `${leaks[0].label} melemah paling banyak dibanding pembanding: rasio ${pct(leaks[0].ratePrev)} → ${pct(leaks[0].rate)} (${pct(leaks[0].ch, 1)}).`,
    leaks.length && leaks[leaks.length - 1].ch > 0.05 && `${leaks[leaks.length - 1].label} membaik: rasio ${pct(leaks[leaks.length - 1].ratePrev)} → ${pct(leaks[leaks.length - 1].rate)}.`,
    set !== 'boost' && t.views > t.clicks && 'Content views lebih banyak dari Link clicks — Meta juga mencatat view dari jalur selain klik link (mis. katalog), jadi rasionya bisa di atas 100%.',
    p && set !== 'boost' && p.atc === 0 && t.atc > 0 && 'Periode pembanding tidak mencatat Adds to cart (file gabungan lama), jadi rasio langkah itu tidak dibandingkan.',
  ];
  return (
    <div className="ma">
      <div className="ma-toolbar">
        <Chips value={set} onChange={setSet} options={FUNNEL_SETS} label="Jenis iklan" />
        <span className="ma-toolbar-note">Spend {rp(t.spend)}{p && <> · <Delta now={t.spend} before={p.spend} /></>}</span>
      </div>
      <Insights items={insights} />
      <Card title="Funnel iklan" sub={set === 'boost' ? 'Boost Post adalah awareness: dari tayangan ke kunjungan profil.' : 'Lebar batang memakai skala log supaya langkah kecil tetap terlihat. Rasio = bagian dari langkah sebelumnya.'}>
        <ol className="ma-funnel">
          {rows.map((r, i) => {
            const v = r.v || 0;
            const w = v > 0 ? Math.max(6, (Math.log10(Math.max(v, 1)) / top) * 100) : 0;
            return (
              <li key={r.k}>
                <div className="ma-funnel-label"><b>{String(i + 1).padStart(2, '0')}</b>{r.label}</div>
                <div className="ma-funnel-bar"><i style={{ width: `${w}%` }} /></div>
                <div className="ma-funnel-value"><strong>{n0(v)}</strong>{r.vPrev ? <Delta now={v} before={r.vPrev} /> : null}</div>
                <div className="ma-funnel-rate">
                  {r.rate != null ? <><strong>{pct(r.rate)}</strong>{r.ratePrev ? <Delta now={r.rate} before={r.ratePrev} /> : null}</> : <span className="ma-muted">awal funnel</span>}
                </div>
                <div className="ma-funnel-cost">{rp(r.cost)} <small>/ {r.label.toLowerCase()}</small></div>
              </li>
            );
          })}
        </ol>
      </Card>
      {set !== 'boost' && (
        <div className="ma-mini">
          {[['CTR link', pct(t.ctr), t.ctr, p?.ctr], ['CPM', rp(t.cpm), t.cpm, p?.cpm, true], ['CPC', rp(t.cpc), t.cpc, p?.cpc, true], ['Cost / ATC', rp(t.costPerAtc), t.costPerAtc, p?.costPerAtc, true], ['AOV', rp(t.aov), t.aov, p?.aov]].map(([label, v, now, before, inv]) => (
            <article key={label} className="ma-tile is-mini"><span>{label}</span><strong>{v}</strong><Delta now={now} before={before} inverse={inv} /></article>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Audience ───────────────────────────────────────────────────────────

const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'Unknown'];

function SegmentTable({ title, rows, total, boost, sortAge }) {
  const list = sortAge ? [...rows].sort((a, b) => AGE_ORDER.indexOf(a.key) - AGE_ORDER.indexOf(b.key)) : rows;
  const bestRoas = boost ? null : Math.max(...rows.filter((r) => r.spend > total.spend * 0.03).map((r) => r.roas ?? 0));
  return (
    <Card title={title}>
      <div className="ma-table-wrap">
        <table className="ma-table">
          <thead>
            <tr><th>Segmen</th><th>Porsi spend</th><th>Spend</th>{boost ? <><th>Profile visits</th><th>Cost / visit</th><th>CTR</th></> : <><th>Purchase value</th><th>ROAS</th><th>Purchases</th><th>Cost / purchase</th></>}</tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.key} className={!boost && r.roas === bestRoas && bestRoas > 0 ? 'is-best' : ''}>
                <th scope="row">{r.key}</th>
                <td><span className="ma-bar"><i style={{ width: `${(r.spend / (total.spend || 1)) * 100}%` }} /></span> {pct(r.spend / (total.spend || 1), 0)}</td>
                <td>{rp(r.spend)}</td>
                {boost ? <><td>{n0(r.visits)}</td><td>{rp(r.costPerVisit)}</td><td>{pct(r.ctr)}</td></>
                  : <><td>{rp(r.value)}</td><td><b>{x(r.roas)}</b></td><td>{n0(r.purchases)}</td><td>{rp(r.cpa)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AudienceView({ cur }) {
  const [set, setSet] = useSessionState('dashboard:meta-audience-set', 'sell');
  const records = pickSet(cur, set);
  const t = totals(records);
  const ages = groupBy(records, 'age');
  const genders = groupBy(records, 'gender');
  const boost = set === 'boost';
  const meaningful = ages.filter((a) => a.spend > t.spend * 0.05 && a.key !== 'Unknown');
  const topSpend = meaningful[0];
  const bestEff = boost
    ? [...meaningful].sort((a, b) => (a.costPerVisit ?? Infinity) - (b.costPerVisit ?? Infinity))[0]
    : [...meaningful].sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0];
  const insights = [
    topSpend && `Umur ${topSpend.key} menyerap ${pct(topSpend.spend / (t.spend || 1), 0)} spend${boost ? '' : ` dengan ROAS ${x(topSpend.roas)}`}.`,
    bestEff && bestEff !== topSpend && (boost
      ? `Kunjungan profil termurah dari umur ${bestEff.key} (${rp(bestEff.costPerVisit)} / visit) dengan ${pct(bestEff.spend / (t.spend || 1), 0)} spend.`
      : `ROAS tertinggi di umur ${bestEff.key} (${x(bestEff.roas)}) yang baru mendapat ${pct(bestEff.spend / (t.spend || 1), 0)} spend — kandidat tambahan budget.`),
    genders[0] && `${genders[0].key === 'female' ? 'Perempuan' : genders[0].key === 'male' ? 'Laki-laki' : 'Gender tak diketahui'} mendapat ${pct(genders[0].spend / (t.spend || 1), 0)} spend${boost ? '' : ` (ROAS ${x(genders[0].roas)})`}.`,
  ];
  if (!records.length) return <div className="ma"><div className="ma-toolbar"><Chips value={set} onChange={setSet} options={FUNNEL_SETS} label="Jenis iklan" /></div><p className="mo-state">Belum ada data untuk jenis iklan ini pada periode ini.</p></div>;
  return (
    <div className="ma">
      <div className="ma-toolbar"><Chips value={set} onChange={setSet} options={FUNNEL_SETS} label="Jenis iklan" /></div>
      <Insights items={insights} />
      <div className="ma-split">
        <SegmentTable title="Per umur" rows={ages} total={t} boost={boost} sortAge />
        <SegmentTable title="Per gender" rows={genders.map((g) => ({ ...g, key: g.key === 'female' ? 'Perempuan' : g.key === 'male' ? 'Laki-laki' : 'Tidak diketahui' }))} total={t} boost={boost} />
      </div>
    </div>
  );
}

// ── Campaign Performance ───────────────────────────────────────────────

const LEVELS = [['campaign', 'Campaign'], ['adset', 'Ad set'], ['ad', 'Iklan']];
const CAMP_SETS = [['all', 'Semua'], ['nonboost', 'Non Boost'], ['cpas', 'CPAS'], ['boost', 'Boost']];

function CampaignView({ cur, prev }) {
  const [level, setLevel] = useSessionState('dashboard:meta-camp-level', 'campaign');
  const [set, setSet] = useSessionState('dashboard:meta-camp-set', 'all');
  const [sort, setSort] = useState({ key: 'spend', dir: -1 });
  const [all, setAll] = useState(false);
  const records = set === 'all' ? cur : cur.filter((r) => r.ds === set);
  const prevMap = useMemo(() => new Map(groupBy(set === 'all' ? prev : prev.filter((r) => r.ds === set), level).map((g) => [g.key, g])), [prev, set, level]);
  const t = totals(records);
  const sellT = totals(selling(records));
  const rows = groupBy(records, level).map((g) => {
    const sells = g.ds.some((d) => SELLING.includes(d));
    const share = g.spend / (t.spend || 1);
    let flag = null;
    if (sells && share >= 0.04 && sellT.roas) {
      if ((g.roas ?? 0) >= sellT.roas * 1.4 && g.purchases >= 3) flag = 'star';
      else if ((g.roas ?? 0) < sellT.roas * 0.5) flag = 'drain';
    }
    return { ...g, sells, share, prev: prevMap.get(g.key), flag };
  });
  const sorted = [...rows].sort((a, b) => ((a[sort.key] ?? -Infinity) - (b[sort.key] ?? -Infinity)) * sort.dir);
  const shown = all ? sorted : sorted.slice(0, 15);
  const stars = rows.filter((r) => r.flag === 'star');
  const drains = rows.filter((r) => r.flag === 'drain');
  const name = LEVELS.find((l) => l[0] === level)[1].toLowerCase();
  const insights = [
    rows[0] && `${rows.length} ${name} aktif; 3 teratas menyerap ${pct(rows.slice(0, 3).reduce((a, r) => a + r.spend, 0) / (t.spend || 1), 0)} spend.`,
    stars.length > 0 && `${stars.length} ${name} berkinerja menonjol (ROAS ≥ 1,4× rata-rata ${x(sellT.roas)}): ${stars.slice(0, 2).map((r) => `"${r.key}" ${x(r.roas)}`).join(', ')}.`,
    drains.length > 0 && `${drains.length} ${name} menyerap ${pct(drains.reduce((a, r) => a + r.spend, 0) / (t.spend || 1), 0)} spend dengan ROAS di bawah separuh rata-rata — evaluasi atau alihkan budgetnya.`,
  ];
  const head = (key, label) => (
    <th aria-sort={sort.key === key ? (sort.dir < 0 ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className={`ma-sort${sort.key === key ? ' is-on' : ''}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
        {label}{sort.key === key && (sort.dir < 0 ? ' ↓' : ' ↑')}
      </button>
    </th>
  );
  return (
    <div className="ma">
      <div className="ma-toolbar">
        <Chips value={level} onChange={(v) => { setLevel(v); setAll(false); }} options={LEVELS} label="Level" />
        <Chips value={set} onChange={(v) => { setSet(v); setAll(false); }} options={CAMP_SETS} label="Jenis iklan" />
      </div>
      <Insights items={insights} />
      <Card title={`Performa per ${name}`} sub="Bintang = ROAS ≥ 1,4× rata-rata dengan ≥ 4% spend; Boros = ROAS < 0,5× rata-rata dengan ≥ 4% spend. Klik judul kolom untuk mengurutkan.">
        <div className="ma-table-wrap">
          <table className="ma-table is-wide">
            <thead>
              <tr>
                <th className="is-name">{LEVELS.find((l) => l[0] === level)[1]}</th>
                {head('spend', 'Spend')}{head('share', 'Porsi')}{head('value', 'Purchase value')}{head('roas', 'ROAS')}{head('purchases', 'Purchases')}{head('cpa', 'Cost / purchase')}{head('ctr', 'CTR')}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className={r.flag ? `is-${r.flag}` : ''}>
                  <th scope="row" className="is-name">
                    <span className="ma-name" title={r.key}>{r.key}</span>
                    <span className="ma-name-tags">{r.ds.map(dsTag)}{r.flag === 'star' && <span className="ma-flag is-star">Bintang</span>}{r.flag === 'drain' && <span className="ma-flag is-drain">Boros</span>}{!r.prev && prev.length > 0 && <span className="ma-flag is-new">Baru</span>}</span>
                  </th>
                  <td>{rp(r.spend)} {r.prev && <Delta now={r.spend} before={r.prev.spend} />}</td>
                  <td>{pct(r.share, 1)}</td>
                  <td>{r.sells ? rp(r.value) : '—'}</td>
                  <td>{r.sells ? <b>{x(r.roas)}</b> : '—'} {r.sells && r.prev?.roas != null && <Delta now={r.roas} before={r.prev.roas} />}</td>
                  <td>{r.sells ? n0(r.purchases) : '—'}</td>
                  <td>{r.sells ? rp(r.cpa) : '—'}</td>
                  <td>{pct(r.ctr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sorted.length > 15 && (
          <button type="button" className="ma-more" onClick={() => setAll((v) => !v)}>{all ? 'Tampilkan 15 teratas' : `Tampilkan semua (${sorted.length})`}</button>
        )}
      </Card>
    </div>
  );
}

// ── Root Cause ─────────────────────────────────────────────────────────

const RC_SETS = [['sell', 'Gabungan penjualan'], ['nonboost', 'Non Boost Post'], ['cpas', 'CPAS']];

function Waterfall({ d }) {
  const steps = [{ label: 'ROAS pembanding', v: d.roasBefore, base: true }, ...d.parts.map((p) => ({ label: p.label, v: p.effect ?? 0 })), { label: 'ROAS periode ini', v: d.roasNow, base: true }];
  let run = 0;
  const bars = steps.map((s) => {
    if (s.base) { run = s.v; return { ...s, from: 0, to: s.v }; }
    const from = run; run += s.v; return { ...s, from, to: run };
  });
  const max = Math.max(...bars.map((b) => Math.max(b.from, b.to))) * 1.12;
  return (
    <div className="ma-wf" role="img" aria-label="Pergerakan ROAS per komponen">
      {bars.map((b) => {
        const lo = Math.min(b.from, b.to);
        const hi = Math.max(b.from, b.to);
        return (
          <div key={b.label} className={`ma-wf-col${b.base ? ' is-base' : b.v >= 0 ? ' is-up' : ' is-down'}`}>
            <div className="ma-wf-track">
              <i style={{ bottom: `${(lo / max) * 100}%`, height: `${Math.max(((hi - lo) / max) * 100, 0.8)}%` }} />
              <em style={{ bottom: `${(hi / max) * 100}%` }}>{b.base ? x(b.v) : `${b.v >= 0 ? '+' : '−'}${x2(b.v)}`}</em>
            </div>
            <span>{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function RootCauseView({ cur, prev, cmp }) {
  const [set, setSet] = useSessionState('dashboard:meta-rc-set', 'sell');
  const t = totals(pickSet(cur, set));
  const p = prev.length ? totals(pickSet(prev, set)) : null;
  const d = roasDrivers(t, p);
  if (!p) {
    return <div className="ma"><div className="ma-toolbar"><Chips value={set} onChange={setSet} options={RC_SETS} label="Jenis iklan" /></div>
      <p className="mo-state">Root cause butuh periode pembanding. {fmtRange(cmp.start, cmp.end)} belum punya file Meta di Data Collection Hub.</p></div>;
  }
  if (!d) return <div className="ma"><div className="ma-toolbar"><Chips value={set} onChange={setSet} options={RC_SETS} label="Jenis iklan" /></div><p className="mo-state">ROAS salah satu periode kosong — belum ada purchase value yang tercatat.</p></div>;
  const ranked = [...d.parts].filter((x2) => x2.effect != null).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  // The main cause pushes ROAS the way it actually moved; the counterweight
  // is the biggest push the other way.
  const dir = Math.sign(d.dRoas) || 1;
  const main = ranked.find((r) => Math.sign(r.effect) === dir);
  const counter = ranked.find((r) => Math.sign(r.effect) === -dir && Math.abs(r.effect) > 0.02);
  const moved = (r) => `${r.say} ${r.change >= 0 ? 'naik' : 'turun'} ${pct(Math.abs(r.change ?? 0), 1)}`;
  const insights = [
    `ROAS iklan ${d.dRoas >= 0 ? 'naik' : 'turun'} ${x2(d.dRoas)} poin (${x(d.roasBefore)} → ${x(d.roasNow)}).`,
    main && `Penyebab utama: ${moved(main)}, menggeser ROAS ${main.effect >= 0 ? '+' : '−'}${x2(main.effect)}.`,
    counter && `Tertahan oleh ${moved(counter)} yang mendorong ke arah sebaliknya (${counter.effect >= 0 ? '+' : '−'}${x2(counter.effect)}).`,
    set === 'sell' && SELLING.some((k) => !byDataset(prev)[k]) && 'Periode pembanding belum punya salah satu jenis iklan (lihat Bauran spend) — sebagian perubahan berasal dari bauran, bukan dari performa iklan yang sama.',
  ];
  const ds = byDataset(cur);
  const dsPrev = byDataset(prev);
  const sellNow = SELLING.reduce((a, k) => a + (ds[k]?.spend ?? 0), 0);
  const sellBefore = SELLING.reduce((a, k) => a + (dsPrev[k]?.spend ?? 0), 0);
  const fmt = { cpm: rp, ctr: (v) => pct(v), cvr: (v) => pct(v), aov: rp };
  return (
    <div className="ma">
      <div className="ma-toolbar">
        <Chips value={set} onChange={setSet} options={RC_SETS} label="Jenis iklan" />
        <span className="ma-toolbar-note">ROAS = (tayangan ÷ spend) × CTR × konversi × AOV</span>
      </div>
      <Insights items={insights} />
      <div className="ma-split is-rc">
        <Card title="Dari ROAS pembanding ke ROAS sekarang" sub="Tiap batang = efek satu komponen; jumlahnya persis sama dengan perubahan ROAS.">
          <Waterfall d={d} />
        </Card>
        <Card title="Komponen ROAS">
          <ul className="ma-drivers">
            {d.parts.map((part) => (
              <li key={part.key} className={part.effect == null ? '' : part.effect >= 0 ? 'is-up' : 'is-down'}>
                <div>
                  <strong>{part.label}</strong>
                  <small>{part.hint}</small>
                </div>
                <div className="ma-driver-vals">
                  <span>{fmt[part.key](part.before)} → <b>{fmt[part.key](part.now)}</b></span>
                  <Delta now={part.now} before={part.before} inverse={part.inverse} />
                </div>
                <div className="ma-driver-effect">
                  {part.effect == null ? '—' : <>{part.effect >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{part.effect >= 0 ? '+' : '−'}{x2(part.effect)}x</>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {set === 'sell' && (
        <Card title="Bauran spend" sub="ROAS gabungan juga bergeser bila porsi spend pindah antara Non Boost Post dan CPAS.">
          <div className="ma-table-wrap">
            <table className="ma-table">
              <thead><tr><th>Jenis iklan</th><th>Porsi spend pembanding</th><th>Porsi spend sekarang</th><th>ROAS pembanding</th><th>ROAS sekarang</th></tr></thead>
              <tbody>
                {SELLING.map((k) => (
                  <tr key={k}>
                    <th scope="row">{dsTag(k)} {DATASET_META[k].label}</th>
                    <td>{pct((dsPrev[k]?.spend ?? 0) / (sellBefore || 1), 0)}</td>
                    <td>{pct((ds[k]?.spend ?? 0) / (sellNow || 1), 0)}</td>
                    <td>{x(dsPrev[k]?.roas)}</td>
                    <td><b>{x(ds[k]?.roas)}</b> {dsPrev[k]?.roas != null && <Delta now={ds[k]?.roas} before={dsPrev[k].roas} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────

export default function MetaAnalysis({ view, filters }) {
  const [mode] = useSessionState('dashboard:meta-source', 'auto');
  const [state, setState] = useState({ status: 'idle' });
  const cmp = comparisonRange(filters);
  const { brandId, startDate, endDate } = filters;

  useEffect(() => {
    if (!brandId) return undefined;
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    Promise.all([loadMetaRecords(brandId, startDate, endDate, mode), loadMetaRecords(brandId, cmp.start, cmp.end, mode)])
      .then(([cur, prev]) => alive && setState({ status: 'ready', cur, prev }))
      .catch(() => alive && setState({ status: 'error' }));
    return () => { alive = false; };
  }, [brandId, startDate, endDate, cmp.start, cmp.end, mode]);

  if (!brandId) return <p className="mo-state">Pilih brand terlebih dahulu.</p>;
  if (state.status === 'error') return <p className="mo-state is-error">File Meta tidak dapat dibaca. Coba muat ulang halaman.</p>;
  if (!state.cur) return <p className="mo-state"><Loader2 size={15} className="mo-spin" /> Membaca file Boost Post, Non Boost Post, dan CPAS…</p>;

  const cur = state.cur.records;
  const prev = state.prev.records;
  const range = { start: startDate, end: endDate };
  if (!cur.length) {
    return (
      <div className="mo-empty">
        <strong>Belum ada file Meta untuk {fmtRange(startDate, endDate)}</strong>
        <p>Unggah Boost Post, Non Boost Post, atau CPAS — atau aktifkan Tarik data API — di Data Collection Hub. File gabungan lama tidak diperlukan.</p>
        <Link to="/data-brand" className="mom-head-link">Buka Data Collection Hub <ArrowUpRight size={13} /></Link>
      </div>
    );
  }
  const legacyUsed = [...state.cur.monthSources, ...state.prev.monthSources].filter((m) => m.used === 'legacy').map((m) => m.month);
  const gaps = SELLING.filter((c) => !cur.some((r) => r.ds === c));

  return (
    <div className={`ma-shell${state.status === 'loading' ? ' is-loading' : ''}`}>
      <div className="ma-period">
        <span><b>Periode</b> {fmtRange(startDate, endDate)}</span>
        <span><b>Pembanding</b> {fmtRange(cmp.start, cmp.end)}{cmp.auto && <em>otomatis — atur di Bandingkan</em>}</span>
        {legacyUsed.length > 0 && <span className="is-legacy">Bulan {legacyUsed.join(', ')} dibaca dari file gabungan lama, dipisah ke Boost / Non Boost</span>}
        {gaps.length > 0 && <span className="is-gap"><TriangleAlert size={13} /> Belum ada file {gaps.map((c) => DATASET_META[c].label).join(' & ')} di periode ini</span>}
      </div>
      {view === 'growth' && <GrowthView cur={cur} prev={prev} range={range} cmp={cmp} />}
      {view === 'funnel' && <FunnelView cur={cur} prev={prev} />}
      {view === 'audience' && <AudienceView cur={cur} />}
      {view === 'campaign' && <CampaignView cur={cur} prev={prev} />}
      {view === 'rootcause' && <RootCauseView cur={cur} prev={prev} cmp={cmp} />}
    </div>
  );
}
