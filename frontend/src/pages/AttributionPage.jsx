import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CircleDot, Construction, Filter, Info, Lightbulb, Lock, Minus, Spline, TrendingDown, TrendingUp, Users, Waypoints } from 'lucide-react';
import api from '../api/client.js';
import PageBand from '../components/common/PageBand.jsx';
import DashboardBrandPicker from '../components/dashboard/DashboardBrandPicker.jsx';
import MonthPicker from '../components/googleReviews/MonthPicker.jsx';
import useActiveBrand from '../hooks/useActiveBrand.js';
import useSessionState from '../hooks/useSessionState.js';
import { CampaignView, CorrelationView, FunnelStages, ThreadView } from '../components/attribution/ThreadSections.jsx';
import { ContributionChart, DailyChart, MonthlyTrendChart, WaterfallChart, fmtJt, fmtNum, fmtPct, fmtRp, fmtX, monthShort } from '../components/attribution/charts.jsx';
import '../components/dashboard/console.css';
import '../components/dashboard/softShell.css';
import '../components/attribution/attribution.css';

// Atribusi & Kebocoran Channel (admin only). Reads the shop's own daily
// numbers next to every channel's spend and answers: why did revenue move,
// which channel actually drives it, where is the budget leaking, and which
// channel to push for a given goal. Everything model-based is ESTIMASI;
// platform claims are shown as claims, never as the truth.

