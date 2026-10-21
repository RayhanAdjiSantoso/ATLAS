import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowRight, ArrowUpRight, Building2, FileBarChart, FolderOpen, LayoutDashboard,
  NotebookPen, ShieldCheck, Sparkles, Target,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import api from '../api/client.js';
import { BrandLogo } from '../reportGenerator/components/BrandLogo';
import { LogoMarquee } from '../components/landing/LogoMarquee.jsx';
import { computeKpis, totalForKind } from '../dailyTracking/lib/summary.js';
import atlasIcon from '../assets/atlas-icon.png';
import atlasWordmark from '../assets/atlas-wordmark.png';
import './beranda.css';

// Beranda — the first screen after sign-in, for the team and for clients.
// It opens on who you are (a greeting and the date; a client also sees its
// own month in three live numbers), then where to go (the workspace, grouped
// the way work flows: put data in, read it, report it), how ATLAS fits
// together, and the brands MIL Digital runs. Every card is a link; a card
// shows only if the account may open it (same rule as the sidebar).
//
// Proportions follow the golden ratio (beranda.css): the hero splits its
// copy and the orbit 1.618 : 1, and spacing steps along the Fibonacci
// scale (8 · 13 · 21 · 34 · 55 · 89).

const MODULES = [
  {
    key: 'brand-settings', to: '/pengaturan-brand', group: 'input', module: 'brand_settings',
    label: 'Setup Context & Brand Direction', tagline: 'Langkah pertama', Icon: NotebookPen,
    desc: "Client's Status, Brand Context, dan Brand Direction yang dibaca seluruh analisis ATLAS.",
  },
  {
    key: 'brand-data', to: '/data-brand', group: 'input', module: 'brand_settings',
    label: 'Data Collection Hub', tagline: 'File & akun iklan', Icon: FolderOpen,
    desc: 'File bulanan tiap marketplace dan otomasi Meta & Google Ads.',
  },
  {
    key: 'daily-tracking', to: '/brand-tracking', group: 'input', module: 'daily_tracking',
    label: 'Brand Tracking', tagline: 'Harian & target', Icon: Activity,
    desc: 'Revenue dan belanja iklan harian, target bulanan, alokasi budget per channel, dan Minutes of Meeting.',
  },
  {
    key: 'dashboard', to: '/dashboard', group: 'read', module: 'dashboard',
    label: 'Brand Overview', tagline: 'Analitik lintas channel', Icon: LayoutDashboard,
    desc: 'Executive Snapshot, ROAS per channel, funnel, produk, dan pelanggan — per brand dan periode.',
  },
  {
    key: 'report-generator', to: '/report-generator/meta', group: 'read', module: 'report_generator',
    label: 'Report Generator', tagline: 'Meta, Shopee, TikTok, Google', Icon: FileBarChart,
    desc: 'Bandingkan dua periode, susun insight, lalu unduh laporan klien sebagai PDF, PNG, atau Excel.',
  },
  {
    key: 'internal-dashboard', to: '/internal-dashboard', group: 'ops', module: 'internal_dashboard',
    label: 'Business Insight', tagline: 'Portofolio klien', Icon: Building2,
    desc: 'Benchmark antar klien, business check-up, industri, dan kualitas data yang masuk.',
  },
  {
    key: 'access', to: '/pengaturan-akses', group: 'ops', adminOnly: true,
    label: 'Pengaturan Akses', tagline: 'Akun & hak akses', Icon: ShieldCheck,
    desc: 'Akun tim dan klien, role, serta modul yang boleh dibuka tiap role.',
  },
];

const GROUPS = [
  { id: 'input', title: 'Masukkan data', hint: 'Profil brand, file, dan angka harian' },
  { id: 'read', title: 'Baca & laporkan', hint: 'Analisis dan laporan klien' },
  { id: 'ops', title: 'Operasional', hint: 'Otomasi, portofolio, dan akses' },
];

