import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { META_DATASETS, readMetaPeriod } from './metaOverview.js';
import './metaOverview.css';

// Business Overview › Meta Ads: the account in three parts, as Data
// Collection Hub files them — Boost Post (awareness), Non Boost Post
// (e-commerce & B2B to the website) and CPAS (catalogue sales on Shopee /
// Tokopedia) — each with the measures that fit its job, against the
// comparison period when one is set.

const rp = (v) => (v == null ? '—' : `Rp${Math.round(v).toLocaleString('id-ID')}`);
const n0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('id-ID'));
const pct = (v) => (v == null ? '—' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`);
const x = (v) => (v == null ? '—' : `${v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`);

const ROWS = {
  boost: [
    ['spend', 'Amount spent', rp], ['impressions', 'Impressions', n0], ['reach', 'Reach', n0],
    ['visits', 'Profile visits', n0], ['costPerVisit', 'Cost / profile visit', rp, true],
    ['interactions', 'Post interactions', n0], ['ctr', 'CTR (link)', pct],
  ],
  sell: [
    ['spend', 'Amount spent', rp], ['value', 'Purchase value', rp], ['roas', 'ROAS', x],
    ['purchases', 'Purchases', n0], ['costPerPurchase', 'Cost / purchase', rp, true],
    ['atc', 'Adds to cart', n0], ['costPerAtc', 'Cost / ATC', rp, true], ['ctr', 'CTR (link)', pct],
  ],
};

function Delta({ now, before, inverse }) {
  if (now == null || before == null || before === 0) return null;
  const ch = (now - before) / Math.abs(before);
  if (Math.abs(ch) < 0.005) return <span className="mo-delta is-flat">±0%</span>;
  const good = inverse ? ch < 0 : ch > 0;
  return <span className={`mo-delta ${good ? 'is-up' : 'is-down'}`}>{ch > 0 ? '▲' : '▼'} {Math.abs(ch * 100).toFixed(1)}%</span>;
}

export default function MetaOverview({ filters }) {
  const [state, setState] = useState({ status: 'idle' });
  const { brandId, startDate, endDate, compare, compareStartDate, compareEndDate } = filters;

  useEffect(() => {
    if (!brandId) return undefined;
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    Promise.all([
      readMetaPeriod(brandId, startDate, endDate),
      compare && compareStartDate && compareEndDate ? readMetaPeriod(brandId, compareStartDate, compareEndDate) : null,
    ]).then(([cur, prev]) => alive && setState({ status: 'ready', cur, prev }))
      .catch(() => alive && setState({ status: 'error' }));
    return () => { alive = false; };
  }, [brandId, startDate, endDate, compare, compareStartDate, compareEndDate]);

  if (state.status === 'loading' && !state.cur) {
    return <p className="mo-state"><Loader2 size={15} className="mo-spin" /> Membaca file Meta dari Data Collection Hub…</p>;
  }
  if (state.status === 'error') return <p className="mo-state is-error">File Meta tidak dapat dibaca. Coba muat ulang halaman.</p>;
  if (!state.cur) return null;

  const { cur, prev } = state;
  const sets = [...META_DATASETS, ...(cur.legacyMonths?.length ? [{ channel: 'meta', label: 'Meta Ads (gabungan lama)', hint: `Bulan sebelum dipisah: ${cur.legacyMonths.join(', ')}` }] : [])];
  const anyData = sets.some((d) => cur.datasets[d.channel]);

  if (!anyData) {
    return (
      <div className="mo-empty">
        <strong>Belum ada file Meta untuk periode ini</strong>
        <p>Unggah Boost Post, Non Boost Post, dan CPAS — atau aktifkan Tarik data API — di Data Collection Hub.</p>
        <Link to="/data-brand" className="mom-head-link">Buka Data Collection Hub <ArrowUpRight size={13} /></Link>
      </div>
    );
  }

  return (
    <div className="mo">
      <div className="mo-hero">
        {[
          ['Total spend Meta', rp(cur.total.spend), cur.total.spend, prev?.total.spend, false],
          ['ROAS iklan (atribusi Meta)', x(cur.total.roas), cur.total.roas, prev?.total.roas, false],
          ['Purchase value', rp(cur.total.value), cur.total.value, prev?.total.value, false],
          ['Purchases', n0(cur.total.purchases), cur.total.purchases, prev?.total.purchases, false],
        ].map(([label, text, now, before]) => (
          <article key={label} className="mo-hero-tile">
            <span>{label}</span>
            <strong>{text}</strong>
            <Delta now={now} before={before} />
          </article>
        ))}
        <p className="mo-hero-note">ROAS iklan = purchase value yang dicatat Meta (Non Boost Post + CPAS) ÷ spend keduanya; Boost Post adalah awareness, jadi hanya masuk ke total spend. ROAS Website &amp; Chat di atas memakai penjualan nyata dari Brand Tracking.</p>
      </div>

      <div className="mo-sets">
        {sets.map((ds) => {
          const d = cur.datasets[ds.channel];
          const p = prev?.datasets[ds.channel];
          const rows = ds.channel === 'boost' ? ROWS.boost : ROWS.sell;
          return (
            <section key={ds.channel} className={`mo-set is-${ds.channel}`}>
              <header>
                <h3>{ds.label}</h3>
                <p>{ds.hint}</p>
              </header>
              {!d ? (
                <p className="mo-set-empty">Belum ada file untuk periode ini.</p>
              ) : (
                <dl>
                  {rows.map(([key, label, f, inverse]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>
                        {f(d[key])}
                        {p && <Delta now={d[key]} before={p[key]} inverse={inverse} />}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {cur.missing[ds.channel]?.length > 0 && d && (
                <p className="mo-set-gap">Tanpa file: {cur.missing[ds.channel].join(', ')}</p>
              )}
            </section>
          );
        })}
      </div>
      <p className="mo-source">Dibaca dari file Meta di <Link to="/data-brand">Data Collection Hub</Link> untuk rentang tanggal di atas{prev ? ', dibanding periode pembanding' : ''}.</p>
    </div>
  );
}