const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const monthLong = (ym) => (ym ? `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '');
const thisMonth = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
const shiftMonth = (ym, k) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return d.toISOString().slice(0, 7);
};
const SPANS = [
  { key: 6, label: '6 bulan' },
  { key: 12, label: '12 bulan' },
  { key: 24, label: '24 bulan' },
];
const TABS = [
  { key: 'thread', label: 'Benang Merah', hint: 'Revenue → funnel → channel → campaign → audiens', icon: <Waypoints size={16} /> },
  { key: 'funnel', label: 'Funnel', hint: 'Tahap yang bocor, dalam Rupiah', icon: <Filter size={16} /> },
  { key: 'corr', label: 'Korelasi', hint: 'Grafik dua garis, sudah dinilai', icon: <Spline size={16} /> },
  { key: 'campaign', label: 'Campaign', hint: 'NV/RM × tujuan, anomali', icon: <Users size={16} /> },
  { key: 'model', label: 'Kontribusi', hint: 'Model, klaim, kebocoran budget', icon: <Activity size={16} /> },
];

const TARGET_FMT = { revenue: fmtJt, visitors: (v) => fmtNum(v), orders: (v) => fmtNum(v) };
const TARGET_UNIT = { revenue: 'Rp', visitors: 'pengunjung', orders: 'pesanan', atc: 'ATC' };

function Tag({ kind, children }) {
  return <span className={`atr-tag is-${kind}`}>{children}</span>;
}
const Estimasi = () => <Tag kind="est">ESTIMASI</Tag>;
const Proxy = () => <Tag kind="proxy">PROXY</Tag>;

function Delta({ value, sentiment = 'higher', format = (v) => fmtPct(Math.abs(v)) }) {
  if (value == null) return <span className="atr-null" title="Tidak bisa dihitung — salah satu periode kosong">—</span>;
  const good = sentiment === 'neutral' ? null : sentiment === 'higher' ? value > 0 : value < 0;
  const flat = Math.abs(value) < 0.005;
  const cls = flat || good == null ? 'is-flat' : good ? 'is-good' : 'is-bad';
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`atr-delta ${cls}`}>
      <Icon size={11} strokeWidth={2.6} aria-hidden="true" />
      {value > 0 ? '+' : value < 0 ? '−' : ''}
      {format(value)}
    </span>
  );
}

function Section({ id, title, desc, tag, children, aside }) {
  return (
    <section className="soft-card atr-section" id={id} aria-labelledby={`${id}-title`}>
      <header className="atr-section-head">
        <div>
          <h2 id={`${id}-title`}>
            {title} {tag}
          </h2>
          {desc && <p>{desc}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Seg({ options, value, onChange, label }) {
  return (
    <div className="atr-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" className={o.key === value ? 'is-on' : ''} aria-pressed={o.key === value} onClick={() => onChange(o.key)} disabled={o.disabled}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const ToneIcon = { good: TrendingUp, bad: TrendingDown, warn: AlertTriangle, muted: Info };

// ── 1. Consultant summary ────────────────────────────────────────────────
function Findings({ data }) {
  const m = data.models.revenue;
  return (
    <Section
      id="atr-findings"
      title="Ringkasan konsultan"
      desc={`${data.brand.name} · ${monthLong(data.monthly[0]?.month)} – ${monthLong(data.monthly.at(-1)?.month)} · dibaca dari data toko Shopee, bukan dari klaim platform.`}
      aside={m?.ok && (
        <div className="atr-quality" title={`Model revenue: ${m.n} hari (${m.from} s/d ${m.to}), R² ${m.r2?.toFixed(2)}`}>
          <span>Kekuatan model</span>
          <strong className={`is-${m.grade}`}>{m.grade}</strong>
          <small>{m.n} hari · R² {m.r2?.toFixed(2)}</small>
        </div>
      )}
    >
      <ol className="atr-findings">
        {data.findings.map((f, i) => {
          const Icon = ToneIcon[f.tone] ?? Lightbulb;
          return (
            <li key={i} className={`is-${f.tone}`}>
              <Icon size={16} aria-hidden="true" />
              <span>{f.text}</span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

// ── 2. Monthly trend ─────────────────────────────────────────────────────
function MonthlyTrend({ data }) {
  const { monthly, channels } = data;
  return (
    <Section id="atr-trend" title="Tren bulanan" desc="Spend tiap channel (batang) terhadap revenue toko (garis). Rasio dihitung dari total bulan, bukan rata-rata harian.">
      <MonthlyTrendChart months={monthly} channels={channels} />
      <div className="atr-table-wrap">
        <table className="atr-table">
          <thead>
            <tr>
              <th>Bulan</th>
              <th>Revenue</th>
              <th>Pengunjung</th>
              <th>CR</th>
              <th>AOV</th>
              <th>ATC toko</th>
              {channels.map((c) => <th key={c.key}>{c.label}</th>)}
              <th>Total spend</th>
              <th title="Revenue toko ÷ total spend iklan">MER</th>
              <th title="Jumlah klaim semua platform ÷ revenue toko">Klaim ÷ revenue</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((m, i) => {
              const prev = monthly[i - 1];
              const ch = (a, b) => (a == null || b == null || a === 0 ? null : (b - a) / Math.abs(a));
              return (
                <tr key={m.month} className={m.complete ? '' : 'is-partial'}>
                  <th scope="row">
                    {monthShort(m.month)}
                    {!m.complete && <small title={`${m.storeDays} dari ${m.calendarDays} hari; ada channel yang datanya belum lengkap`}> sebagian</small>}
                  </th>
                  <td>
                    {fmtJt(m.store.revenue)}
                    {prev && m.storeDays === m.calendarDays && prev.storeDays === prev.calendarDays && <Delta value={ch(prev.store.revenue, m.store.revenue)} />}
                  </td>
                  <td>{fmtNum(m.store.visitors)}</td>
                  <td>{fmtPct(m.store.cr, 2)}</td>
                  <td>{fmtJt(m.store.aov)}</td>
                  <td>{m.store.atc == null ? <span className="atr-null" title="File Product Performance bulan penuh belum ada">—</span> : fmtNum(m.store.atc)}</td>
                  {channels.map((c) => (
                    <td key={c.key}>{m.spend[c.key] == null ? <span className="atr-null" title="Data channel ini belum ada untuk bulan ini">—</span> : fmtJt(m.spend[c.key])}</td>
                  ))}
                  <td>{fmtJt(m.spend.total)}</td>
                  <td>{fmtX(m.mer)}</td>
                  <td>{m.channelsKnown ? fmtPct(m.overclaim, 0) : <span className="atr-null" title="Ada channel yang datanya belum lengkap — rasio klaim tidak dihitung">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── 3. Why did revenue move? ─────────────────────────────────────────────
function Bridge({ data }) {
  const { bridges } = data;
  const defaultIdx = Math.max(0, bridges.map((b) => Boolean(b.channels.revenue && !b.channels.revenue.partial)).lastIndexOf(true));
  const [idx, setIdx] = useState(defaultIdx);
  const [view, setView] = useState('drivers');
  const [target, setTarget] = useState('revenue');
  const b = bridges[Math.min(idx, bridges.length - 1)];
  if (!b) return null;
  const chTarget = b.channels[target];
  const fmt = TARGET_FMT[target];
  const views = [
    { key: 'drivers', label: 'Penggerak toko' },
    { key: 'sources', label: 'Sumber penjualan' },
    { key: 'channels', label: 'Per channel iklan', disabled: !b.channels.revenue },
  ];
  return (
    <Section
      id="atr-bridge"
      title="Kenapa revenue berubah?"
      desc="Selisih revenue dipecah menjadi Rupiah per penyebab — jumlah semua batang = selisih total."
      tag={view === 'channels' ? <Estimasi /> : null}
      aside={(
        <label className="atr-field">
          <span>Periode</span>
          <select value={idx} onChange={(e) => setIdx(Number(e.target.value))}>
            {bridges.map((x, i) => <option key={x.to} value={i}>{monthShort(x.from)} → {monthShort(x.to)}</option>)}
          </select>
        </label>
      )}
    >
      <div className="atr-bridge-head">
        <div className="atr-bigfig">
          <span>Revenue {monthShort(b.from)} → {monthShort(b.to)}</span>
          <strong>{fmtJt(b.revenueFrom)} → {fmtJt(b.revenueTo)}</strong>
          <Delta value={b.revenueFrom ? b.change / b.revenueFrom : null} />
        </div>
        <Seg options={views} value={view} onChange={setView} label="Cara memecah selisih" />
        {view === 'channels' && (
          <Seg options={[{ key: 'revenue', label: 'Revenue' }, { key: 'visitors', label: 'Traffic' }, { key: 'orders', label: 'Pesanan' }]} value={target} onChange={setTarget} label="Metrik" />
        )}
      </div>

      {view === 'drivers' && b.drivers && (
        <>
          <WaterfallChart startLabel={monthShort(b.from)} endLabel={monthShort(b.to)} start={b.revenueFrom} end={b.revenueTo} items={b.drivers} />
          <p className="atr-note">Revenue = Jumlah hari × Traffic per hari × Conversion Rate × AOV. Dipecah dengan metode LMDI, jadi tidak ada sisa dan urutan faktor tidak memengaruhi hasil.</p>
          <div className="atr-mini-grid">
            {b.drivers.map((d) => (
              <div key={d.key} className="atr-mini">
                <span>{d.label}</span>
                <strong>{d.unit === 'pct' ? `${fmtPct(d.from, 2)} → ${fmtPct(d.to, 2)}` : d.unit === 'idr' ? `${fmtJt(d.from)} → ${fmtJt(d.to)}` : `${fmtNum(d.from)} → ${fmtNum(d.to)}`}</strong>
                <em className={d.value >= 0 ? 'is-good' : 'is-bad'}>{d.value >= 0 ? '+' : '−'}{fmtJt(Math.abs(d.value))}</em>
              </div>
            ))}
          </div>
        </>
      )}

      {view === 'sources' && (
        <>
          <WaterfallChart
            startLabel={monthShort(b.from)}
            endLabel={monthShort(b.to)}
            start={b.sources.reduce((s, x) => s + x.from, 0)}
            end={b.sources.reduce((s, x) => s + x.to, 0)}
            items={[...b.sources].sort((x, y) => Math.abs(y.value) - Math.abs(x.value)).map((s) => ({ label: s.label.replace(' (termasuk traffic eksternal)', ''), value: s.value }))}
          />
          <p className="atr-note">Sumber penjualan dari laporan Asal Penjualan Shopee (tanpa tumpang tindih). Traffic dari luar Shopee — termasuk Meta Boost Post dan CPAS — masuk ke Halaman Produk · Lainnya atau sumber organik lain, karena Shopee tidak memisahkannya. Iklan Shopee tidak ikut di sini: penjualannya sudah tercatat di sumber-sumber ini.</p>
        </>
      )}

      {view === 'channels' && (chTarget ? (
        <>
          <WaterfallChart
            startLabel={monthShort(b.from)}
            endLabel={monthShort(b.to)}
            start={chTarget.from}
            end={chTarget.to}
            items={chTarget.items.map((i) => ({ label: i.label, value: i.value }))}
            format={fmt}
          />
          <p className="atr-note">
            Kontribusi tiap channel diperkirakan dari hubungan harian spend vs {target === 'revenue' ? 'revenue' : target === 'visitors' ? 'pengunjung' : 'pesanan'} toko.
            {chTarget.partial && ' Sebagian hari di salah satu bulan tidak bisa dimodelkan (data channel kosong) — total di sini hanya hari yang lengkap.'}
          </p>
        </>
      ) : <div className="atr-empty">Model belum bisa dihitung untuk periode ini.</div>)}
    </Section>
  );
}

// ── 4. Channel contribution (model) ──────────────────────────────────────
function Contribution({ data }) {
  const [target, setTarget] = useState('revenue');
  const m = data.models[target];
  const unit = TARGET_UNIT[target];
  const per = (v) => (v == null ? '—' : target === 'revenue' ? fmtX(v) : `${fmtNum(v * 1e6)} / Rp1 jt`);
  return (
    <Section
      id="atr-contrib"
      title="Kontribusi channel"
      tag={<Estimasi />}
      desc="Model regresi harian: berapa revenue/traffic/pesanan toko yang bergerak ketika spend sebuah channel naik, setelah memperhitungkan hari, tanggal kembar, gajian, dan tren. Efek tertunda (adstock) dan kejenuhan dihitung per channel."
      aside={<Seg options={[{ key: 'revenue', label: 'Revenue' }, { key: 'visitors', label: 'Traffic' }, { key: 'orders', label: 'Pesanan' }]} value={target} onChange={setTarget} label="Metrik" />}
    >
      {!m?.ok ? (
        <div className="atr-empty">{m?.reason ?? 'Model belum bisa dihitung.'}</div>
      ) : (
        <>
          <ContributionChart months={data.monthly} channels={data.channels} target={target} format={TARGET_FMT[target]} />
          <div className="atr-table-wrap">
            <table className="atr-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Spend ({m.from} – {m.to})</th>
                  <th>Kontribusi</th>
                  <th title="Rata-rata per Rupiah spend selama periode model">{target === 'revenue' ? 'iROAS' : 'Rata-rata'}</th>
                  <th title="Rentang 80% dari bootstrap 120×">Rentang keyakinan</th>
                  <th title="Hasil Rupiah berikutnya pada tingkat spend 30 hari terakhir">{target === 'revenue' ? 'mROAS' : 'Marjinal'}</th>
                  <th title="Berapa lama efek iklan bertahan setelah hari tayang">Efek tertunda</th>
                  <th>Kejenuhan</th>
                </tr>
              </thead>
              <tbody>
                {m.channels.map((c) => {
                  const ch = data.channels.find((x) => x.key === c.channel);
                  const halfLife = c.decay > 0 ? Math.log(0.5) / Math.log(c.decay) : 0;
                  return (
                    <tr key={c.channel}>
                      <th scope="row">
                        <span className="atr-dot" style={{ background: ch?.color }} />
                        {ch?.label}
                        {ch?.scopeNote && <span className="atr-info" title={ch.scopeNote} aria-label={ch.scopeNote}><Info size={13} aria-hidden="true" /></span>}
                      </th>
                      <td>{fmtJt(c.spend)}</td>
                      <td>{c.detected ? (target === 'revenue' ? fmtJt(c.contribution) : `${fmtNum(c.contribution)} ${unit}`) : <span className="atr-muted" title="Model tidak menemukan efek positif yang terukur — bukan berarti nol pasti">tidak terdeteksi</span>}</td>
                      <td>{c.detected ? per(c.average) : '—'}</td>
                      <td>{c.interval ? `${per(c.interval.low)} – ${per(c.interval.high)}` : '—'}</td>
                      <td>{c.detected ? per(c.marginal) : '—'}</td>
                      <td>{c.decay === 0 ? 'hari itu saja' : `±${fmtNum(halfLife, 1)} hari`}</td>
                      <td>{c.alpha < 1 ? <Tag kind="watch">mulai jenuh</Tag> : <Tag kind="ok">belum jenuh</Tag>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="atr-note">
            {m.n} hari lengkap · R² {m.r2?.toFixed(2)} · kekuatan model <strong>{m.grade}</strong>. iROAS = kontribusi ÷ spend; mROAS = hasil tambahan Rupiah berikutnya. Rentang lebar berarti data belum cukup bervariasi untuk memastikan — uji dengan holdout (matikan/naikkan channel 7–14 hari). Spend GMV Max mengikuti penjualan, sehingga kontribusi Iklan Shopee sebaiknya dibaca sebagai batas atas; bagian "Organik, tren & kalender" bisa negatif bila tren menurun.
          </p>
        </>
      )}
    </Section>
  );
}

// ── 5. Claims vs shop ────────────────────────────────────────────────────
function Reconciliation({ data }) {
  const r = data.reconciliation;
  const max = Math.max(...r.channels.flatMap((c) => [c.spendShare ?? 0, c.claimShareOfRevenue ?? 0, c.modelShareOfRevenue ?? 0]), 0.01);
  return (
    <Section
      id="atr-recon"
      title="Klaim platform vs data toko"
      desc={`Bulan dengan data semua channel lengkap: ${r.months.map(monthShort).join(', ') || '—'}. Klaim = omzet yang dilaporkan platform (Iklan Shopee: Asal Penjualan; CPAS: shared purchase value; Meta: purchase value).`}
    >
      <div className="atr-recon-top">
        <div className="atr-bigfig">
          <span>Revenue toko</span>
          <strong>{fmtJt(r.revenue)}</strong>
        </div>
        <div className="atr-bigfig">
          <span>Jumlah klaim semua platform</span>
          <strong>{fmtJt(r.claimTotal)}</strong>
          <em className={r.overclaim > 1 ? 'is-bad' : ''}>{fmtPct(r.overclaim, 0)} dari revenue</em>
        </div>
        <div className="atr-bigfig">
          <span>Dijelaskan iklan menurut model <Estimasi /></span>
          <strong>{fmtPct(r.modelChannelsShare, 0)}</strong>
          <em>sisanya organik & kalender</em>
        </div>
      </div>
      <div className="atr-recon-rows">
        {r.channels.map((c) => {
          const ch = data.channels.find((x) => x.key === c.channel);
          const bar = (v, cls) => <i className={cls} style={{ width: `${Math.max(((v ?? 0) / max) * 100, 0.5)}%` }} />;
          return (
            <div key={c.channel} className="atr-recon-row">
              <div className="atr-recon-name">
                <span className="atr-dot" style={{ background: ch?.color }} />
                <strong>{c.label}</strong>
                <small>ROAS klaim {fmtX(c.claimedRoas)}</small>
              </div>
              <div className="atr-bars">
                <div><span>Share spend</span>{bar(c.spendShare, 'is-spend')}<b>{fmtPct(c.spendShare, 0)}</b></div>
                <div><span>Klaim ÷ revenue</span>{bar(c.claimShareOfRevenue, 'is-claim')}<b>{fmtPct(c.claimShareOfRevenue, 0)}</b></div>
                <div><span>Kontribusi model</span>{bar(c.modelShareOfRevenue, 'is-model')}<b>{c.modelShareOfRevenue == null ? '—' : fmtPct(c.modelShareOfRevenue, 0)}</b></div>
              </div>
              <div className="atr-recon-verdict">
                {!(c.claim > 0) ? (
                  <span>Tidak mengklaim pembelian — dinilai dari pergerakan toko{c.modelContribution > 0 ? '' : ' (efek belum terdeteksi)'}</span>
                ) : c.claimVsModel != null ? (
                  <>
                    <strong>{fmtNum(c.claimVsModel, 1)}×</strong>
                    <span>klaim vs dukungan data toko</span>
                  </>
                ) : (
                  <span>Klaim ada, efek ke toko tidak terdeteksi</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="atr-note">Klaim di atas 100% revenue berarti platform menghitung pembeli yang sama. Angka "×" &gt; 1 artinya klaim lebih besar dari yang bisa dijelaskan pergerakan toko — sisanya kemungkinan pembelian yang tetap terjadi tanpa iklan.</p>
    </Section>
  );
}

// ── 6. Leak matrix + reallocation ────────────────────────────────────────
function Leaks({ data, targetRoas, onTargetRoas }) {
  const l = data.leaks;
  const re = data.reallocation;
  return (
    <Section
      id="atr-leaks"
      title="Matriks kebocoran"
      tag={<Estimasi />}
      desc="Spend yang tidak ditebus revenue inkremental pada ROAS target. Bocor = spend − kontribusi ÷ ROAS target."
      aside={(
        <label className="atr-field">
          <span>ROAS target</span>
          <select value={targetRoas} onChange={(e) => onTargetRoas(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 8, 10].map((v) => <option key={v} value={v}>{v}x</option>)}
          </select>
        </label>
      )}
    >
      {!l ? <div className="atr-empty">Model revenue belum bisa dihitung.</div> : (
        <>
          <div className="atr-table-wrap">
            <table className="atr-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Spend</th>
                  <th>Share spend</th>
                  <th>Share kontribusi</th>
                  <th>ROAS klaim</th>
                  <th>iROAS</th>
                  <th>mROAS</th>
                  <th>Keyakinan</th>
                  <th>Bocor</th>
                </tr>
              </thead>
              <tbody>
                {[...l.rows].sort((a, b) => b.leak - a.leak).map((r) => {
                  const ch = data.channels.find((x) => x.key === r.channel);
                  return (
                    <tr key={r.channel}>
                      <th scope="row">
                        <span className="atr-dot" style={{ background: ch?.color }} />
                        {r.label}
                        {r.scopeNote && <span className="atr-info" title={r.scopeNote} aria-label={r.scopeNote}><Info size={13} aria-hidden="true" /></span>}
                      </th>
                      <td>{fmtJt(r.spend)}</td>
                      <td>{fmtPct(r.spendShare, 0)}</td>
                      <td>{fmtPct(r.contributionShare, 0)}</td>
                      <td>{fmtX(r.claimedRoas)}</td>
                      <td>{r.detected ? fmtX(r.iroas) : <span className="atr-muted">tidak terdeteksi</span>}</td>
                      <td>{r.detected ? fmtX(r.mroas) : '—'}</td>
                      <td>{r.confidence ? <Tag kind={r.confidence === 'tinggi' ? 'ok' : r.confidence === 'sedang' ? 'watch' : 'low'}>{r.confidence}</Tag> : '—'}</td>
                      <td className={r.leak > 0 ? 'atr-leak' : ''}>{r.leak > 0 ? `${fmtJt(r.leak)} (${fmtPct(r.leakShare, 0)})` : 'tidak bocor'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {re && re.expectedChange > 0 && (
            <div className="atr-callout">
              <Lightbulb size={18} aria-hidden="true" />
              <div>
                <strong>Saran realokasi <Estimasi /></strong>
                <p>
                  Geser <b>{fmtJt(re.amount)}</b> per 30 hari dari <b>{re.fromLabel}</b> ke <b>{re.toLabel}</b>. Dengan total spend tetap, revenue diperkirakan naik <b>{fmtJt(re.expectedChange)}</b> — dihitung dari kurva respons tiap channel pada tingkat spend 30 hari terakhir. Uji bertahap 2 minggu dan bandingkan dengan model.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ── 7. Levers per goal ───────────────────────────────────────────────────
function Levers({ data }) {
  const goals = data.levers;
  const [key, setKey] = useState(goals.find((g) => g.ok)?.key ?? 'revenue');
  const g = goals.find((x) => x.key === key);
  const rows = g?.ok ? g.rows : [];
  const max = Math.max(...rows.map((r) => r.perMillion ?? 0), 1e-9);
  const fmt = (v) => (key === 'revenue' ? fmtJt(v) : `${fmtNum(v)} ${TARGET_UNIT[key]}`);
  return (
    <Section
      id="atr-levers"
      title="Mau menaikkan metrik ini? Channel mana yang di-push"
      tag={<>{<Estimasi />}{g?.proxy && <Proxy />}</>}
      desc="Hasil tambahan per Rp1 juta spend berikutnya, pada tingkat spend 30 hari terakhir. Channel yang mulai jenuh memberi hasil makin kecil untuk tiap tambahan budget."
      aside={<Seg options={goals.map((x) => ({ key: x.key, label: x.label, disabled: !x.ok }))} value={key} onChange={setKey} label="Tujuan" />}
    >
      {!g?.ok ? <div className="atr-empty">Belum cukup data untuk tujuan ini.</div> : (
        <>
          <ol className="atr-levers">
            {rows.map((r, i) => {
              const ch = data.channels.find((x) => x.key === r.channel);
              return (
                <li key={r.channel} className={i === 0 && r.perMillion > 0 ? 'is-top' : ''}>
                  <span className="atr-lever-rank">{i + 1}</span>
                  <span className="atr-lever-name">
                    <span className="atr-dot" style={{ background: ch?.color }} />
                    {r.label}
                  </span>
                  <span className="atr-lever-bar"><i style={{ width: `${Math.max(((r.perMillion ?? 0) / max) * 100, 0)}%`, background: ch?.color }} /></span>
                  <strong>{r.detected && r.perMillion > 0 ? `${fmt(r.perMillion)} / Rp1 jt` : <span className="atr-muted">tidak terdeteksi</span>}</strong>
                  <span className="atr-lever-tags">
                    {r.confidence && <Tag kind={r.confidence === 'tinggi' ? 'ok' : r.confidence === 'sedang' ? 'watch' : 'low'}>keyakinan {r.confidence}</Tag>}
                    {r.detected && r.saturating && <Tag kind="watch">mulai jenuh</Tag>}
                  </span>
                </li>
              );
            })}
          </ol>
          {key === 'atc' && <p className="atr-note">ATC per Rp1 jt = pengunjung tambahan dari model traffic × rasio ATC toko per pengunjung (dari Product Performance bulanan). PROXY: menganggap pengunjung dari tiap channel menambah ke keranjang dengan rasio rata-rata toko. ATC harian per sumber tidak tersedia dari Shopee.</p>}
        </>
      )}
    </Section>
  );
}

// ── 8. Funnel diagnosis ──────────────────────────────────────────────────
function Diagnosis({ data }) {
  const list = data.diagnosis.filter((d) => d.previous);
  const [month, setMonth] = useState(list.at(-1)?.month);
  const d = list.find((x) => x.month === month) ?? list.at(-1);
  if (!d) return null;
  const fmtStage = (s, v) => (v == null ? <span className="atr-null" title="Tidak bisa dihitung">—</span> : s.unit === 'pct' ? fmtPct(v, 2) : s.unit === 'ratio' ? fmtX(v) : s.unit === 'ratio1' ? fmtNum(v, 2) : s.unit === 'idr' ? fmtJt(v) : fmtNum(v));
  return (
    <Section
      id="atr-diagnosis"
      title="Diagnosa funnel per channel"
      desc="Tiap tahap funnel dibanding bulan sebelumnya. Tahap yang memburuk paling tajam (lebih dari 10%) ditandai, lengkap dengan tindakan."
      aside={(
        <label className="atr-field">
          <span>Bulan</span>
          <select value={d.month} onChange={(e) => setMonth(e.target.value)}>
            {list.map((x) => <option key={x.month} value={x.month}>{monthShort(x.previous)} → {monthShort(x.month)}</option>)}
          </select>
        </label>
      )}
    >
      <div className="atr-diag-grid">
        {d.channels.map((c) => {
          const ch = data.channels.find((x) => x.key === c.channel);
          return (
            <article key={c.channel} className={`atr-diag ${c.worst ? 'is-flagged' : ''}`}>
              <header>
                <span className="atr-dot" style={{ background: ch?.color }} />
                <strong>{c.label}</strong>
                {c.missing ? <Tag kind="watch">data belum lengkap</Tag> : c.worst ? <Tag kind="low">bocor di {c.worst.label}</Tag> : <Tag kind="ok">tidak ada tahap memburuk</Tag>}
              </header>
              {c.missing ? (
                <div className="atr-empty">Data {c.label} untuk {monthShort(c.missing === 'cur' ? d.month : d.previous)} belum ada — perbandingan tidak dihitung.</div>
              ) : (
              <table className="atr-table is-compact">
                <thead>
                  <tr><th>Tahap</th><th>{monthShort(d.previous)}</th><th>{monthShort(d.month)}</th><th>Perubahan</th></tr>
                </thead>
                <tbody>
                  {c.stages.map((s) => (
                    <tr key={s.key} className={c.worst?.key === s.key ? 'is-worst' : ''}>
                      <th scope="row">{s.label}</th>
                      <td>{fmtStage(s, s.from)}</td>
                      <td>{fmtStage(s, s.to)}</td>
                      <td><Delta value={s.change} sentiment={['cpm', 'cpc', 'cpatc', 'cpv'].includes(s.key) ? 'lower' : s.key === 'spend' ? 'neutral' : 'higher'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
              {c.worst && <p className="atr-advice"><CircleDot size={13} aria-hidden="true" /> {c.worst.advice}</p>}
              {c.note && <p className="atr-advice is-warn"><AlertTriangle size={13} aria-hidden="true" /> {c.note}</p>}
            </article>
          );
        })}
      </div>
    </Section>
  );
}

// ── 9. Unusual days ──────────────────────────────────────────────────────
function Daily({ data }) {
  const recent = useMemo(() => data.daily.filter((d) => d.revenue != null).slice(-120), [data.daily]);
  return (
    <Section id="atr-daily" title="Hari tidak biasa" tag={<Estimasi />} desc="Revenue harian dibanding perkiraan model. Titik hijau/merah = hari yang menyimpang lebih dari 2 standar deviasi — cek promo, stok, atau perubahan iklan di hari itu.">
      <DailyChart daily={recent} channels={data.channels} events={data.events} />
      {data.events.length > 0 && (
        <div className="atr-table-wrap">
          <table className="atr-table is-compact">
            <thead>
              <tr><th>Tanggal</th><th>Aktual</th><th>Perkiraan</th><th>Selisih</th>{data.channels.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.date}>
                  <th scope="row">{e.date}</th>
                  <td>{fmtJt(e.actual)}</td>
                  <td>{fmtJt(e.expected)}</td>
                  <td className={e.direction === 'up' ? 'atr-up' : 'atr-down'}>{e.gap >= 0 ? '+' : '−'}{fmtJt(Math.abs(e.gap))}</td>
                  {data.channels.map((c) => <td key={c.key}>{fmtJt(e.spend[c.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ── 10. Coverage ─────────────────────────────────────────────────────────
function Coverage({ data }) {
  return (
    <Section id="atr-coverage" title="Cakupan data" desc="Sumber: Shopee harian (Asal Penjualan & ringkasan toko), Meta Ads harian (akun MAIN dibagi Boost/Non-Boost dengan Kata Kunci Boost Post; akun CPAS), dan Product Performance bulanan untuk ATC toko.">
      <div className="atr-table-wrap">
        <table className="atr-table is-compact">
          <thead><tr><th>Channel</th><th>Dipakai</th><th>Data dari</th><th>Sampai</th><th>Hari terisi</th><th>Hari toko tanpa data channel</th></tr></thead>
          <tbody>
            {data.coverage.map((c) => (
              <tr key={c.channel}>
                <th scope="row">{c.label}</th>
                <td>{c.active ? 'ya' : 'tidak'}</td>
                <td>{c.first ?? '—'}</td>
                <td>{c.last ?? '—'}</td>
                <td>{fmtNum(c.days)}</td>
                <td>{c.missingDays ? <span className="atr-warn-text">{fmtNum(c.missingDays)}</span> : '0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="atr-note">Hari yang data salah satu channel-nya kosong tidak dipakai model (kosong ≠ nol). Isi data yang kurang di Data Collection Hub atau Meta Ads Automation agar model dan rekonsiliasi lebih tajam.</p>
    </Section>
  );
}

// ── Funnel tab: where the shop's funnel leaked, and how each stage moves
// with revenue (the old Reach → View Content → Revenue charts).
function FunnelLeak({ data }) {
  const t = data.thread;
  const leak = t.leak;
  if (!leak) return null;
  return (
    <Section
      id="atr-leak"
      title={`Funnel Shopee ${monthShort(leak.from)} → ${monthShort(leak.to)}`}
      desc="Revenue toko = jumlah hari × pengunjung per hari × Conversion Rate × AOV. Tiap tahap diberi dampak Rupiah-nya; klik produk dan Add to Cart menjelaskan apa yang terjadi di dalam Conversion Rate."
    >
      <div className="atr-recon-top">
        <div className="atr-bigfig"><span>Revenue toko</span><strong>{fmtJt(leak.revenueFrom)} → {fmtJt(leak.revenueTo)}</strong></div>
        <div className="atr-bigfig"><span>Tahap paling bocor</span><strong>{leak.leak ? leak.leak.label : 'tidak ada'}</strong>{leak.leak && <em className="is-bad">−{fmtJt(Math.abs(leak.leak.rupiah))}</em>}</div>
        <div className="atr-bigfig"><span>Tahap paling naik</span><strong>{leak.lift ? leak.lift.label : 'tidak ada'}</strong>{leak.lift && <em>+{fmtJt(leak.lift.rupiah)}</em>}</div>
      </div>
      <FunnelStages leak={leak} />
      {t.chain.length > 0 && (
        <>
          <h3 className="atr-subhead">Tahap mana yang paling menentukan revenue harian?</h3>
          <div className="atr-chain">
            {[...t.chain].sort((a, b) => b.score - a.score).map((c) => (
              <div key={c.driver} className="atr-chain-row">
                <span>{c.label.replace('Shopee · ', '')}</span>
                <span className="atr-scorebar"><i style={{ width: `${Math.max(c.score, 0) * 100}%` }} /></span>
                <b>{c.score.toLocaleString('id-ID', { maximumFractionDigits: 2 })}</b>
                <em>{c.strength}</em>
              </div>
            ))}
          </div>
          <p className="atr-note">Skor = seberapa rapat tahap ini bergerak bersama revenue toko dari hari ke hari. Tahap dengan skor tertinggi adalah tuas paling langsung untuk revenue.</p>
        </>
      )}
    </Section>
  );
}

// ── Under development: the page opens only with the access code ──────────
// A soft gate for the team while the method is still being validated with
// the consultant — the API itself stays admin-only. Remembered for the tab's
// session so a reload does not ask again.
const ACCESS_CODE = '1234';

function DevLock({ onUnlock }) {
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    if (code.trim() === ACCESS_CODE) onUnlock();
    else setWrong(true);
  };
  return (
    <section className="soft-card atr-lock" aria-labelledby="atr-lock-title">
      <span className="atr-lock-icon" aria-hidden="true"><Construction size={22} /></span>
      <h2 id="atr-lock-title">Sedang dalam pengembangan</h2>
      <p>Modul Atribusi & Kebocoran Channel masih diuji bersama konsultan dan <b>belum bisa digunakan</b> untuk analisa klien. Angka dan metodenya masih bisa berubah.</p>
      <form className="atr-lock-form" onSubmit={submit}>
        <label htmlFor="atr-lock-code">Kode akses tim</label>
        <div>
          <input
            id="atr-lock-code"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={code}
            onChange={(e) => { setCode(e.target.value); setWrong(false); }}
            aria-invalid={wrong}
            aria-describedby={wrong ? 'atr-lock-err' : undefined}
            autoFocus
          />
          <button type="submit" className="btn btn-primary"><Lock size={15} aria-hidden="true" /> Buka</button>
        </div>
        {wrong && <p id="atr-lock-err" className="atr-lock-err" role="alert">Kode salah.</p>}
      </form>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="atr-skeleton" aria-busy="true" aria-label="Memuat analisa">
      {[0, 1, 2].map((i) => <div key={i} className="soft-card"><span /><span /><span /></div>)}
    </div>
  );
}

export default function AttributionPage() {
  const [brands, setBrands] = useState([]);
  const [brandStatus, setBrandStatus] = useSessionState('attribution:brand-status', 'active');
  const [brandId, setBrandId] = useActiveBrand();
  const [endMonth, setEndMonth] = useSessionState('attribution:end', thisMonth());
  const [span, setSpan] = useSessionState('attribution:span', 12);
  const [targetRoas, setTargetRoas] = useSessionState('attribution:target-roas', 3);
  const [tab, setTab] = useSessionState('attribution:tab', 'thread');
  const [compare, setCompare] = useState(null);
  const [pair, setPair] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [unlocked, setUnlocked] = useSessionState('attribution:unlocked', false);

  useEffect(() => {
    api.get('/brands').then((res) => setBrands(res.data.brands ?? [])).catch(() => setBrands([]));
  }, []);

  const from = shiftMonth(endMonth, -(span - 1));
  useEffect(() => {
    if (!brandId || !unlocked) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get(`/attribution/${brandId}`, { params: { from, to: endMonth, targetRoas, ...(compare ? { compareFrom: compare.split('|')[0], compareTo: compare.split('|')[1] } : {}) } })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) { setData(null); setError(err.response?.data?.message ?? 'Analisa gagal dimuat.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [brandId, from, endMonth, targetRoas, compare, unlocked]);
  // A new brand or window starts on its own default comparison.
  useEffect(() => { setCompare(null); setPair(null); }, [brandId, from, endMonth]);
  // The chart opened from the chain lands on the Korelasi tab.
  const openPair = (target, driver) => { setPair({ target, driver }); setTab('corr'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const defaultPair = data?.thread && !pair
    ? (() => { const top = [...data.thread.matrix].filter((m) => m.target === data.thread.target).sort((a, b) => b.score - a.score)[0]; return top ? { target: top.target, driver: top.driver } : null; })()
    : pair;

  const empty = data && data.storeDays === 0;
  const ready = data && !empty && data.monthly.length > 0;

  if (!unlocked) {
    return (
      <div className="con soft-shell atr-page">
        <div className="soft-frame">
          <PageBand
            kicker="Workspace · Internal"
            title="Atribusi & Kebocoran Channel"
            desc="Kenapa revenue bergerak, channel mana yang benar-benar mendorong toko, di mana budget bocor, dan channel mana yang di-push untuk tiap tujuan."
          />
          <DevLock onUnlock={() => setUnlocked(true)} />
        </div>
      </div>
    );
  }

  return (
    <div className="con soft-shell atr-page">
      <div className="soft-frame">
        <PageBand
          tabs={brandId ? TABS.map((t) => ({ ...t, onSelect: () => setTab(t.key) })) : []}
          activeKey={tab}
          layoutId="atr-band-sheet"
          kicker="Workspace · Internal"
          title="Atribusi & Kebocoran Channel"
          desc="Kenapa revenue bergerak, channel mana yang benar-benar mendorong toko, di mana budget bocor, dan channel mana yang di-push untuk tiap tujuan."
          tools={(
            <div className="atr-tools">
              <div className="atr-tool">
                <span className="bp-label">Brand</span>
                <DashboardBrandPicker id="atr-brand" brands={brands} value={brandId ?? ''} onChange={setBrandId} status={brandStatus} onStatusChange={setBrandStatus} placeholder="Pilih brand…" resultHint="Pilih untuk membuka analisa" />
              </div>
              <div className="atr-tool">
                <span className="bp-label">Sampai bulan</span>
                <MonthPicker label="Sampai bulan" value={endMonth} max={thisMonth()} onChange={(v) => setEndMonth(v || thisMonth())} />
              </div>
              <div className="atr-tool">
                <span className="bp-label">Rentang</span>
                <Seg options={SPANS} value={span} onChange={setSpan} label="Rentang bulan" />
              </div>
            </div>
          )}
        />

        <div className="atr-devnote" role="note">
          <Construction size={16} aria-hidden="true" />
          <span><b>Under development</b> — belum bisa digunakan untuk analisa atau laporan klien. Angka dan metode masih divalidasi dan bisa berubah.</span>
        </div>
        {!brandId && <div className="soft-card atr-empty atr-empty-page">Pilih brand untuk memulai analisa.</div>}
        {error && <div className="alert alert-error">{error}</div>}
        {brandId && loading && !data && <Skeleton />}
        {empty && <div className="soft-card atr-empty atr-empty-page">Belum ada data harian Shopee untuk {data.brand?.name} di {monthLong(from)} – {monthLong(endMonth)}. Upload Performa Toko (shop-stats) di Data Collection Hub.</div>}

        {ready && (
          <div className={`atr-body${loading ? ' is-loading' : ''}`}>
            {tab === 'thread' && (
              <>
                <Section id="atr-thread" title="Benang merah" desc={data.thread.months ? `${data.brand.name} · ${monthLong(data.thread.months.from)} → ${monthLong(data.thread.months.to)}` : data.brand.name}>
                  <ThreadView thread={data.thread} monthly={data.monthly} compare={compare} onCompare={setCompare} onOpenPair={openPair} />
                </Section>
                <Findings data={data} />
              </>
            )}
            {tab === 'funnel' && (
              <>
                <FunnelLeak data={data} />
                {data.bridges.length > 0 && <Bridge key={`${data.brand.id}-${data.from}-${data.to}`} data={data} />}
                {data.diagnosis.length > 1 && <Diagnosis key={`d-${data.brand.id}-${data.to}`} data={data} />}
              </>
            )}
            {tab === 'corr' && (
              <Section id="atr-corr" title="Korelasi trend" desc="Pengganti grafik dua garis di spreadsheet lama: setiap penggerak (spend channel, kelompok campaign, aktivitas Meta) dinilai terhadap setiap metrik (revenue per channel penjualan, funnel Shopee).">
                <CorrelationView thread={data.thread} pair={defaultPair} onPair={setPair} />
              </Section>
            )}
            {tab === 'campaign' && (
              <Section id="atr-campaign" title="Campaign & audiens" desc="Kelompok campaign Meta per bulan dan segmen audiens yang biayanya anomali.">
                <CampaignView key={data.thread.months?.to} thread={data.thread} />
              </Section>
            )}
            {tab === 'model' && (
              <>
                <MonthlyTrend data={data} />
                <Levers key={`l-${data.brand.id}`} data={data} />
                <Contribution data={data} />
                <Reconciliation data={data} />
                <Leaks data={data} targetRoas={targetRoas} onTargetRoas={setTargetRoas} />
                <Daily data={data} />
                <Coverage data={data} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
