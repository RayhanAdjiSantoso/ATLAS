import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, Crown, Info, Megaphone, ShoppingBag, Sparkles } from 'lucide-react';
import api from '../../api/client.js';
import useSessionState from '../../hooks/useSessionState.js';
import { readSpreadsheetFile } from '../../reportGenerator/lib/xlsxUtils';
import { parseShopeeCSV } from '../../reportGenerator/lib/shopeeAds';
import { parseProductPerfRows } from '../../reportGenerator/lib/shopeeProductAnalysis';
import { buildCrossChannel, buildShopeeProducts, META_BASIS, MIN_ATC, MIN_PURCHASES } from '../../reportGenerator/lib/crossChannel';
import './crossChannel.css';

// Executive Snapshot — which product to push where, Meta × Shopee.
// Reads the month's files from Data Collection Hub (CPAS, Iklan Produk Shopee,
// Product Performance); the scoring rule lives in
// reportGenerator/lib/crossChannel.ts. The files are read once; switching
// the comparison measure re-ranks in the browser.

const NEEDED = [
  { channel: 'cpas', label: 'CPAS (Meta)' },
  { channel: 'produk', label: 'Iklan Produk Shopee' },
  { channel: 'product_performance', label: 'Product Performance Shopee' },
];

const rp = (v) => (v == null ? '—' : 'Rp' + Math.round(v).toLocaleString('id-ID'));
const rpShort = (v) => {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e9) return `Rp${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (Math.abs(v) >= 1e6) return `Rp${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  return rp(v);
};
const x = (v) => (v == null ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}x`);
const pctF = (v) => (v == null ? '—' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`); // fraction
const pctP = (v) => (v == null ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`); // already %
const n0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('id-ID'));
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

async function fileAs(brandId, f) {
  const { data } = await api.get(`/brands/${brandId}/library/${f.id}/download`, { responseType: 'blob' });
  return new File([data], f.original_filename || `file-${f.id}`);
}

// An ad's standing under the chosen measure: its 0–100 rank among the brand's ads.
const rankOf = (ad, basis) => (ad && ad.scored ? (basis === 'score' ? ad.score : ad.parts?.[basis]) ?? null : null);
const SCOPE = { product: 'materi khusus', collection: 'materi koleksi', catalog: 'DPA katalog', none: '—' };

const TAGS = {
  traffic: { label: 'Konversi tinggi · traffic kecil', tone: 'gold' },
  noMeta: { label: 'Belum ada materi CPAS', tone: 'blue' },
  weakMeta: { label: 'Materi CPAS lemah', tone: 'red' },
  unadvertised: { label: 'Belum di Iklan Shopee', tone: 'orange' },
  weakShopee: { label: 'Iklan Shopee lemah', tone: 'red' },
};

function ScoreBar({ label, value, tone }) {
  return (
    <div className="xc2-score">
      <span>{label}</span>
      <div className="xc2-score-track"><i className={`is-${tone}`} style={{ width: `${value ?? 0}%` }} /></div>
      <b>{value == null ? '—' : value}</b>
    </div>
  );
}

// A funnel as a row of steps with the rate between them.
function Funnel({ steps }) {
  return (
    <div className="xc2-funnel">
      {steps.map((s, i) => (
        <div key={s.label} className="xc2-funnel-step">
          {i > 0 && <span className="xc2-funnel-rate">{s.rate}</span>}
          <div><b>{s.value}</b><small>{s.label}</small></div>
        </div>
      ))}
    </div>
  );
}

function metaFunnel(ad) {
  return [
    { label: 'Tayang', value: n0(ad.impressions) },
    { label: 'View', value: n0(ad.contentViews), rate: pctF(ad.impressions ? ad.contentViews / ad.impressions : null) },
    { label: 'ATC', value: n0(ad.atc), rate: pctF(ad.atcRate) },
    { label: 'Beli', value: n0(ad.orders), rate: pctF(ad.atc ? ad.orders / ad.atc : null) },
  ];
}

function RecCard({ rec, side, basis }) {
  const { product: p, ad } = rec;
  const tag = TAGS[rec.tag];
  return (
    <li className="xc2-card">
      <div className="xc2-card-head">
        <strong title={p.name}>{p.name}</strong>
        {tag && <span className={`xc2-tag is-${tag.tone}`}>{tag.label}</span>}
      </div>
      <div className="xc2-scores">
        <ScoreBar label="Shopee" value={p.shopeeScore} tone="orange" />
        <ScoreBar label="Meta" value={rankOf(ad, basis) == null ? null : Math.round(rankOf(ad, basis))} tone="blue" />
      </div>
      <div className="xc2-facts">
        <span>Penjualan <b>{rpShort(p.sales)}</b></span>
        <span>Konversi <b>{pctP(p.conversionRate)}</b></span>
        <span>Klik produk <b>{n0(p.clicks)}</b></span>
        <span>Iklan Shopee <b>{p.adRoas == null ? 'tidak aktif' : `ROAS ${x(p.adRoas)}`}</b></span>
      </div>
      {ad && side === 'meta' && <Funnel steps={metaFunnel(ad)} />}
      <p>{rec.reason}</p>
      {ad && <small>{rec.scope === 'collection' ? 'Materi koleksi' : 'Materi'}: {ad.name}{ad.matchedOn.length ? ` · cocok lewat “${ad.matchedOn.join(', ')}”` : ''}{rec.scope === 'collection' ? ` · mencakup ${ad.products.length} produk` : ''}</small>}
    </li>
  );
}

// The top Shopee products side by side with their Meta support: one row per
// product, Shopee strength on the left, the best CPAS ad's strength on the
// right — or a dashed "no ad" track, which is the gap the panel is about.
function ProductMap({ map, basis, catalog }) {
  const [all, setAll] = useState(false);
  const rows = map.map((m) => ({ ...m, meta: rankOf(m.ad, basis) }));
  const gaps = rows.filter((r) => !r.ad).length;
  const bestCatalog = catalog.filter((a) => a.scored).sort((a, b) => (rankOf(b, basis) ?? -1) - (rankOf(a, basis) ?? -1))[0];
  const verdict = (r) => {
    if (!r.ad) return { text: 'Belum ada materi', tone: 'gap' };
    if (r.meta == null) return { text: 'Materi kurang data', tone: 'thin' };
    if (r.meta >= 50 && r.product.shopeeScore >= 50) return { text: 'Kuat di dua channel', tone: 'star' };
    if (r.meta < 50) return { text: 'Materi lemah', tone: 'weak' };
    return { text: 'Kuat di Meta', tone: 'meta' };
  };
  return (
    <div className="xc2-map">
      <div className="xc2-map-head">
        <div>
          <span className="xc2-map-title">Peta produk terkuat di Shopee</span>
          <small>{rows.length} produk teratas menurut penjualan &amp; konversi Shopee, dan seberapa kuat materi Meta yang mendorongnya.</small>
        </div>
        <span className="xc2-map-gap"><b>{gaps}</b> dari {rows.length} belum punya materi khusus/koleksi</span>
      </div>
      {catalog.length > 0 && (
        <p className="xc2-catalog">
          Selain itu, <b>{catalog.length} materi DPA/katalog</b> mendorong semua produk sekaligus
          {bestCatalog ? <> — terkuat “{bestCatalog.name}” ({n0(bestCatalog.atc)} ATC, {rp(bestCatalog.costPerAtc)}/ATC)</> : null}. Materi katalog tidak dihitung per produk karena kontribusinya tidak bisa dipisah per produk dari file CPAS.
        </p>
      )}
      <div className="xc2-map-legend"><span><i className="is-shopee" /> Kekuatan di Shopee</span><span><i className="is-meta" /> Kekuatan materi Meta</span></div>
      <ol className="xc2-map-rows">
        {(all ? rows : rows.slice(0, 8)).map((r) => {
          const v = verdict(r);
          return (
            <li key={r.product.key} title={r.ad ? `Materi: ${r.ad.name}` : undefined}>
              <span className="xc2-map-name">
                <strong>{r.product.name}</strong>
                <small>{rpShort(r.product.sales)} · konversi {pctP(r.product.conversionRate)}</small>
              </span>
              <span className="xc2-map-bars">
                <span className="xc2-bar-row"><span className="xc2-bar is-shopee"><i style={{ width: `${r.product.shopeeScore}%` }} /></span><b>{r.product.shopeeScore}</b></span>
                {!r.ad
                  ? <span className="xc2-bar-row"><span className="xc2-bar is-none"><em>tanpa materi</em></span><b>—</b></span>
                  : r.meta == null
                    ? <span className="xc2-bar-row"><span className="xc2-bar is-thin"><em>{SCOPE[r.scope]} · &lt; {MIN_ATC} ATC</em></span><b>—</b></span>
                    : <span className="xc2-bar-row"><span className="xc2-bar is-meta"><i style={{ width: `${r.meta}%` }} /><em>{SCOPE[r.scope]}</em></span><b>{Math.round(r.meta)}</b></span>}
              </span>
              <span className={`xc2-verdict is-${v.tone}`}>{v.text}</span>
            </li>
          );
        })}
      </ol>
      {rows.length > 8 && (
        <button type="button" className="xc2-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Tampilkan 8 teratas' : `Tampilkan semua ${rows.length} produk`} <ChevronDown size={14} aria-hidden="true" className={all ? 'is-up' : ''} />
        </button>
      )}
    </div>
  );
}

export default function CrossChannelPanel({ filters }) {
  const brandId = filters.brandId;
  const month = (filters.endDate || filters.startDate || '').slice(0, 7);
  const [state, setState] = useState({ status: 'idle' });
  const [basis, setBasis] = useSessionState('xc:basis', 'score');
  const [tab, setTab] = useState('toMeta');
  const [method, setMethod] = useState(false);

  useEffect(() => {
    if (!brandId || !month) { setState({ status: 'idle' }); return undefined; }
    let alive = true;
    setState({ status: 'loading' });
    (async () => {
      try {
        const { data } = await api.get(`/brands/${brandId}/library`);
        const files = data.files || [];
        const complete = (mm) => NEEDED.every((nd) => files.some((f) => f.channel === nd.channel && f.period_month?.slice(0, 7) === mm));
        // The selected month, or else the latest complete month before it —
        // said plainly in the header, so the reading is never silently off.
        const months = [...new Set(files.map((f) => f.period_month?.slice(0, 7)).filter(Boolean))].sort().reverse();
        const used = complete(month) ? month : months.find((mm) => mm <= month && complete(mm)) ?? months.find(complete) ?? null;
        if (!used) {
          const missing = NEEDED.filter((nd) => !files.some((f) => f.channel === nd.channel && f.period_month?.slice(0, 7) === month)).map((nd) => nd.label);
          if (alive) setState({ status: 'missing', missing });
          return;
        }
        const pick = (ch) => files.filter((f) => f.channel === ch && f.period_month?.slice(0, 7) === used);
        const [cpasFiles, adFiles, perfFiles] = await Promise.all(NEEDED.map((nd) => Promise.all(pick(nd.channel).map((f) => fileAs(brandId, f)))));
        const cpasRows = (await Promise.all(cpasFiles.map(readSpreadsheetFile))).flat();
        const adRows = (await Promise.all(adFiles.map(async (f) => parseShopeeCSV(await f.text()).rows))).flat();
        const perf = parseProductPerfRows((await Promise.all(perfFiles.map(readSpreadsheetFile))).flat());
        if (alive) setState({ status: 'ready', cpasRows, products: buildShopeeProducts(perf, adRows), used });
      } catch (e) {
        // A role without access to Data Collection Hub's files simply does not get
        // this reading; anything else is a real failure worth saying.
        if (alive) setState(e?.response?.status === 403 ? { status: 'hidden' } : { status: 'error', message: e?.message || 'Gagal membaca file' });
      }
    })();
    return () => { alive = false; };
  }, [brandId, month]);

  const r = useMemo(
    () => (state.status === 'ready' ? buildCrossChannel(state.cpasRows, state.products, basis) : null),
    [state, basis],
  );

  if (state.status === 'hidden' || state.status === 'idle') return null;
  const label = (mm) => { const [y, m] = mm.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const monthLabel = label(month);
  const usedLabel = state.used ? label(state.used) : monthLabel;
  const fallback = state.used && state.used !== month;
  const basisInfo = META_BASIS.find((b) => b.id === basis) ?? META_BASIS[0];
  const leaders = r ? r.ads.filter((a) => a.scored).sort((a, b) => (rankOf(b, basis) ?? -1) - (rankOf(a, basis) ?? -1)).slice(0, 8) : [];
  const TABS = r ? [
    { id: 'toMeta', label: 'Dorong di Meta', Icon: Megaphone, items: r.shopeeToMeta, side: 'shopee', empty: 'Produk terkuat Shopee bulan ini sudah didorong baik di Meta.' },
    { id: 'toShopee', label: 'Dorong di Iklan Shopee', Icon: ShoppingBag, items: r.metaToShopee, side: 'meta', empty: 'Tidak ada materi Meta kuat yang produknya lemah di Iklan Shopee — atau materinya belum bisa dipetakan ke satu produk (lihat di bawah).' },
    { id: 'stars', label: 'Pertahankan', Icon: Crown, items: r.stars, side: 'meta', empty: 'Belum ada produk yang kuat di kedua channel sekaligus.' },
  ] : [];
  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <section className="con-focus xc xc2" aria-labelledby="xc-title">
      <div className="con-focus-head xc-head">
        <div>
          <h2 id="xc-title"><Sparkles size={17} aria-hidden="true" /> Rekomendasi silang Meta × Shopee</h2>
          <p>
            Produk yang kuat di satu channel tapi belum dimaksimalkan di channel lain, {usedLabel}.
            {fallback && <> File {monthLabel} belum lengkap, jadi dipakai {usedLabel} — bulan terdekat yang filenya lengkap.</>}
          </p>
        </div>
        <Link to="/data-brand" className="mom-head-link">Sumber file <ArrowUpRight size={13} /></Link>
      </div>

      <div className="con-focus-body xc-body">
        {state.status === 'loading' && <div className="xc-note">Membaca file CPAS dan Iklan Shopee bulan ini…</div>}
        {state.status === 'error' && <div className="xc-note is-bad">Rekomendasi belum bisa dihitung: {state.message}</div>}
        {state.status === 'missing' && (
          <div className="xc-note">Butuh file bulan {monthLabel} di Data Collection Hub: <strong>{state.missing.join(', ')}</strong>.</div>
        )}

        {r && (
          <>
            <div className="xc2-basis">
              <span className="xc2-basis-label">Ukur kekuatan materi Meta dengan</span>
              <div className="xc2-seg" role="radiogroup" aria-label="Metrik pembanding Meta">
                {META_BASIS.map((b) => (
                  <button key={b.id} type="button" role="radio" aria-checked={basis === b.id} className={basis === b.id ? 'is-on' : ''} onClick={() => setBasis(b.id)}>
                    {b.label}{b.id === 'score' && <em>disarankan</em>}
                  </button>
                ))}
              </div>
              <small>{basisInfo.hint}</small>
              {r.totals.spend > 0 && r.totals.atc === 0 && r.totals.orders === 0 && (
                <small className="xc2-unit">File CPAS bulan ini tidak memuat add to cart maupun pembelian “with shared items”, jadi kekuatan materi Meta belum bisa dinilai. Periksa pengaturan tarik otomatis CPAS brand ini, atau unggah ekspor CPAS dari Ads Manager (level Ad, dengan kolom shared items) di Data Collection Hub.</small>
              )}
              {r.unit === 'campaign' && <small className="xc2-unit">File CPAS bulan ini tidak memuat kolom Ad name (ditarik per campaign), jadi yang dinilai adalah campaign, bukan materi iklan.</small>}
            </div>

            <div className="xc2-kpis">
              <div><span>Spend CPAS</span><b>{rpShort(r.totals.spend)}</b></div>
              <div><span>Add to cart dari CPAS</span><b>{n0(r.totals.atc)}</b><small>Pembelian tercatat {n0(r.totals.orders)}</small></div>
              <div><span>Median biaya per ATC</span><b>{rp(r.medians.costPerAtc)}</b><small>View → ATC {pctF(r.medians.atcRate)}</small></div>
              <div><span>Materi dinilai</span><b>{r.totals.scoredAds}<small> / {r.ads.length}</small></b><small>min. {MIN_ATC} ATC</small></div>
              <div><span>Materi terpetakan</span><b>{r.ads.length - r.unmatched.length}<small> / {r.ads.length}</small></b><small>{r.ads.filter((a) => a.scope === 'product').length} khusus · {r.ads.filter((a) => a.scope === 'collection').length} koleksi · {r.catalog.length} katalog</small></div>
            </div>

            <ProductMap map={r.map} basis={basis} catalog={r.catalog} />

            <div className="xc2-recs">
              <nav className="xc2-tabs" role="tablist" aria-label="Rekomendasi">
                {TABS.map(({ id, label: l, Icon, items }) => (
                  <button key={id} type="button" role="tab" aria-selected={activeTab.id === id} className={activeTab.id === id ? 'is-on' : ''} onClick={() => setTab(id)}>
                    <Icon size={15} aria-hidden="true" /> {l} <b>{items.length}</b>
                  </button>
                ))}
              </nav>
              {activeTab.items.length ? (
                <ol className="xc2-cards">{activeTab.items.map((rec) => <RecCard key={rec.product.key} rec={rec} side={activeTab.side} basis={basis} />)}</ol>
              ) : <div className="xc-empty">{activeTab.empty}</div>}
            </div>

            <div className="xc2-leaders">
              <div className="xc2-leaders-head">
                <h3><Megaphone size={15} aria-hidden="true" /> {r.unit === 'campaign' ? 'Campaign' : 'Materi'} CPAS terkuat bulan ini</h3>
                <small>Diurutkan menurut {basisInfo.label.toLowerCase()} · termasuk materi yang belum terpetakan ke satu produk (DPA, katalog, koleksi)</small>
              </div>
              <table>
                <thead><tr><th>{r.unit === 'campaign' ? 'Campaign' : 'Materi'}</th><th className="is-basis" title={`Peringkat 0–100 di antara materi brand ini, menurut ${basisInfo.label}`}>Peringkat</th><th>Spend</th><th className={basis === 'costPerAtc' ? 'is-basis' : ''}>Biaya/ATC</th><th className={basis === 'atcRate' ? 'is-basis' : ''}>View→ATC</th><th>ATC</th><th className={basis === 'roas' ? 'is-basis' : ''}>Beli · ROAS</th><th>Cakupan</th></tr></thead>
                <tbody>
                  {leaders.map((a) => (
                    <tr key={a.name}>
                      <td title={a.name}>{a.name}</td>
                      <td><span className="xc2-pill">{rankOf(a, basis) == null ? '—' : Math.round(rankOf(a, basis))}</span></td>
                      <td>{rpShort(a.spend)}</td>
                      <td className={basis === 'costPerAtc' ? 'is-basis' : ''}>{rp(a.costPerAtc)}</td>
                      <td className={basis === 'atcRate' ? 'is-basis' : ''}>{pctF(a.atcRate)}</td>
                      <td>{n0(a.atc)}</td>
                      <td className={basis === 'roas' ? 'is-basis' : ''}>{n0(a.orders)}{a.orders >= MIN_PURCHASES && <small> · {x(a.roas)}</small>}</td>
                      <td className="xc2-prod" title={a.products.map((p) => p.name).join(', ')}>
                        {a.scope === 'product' ? a.product.name : a.scope === 'collection' ? `Koleksi “${a.matchedOn[0]}” · ${a.products.length} produk` : a.scope === 'catalog' ? 'Semua produk (katalog)' : <em>belum terpetakan</em>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button type="button" className={`xc2-method${method ? ' is-open' : ''}`} onClick={() => setMethod((v) => !v)} aria-expanded={method}>
              <Info size={15} aria-hidden="true" /> Cara dihitung &amp; kenapa bukan ROAS saja <ChevronDown size={15} aria-hidden="true" />
            </button>
            {method && (
              <div className="xc2-method-body">
                <p><b>Kenapa bukan ROAS saja.</b> Materi CPAS jarang menghasilkan pembelian langsung — bulan ini {n0(r.totals.orders)} pembelian dari {n0(r.totals.atc)} add to cart. Orang melihat iklan, memasukkan ke keranjang, lalu membeli belakangan atau lewat jalur lain. ROAS dari beberapa pembelian saja lebih banyak keberuntungan daripada sinyal.</p>
                <p><b>Skor Meta (0–100)</b> = peringkat persentil di antara materi brand ini sendiri: biaya per ATC (makin murah makin baik) 45%, View → ATC 30%, ROAS 25%. ROAS hanya ikut dihitung bila materi punya ≥ {MIN_PURCHASES} pembelian; kalau tidak, bobotnya dialihkan ke dua metrik lain. Materi dengan &lt; {MIN_ATC} ATC tidak dinilai (data tipis).</p>
                <p><b>Skor Shopee (0–100)</b> = persentil penjualan (60%) dan tingkat konversi halaman produk (40%). Konversi dari produk dengan &lt; 50 klik diabaikan. “Kuat” berarti skor ≥ 50, yaitu separuh teratas brand ini — aturannya menyesuaikan tiap brand.</p>
                <p><b>Pemetaan materi → produk</b> lewat kesamaan kata di nama iklan dan nama produk, tiga tingkat: <b>materi khusus</b> (kata yang hanya ada di ≤ 2 produk, mis. “polaris”), <b>materi koleksi</b> (kata yang dimiliki satu kelompok produk, mis. “pants”, “shirt”, “essential” — berlaku untuk semua produk dalam kelompok itu), dan <b>DPA/katalog</b> (mendorong semua produk; tidak dihitung per produk). Bila satu produk didorong beberapa materi, yang dipakai adalah materi terkuat menurut metrik yang dipilih. Supaya pemetaan lebih tepat, cantumkan nama produk atau koleksi di nama iklan, mis. “SV / Video | Polaris Shirt | 140126”.</p>
                {r.unmatched.length > 0 && <p><b>Belum terpetakan ({r.unmatched.length}):</b> {r.unmatched.slice(0, 12).map((a) => a.name).join(' · ')}{r.unmatched.length > 12 ? ' …' : ''}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
