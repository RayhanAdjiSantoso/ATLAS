import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, Minus, Sparkles } from 'lucide-react';
import { TrendPairChart, fmtJt, fmtNum, fmtPct, fmtX, monthShort } from './charts.jsx';

// Atribusi › the consultant's bottom-up reading: Benang Merah (the chain),
// Funnel (where it leaked), Korelasi (the old 83 two-line charts, scored),
// and Campaign & Audiens (NV/RM × goal groups and their anomalies). All of
// it is correlation read off the shop's and the ads' own daily numbers —
// no AI, and labelled as a link, not as proof of cause.

const STRENGTH = {
  kuat: { label: 'kuat', cls: 'is-strong' },
  sedang: { label: 'sedang', cls: 'is-mid' },
  lemah: { label: 'lemah', cls: 'is-weak' },
  'tidak ada': { label: 'tidak ada', cls: 'is-none' },
  berlawanan: { label: 'berlawanan', cls: 'is-inverse' },
};
const fmtUnit = (unit, v) => (v == null ? '—' : unit === 'idr' ? fmtJt(v) : unit === 'pct' ? fmtPct(v, 2) : unit === 'ratio' ? fmtNum(v, 2) : fmtNum(v));
const genderLabel = (g) => (g === 'female' ? 'Perempuan' : g === 'male' ? 'Laki-laki' : 'Tak diketahui');

function Chip({ strength }) {
  const s = STRENGTH[strength] ?? STRENGTH['tidak ada'];
  return <span className={`atr-strength ${s.cls}`}>{s.label}</span>;
}

function Change({ value, sentiment = 'higher' }) {
  if (value == null) return <span className="atr-null" title="Tidak bisa dihitung">—</span>;
  const good = sentiment === 'neutral' ? null : sentiment === 'higher' ? value > 0 : value < 0;
  const flat = Math.abs(value) < 0.005;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`atr-delta ${flat || good == null ? 'is-flat' : good ? 'is-good' : 'is-bad'}`}>
      <Icon size={11} strokeWidth={2.6} aria-hidden="true" />
      {value > 0 ? '+' : value < 0 ? '−' : ''}
      {fmtPct(Math.abs(value))}
    </span>
  );
}

// ── Driver ranking rows (channel / campaign steps) ───────────────────────
function DriverRows({ rows, onOpen, target, extra }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.score)), 0.01);
  return (
    <div className="atr-table-wrap">
      <table className="atr-table">
        <thead>
          <tr>
            <th>Penggerak</th>
            <th>Hubungan</th>
            <th title="Skor gabungan: korelasi level dan korelasi perubahan mingguan (Spearman)">Skor</th>
            <th title="Seberapa rapat dua garis bergerak (z-score) — 100% = berimpit">Kemiripan garis</th>
            <th title="Berapa hari penggerak mendahului metrik">Jeda</th>
            <th>Perubahan penggerak</th>
            <th title="Penggerak dan metrik bergerak sesuai arah hubungannya di dua bulan yang dibandingkan">Searah</th>
            {extra && <th>{extra.head}</th>}
            <th aria-label="Lihat grafik" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.driver}>
              <th scope="row" className="atr-wrap">{r.label}</th>
              <td><Chip strength={r.strength} /></td>
              <td>
                <span className="atr-scorebar"><i className={r.score < 0 ? 'is-neg' : ''} style={{ width: `${(Math.abs(r.score) / max) * 100}%` }} /></span>
                {fmtNum(r.score, 2)}
              </td>
              <td>{fmtPct(r.similarity, 0)}</td>
              <td>{r.lag ? `${r.lag} hari` : 'hari yang sama'}</td>
              <td><Change value={r.driverChange} sentiment="neutral" /></td>
              <td>{r.agrees ? <Check size={15} className="atr-ok-icon" aria-label="Searah" /> : <span className="atr-muted">tidak</span>}</td>
              {extra && <td className="atr-wrap">{extra.cell(r)}</td>}
              <td><button type="button" className="atr-link" onClick={() => onOpen(target, r.driver)}>Grafik <ArrowRight size={12} aria-hidden="true" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Funnel stages table ──────────────────────────────────────────────────
