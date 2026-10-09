import { Link } from 'react-router-dom';
import { LayoutDashboard, FileBarChart, Megaphone, Building2, History, CalendarCheck, SlidersHorizontal, FolderOpen, Radar, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
// Reveal and MilMark are part of the design system ported from the Monthly
// Report Generator, which is why they live under reportGenerator/components
// rather than components/common — keeping that folder a verbatim copy is what
// makes a later re-sync a file copy instead of a merge.
import { Reveal } from '../reportGenerator/components/Reveal';
import { MilMark } from '../reportGenerator/components/MilMark';
import atlasWordmark from '../assets/atlas-wordmark.png';
import '../reportGenerator/index.css';
import '../reportGenerator/app/shell.css';
import '../reportGenerator/app/atlas-fit.css';

// ATLAS's front door, built on the Monthly Report Generator's home-page layout
// (the masthead band and the index rows) with ATLAS's own content: these are
// ATLAS's modules, not the generator's report types.
//
// A row per module, not a card. Seven equal-weight cards with an icon, a
// heading and a paragraph is the shape every generated landing page takes, and
// it reads as filler for a tool whose users already know the product — so this
// is built like the tables they spend the day in.

const MODULES = [
  {
    key: 'brand-settings',
    to: '/pengaturan-brand',
    label: 'Brand Context',
    tagline: 'Langkah pertama',
    desc: 'Daftar klien dan statusnya, lalu brand context dan current direction setiap brand yang dibaca analisis ATLAS.',
    accent: 'var(--acc)',
    tint: 'var(--acc-100)',
    Icon: SlidersHorizontal,
  },
  {
    key: 'brand-data',
    to: '/data-brand',
    label: 'Data Collection Hub',
    tagline: 'Data sumber per brand',
    desc: 'File bulanan tiap marketplace, Minutes of Meeting, dan akun Meta & Google Ads — sumber yang dibaca dashboard dan laporan.',
    accent: 'var(--acc)',
    tint: 'var(--acc-100)',
    Icon: FolderOpen,
  },
  {
    key: 'dashboard',
    to: '/dashboard',
    label: 'Business Overview',
    tagline: 'Analitik penjualan Shopee',
    desc: 'KPI, funnel pesanan, tren harian, analisis produk, dan segmentasi pelanggan dari data ekspor Shopee yang sudah diimpor.',
    accent: 'var(--acc)',
    tint: 'var(--acc-100)',
    Icon: LayoutDashboard,
  },
  {
    key: 'daily-tracking',
    to: '/brand-tracking',
    label: 'Brand Tracking',
    tagline: 'Input harian',
    desc: 'Revenue per channel dan belanja iklan harian — sumber angka Executive Snapshot di dashboard.',
    accent: 'var(--gold)',
    tint: '#fdf3e0',
    Icon: CalendarCheck,
  },
  {
    key: 'report-generator',
    to: '/report-generator/meta',
    label: 'Performance Report Generator',
    tagline: 'Meta, Shopee & TikTok',
    desc: 'Bandingkan dua periode, bedah funnel iklan tiap platform, lalu unduh laporannya sebagai PDF, PNG per section, atau Excel.',
    accent: 'var(--shopee)',
    tint: 'var(--shopee-100)',
    Icon: FileBarChart,
  },
  {
    key: 'meta-automation',
    to: '/meta-automation',
    label: 'Meta Ads Automation',
    tagline: 'Laporan terjadwal',
    desc: 'Kelola brand dan langganan, lalu biarkan laporan harian dan mingguan Meta Ads terkirim sendiri.',
    accent: 'var(--biz)',
    tint: 'var(--biz-100)',
    Icon: Megaphone,
    adminOnly: true,
  },
  {
    key: 'internal-dashboard',
    to: '/internal-dashboard',
    label: 'Internal Dashboard',
    tagline: 'Portofolio klien',
    desc: 'Benchmark antar klien, business check-up, perbandingan kategori dan industri, sampai kualitas data yang masuk.',
    accent: 'var(--sum)',
    tint: 'var(--sum-100)',
    Icon: Building2,
    adminOnly: true,
  },
  {
    key: 'control-center',
    to: '/pusat-kendali',
    label: 'Pusat Kendali',
    tagline: 'Kelengkapan data',
    desc: 'Brand yang datanya belum lengkap dan to do meeting yang tertunda, dalam satu daftar lintas klien.',
    accent: 'var(--biz)',
    tint: 'var(--biz-100)',
    Icon: Radar,
  },
];

// A utility, not a module: somewhere you check on the data rather than read it.
const UTILITIES = [
  { key: 'history', to: '/history', label: 'History Upload', tagline: 'Jejak setiap file yang masuk', Icon: History },
  { key: 'access', to: '/pengaturan-akses', label: 'Pengaturan Akses', tagline: 'Akun, role, dan hak akses', Icon: ShieldCheck, adminOnly: true },
];


// The three-step working rhythm, in the hero's side card.
const FLOW = [
  { title: 'Impor data', hint: 'Ekspor Shopee per brand' },
  { title: 'Baca performanya', hint: 'KPI, funnel, produk' },
  { title: 'Susun laporannya', hint: 'PDF / PNG / Excel' },
];

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8h9M8.5 4l4 4-4 4" />
    </svg>
  );
}


