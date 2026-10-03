import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInView, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, ChevronLeft, ChevronRight, ImagePlus, Settings2, X } from 'lucide-react';
import api from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import atlasWordmark from '../assets/atlas-wordmark.png';
import { MilWindow } from '../components/landing/MilWindow.jsx';
import { LogoMarquee } from '../components/landing/LogoMarquee.jsx';
import { SqueezeCarousel } from '../components/landing/SqueezeCarousel.jsx';
import { HomepageManager } from '../components/landing/HomepageManager.jsx';
import { BrandLogo } from '../reportGenerator/components/BrandLogo';
import './landing.css';

// ATLAS's public front door: what anyone with the link sees before logging
// in. MIL Digital's mark opens the page — the gallery's open photo shows
// through its m, i and l — then the brands MIL runs, its A.C.T.I.V.E. values,
// the gallery itself and what ATLAS does. Photos, logos and copy are managed
// in place by roles Pengaturan Akses allows.

// Shown until the server's copy arrives (and if it cannot be reached), so the
// first paint is never an empty hero. Mirrors the server defaults.
const DEFAULT_SETTINGS = {
  headline: 'Performa iklan klien, dibaca dengan jujur.',
  lede: 'ATLAS adalah ruang kerja MIL Digital: data Meta, Shopee, TikTok, dan Google dari setiap klien diolah jadi analitik dan laporan yang siap dibaca.',
  about: 'MIL Digital mengelola iklan performa untuk brand di Meta Ads, Shopee Ads, TikTok GMV Max, dan Google Ads — dari eksekusi kampanye harian sampai laporan bulanan ke klien.',
};
// MIL's own figure, from its logofolio ("Trusted by 150+ brands").
const BRANDS_SERVED = 150;
const mediaUrl = (m) => `/api/public/homepage/media/${m.id}?v=${m.version}`;

const VALUES = [
  { name: 'Attention', line: 'Fokus penuh pada brand klien, dengan perhatian dekat pada performa dan data.' },
  { name: 'Care', line: 'Pendampingan yang sungguh-sungguh — dan kami berbagi pengetahuan dengan klien.' },
  { name: 'Tailored Strategy', line: 'Strategi yang disusun untuk tujuan tiap klien, didukung data.' },
  { name: 'Initiatives', line: 'Bergerak proaktif untuk menawarkan solusi, sebelum diminta.' },
  { name: 'Visionary', line: 'Berpikir dan merencanakan untuk apa yang datang berikutnya.' },
  { name: 'Excellence', line: 'Spesialis digital marketing dengan layanan yang unggul dan bisa diandalkan.' },
];

const PLATFORMS = [
  { key: 'meta', name: 'Meta Ads', line: 'Boost, Non-Boost, dan CPAS — dari tabel sampai root cause per periode.' },
  { key: 'shopee', name: 'Shopee Ads', line: 'Iklan Produk, Toko, Live, dan omzet toko dibaca bersama.' },
  { key: 'tiktok', name: 'TikTok GMV Max', line: 'Cost, order, dan ROI campaign GMV Max antar periode.' },
  { key: 'google', name: 'Google Ads', line: 'Campaign, keyword, dan search term, ditarik otomatis tiap hari.' },
];

const INSIDE = [
  { name: 'Business Overview', line: 'Penjualan, funnel, produk, dan pelanggan per brand.' },
  { name: 'Report Generator', line: 'Laporan dua periode, siap diunduh sebagai PDF, PNG, atau Excel.' },
  { name: 'Daily Tracking', line: 'Revenue dan belanja iklan harian di satu tempat.' },
];

// `value` undefined = still loading (a shimmer); null = no data (a dash).
function CountUp({ value, suffix = '' }) {
  const ref = useRef(null);
  const seen = useInView(ref, { once: true, margin: '-60px' });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!seen || value == null) return undefined;
    if (reduce) {
      setShown(value);
      return undefined;
    }
    let raf;
    const start = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - start) / 1100);
      setShown(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, value, reduce]);
  if (value === undefined) return <span ref={ref} className="lp-skel" aria-label="Memuat" />;
  return (
    <span ref={ref}>
      {value === null ? '—' : shown}
      {value !== null && suffix}
    </span>
  );
}

// The headline rises word by word out of its own line. A comma splits it into
// the two lines of the hero, the second in the accent.
function Headline({ text }) {
  const at = text.indexOf(', ');
  const lines = at > 0 ? [text.slice(0, at + 1), text.slice(at + 2)] : [text];
  let n = 0;
  return (
    <h1 className="lp-headline" aria-label={text}>
      {lines.map((line, li) => (
        <span key={li} className={`lp-headline-line${li === 1 ? ' is-accent' : ''}`} aria-hidden="true">
          {line.split(' ').map((word, wi) => (
            <Fragment key={wi}>
              {wi > 0 && ' '}
              <span className="lp-word">
                <span style={{ '--w': n++ }}>{word}</span>
              </span>
            </Fragment>
          ))}
        </span>
      ))}
    </h1>
  );
}