const FLOW = [
  { title: 'Kenali Brand Lebih Jauh', hint: 'Input Context & Direction', Icon: NotebookPen },
  { title: 'Kumpulkan Data', hint: 'Input File Manual ataupun Otomatis', Icon: FolderOpen },
  { title: 'Baca Performa', hint: 'Generating Data Keseluruhan', Icon: LayoutDashboard },
  { title: 'Susun Laporan', hint: 'PDF · PNG · Excel', Icon: FileBarChart },
];

const pad = (n) => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const greetingOf = (h) => (h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 19 ? 'Selamat sore' : 'Selamat malam');
const rpShort = (v) => {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e9) return `Rp${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (Math.abs(v) >= 1e6) return `Rp${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  return `Rp${Math.round(v).toLocaleString('id-ID')}`;
};

const prefersReduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// A number that counts up once, the first time it has a value.
// `ready`: the request finished — a null value then reads "—", not loading.
function CountUp({ value, ready = true, format = (v) => Math.round(v).toLocaleString('id-ID') }) {
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (value == null) return undefined;
    if (prefersReduced()) { setShown(value); return undefined; }
    let raf;
    const start = performance.now();
    const tick = (t) => {
      const k = Math.min((t - start) / 1100, 1);
      setShown(value * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  if (value == null) return ready ? <>—</> : <span className="hb-skel" aria-label="Memuat" />;
  return <>{format(shown ?? 0)}</>;
}

// Adds .is-in to every [data-hb-reveal] under `ref` as it scrolls into view.
function useReveal(ref) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const items = root.querySelectorAll('[data-hb-reveal]');
    if (prefersReduced() || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-in'));
      return undefined;
    }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
}

// Cursor-following light on the module grid.
function spotlight(e) {
  const card = e.target.closest?.('.hb-card');
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', `${e.clientX - r.left}px`);
  card.style.setProperty('--my', `${e.clientY - r.top}px`);
}

function Orbit() {
  return (
    <div className="hb-orbit" aria-hidden="true">
      <span className="hb-orbit-ring is-1" />
      <span className="hb-orbit-ring is-2" />
      <span className="hb-orbit-ring is-3" />
      <div className="hb-orbit-spin">
        {['meta', 'shopee', 'tiktok', 'google'].map((k, i) => (
          <span key={k} className="hb-orbit-node" style={{ '--a': `${i * 90}deg` }}>
            <span className="hb-orbit-chip"><BrandLogo name={k} size={22} /></span>
          </span>
        ))}
      </div>
      <div className="hb-orbit-core">
        <img src={atlasIcon} alt="" />
      </div>
      <span className="hb-orbit-spark is-a" />
      <span className="hb-orbit-spark is-b" />
      <span className="hb-orbit-spark is-c" />
    </div>
  );
}

export default function HomePage() {
  const { user, isAdmin, isViewOnly, can, allowedBrandId } = useAuth();
  const rootRef = useRef(null);
  useReveal(rootRef);

  const allowed = (m) => (!m.module || can(m.module)) && (!m.adminOnly || (isAdmin && !isViewOnly));
  const modules = MODULES.filter(allowed);
  const groups = GROUPS.map((g) => ({ ...g, items: modules.filter((m) => m.group === g.id) })).filter((g) => g.items.length);
  const isClient = Boolean(allowedBrandId);

  const fullName = (user?.full_name || user?.fullName || '').trim();
  const firstName = fullName.split(' ')[0];
  const now = new Date();
  const dateLabel = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const [brands, setBrands] = useState(null);
  const [clientStats, setClientStats] = useState(null);
  const [logos, setLogos] = useState([]);
  const [activeClients, setActiveClients] = useState(null);

  useEffect(() => {
    let alive = true;
    // The brand list only names a client's own brand here.
    if (allowedBrandId) api.get('/brands').then(({ data }) => alive && setBrands(data.brands ?? [])).catch(() => alive && setBrands([]));
    api.get('/public/homepage').then(({ data }) => {
      if (!alive) return;
      setLogos((data.logos ?? []).map((m) => ({ ...m, url: `/api/public/homepage/media/${m.id}?v=${m.version}` })));
      setActiveClients(data.stats?.activeClients ?? null);
    }).catch(() => {});
    // A client's own month, from Brand Tracking: what it sold, its ROAS and
    // how far along its target it is.
    if (allowedBrandId && can('daily_tracking')) {
      const month = thisMonth();
      Promise.all([
        api.get('/daily-tracking/channels', { params: { brandId: allowedBrandId } }),
        api.get('/daily-tracking/entries', { params: { brandId: allowedBrandId, month } }),
        api.get('/daily-tracking/targets', { params: { brandId: allowedBrandId, month } }).catch(() => ({ data: {} })),
      ]).then(([ch, en, tg]) => {
        if (!alive) return;
        const k = computeKpis(en.data, ch.data);
        const revenue = totalForKind(en.data, ch.data, 'sales', 'revenue');
        const spend = totalForKind(en.data, ch.data, 'spend', 'amount');
        const target = tg.data?.target?.targetSales ?? null;
        setClientStats({
          revenue, trx: k.totalTransaksi,
          roas: revenue != null && spend ? revenue / spend : null,
          achieved: target && revenue != null ? revenue / target : null, target,
        });
      }).catch(() => alive && setClientStats({}));
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedBrandId]);

  const myBrand = useMemo(() => (isClient ? brands?.find((b) => b.brand_id === allowedBrandId) : null), [brands, isClient, allowedBrandId]);
  const monthName = now.toLocaleDateString('id-ID', { month: 'long' });

  // A client's own month at a glance. The team's Beranda leaves numbers to
  // Brand Overview.
  const pulse = isClient
    ? [
      {
        label: `Revenue ${monthName}`, value: clientStats?.revenue, format: rpShort, ready: clientStats != null, to: '/brand-tracking',
        hint: clientStats && clientStats.revenue == null ? 'Belum ada revenue bulan ini — isi di Brand Tracking' : myBrand?.brand_name ?? 'Brand Anda',
      },
      {
        label: 'ROAS blended', value: clientStats?.roas, ready: clientStats != null, to: '/brand-tracking',
        format: (v) => `${v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`,
        hint: clientStats && clientStats.roas == null ? 'Muncul setelah revenue & belanja iklan terisi' : 'Revenue ÷ belanja iklan',
      },
      {
        label: 'Pencapaian target', value: clientStats?.achieved, ready: clientStats != null, to: '/brand-tracking', meter: clientStats?.achieved,
        format: (v) => `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`,
        hint: clientStats?.target ? `dari target ${rpShort(clientStats.target)}` : 'Target bulan ini belum diatur',
      },
    ]
    : [];

  const primary = isClient
    ? { to: '/brand-tracking', label: 'Buka Brand Tracking' }
    : can('dashboard') ? { to: '/dashboard', label: 'Brand Overview' } : { to: modules[0]?.to ?? '/', label: `Buka ${modules[0]?.label ?? 'ATLAS'}` };
  const secondary = !isClient && can('internal_dashboard') ? { to: '/internal-dashboard', label: 'Business Insight' } : null;

  return (
    <div className="hb" ref={rootRef}>
      <section className={`hb-hero${pulse.length ? ' has-pulse' : ''}`} aria-label="Selamat datang">
        <div className="hb-aurora" aria-hidden="true"><i /><i /><i /></div>
        <div className="hb-grid" aria-hidden="true" />
        <div className="hb-hero-copy">
          <span className="hb-kicker"><i aria-hidden="true" /> {dateLabel}</span>
          <h1>
            {greetingOf(now.getHours())}{firstName ? ',' : '.'}
            {firstName && <><br /><span className="hb-name">{firstName}.</span></>}
          </h1>
          <p>
            {isClient
              ? <>Ruang performa <b>{myBrand?.brand_name ?? 'brand Anda'}</b> bersama MIL Digital — isi angka harian, pantau target, dan lihat hasilnya di satu tempat.</>
              : 'Semua data klien, analisis lintas channel, dan laporan siap kirim — Meta, Shopee, TikTok, dan Google dalam satu ruang kerja.'}
          </p>
          <div className="hb-actions">
            <Link to={primary.to} className="hb-btn is-primary">{primary.label} <ArrowRight size={17} aria-hidden="true" /></Link>
            {secondary && <Link to={secondary.to} className="hb-btn">{secondary.label} <ArrowRight size={17} aria-hidden="true" /></Link>}
          </div>
        </div>
        <Orbit />
      </section>

      {pulse.length > 0 && (
      <section className="hb-pulse" aria-label="Bulan ini">
        {pulse.map((p, i) => {
          const Tag = p.to ? Link : 'div';
          return (
            <Tag key={p.label} {...(p.to ? { to: p.to } : {})} className={`hb-stat${p.tone ? ` is-${p.tone}` : ''}`} style={{ '--i': i }}>
              <span className="hb-stat-label">{p.label}</span>
              <strong className="hb-stat-value"><CountUp value={p.value} format={p.format} ready={p.ready !== false} /></strong>
              <span className="hb-stat-hint">{p.hint}</span>
              {p.meter != null && <span className="hb-stat-meter" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(p.meter, 1)})` }} /></span>}
              {p.to && <ArrowUpRight className="hb-stat-go" size={16} aria-hidden="true" />}
            </Tag>
          );
        })}
      </section>
      )}

      <section className="hb-section" aria-labelledby="hb-work-title">
        <header className="hb-section-head" data-hb-reveal>
          <span className="hb-eyebrow"><Sparkles size={14} aria-hidden="true" /> Workspace</span>
          <h2 id="hb-work-title">{isClient ? 'Yang bisa Anda buka' : 'Mulai darimana Hari Ini?'}</h2>
        </header>
        <div className="hb-groups" onPointerMove={spotlight}>
          {groups.map((g, gi) => (
            <div key={g.id} className="hb-group" data-hb-reveal style={{ '--d': `${gi * 90}ms` }}>
              <div className="hb-group-head">
                <h3>{g.title}</h3>
                <p>{g.hint}</p>
              </div>
              <div className="hb-cards">
                {g.items.map((m) => (
                  <Link key={m.key} to={m.to} className="hb-card">
                    <span className="hb-card-light" aria-hidden="true" />
                    <span className="hb-card-ico" aria-hidden="true"><m.Icon size={20} /></span>
                    <span className="hb-card-body">
                      <span className="hb-card-tag">{m.tagline}</span>
                      <strong>{m.label}</strong>
                      <span className="hb-card-desc">{m.desc}</span>
                    </span>
                    <ArrowUpRight className="hb-card-go" size={18} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {!isClient && (
        <section className="hb-section hb-flow" aria-labelledby="hb-flow-title" data-hb-reveal>
          <header className="hb-section-head">
            <span className="hb-eyebrow"><Target size={14} aria-hidden="true" /> WORKSPACE </span>
            <h2 id="hb-flow-title">Raw Data Jadi Laporan Klien.</h2>
          </header>
          <ol className="hb-steps">
            {FLOW.map((s, i) => (
              <li key={s.title} style={{ '--i': i }}>
                <span className="hb-step-ico" aria-hidden="true"><s.Icon size={20} /></span>
                <span className="hb-step-num">{pad(i + 1)}</span>
                <strong>{s.title}</strong>
                <small>{s.hint}</small>
              </li>
            ))}
          </ol>
        </section>
      )}

      {logos.length > 0 && (
        <section className="hb-clients" aria-labelledby="hb-clients-title" data-hb-reveal>
          <div className="hb-clients-head">
            <h2 id="hb-clients-title">Brand yang tumbuh bersama MIL Digital</h2>
            {activeClients != null && <span><b><CountUp value={activeClients} /></b> brand aktif saat ini</span>}
          </div>
          <LogoMarquee logos={logos} rows={logos.length >= 16 ? 2 : 1} />
        </section>
      )}

      <footer className="hb-footer">
        <img src={atlasWordmark} alt="ATLAS" />
        <span>MIL Digital · Analytics workspace</span>
      </footer>
    </div>
  );
}
