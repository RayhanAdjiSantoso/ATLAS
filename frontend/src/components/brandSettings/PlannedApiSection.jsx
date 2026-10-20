import { CalendarClock, Link2, PlugZap, UploadCloud } from 'lucide-react';
import { BrandLogo } from '../../reportGenerator/components/BrandLogo';
import './plannedApi.css';

// Data Collection Hub › the API section of a platform whose integration is
// not built yet (Shopee, TikTok). It holds the place Meta and Google Ads
// already fill below their upload card: what the connection will pull, the
// steps to get there, and — until then — that the uploads above are the
// source. Nothing here calls a server.

const PLANS = {
  shopee: {
    title: 'Integrasi API Shopee',
    source: 'Shopee Open Platform',
    exportFrom: 'Shopee Seller Centre',
    pulls: [
      ['Pesanan & penjualan harian', 'Pengganti ekspor Order dan Performa Toko.'],
      ['Iklan Shopee (Iklan Produk, Toko, Live)', 'Biaya, klik, dan omzet per iklan per hari.'],
      ['Performa produk', 'Pengunjung, konversi, dan penjualan per produk.'],
    ],
    steps: ['Daftar sebagai partner di Shopee Open Platform', 'Hubungkan toko klien (izin akses dari pemilik toko)', 'Data ditarik otomatis setiap hari'],
  },
  tiktok: {
    title: 'Integrasi API TikTok',
    source: 'TikTok Shop Partner API & TikTok Marketing API',
    exportFrom: 'TikTok Shop Seller Center',
    pulls: [
      ['Pesanan TikTok Shop', 'Penjualan dan pesanan harian toko.'],
      ['GMV Max & iklan', 'Biaya, GMV, dan ROI per kampanye per hari.'],
      ['Performa konten', 'Video dan live yang menghasilkan penjualan.'],
    ],
    steps: ['Daftar aplikasi di TikTok Shop Partner Center', 'Hubungkan toko dan akun iklan klien', 'Data ditarik otomatis setiap hari'],
  },
};

export default function PlannedApiSection({ platformId }) {
  const plan = PLANS[platformId];
  if (!plan) return null;
  return (
    <section className="bp-channel-accounts pa" aria-label={plan.title}>
      <header className="pa-head">
        <span className="pa-logo" aria-hidden="true"><BrandLogo name={platformId} size={22} /></span>
        <div>
          <h3>{plan.title} <em>Segera hadir</em></h3>
          <p>Lewat {plan.source}. Setelah tersambung, dataset di atas terisi otomatis seperti Meta Ads dan Google Ads.</p>
        </div>
        <button type="button" className="bp-ghost" disabled title="Integrasi belum tersedia">
          <Link2 size={15} aria-hidden="true" /> Hubungkan akun
        </button>
      </header>

      <div className="pa-grid">
        <div className="pa-card">
          <span className="pa-label"><PlugZap size={14} aria-hidden="true" /> Yang akan ditarik</span>
          <ul>
            {plan.pulls.map(([name, note]) => (
              <li key={name}><b>{name}</b><small>{note}</small></li>
            ))}
          </ul>
        </div>
        <div className="pa-card">
          <span className="pa-label"><CalendarClock size={14} aria-hidden="true" /> Tahapan</span>
          <ol>
            {plan.steps.map((step, i) => (
              <li key={step}><i>{i + 1}</i><span>{step}</span></li>
            ))}
          </ol>
        </div>
      </div>

      <p className="pa-now"><UploadCloud size={15} aria-hidden="true" /> Untuk sekarang, unggah file ekspor {plan.exportFrom} ke kartu di atas — Report Generator dan Brand Overview membacanya seperti biasa.</p>
    </section>
  );
}
