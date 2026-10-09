import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowRight, ArrowUpRight, Building2, FileBarChart, FolderOpen, LayoutDashboard, Megaphone,
  NotebookPen, Radar, ShieldCheck, Sparkles, Target,
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
// It opens on who you are and what today looks like (a greeting, the date,
// and three live numbers), then where to go (the workspace, grouped the way
// work flows: put data in, read it, report it), how ATLAS fits together, and
// the brands MIL Digital runs. Every number is live; every card is a link;
// a card shows only if the account may open it (same rule as the sidebar).

const MODULES = [
  {
    key: 'brand-settings', to: '/pengaturan-brand', group: 'input', module: 'brand_settings',
    label: 'Brand Context', tagline: 'Langkah pertama', Icon: NotebookPen,
    desc: 'Status klien, brand context, dan current direction yang dibaca seluruh analisis ATLAS.',
  },
  {
    key: 'brand-data', to: '/data-brand', group: 'input', module: 'brand_settings',
    label: 'Data Collection Hub', tagline: 'File & akun iklan', Icon: FolderOpen,
    desc: 'File bulanan tiap marketplace, Minutes of Meeting, dan otomasi Meta & Google Ads.',
  },
  {
    key: 'daily-tracking', to: '/brand-tracking', group: 'input', module: 'daily_tracking',
    label: 'Brand Tracking', tagline: 'Harian & target', Icon: Activity,
    desc: 'Revenue dan belanja iklan harian, target bulanan, dan alokasi budget per channel.',
  },
  {
    key: 'dashboard', to: '/dashboard', group: 'read', module: 'dashboard',
    label: 'Business Overview', tagline: 'Analitik lintas channel', Icon: LayoutDashboard,
    desc: 'Executive Snapshot, ROAS per channel, funnel, produk, dan pelanggan — per brand dan periode.',
  },
  {
    key: 'report-generator', to: '/report-generator/meta', group: 'read', module: 'report_generator',
    label: 'Report Generator', tagline: 'Meta, Shopee, TikTok, Google', Icon: FileBarChart,
    desc: 'Bandingkan dua periode, susun insight, lalu unduh laporan klien sebagai PDF, PNG, atau Excel.',
  },
  {
    key: 'meta-automation', to: '/meta-automation', group: 'ops', module: 'meta_automation',
    label: 'Meta Ads Automation', tagline: 'Laporan terjadwal', Icon: Megaphone,
    desc: 'Akun, langganan notifikasi, dan laporan Meta Ads harian & mingguan yang terkirim sendiri.',
  },
  {
    key: 'internal-dashboard', to: '/internal-dashboard', group: 'ops', module: 'internal_dashboard',
    label: 'Internal Dashboard', tagline: 'Portofolio klien', Icon: Building2,
    desc: 'Benchmark antar klien, business check-up, industri, dan kualitas data yang masuk.',
  },
  {
    key: 'control-center', to: '/pusat-kendali', group: 'ops', module: 'control_center',
    label: 'Pusat Kendali', tagline: 'Yang perlu ditindak', Icon: Radar,
    desc: 'Brand yang datanya belum lengkap dan to do meeting yang tertunda, lintas klien.',
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
  { title: 'Kenali brand', hint: 'Context & direction', Icon: NotebookPen },
  { title: 'Kumpulkan data', hint: 'File, API, angka harian', Icon: FolderOpen },
  { title: 'Baca performa', hint: 'ROAS, funnel, produk', Icon: LayoutDashboard },
  { title: 'Susun laporan', hint: 'PDF · PNG · Excel', Icon: FileBarChart },
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
  const [summary, setSummary] = useState(null);
  const [clientStats, setClientStats] = useState(null);
  const [logos, setLogos] = useState([]);
  const [activeClients, setActiveClients] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/brands').then(({ data }) => alive && setBrands(data.brands ?? [])).catch(() => alive && setBrands([]));
    if (can('control_center')) {
      api.get('/control-center/summary').then(({ data }) => alive && setSummary(data)).catch(() => {});
    }
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
  const activeCount = brands ? brands.filter((b) => b.status === 'active').length : null;
  const monthName = now.toLocaleDateString('id-ID', { month: 'long' });

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
    : [
      { label: 'Brand aktif', value: activeCount, ready: brands != null, hint: brands ? `${brands.length} brand terdaftar` : 'Memuat…', to: can('brand_settings') ? '/pengaturan-brand' : null },
      ...(summary ? [
        { label: 'To do tertunda', value: summary.overdueTasks ?? 0, hint: 'Dari Minutes of Meeting', to: '/pusat-kendali', tone: summary.overdueTasks ? 'warn' : null },
        { label: 'Perlu tindakan data', value: summary.dataAttention ?? 0, hint: 'Brand bulan ini', to: '/pusat-kendali', tone: summary.dataAttention ? 'warn' : null },
      ] : [
        { label: 'Modul untuk Anda', value: modules.length, hint: 'Sesuai hak akses akun', to: null },
      ]),
    ];

  const primary = isClient
    ? { to: '/brand-tracking', label: 'Buka Brand Tracking' }
    : can('dashboard') ? { to: '/dashboard', label: 'Buka Business Overview' } : { to: modules[0]?.to ?? '/', label: `Buka ${modules[0]?.label ?? 'ATLAS'}` };
  const secondary = !isClient && can('report_generator') ? { to: '/report-generator/meta', label: 'Buat laporan' } : null;

  return (
    <div className="hb" ref={rootRef}>
      <section className="hb-hero" aria-label="Selamat datang">
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
            {secondary && <Link to={secondary.to} className="hb-btn">{secondary.label}</Link>}
            <Link to="/selamat-datang" className="hb-btn is-quiet">
              {can('homepage_content') && !isViewOnly ? 'Kelola homepage publik' : 'Lihat homepage publik'} <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <Orbit />
      </section>

      <section className="hb-pulse" aria-label="Hari ini">
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

      <section className="hb-section" aria-labelledby="hb-work-title">
        <header className="hb-section-head" data-hb-reveal>
          <span className="hb-eyebrow"><Sparkles size={14} aria-hidden="true" /> Ruang kerja</span>
          <h2 id="hb-work-title">{isClient ? 'Yang bisa Anda buka' : 'Mulai dari mana hari ini?'}</h2>
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
            <span className="hb-eyebrow"><Target size={14} aria-hidden="true" /> Cara kerja ATLAS</span>
            <h2 id="hb-flow-title">Dari data mentah ke laporan klien</h2>
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
