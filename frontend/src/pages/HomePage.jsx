import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { LayoutDashboard, FileBarChart, Megaphone, Building2, History } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
// Reveal and MilMark are part of the design system ported from the Monthly
// Report Generator, which is why they live under reportGenerator/components
// rather than components/common — keeping that folder a verbatim copy is what
// makes a later re-sync a file copy instead of a merge.
import { Reveal } from '../reportGenerator/components/Reveal';
import { MilMark } from '../reportGenerator/components/MilMark';
import '../reportGenerator/index.css';
import '../reportGenerator/app/shell.css';
import '../reportGenerator/app/atlas-fit.css';

// ATLAS's front door, built on the Monthly Report Generator's home-page layout
// (the masthead band, the index rows, the three-step band) with ATLAS's own
// content: these are ATLAS's modules, not the generator's report types.
//
// A row per module, not a card. Seven equal-weight cards with an icon, a
// heading and a paragraph is the shape every generated landing page takes, and
// it reads as filler for a tool whose users already know the product — so this
// is built like the tables they spend the day in.

const MODULES = [
  {
    key: 'dashboard',
    to: '/dashboard',
    label: 'Dashboard Business Overview',
    tagline: 'Analitik penjualan Shopee',
    desc: 'KPI, funnel pesanan, tren harian, analisis produk, dan segmentasi pelanggan dari data ekspor Shopee yang sudah diimpor.',
    accent: 'var(--acc)',
    tint: 'var(--acc-100)',
    Icon: LayoutDashboard,
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
];

// A utility, not a module: somewhere you check on the data rather than read it.
const UTILITIES = [
  { key: 'history', to: '/history', label: 'History Upload', tagline: 'Jejak setiap file yang masuk', Icon: History },
];

const STEPS = [
  {
    title: 'Impor data',
    body: 'Unggah file ekspor Shopee — Order, Performance Overview, Product Performance. ATLAS memetakan isinya dan menyimpannya per brand dan per periode.',
  },
  {
    title: 'Baca performanya',
    body: 'Dashboard menyusun KPI, funnel, dan analisis produk dari data yang masuk, jadi tidak ada lagi spreadsheet yang disalin ulang tiap bulan.',
  },
  {
    title: 'Susun laporannya',
    body: 'Report Generator menggabungkan Meta, Shopee, dan TikTok jadi satu laporan periodik dengan delta antar periode — siap dikirim ke klien.',
  },
];

// Short form of the three steps for the hero card. The full explanation stays
// in the "Cara kerjanya" band below — this is the summary, not a second copy.
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

function CometStreak() {
  const reduce = useReducedMotion();
  // A single large-radius arc rather than a bezier: the streak reads as the
  // lit edge of a sphere, and only a near-constant curvature does that — a
  // bezier of the same span looks like a ruled diagonal. It starts past the
  // middle so it sweeps the empty right half instead of ruling a line through
  // the paragraph. preserveAspectRatio="none" lets it stretch with the band.
  const d = 'M 300 520 A 2000 2000 0 0 1 1780 -70';
  return (
    <svg className="home-streak" viewBox="0 0 1600 400" preserveAspectRatio="none" aria-hidden focusable="false">
      <defs>
        <linearGradient id="atlas-streak-g" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#1e3eb8" stopOpacity="0" />
          <stop offset="20%" stopColor="#2f54d4" stopOpacity=".75" />
          <stop offset="48%" stopColor="#5b3fd6" stopOpacity="1" />
          <stop offset="74%" stopColor="#7c3aed" stopOpacity="1" />
          <stop offset="92%" stopColor="#a78bfa" stopOpacity=".8" />
          <stop offset="100%" stopColor="#cbb6f7" stopOpacity="0" />
        </linearGradient>
        <filter id="atlas-streak-glow" x="-25%" y="-90%" width="150%" height="280%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
        <filter id="atlas-streak-glow-tight" x="-25%" y="-90%" width="150%" height="280%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <path d={d} className="home-streak-halo" stroke="url(#atlas-streak-g)" filter="url(#atlas-streak-glow)" />
      <path d={d} className="home-streak-inner" stroke="url(#atlas-streak-g)" filter="url(#atlas-streak-glow-tight)" />
      <motion.path
        d={d}
        className="home-streak-core"
        stroke="url(#atlas-streak-g)"
        initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 1.5, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
      />
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
  const { user, isAdmin } = useAuth();
  // Admin-only modules are hidden rather than shown-and-blocked: a link that
  // bounces you to the dashboard is worse than no link. ProtectedRoute is
  // still the thing that actually enforces this.
  const modules = MODULES.filter((m) => !m.adminOnly || isAdmin);
  const firstName = (user?.full_name || user?.fullName || '').trim().split(' ')[0];

  return (
    // Two elements, not one: the stylesheet nests every rule under .mil-ui, so
    // `.home` reads as `.mil-ui .home` — a descendant. Both classes on a single
    // node and that rule silently never matches. .atlas-home stays on the outer
    // node because atlas-fit.css targets it as a direct child of .main-content.
    <div className="mil-ui atlas-home">
      <div className="home">
        <section className="home-top bleed">
          {/* A pale tinted surface, not a saturated slab: no screen in this
              system paints a saturated background, and the arc and watermark
              carry the interest instead. See .home-band in shell.css. */}
          <Reveal className="home-band">
            <MilMark className="home-band-mark" />
            <CometStreak />

            <div className="home-band-copy">
              <Link to="/report-generator/meta" className="home-badge">
                <span className="home-badge-tag">Baru</span>
                <span className="home-badge-text">Report Generator dengan tampilan baru</span>
                <Arrow />
              </Link>
              <h1 className="home-band-title">
                {firstName ? `Selamat datang, ${firstName}.` : 'Data klien dan laporannya, satu tempat.'}
              </h1>
              <p className="home-band-lede">
                ATLAS mengubah file ekspor mentah jadi analitik yang bisa dibaca dan laporan yang bisa dikirim. Impor
                data Shopee, baca performanya di dashboard, lalu susun laporan Meta, Shopee, dan TikTok tanpa keluar
                dari satu aplikasi.
              </p>
              <div className="home-band-actions">
                <Link to="/dashboard" className="btn home-band-cta">
                  Buka dashboard
                </Link>
                <Link to="/report-generator/meta" className="btn home-band-cta ghost">
                  Buat laporan
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
                {isAdmin
                  ? 'Empat modul, masing-masing punya halaman dan alur datanya sendiri.'
                  : 'Modul yang tersedia untuk akun Anda.'}
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
              {UTILITIES.map(({ key, to, label, tagline, Icon }) => (
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

        <section className="home-cut home-cut-steps">
          <div className="bleed">
            <header className="home-cut-head">
              <h2 className="home-h2">Cara kerjanya</h2>
              <p className="home-cut-sub">Dari file ekspor mentah sampai laporan siap kirim, tiga langkah.</p>
            </header>
            <ol className="home-steps">
              {STEPS.map((s, i) => (
                <Reveal key={s.title} delay={i * 70}>
                  <li className="home-step">
                    <h3 className="home-step-title">{s.title}</h3>
                    <p className="home-step-body">{s.body}</p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <footer className="home-footer">
          <span>MIL Digital · ATLAS</span>
        </footer>
      </div>
    </div>
  );
}