// The dark pill with a round arrow chip; the arrow leaves through the corner
// and a fresh one arrives behind it on hover.
function PillCta({ to, children, size }) {
  return (
    <Link to={to} className={`lp-cta${size === 'lg' ? ' lp-cta-lg' : ''}`}>
      <span>{children}</span>
      <span className="lp-cta-chip" aria-hidden="true">
        <ArrowUpRight size={size === 'lg' ? 18 : 16} />
        <ArrowUpRight size={size === 'lg' ? 18 : 16} />
      </span>
    </Link>
  );
}

function Lightbox({ photos, index, onIndex, onClose }) {
  const p = photos[index];
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % photos.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + photos.length) % photos.length);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, photos.length, onIndex, onClose]);
  if (!p) return null;
  return (
    <div className="lp-lightbox" role="dialog" aria-modal="true" aria-label={p.title || 'Foto'} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <figure>
        <img src={p.url} alt={p.title || ''} />
        {(p.title || p.caption) && (
          <figcaption>
            {p.title && <strong>{p.title}</strong>}
            {p.caption && <span>{p.caption}</span>}
          </figcaption>
        )}
      </figure>
      <button type="button" className="lp-lb-btn lp-lb-close" onClick={onClose} aria-label="Tutup">
        <X size={20} />
      </button>
      {photos.length > 1 && (
        <>
          <button type="button" className="lp-lb-btn lp-lb-prev" onClick={() => onIndex((index - 1 + photos.length) % photos.length)} aria-label="Foto sebelumnya">
            <ChevronLeft size={22} />
          </button>
          <button type="button" className="lp-lb-btn lp-lb-next" onClick={() => onIndex((index + 1) % photos.length)} aria-label="Foto berikutnya">
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </div>
  );
}

// Six values, one column per letter of A.C.T.I.V.E. While the section is on
// screen the highlight walks the letters by itself; a pointer or focus takes
// it over.
function Values() {
  const ref = useRef(null);
  const inView = useInView(ref, { margin: '-20% 0px' });
  const reduce = useReducedMotion();
  const [hot, setHot] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!inView || held || reduce) return undefined;
    const t = window.setInterval(() => setHot((h) => (h + 1) % VALUES.length), 2600);
    return () => window.clearInterval(t);
  }, [inView, held, reduce]);
  const take = (i) => {
    setHeld(true);
    setHot(i);
  };
  return (
    <section id="nilai" className="lp-values" aria-labelledby="lp-values-title" ref={ref}>
      <div className="lp-values-head" data-reveal>
        <h2 id="lp-values-title">
          Kenapa <em>MIL Digital</em>
        </h2>
        <p>Enam nilai yang kami pegang di setiap akun klien — disingkat A.C.T.I.V.E.</p>
      </div>
      <ol className="lp-values-grid" onMouseLeave={() => setHeld(false)}>
        {VALUES.map((v, i) => (
          <li
            key={v.name}
            className={`lp-value${hot === i ? ' is-hot' : ''}`}
            style={{ '--i': i }}
            data-reveal
            tabIndex={0}
            onMouseEnter={() => take(i)}
            onFocus={() => take(i)}
            onBlur={() => setHeld(false)}
          >
            <span className="lp-value-letter" aria-hidden="true">
              {v.name[0]}
              <i>.</i>
            </span>
            <strong>{v.name}</strong>
            <p>{v.line}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const NAV = [
  { id: 'beranda', label: 'Beranda' },
  { id: 'portofolio', label: 'Portofolio' },
  { id: 'nilai', label: 'Nilai' },
  { id: 'galeri', label: 'Galeri' },
  { id: 'atlas', label: 'ATLAS' },
];

export default function LandingPage() {
  const { user, can } = useAuth();
  const [data, setData] = useState(null);
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [managing, setManaging] = useState(false);
  const [section, setSection] = useState('beranda');
  const [scrolled, setScrolled] = useState(false);
  const [pill, setPill] = useState(null);
  const rootRef = useRef(null);
  const navRef = useRef(null);

  const load = useCallback(() => {
    api
      .get('/public/homepage')
      .then(({ data: d }) => {
        const withUrl = (list) => list.map((m) => ({ ...m, url: mediaUrl(m) }));
        setData({ ...d, photos: withUrl(d.photos), logos: withUrl(d.logos) });
      })
      .catch(() => setData({ photos: [], logos: [], settings: null, stats: { activeClients: null } }));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    document.title = 'ATLAS — MIL Digital';
  }, []);

  const photos = data?.photos ?? [];
  const logos = data?.logos ?? [];
  const settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
  const count = photos.length;
  const canManage = Boolean(user) && can('homepage_content') && !user?.isViewOnly;
  const showGallery = count > 0 || canManage;
  const nav = NAV.filter((n) => n.id !== 'galeri' || showGallery);
  // Compact marks read best inside the trust row's circles.
  const faces = logos.filter((l) => l.width && l.height && l.width / l.height < 1.45).slice(0, 4);

  useEffect(() => {
    if (active >= count && count) setActive(0);
  }, [active, count]);

  // The nav turns solid once the page moves under it, and its pill follows
  // the last section whose top has passed 40% of the screen — read from the
  // scroll position, so it is right whichever way the page is moving.
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      setScrolled(window.scrollY > 8);
      const line = window.innerHeight * 0.4;
      let here = 'beranda';
      NAV.forEach((n) => {
        const el = document.getElementById(n.id);
        if (el && el.getBoundingClientRect().top <= line) here = n.id;
      });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) here = 'atlas';
      setSection(here);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [showGallery, data]);

  // The active pill slides under whichever link is current.
  useLayoutEffect(() => {
    const measure = () => {
      const link = navRef.current?.querySelector(`[data-nav="${section}"]`);
      if (link) setPill({ x: link.offsetLeft, w: link.offsetWidth });
    };
    measure();
    document.fonts?.ready.then(measure);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [section, showGallery]);

  // Sections rise into place once, as they first reach the screen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.dataset.in = '';
          io.unobserve(e.target);
        }),
      { rootMargin: '0px 0px -10% 0px' },
    );
    root.querySelectorAll('[data-reveal]:not([data-in])').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [data, showGallery]);

  const slides = photos.map((p, i) => ({
    id: p.id,
    title: p.title || 'MIL Digital',
    description: p.caption || undefined,
    image: p.url,
    imageAlt: p.title || '',
    action: 'Lihat penuh',
    onAction: () => {
      setActive(i);
      setLightbox(true);
    },
    overlay: <span className="sq-mark">MIL Digital</span>,
  }));
  const home = user ? '/' : '/login';

  return (
    <div className="lp" ref={rootRef}>
      {/* Soft blue light that turns slowly behind the first screen. */}
      <div className="lp-aurora" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}`}>
        <a href="#beranda" className="lp-nav-brand" aria-label="ATLAS — MIL Digital">
          <img src={atlasWordmark} alt="ATLAS — MIL Digital" />
        </a>
        <nav className="lp-nav-links" aria-label="Bagian halaman" ref={navRef}>
          {pill && <span className="lp-nav-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden="true" />}
          {nav.map((n) => (
            <a key={n.id} href={`#${n.id}`} data-nav={n.id} aria-current={section === n.id ? 'true' : undefined} className={section === n.id ? 'is-on' : ''}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="lp-nav-actions">
          {canManage && (
            <button type="button" className="lp-ghost" onClick={() => setManaging(true)}>
              <Settings2 size={16} aria-hidden /> Kelola homepage
            </button>
          )}
          <PillCta to={home}>{user ? 'Buka ATLAS' : 'Masuk'}</PillCta>
        </div>
        <span className="lp-nav-progress" aria-hidden="true" />
      </header>

      <main>
        {/* The first screen: pitch on the left, the mark on the right, and the
            client band already in view at its foot. */}
        <div className="lp-first">
          <section id="beranda" className="lp-hero" aria-label="MIL Digital">
            <div className="lp-hero-copy">
              <Headline text={settings.headline} key={settings.headline} />
              <p className="lp-lede">{settings.lede}</p>
              <div className="lp-hero-actions">
                <PillCta to={home} size="lg">
                  {user ? 'Buka ATLAS' : 'Masuk ke ATLAS'}
                </PillCta>
                <div className="lp-trust">
                  {faces.length > 0 && (
                    <span className="lp-faces" aria-hidden="true">
                      {faces.map((l, i) => (
                        <span key={l.id} style={{ '--f': i }}>
                          <img src={l.url} alt="" />
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="lp-trust-copy">
                    <strong>{BRANDS_SERVED}+ brand</strong>
                    <span>{data?.stats?.activeClients ? `${data.stats.activeClients} klien aktif di ATLAS saat ini` : 'mempercayakan iklannya ke MIL Digital'}</span>
                  </span>
                </div>
              </div>
            </div>
            <div className="lp-stage-wrap">
              <div className="lp-stage">
                <MilWindow photos={photos} active={active} label={photos[active]?.title ? `MIL — foto: ${photos[active].title}` : 'Logo MIL Digital'} />
              </div>
              {PLATFORMS.map((p, i) => (
                <span key={p.key} className={`lp-chip lp-chip-${p.key}`} style={{ '--c': i }} aria-hidden="true">
                  <span>
                    <BrandLogo name={p.key} size={18} />
                    {p.name}
                  </span>
                </span>
              ))}
            </div>
          </section>

          {logos.length > 0 ? (
            <section className="lp-clients" aria-label="Klien MIL Digital">
              <p className="lp-divider">
                <span>Brand yang tumbuh bersama MIL Digital</span>
              </p>
              <LogoMarquee logos={logos} />
            </section>
          ) : (
            canManage && (
              <section className="lp-clients is-empty">
                <button type="button" className="lp-link" onClick={() => setManaging(true)}>
                  Belum ada logo klien — tambahkan di Kelola homepage
                </button>
              </section>
            )
          )}
        </div>

        <section id="portofolio" className="lp-portfolio">
          <div className="lp-portfolio-copy" data-reveal>
            <h2>
              Tentang <em>MIL Digital</em>
            </h2>
            <p>{settings.about}</p>
          </div>
          <dl className="lp-facts">
            <div data-reveal style={{ '--i': 0 }}>
              <dt>Brand yang pernah ditangani</dt>
              <dd>
                <CountUp value={BRANDS_SERVED} suffix="+" />
              </dd>
            </div>
            <div data-reveal style={{ '--i': 1 }}>
              <dt>Klien aktif saat ini</dt>
              <dd>
                <CountUp value={data ? data.stats?.activeClients ?? null : undefined} />
              </dd>
            </div>
            <div data-reveal style={{ '--i': 2 }}>
              <dt>Platform iklan yang dikelola</dt>
              <dd>
                <CountUp value={PLATFORMS.length} />
              </dd>
            </div>
          </dl>
        </section>

        <Values />

        {showGallery && (
          <section id="galeri" className="lp-gallery" aria-labelledby="lp-gallery-title">
            {count > 0 ? (
              <div data-reveal>
                <SqueezeCarousel
                  slides={slides}
                  onIndexChange={setActive}
                  label="Galeri MIL Digital"
                  height="clamp(260px, 30cqi, 440px)"
                  gap={14}
                  slatGap={8}
                  slatWidth={10}
                  radius={18}
                  autoplay={!lightbox && !managing}
                  interval={6000}
                  head={
                    <div className="lp-gallery-head">
                      <h2 id="lp-gallery-title">
                        Di balik layar <em>MIL Digital</em>
                      </h2>
                      <p>Tim, klien, dan pekerjaan sehari-hari. Arahkan ke foto untuk melebarkannya, klik untuk membukanya.</p>
                    </div>
                  }
                />
              </div>
            ) : (
              <div className="lp-gallery-empty" data-reveal>
                <h2 id="lp-gallery-title">
                  Di balik layar <em>MIL Digital</em>
                </h2>
                <p>Belum ada foto. Galeri ini tersembunyi dari pengunjung sampai foto pertama diunggah — foto yang sama juga tampil di dalam huruf mil.</p>
                <button type="button" className="lp-ghost" onClick={() => setManaging(true)}>
                  <ImagePlus size={16} aria-hidden /> Tambah foto galeri
                </button>
              </div>
            )}
          </section>
        )}

        <section id="platform" className="lp-platforms" aria-labelledby="lp-platform-title">
          <h2 id="lp-platform-title" data-reveal>
            Platform yang <em>kami kelola</em>
          </h2>
          <ul>
            {PLATFORMS.map((p, i) => (
              <li key={p.key} style={{ '--i': i }} data-reveal>
                <span className="lp-platform-mark" aria-hidden="true">
                  <BrandLogo name={p.key} size={26} />
                </span>
                <strong>{p.name}</strong>
                <span>{p.line}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="atlas" className="lp-atlas" aria-labelledby="lp-atlas-title">
          <div className="lp-atlas-copy" data-reveal>
            <h2 id="lp-atlas-title">
              Di dalam <em>ATLAS</em>
            </h2>
            <p>Satu ruang kerja untuk data setiap klien — dari file ekspor sampai laporan yang dikirim.</p>
            <PillCta to={home}>{user ? 'Buka ATLAS' : 'Masuk ke ATLAS'}</PillCta>
          </div>
          <ol className="lp-atlas-list">
            {INSIDE.map((m, i) => (
              <li key={m.name} data-reveal style={{ '--i': i }}>
                <span className="lp-atlas-n" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <strong>{m.name}</strong>
                <span>{m.line}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="lp-footer">
        <img src={atlasWordmark} alt="" />
        <span>© {new Date().getFullYear()} MIL Digital Marketing Consultant · ATLAS</span>
      </footer>

      {lightbox && count > 0 && <Lightbox photos={photos} index={active} onIndex={setActive} onClose={() => setLightbox(false)} />}
      {managing && <HomepageManager onClose={() => setManaging(false)} onChanged={load} />}
    </div>
  );
}
