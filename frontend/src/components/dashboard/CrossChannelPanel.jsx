import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Megaphone, ShoppingBag } from 'lucide-react';
import api from '../../api/client.js';
import { readSpreadsheetFile } from '../../reportGenerator/lib/xlsxUtils';
import { parseShopeeCSV } from '../../reportGenerator/lib/shopeeAds';
import { parseProductPerfRows } from '../../reportGenerator/lib/shopeeProductAnalysis';
import { buildCrossChannel, buildShopeeProducts } from '../../reportGenerator/lib/crossChannel';

// Executive Snapshot — which product to push where, Meta × Shopee.
// Reads the month's files from Pengaturan Brand (CPAS, Iklan Produk Shopee,
// Product Performance); see reportGenerator/lib/crossChannel.ts for the rule.

const NEEDED = [
  { channel: 'cpas', label: 'CPAS (Meta)' },
  { channel: 'produk', label: 'Iklan Produk Shopee' },
  { channel: 'product_performance', label: 'Product Performance Shopee' },
];

const rp = (v) => 'Rp' + Math.round(v || 0).toLocaleString('id-ID');
const x = (v) => (v == null ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}x`);
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

async function fileAs(brandId, f) {
  const { data } = await api.get(`/brands/${brandId}/library/${f.id}/download`, { responseType: 'blob' });
  return new File([data], f.original_filename || `file-${f.id}`);
}

export default function CrossChannelPanel({ filters }) {
  const brandId = filters.brandId;
  const month = (filters.endDate || filters.startDate || '').slice(0, 7);
  const [state, setState] = useState({ status: 'idle' });

  useEffect(() => {
    if (!brandId || !month) { setState({ status: 'idle' }); return undefined; }
    let alive = true;
    setState({ status: 'loading' });
    (async () => {
      try {
        const { data } = await api.get(`/brands/${brandId}/library`);
        const files = data.files || [];
        const complete = (mm) => NEEDED.every((n) => files.some((f) => f.channel === n.channel && f.period_month?.slice(0, 7) === mm));
        // The selected month, or else the latest complete month before it —
        // said plainly in the header, so the reading is never silently off.
        const months = [...new Set(files.map((f) => f.period_month?.slice(0, 7)).filter(Boolean))].sort().reverse();
        const used = complete(month) ? month : months.find((mm) => mm <= month && complete(mm)) ?? months.find(complete) ?? null;
        if (!used) {
          const missing = NEEDED.filter((n) => !files.some((f) => f.channel === n.channel && f.period_month?.slice(0, 7) === month)).map((n) => n.label);
          if (alive) setState({ status: 'missing', missing });
          return;
        }
        const pick = (ch) => files.filter((f) => f.channel === ch && f.period_month?.slice(0, 7) === used);
        const [cpasFiles, adFiles, perfFiles] = await Promise.all(NEEDED.map((n) => Promise.all(pick(n.channel).map((f) => fileAs(brandId, f)))));
        const cpasRows = (await Promise.all(cpasFiles.map(readSpreadsheetFile))).flat();
        const adRows = (await Promise.all(adFiles.map(async (f) => parseShopeeCSV(await f.text()).rows))).flat();
        const perf = parseProductPerfRows((await Promise.all(perfFiles.map(readSpreadsheetFile))).flat());
        const result = buildCrossChannel(cpasRows, buildShopeeProducts(perf, adRows));
        if (alive) setState({ status: 'ready', result, used });
      } catch (e) {
        // A role without access to Pengaturan Brand's files simply does not
        // get this reading; anything else is a real failure worth saying.
        if (alive) setState(e?.response?.status === 403 ? { status: 'hidden' } : { status: 'error', message: e?.message || 'Gagal membaca file' });
      }
    })();
    return () => { alive = false; };
  }, [brandId, month]);

  if (state.status === 'hidden' || state.status === 'idle') return null;
  const label = (mm) => { const [y, m] = mm.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
  const monthLabel = label(month);
  const usedLabel = state.used ? label(state.used) : monthLabel;
  const fallback = state.used && state.used !== month;
  const r = state.result;

  return (
    <section className="con-focus xc" aria-labelledby="xc-title">
      <div className="con-focus-head xc-head">
        <div>
          <h2 id="xc-title">Rekomendasi silang Meta × Shopee</h2>
          <p>
            Produk yang kuat di satu channel tapi belum dimaksimalkan di channel lain, {usedLabel}.
            {fallback && <> File {monthLabel} belum lengkap, jadi dipakai {usedLabel} — bulan terdekat yang filenya lengkap.</>}
          </p>
        </div>
        <Link to="/pengaturan-brand" className="mom-head-link">Sumber file <ArrowUpRight size={13} /></Link>
      </div>

      <div className="con-focus-body xc-body">
        {state.status === 'loading' && <div className="xc-note">Membaca file CPAS dan Iklan Shopee bulan ini…</div>}
        {state.status === 'error' && <div className="xc-note is-bad">Rekomendasi belum bisa dihitung: {state.message}</div>}
        {state.status === 'missing' && (
          <div className="xc-note">
            Butuh file bulan {monthLabel} di Pengaturan Brand: <strong>{state.missing.join(', ')}</strong>.
          </div>
        )}

        {state.status === 'ready' && (
          <>
            <div className="xc-cols">
              <div className="xc-col">
                <h3><Megaphone size={15} aria-hidden="true" /> Kuat di Meta <ArrowRight size={14} aria-hidden="true" /> dorong di Iklan Shopee</h3>
                {r.metaToShopee.length ? (
                  <ol className="xc-list">
                    {r.metaToShopee.map((it) => (
                      <li key={it.product.key}>
                        <strong className="xc-name">{it.product.name}</strong>
                        <div className="xc-facts">
                          <span>ROAS CPAS <b>{x(it.ad?.roas)}</b></span>
                          <span>Iklan Shopee <b>{it.product.adRoas == null ? 'belum diiklankan' : `ROAS ${x(it.product.adRoas)}`}</b></span>
                        </div>
                        <p>{it.reason}</p>
                        <small>Materi Meta: {it.ad?.name} · cocok lewat kata “{it.ad?.matchedOn.join(', ')}”</small>
                      </li>
                    ))}
                  </ol>
                ) : <div className="xc-empty">Tidak ada produk yang kuat di Meta tapi lemah di Iklan Shopee bulan ini.</div>}
              </div>

              <div className="xc-col">
                <h3><ShoppingBag size={15} aria-hidden="true" /> Laris di Shopee <ArrowRight size={14} aria-hidden="true" /> dorong di Meta (CPAS)</h3>
                {r.shopeeToMeta.length ? (
                  <ol className="xc-list">
                    {r.shopeeToMeta.map((it) => (
                      <li key={it.product.key}>
                        <strong className="xc-name">{it.product.name}</strong>
                        <div className="xc-facts">
                          <span>Penjualan Shopee <b>{rp(it.product.sales)}</b></span>
                          <span>CPAS <b>{it.ad ? `ROAS ${x(it.ad.roas)}` : 'belum ada materi'}</b></span>
                        </div>
                        <p>{it.reason}</p>
                        {it.ad && <small>Materi Meta: {it.ad.name}</small>}
                      </li>
                    ))}
                  </ol>
                ) : <div className="xc-empty">Produk terlaris Shopee bulan ini sudah didorong baik di Meta.</div>}
              </div>
            </div>

            <p className="xc-foot">
              “Kuat” dan “lemah” dibandingkan median brand bulan ini — ROAS CPAS {x(r.medians.metaRoas)}, ROAS Iklan Shopee {x(r.medians.shopeeRoas)}.
              {' '}{r.ads.length - r.unmatched.length} dari {r.ads.length} materi CPAS terhubung ke produk Shopee lewat kesamaan nama
              {r.unmatched.length > 0 && <> — tidak terpetakan: {r.unmatched.map((a) => a.name).join(', ')}</>}.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