export function FunnelStages({ leak }) {
  return (
    <div className="atr-table-wrap">
      <table className="atr-table">
        <thead>
          <tr><th>Tahap</th><th>{monthShort(leak.from)}</th><th>{monthShort(leak.to)}</th><th>Perubahan</th><th title="Dampak ke revenue (LMDI) — jumlah semua tahap + jumlah hari = selisih revenue">Dampak ke revenue</th></tr>
        </thead>
        <tbody>
          {leak.stages.map((s) => (
            <tr key={s.key} className={leak.leak?.key === s.key ? 'is-worst' : ''}>
              <th scope="row">
                {s.label}
                {s.monthlyOnly && <small> · dari Product Performance bulanan</small>}
              </th>
              <td>{fmtUnit(s.unit, s.from)}</td>
              <td>{fmtUnit(s.unit, s.to)}</td>
              <td><Change value={s.change} /></td>
              <td>{s.rupiah == null ? <span className="atr-muted">bagian dari CR</span> : <b className={s.rupiah >= 0 ? 'atr-up' : 'atr-down'}>{s.rupiah >= 0 ? '+' : '−'}{fmtJt(Math.abs(s.rupiah))}</b>}</td>
            </tr>
          ))}
          {leak.daysRupiah != null && Math.abs(leak.daysRupiah) > 0 && (
            <tr>
              <th scope="row">Jumlah hari ({leak.daysFrom} → {leak.daysTo})</th>
              <td colSpan={3} />
              <td><b className={leak.daysRupiah >= 0 ? 'atr-up' : 'atr-down'}>{leak.daysRupiah >= 0 ? '+' : '−'}{fmtJt(Math.abs(leak.daysRupiah))}</b></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── 1. The chain ─────────────────────────────────────────────────────────
export function ThreadView({ thread, monthly, compare, onCompare, onOpenPair }) {
  const pairs = monthly.slice(1).map((m, i) => ({ from: monthly[i].month, to: m.month }));
  const current = thread.months ? `${thread.months.from}|${thread.months.to}` : '';
  const target = thread.target;
  if (!thread.steps.length) return <div className="atr-empty">Belum cukup data untuk ditelusuri.</div>;
  return (
    <div className="atr-thread">
      <div className="atr-thread-head">
        <p>
          Ditelusuri dari bawah ke atas, seperti cara konsultan: revenue → channel penjualan → tahap funnel yang bocor → channel iklan yang bergerak bersamanya → kelompok campaign → audiens. Setiap “hubungan” adalah korelasi tren harian (7 hari bergulir), bukan bukti sebab-akibat.
        </p>
        <label className="atr-field">
          <span>Bandingkan</span>
          <select value={compare ?? current} onChange={(e) => onCompare(e.target.value)}>
            {pairs.map((p) => <option key={`${p.from}|${p.to}`} value={`${p.from}|${p.to}`}>{monthShort(p.from)} → {monthShort(p.to)}</option>)}
          </select>
        </label>
      </div>
      <ol className="atr-steps">
        {thread.steps.map((s, i) => (
          <li key={`${s.level}-${i}`} className={`atr-step is-${s.level}`}>
            <span className="atr-step-num" aria-hidden="true">{s.level === 'anomaly' ? <Sparkles size={14} /> : i + 1}</span>
            <div className="atr-step-body">
              <span className="atr-step-title">{s.title}</span>
              <h3>{s.question}</h3>
              {s.answer && <p className="atr-step-answer">{s.answer}</p>}

              {s.level === 'revenue' && s.rows?.length > 0 && (
                <div className="atr-table-wrap">
                  <table className="atr-table is-compact">
                    <thead><tr><th>Channel penjualan</th><th>{monthShort(thread.months.from)}</th><th>{monthShort(thread.months.to)}</th><th>Selisih</th><th /></tr></thead>
                    <tbody>
                      {s.rows.map((r) => (
                        <tr key={r.key} className={r.key === s.focus ? 'is-focus' : ''}>
                          <th scope="row">{r.label}</th>
                          <td>{fmtJt(r.from)}</td>
                          <td>{fmtJt(r.to)}</td>
                          <td><b className={r.change >= 0 ? 'atr-up' : 'atr-down'}>{r.change >= 0 ? '+' : '−'}{fmtJt(Math.abs(r.change))}</b></td>
                          <td>{r.spike ? <span className="atr-tag is-proxy" title="Lebih dari separuh revenue bulan itu datang dari 1–2 hari">lonjakan 1–2 hari</span> : r.key === s.focus ? <span className="atr-tag is-est">ditelusuri</span> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {s.level === 'funnel' && s.leak && <FunnelStages leak={s.leak} />}

              {(s.level === 'channel' || (s.level === 'campaign' && s.rows?.length)) && s.rows?.length > 0 && (
                <DriverRows
                  rows={s.rows.slice(0, 8)}
                  target={target}
                  onOpen={onOpenPair}
                  extra={s.level === 'campaign' && s.rows[0]?.metricsTo ? {
                    head: `Biaya per hasil ${monthShort(thread.months.from)} → ${monthShort(thread.months.to)}`,
                    cell: (r) => {
                      const key = { atc: 'cpatc', purchase: 'cpp', vc: 'cpv' }[r.primary] ?? 'cpc';
                      const name = { cpatc: 'CPATC', cpp: 'CPP', cpv: 'CPV', cpc: 'CPC' }[key];
                      return <span>{name} {fmtJt(r.metricsFrom?.[key])} → {fmtJt(r.metricsTo?.[key])}{r.campaignCount ? <small className="atr-muted"> · {r.campaignCount} campaign</small> : null}</span>;
                    },
                  } : null}
                />
              )}

              {s.level === 'audience' && s.audiences?.rows.length > 0 && (
                <div className="atr-table-wrap">
                  <table className="atr-table is-compact">
                    <thead><tr><th>Audiens</th><th>Share spend</th><th>{s.audiences.resultLabel}</th><th>{s.audiences.costLabel}</th><th>vs rata-rata kelompok</th><th>ROAS klaim</th></tr></thead>
                    <tbody>
                      {s.audiences.rows.map((a) => (
                        <tr key={`${a.age}${a.gender}`}>
                          <th scope="row">{genderLabel(a.gender)} {a.age}</th>
                          <td>{fmtPct(a.spendShare, 0)}</td>
                          <td>{fmtNum(a.results)}</td>
                          <td>{fmtJt(a.cost)}</td>
                          <td><Change value={a.vsGroup} sentiment="lower" /></td>
                          <td>{fmtX(a.roas)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── 3. Correlation matrix + the two-line chart ───────────────────────────
export function CorrelationView({ thread, pair, onPair }) {
  const [grain, setGrain] = useState('weekly');
  const [mode, setMode] = useState('axes');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const cell = useMemo(() => new Map(thread.matrix.map((m) => [`${m.target}|${m.driver}`, m])), [thread.matrix]);
  const outcomes = thread.outcomes.filter((o) => outcomeFilter === 'all' || o.group === outcomeFilter);
  const groups = [...new Set(thread.drivers.map((d) => d.group))];
  const series = useMemo(() => new Map(thread.series.map((s) => [s.key, s])), [thread.series]);
  const selected = pair ? cell.get(`${pair.target}|${pair.driver}`) : null;
  const t = pair ? series.get(pair.target) : null;
  const d = pair ? series.get(pair.driver) : null;
  const outcomeGroups = [...new Set(thread.outcomes.map((o) => o.group))];

  return (
    <div className="atr-corr">
      {t && d && (
        <div className="atr-pair">
          <div className="atr-pair-head">
            <div>
              <span className="atr-step-title">Grafik dua garis</span>
              <h3>{d.label} <span className="atr-muted">vs</span> {t.label}</h3>
            </div>
            <div className="atr-pair-controls">
              <div className="atr-seg" role="group" aria-label="Skala waktu">
                {[['weekly', 'Mingguan'], ['monthly', 'Bulanan']].map(([k, l]) => <button key={k} type="button" className={grain === k ? 'is-on' : ''} aria-pressed={grain === k} onClick={() => setGrain(k)}>{l}</button>)}
              </div>
              <div className="atr-seg" role="group" aria-label="Tampilan">
                {[['axes', 'Dua sumbu'], ['index', 'Indeks (gap)']].map(([k, l]) => <button key={k} type="button" className={mode === k ? 'is-on' : ''} aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>)}
              </div>
            </div>
          </div>
          {selected && (
            <div className="atr-pair-stats">
              <div><span>Hubungan</span><Chip strength={selected.strength} /></div>
              <div><span>Kemiripan garis</span><strong>{fmtPct(selected.similarity, 0)}</strong></div>
              <div><span>Korelasi level</span><strong>{fmtNum(selected.r, 2)}</strong></div>
              <div><span>Korelasi perubahan</span><strong>{selected.rChange == null ? '—' : fmtNum(selected.rChange, 2)}</strong></div>
              <div><span>Jeda</span><strong>{selected.lag ? `${selected.lag} hari` : 'hari sama'}</strong></div>
              <div><span>Hari dibandingkan</span><strong>{fmtNum(selected.n)}</strong></div>
            </div>
          )}
          <TrendPairChart target={t} driver={d} grain={grain} mode={mode} />
          <p className="atr-note">
            {mode === 'index'
              ? 'Kedua garis diubah ke skala yang sama (z-score). Area kuning = gap: makin tipis, makin erat hubungannya.'
              : 'Garis hitam = metrik, garis biru putus-putus = penggerak, masing-masing dengan sumbunya sendiri — seperti grafik di spreadsheet lama.'}
            {' '}Korelasi perubahan mengukur apakah naik-turunnya mingguan juga sejalan, jadi dua garis yang hanya sama-sama naik pelan tidak dianggap terhubung.
          </p>
        </div>
      )}

      <div className="atr-corr-head">
        <p>Setiap sel = satu grafik dua garis dari cara lama, sudah dinilai. Klik sel untuk membuka grafiknya.</p>
        <div className="atr-seg" role="group" aria-label="Kelompok metrik">
          {[['all', 'Semua'], ...outcomeGroups.map((g) => [g, g])].map(([k, l]) => <button key={k} type="button" className={outcomeFilter === k ? 'is-on' : ''} aria-pressed={outcomeFilter === k} onClick={() => setOutcomeFilter(k)}>{l}</button>)}
        </div>
      </div>
      <div className="atr-table-wrap">
        <table className="atr-heat">
          <thead>
            <tr>
              <th className="atr-heat-corner">Penggerak ↓ · Metrik →</th>
              {outcomes.map((o) => <th key={o.key} className={o.key === thread.target ? 'is-target' : ''}><span>{o.label}</span></th>)}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g}>
              <tr className="atr-heat-group"><th colSpan={outcomes.length + 1}>{g}</th></tr>
              {thread.drivers.filter((dr) => dr.group === g).map((dr) => (
                <tr key={dr.key}>
                  <th scope="row" className="atr-wrap">{dr.label}</th>
                  {outcomes.map((o) => {
                    const m = cell.get(`${o.key}|${dr.key}`);
                    if (!m) return <td key={o.key} className="atr-heat-na" title="Data tidak cukup bervariasi untuk dinilai">·</td>;
                    const on = pair?.target === o.key && pair?.driver === dr.key;
                    const alpha = Math.min(Math.abs(m.score), 1);
                    const bg = m.score >= 0 ? `rgba(30, 62, 184, ${0.08 + alpha * 0.72})` : `rgba(124, 58, 237, ${0.08 + alpha * 0.5})`;
                    return (
                      <td key={o.key}>
                        <button
                          type="button"
                          className={`atr-heat-cell${on ? ' is-on' : ''}${alpha > 0.45 ? ' is-dark' : ''}`}
                          style={{ background: bg }}
                          onClick={() => onPair({ target: o.key, driver: dr.key })}
                          title={`${dr.label} vs ${o.label}: hubungan ${m.strength}, skor ${m.score.toFixed(2)}, kemiripan ${Math.round(m.similarity * 100)}%${m.lag ? `, jeda ${m.lag} hari` : ''}`}
                        >
                          {m.score.toLocaleString('id-ID', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="atr-note">Biru = bergerak searah (makin pekat makin kuat), ungu = berlawanan arah. Skor 0,55 ke atas = kuat, 0,35 = sedang, 0,15 = lemah. Penggerak yang aktif kurang dari 21 hari tidak dinilai.</p>
    </div>
  );
}

// ── 4. Campaign groups & anomalies ───────────────────────────────────────
export function CampaignView({ thread }) {
  const months = [...new Set(thread.groups.flatMap((g) => g.byMonth.map((m) => m.month)))].sort();
  const [month, setMonth] = useState(thread.months?.to ?? months.at(-1));
  const prevMonth = months[months.indexOf(month) - 1];
  const rows = thread.groups
    .map((g) => ({ g, cur: g.byMonth.find((m) => m.month === month), prev: g.byMonth.find((m) => m.month === prevMonth) }))
    .filter((x) => x.cur && x.cur.spend > 0)
    .sort((a, b) => b.cur.spend - a.cur.spend);
  const COLS = [
    ['spend', 'Spend', 'idr', 'neutral'],
    ['cpm', 'CPM', 'idr', 'lower'],
    ['ctr', 'CTR', 'pct', 'higher'],
    ['cpc', 'CPC', 'idr', 'lower'],
    ['cpv', 'Cost/View Content', 'idr', 'lower'],
    ['cpatc', 'Cost/ATC', 'idr', 'lower'],
    ['cpp', 'Cost/Purchase', 'idr', 'lower'],
    ['roas', 'ROAS klaim', 'x', 'higher'],
  ];
  const fmt = (unit, v) => (v == null ? <span className="atr-null" title="Tidak ada hasil ini">—</span> : unit === 'x' ? fmtX(v) : fmtUnit(unit, v));
  const chg = (a, b) => (a == null || b == null || a === 0 ? null : (b - a) / Math.abs(a));
  return (
    <div className="atr-campaigns">
      <div className="atr-corr-head">
        <p>Campaign Meta dikelompokkan dari namanya: audiens (NV = new, RM = remarketing) × tujuan (View Content, Add to Cart, Purchase, Traffic). Perubahan dibanding {prevMonth ? monthShort(prevMonth) : 'bulan sebelumnya'}.</p>
        <label className="atr-field">
          <span>Bulan</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthShort(m)}</option>)}
          </select>
        </label>
      </div>
      <div className="atr-table-wrap">
        <table className="atr-table">
          <thead>
            <tr><th>Kelompok</th>{COLS.map(([k, l]) => <th key={k}>{l}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(({ g, cur, prev }) => (
              <tr key={g.key}>
                <th scope="row" className="atr-wrap" title={g.campaigns.join('\n')}>
                  {g.label}
                  <small> · {g.campaigns.length} campaign</small>
                </th>
                {COLS.map(([k, , unit, sent]) => (
                  <td key={k}>
                    <div className="atr-cellstack">
                      {fmt(unit, cur[k])}
                      {prev && <Change value={chg(prev[k], cur[k])} sentiment={sent} />}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="atr-subhead">Anomali audiens {thread.months ? monthShort(thread.months.to) : ''}</h3>
      {!thread.anomalies.length ? (
        <div className="atr-empty">Tidak ada segmen audiens (kelompok × umur × gender, spend ≥1%) yang biayanya jauh dari segmen lain bulan ini.</div>
      ) : (
        <div className="atr-anoms">
          {thread.anomalies.map((a, i) => (
            <article key={i} className={`atr-anom is-${a.tone}${a.sideEffect ? ' is-side' : ''}`}>
              <header>
                {a.sideEffect && <span className="atr-tag is-est"><Sparkles size={11} aria-hidden="true" /> benang merah</span>}
                <span className={`atr-tag ${a.tone === 'good' ? 'is-ok' : 'is-low'}`}>{a.tone === 'good' ? 'jauh lebih murah' : 'jauh lebih mahal'}</span>
              </header>
              <strong>{a.groupLabel}</strong>
              <span className="atr-muted">{genderLabel(a.gender)} {a.age}</span>
              <p>
                {a.costLabel} <b>{fmtJt(a.cost)}</b> vs pembanding {fmtJt(a.peerMedian)} ({a.vsPeers >= 0 ? '+' : '−'}{fmtPct(Math.abs(a.vsPeers), 0)}) · {fmtNum(a.volume)} {a.resultLabel} · spend {fmtJt(a.spend)}
              </p>
              {a.sideEffect && <p className="atr-anom-hint">Campaign ini tidak dioptimasi untuk {a.resultLabel}, tapi menghasilkannya dengan murah — uji duplikasi audiens ini dengan tujuan {a.resultLabel}.</p>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