function ModuleRow({ item }) {
  const { Icon } = item;
  return (
    <Link to={item.to} className="home-row" style={{ '--row-accent': item.accent, '--row-tint': item.tint }}>
      <span className="home-row-ico" aria-hidden>
        <Icon className="home-row-ico-svg" />
      </span>
      <span className="home-row-main">
        <span className="home-row-head">
          <span className="home-row-name">{item.label}</span>
          <span className="home-row-tagline">{item.tagline}</span>
        </span>
        <span className="home-row-desc">{item.desc}</span>
      </span>
      <span className="home-row-go" aria-hidden>
        <Arrow />
      </span>
    </Link>
  );
}

export default function HomePage() {
  const { user, isAdmin, isViewOnly, can } = useAuth();
  // Admin-only modules are hidden rather than shown-and-blocked: a link that
  // bounces you to the dashboard is worse than no link. ProtectedRoute is
  // still the thing that actually enforces this.
  // Same rule as the sidebar: a card shows only if this role may open it.
  const PERMISSION_OF = {
    dashboard: 'dashboard', 'daily-tracking': 'daily_tracking', 'brand-settings': 'brand_settings', 'brand-data': 'brand_settings', 'report-generator': 'report_generator',
    'meta-automation': 'meta_automation', 'internal-dashboard': 'internal_dashboard', 'control-center': 'control_center', history: 'history',
  };
  const allowed = (m) => (!PERMISSION_OF[m.key] || can(PERMISSION_OF[m.key])) && (!m.adminOnly || m.key !== 'access' || (isAdmin && !isViewOnly));
  const modules = MODULES.filter(allowed);
  const utilities = UTILITIES.filter(allowed);
  const firstName = (user?.full_name || user?.fullName || '').trim().split(' ')[0];

  return (
    // Two elements, not one: the stylesheet nests every rule under .mil-ui, so
    // `.home` reads as `.mil-ui .home` — a descendant. Both classes on a single
    // node and that rule silently never matches. .atlas-home stays on the outer
    // node because atlas-fit.css targets it as a direct child of .main-content.
    <div className="mil-ui atlas-home">
      <div className="home">
        <section className="home-top bleed">
          <Reveal className="home-band">
            <MilMark className="home-band-mark" />

            <div className="home-band-copy">
              <img src={atlasWordmark} alt="ATLAS — MIL Digital" className="home-band-logo" />
              <h1 className="home-band-title">
                {firstName ? `Selamat datang, ${firstName}.` : 'Data klien dan laporannya, satu tempat.'}
              </h1>
              <p className="home-band-lede">
                Dari file ekspor mentah ke analitik dan laporan klien — Meta, Shopee, dan TikTok dalam satu aplikasi.
              </p>
              <div className="home-band-actions">
                <Link to="/dashboard" className="btn home-band-cta">
                  Buka dashboard
                </Link>
                <Link to="/report-generator/meta" className="btn home-band-cta ghost">
                  Buat laporan
                </Link>
                <Link to="/selamat-datang" className="btn home-band-cta ghost">
                  {can('homepage_content') && !isViewOnly ? 'Kelola homepage publik' : 'Lihat homepage publik'}
                </Link>
              </div>
            </div>

            <aside className="home-flowcard" aria-label="Alur kerja di ATLAS">
              <span className="home-flowcard-title">Alur</span>
              <ol className="home-flowcard-list">
                {FLOW.map((f, i) => (
                  <li key={f.title} className="home-flowcard-step">
                    <span className="home-flowcard-dot" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="home-flowcard-text">
                      <span className="home-flowcard-step-title">{f.title}</span>
                      <span className="home-flowcard-hint">{f.hint}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </aside>
          </Reveal>
        </section>

        <section className="home-cut home-cut-index">
          <div className="bleed">
            <header className="home-cut-head">
              <h2 className="home-h2">Modul</h2>
              <p className="home-cut-sub">
                Modul yang bisa dibuka akun Anda.
              </p>
            </header>
            <div className="home-index">
              {modules.map((m, i) => (
                <Reveal key={m.key} delay={i * 45}>
                  <ModuleRow item={m} />
                </Reveal>
              ))}
            </div>

            <div className="home-utils">
              {utilities.map(({ key, to, label, tagline, Icon }) => (
                <Link key={key} to={to} className="home-util">
                  <span className="home-util-ico" aria-hidden>
                    <Icon className="home-util-ico-svg" />
                  </span>
                  <span className="home-util-text">
                    <span className="home-util-name">{label}</span>
                    <span className="home-util-desc">{tagline}</span>
                  </span>
                  <Arrow />
                </Link>
              ))}
            </div>
          </div>
        </section>


        <footer className="home-footer">
          <img src={atlasWordmark} alt="" className="home-footer-logo" />
          <span>MIL Digital · ATLAS</span>
        </footer>
      </div>
    </div>
  );
}
