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
// in, in English for clients and partners. The first screen holds the pitch,
// the mil mark (the gallery's open photo shows through its letters) and the
// client band; below come a statement that lights up as it is read, MIL's
// numbers, its A.C.T.I.V.E. values, the gallery, the platforms, a bento of
// what ATLAS does, and a closing call. Photos, logos and the three copy
// fields are managed in place by roles Pengaturan Akses allows (the manager
// itself stays in ATLAS's Indonesian).

// Shown until the server's copy arrives (and if it cannot be reached), so the
// first paint is never an empty hero. Mirrors the server defaults.
const DEFAULT_SETTINGS = {
  headline: 'Your ads, all in one place.',
  lede: "ATLAS is MIL Digital's analytics workspace. Meta, Shopee, TikTok and Google data from every client, turned into clear analysis and reports that are ready to send.",
  about: 'MIL Digital runs performance marketing for brands across Meta Ads, Shopee Ads, TikTok GMV Max and Google Ads — from daily campaign execution to monthly client reporting.',
};
// MIL's own figure, from its logofolio ("Trusted by 150+ brands").
const BRANDS_SERVED = 150;
const mediaUrl = (m) => `/api/public/homepage/media/${m.id}?v=${m.version}`;

const STATEMENT =
  "We don't just run ads. We read every rupiah, every click and every order — so our clients always know what is working, and why.";

// MIL's values, worded as in its own deck.
const VALUES = [
  { name: 'Attention', line: 'Consistently focused on our brands, with close attention to performance and data.' },
  { name: 'Care', line: 'A dedicated, caring approach — and we share what we know with our clients.' },
  { name: 'Tailored Strategy', line: 'Strategies tailored to each client’s goals, supported by data.' },
  { name: 'Initiatives', line: 'We act proactively to bring solutions, before we are asked.' },
  { name: 'Visionary', line: 'Thinking about, and planning for, what comes next.' },
  { name: 'Excellence', line: 'Digital marketing specialists offering excellent, reliable service.' },
];

const PLATFORMS = [
  { key: 'meta', name: 'Meta Ads', line: 'Boost, Non-Boost and CPAS — from tables to root cause, period by period.' },
  { key: 'shopee', name: 'Shopee Ads', line: 'Product, Shop and Live ads, read together with store revenue.' },
  { key: 'tiktok', name: 'TikTok GMV Max', line: 'Cost, orders and ROI of GMV Max campaigns across periods.' },
  { key: 'google', name: 'Google Ads', line: 'Campaigns, keywords and search terms, pulled in automatically every day.' },
];

// The bars in the Report Generator tile are a drawing, not data: two periods
// side by side, the way the reports compare them.
const BARS = [
  [38, 52],
  [54, 61],
  [46, 72],
  [62, 70],
  [50, 84],
  [58, 92],
];
const FUNNEL = [100, 72, 46, 28];

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
  if (value === undefined) return <span ref={ref} className="lp-skel" aria-label="Loading" />;
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

// A sentence that lights up word by word as it is scrolled through — read at
// the pace of the reader rather than on a timer.
function Statement({ text }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const words = text.split(' ');
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (reduce) {
      el.style.setProperty('--p', '1');
      return undefined;
    }
    let raf = 0;
    const read = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 as the block's top reaches 85% of the screen, 1 as its bottom
      // passes 45%.
      const p = (vh * 0.85 - r.top) / (r.height + vh * 0.4);
      el.style.setProperty('--p', String(Math.min(1, Math.max(0, p))));
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
  }, [reduce]);
  return (
    <section className="lp-statement" aria-label="MIL Digital">
      <p ref={ref} style={{ '--n': words.length }}>
        {words.map((w, i) => (
          <Fragment key={i}>
            {i > 0 && ' '}
            <span style={{ '--k': i }}>{w}</span>
          </Fragment>
        ))}
      </p>
    </section>
  );
}

// The ink-on-blue pill with a round arrow chip; the arrow leaves through the
// corner and a fresh one arrives behind it on hover.
function PillCta({ to, children, size, tone }) {
  return (
    <Link to={to} className={`lp-cta${size === 'lg' ? ' lp-cta-lg' : ''}${tone === 'light' ? ' is-light' : ''}`}>
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
    <div className="lp-lightbox" role="dialog" aria-modal="true" aria-label={p.title || 'Photo'} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <figure>
        <img src={p.url} alt={p.title || ''} />
        {(p.title || p.caption) && (
          <figcaption>
            {p.title && <strong>{p.title}</strong>}
            {p.caption && <span>{p.caption}</span>}
          </figcaption>
        )}
      </figure>
      <button type="button" className="lp-lb-btn lp-lb-close" onClick={onClose} aria-label="Close">
        <X size={20} />
      </button>
      {photos.length > 1 && (
        <>
          <button type="button" className="lp-lb-btn lp-lb-prev" onClick={() => onIndex((index - 1 + photos.length) % photos.length)} aria-label="Previous photo">
            <ChevronLeft size={22} />
          </button>
          <button type="button" className="lp-lb-btn lp-lb-next" onClick={() => onIndex((index + 1) % photos.length)} aria-label="Next photo">
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
    <section id="values" className="lp-values" aria-labelledby="lp-values-title" ref={ref}>
      <div className="lp-values-head" data-reveal>
        <h2 id="lp-values-title">
          Why <em>MIL Digital</em>
        </h2>
        <p>Six values we bring to every client account — together, A.C.T.I.V.E.</p>
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

// A soft light follows the pointer across each bento tile.
function spotlight(e) {
  const tile = e.target.closest('.lp-tile');
  if (!tile) return;
  const r = tile.getBoundingClientRect();
  tile.style.setProperty('--mx', `${e.clientX - r.left}px`);
  tile.style.setProperty('--my', `${e.clientY - r.top}px`);
}

function Inside({ home, signedIn }) {
  return (
    <section id="atlas" className="lp-inside" aria-labelledby="lp-inside-title">
      <div className="lp-inside-head" data-reveal>
        <h2 id="lp-inside-title">
          Inside <em>ATLAS</em>
        </h2>
        <p>One workspace for every client’s data — from the raw export to the report that gets sent.</p>
      </div>
      <div className="lp-bento" onPointerMove={spotlight}>
        <article className="lp-tile lp-tile-report" data-reveal style={{ '--i': 0 }}>
          <div className="lp-tile-copy">
            <strong>Report Generator</strong>
            <p>Two-period reports for Meta, Shopee, TikTok and Google, ready to download as PDF, PNG or Excel.</p>
          </div>
          <div className="lp-bars" aria-hidden="true">
            {BARS.map(([a, b], i) => (
              <span key={i} style={{ '--i': i }}>
                <i style={{ height: `${a}%` }} />
                <i style={{ height: `${b}%` }} />
              </span>
            ))}
          </div>
          <div className="lp-legend" aria-hidden="true">
            <span>Previous period</span>
            <span>This period</span>
          </div>
        </article>
        <article className="lp-tile lp-tile-daily" data-reveal style={{ '--i': 1 }}>
          <div className="lp-tile-copy">
            <strong>Daily Tracking</strong>
            <p>Daily revenue and ad spend, side by side in one place.</p>
          </div>
          <svg className="lp-spark" viewBox="0 0 300 90" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="lp-spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#1e3eb8" stopOpacity=".22" />
                <stop offset="1" stopColor="#1e3eb8" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="lp-spark-area" d="M0 70 C30 64 45 40 75 46 S120 72 150 50 S200 18 230 30 S275 22 300 8 L300 90 L0 90 Z" fill="url(#lp-spark-fill)" />
            <path className="lp-spark-line" d="M0 70 C30 64 45 40 75 46 S120 72 150 50 S200 18 230 30 S275 22 300 8" pathLength="1" />
          </svg>
        </article>
        <article className="lp-tile lp-tile-overview" data-reveal style={{ '--i': 2 }}>
          <div className="lp-tile-copy">
            <strong>Business Overview</strong>
            <p>Sales, funnel, products and customers, per brand.</p>
          </div>
          <div className="lp-funnel" aria-hidden="true">
            {FUNNEL.map((w, i) => (
              <i key={i} style={{ '--w': `${w}%`, '--i': i }} />
            ))}
          </div>
        </article>
        <article className="lp-tile lp-tile-platforms" data-reveal style={{ '--i': 3 }}>
          <div className="lp-tile-copy">
            <strong>Four ad platforms, one read</strong>
            <p>Every channel MIL runs, pulled into the same workspace.</p>
          </div>
          <div className="lp-orbit" aria-hidden="true">
            {PLATFORMS.map((p, i) => (
              <span key={p.key} style={{ '--i': i }}>
                <BrandLogo name={p.key} size={22} />
              </span>
            ))}
          </div>
        </article>
      </div>
      <div className="lp-closing" data-reveal>
        <span className="lp-closing-light" aria-hidden="true" />
        <h2>
          See every client’s numbers, <em>clearly.</em>
        </h2>
        <p>Access to ATLAS is given by the MIL Digital team to clients and internal staff.</p>
        <PillCta to={home} size="lg" tone="light">
          {signedIn ? 'Open ATLAS' : 'Sign in to ATLAS'}
        </PillCta>
      </div>
    </section>
  );
}

const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'values', label: 'Values' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'atlas', label: 'ATLAS' },
];

// True while the window is at least `px` tall.
function useTall(px) {
  const query = `(min-height: ${px}px)`;
  const [tall, setTall] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setTall(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return tall;
}

// Where the "+" marks sit on the blueprint grid, in grid cells.
const MARKS = [
  [2, 2],
  [11, 4],
  [20, 2],
  [3, 8],
  [17, 9],
];

export default function LandingPage() {
  const { user, can } = useAuth();
  const tall = useTall(900);
  const [data, setData] = useState(null);
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [managing, setManaging] = useState(false);
  const [section, setSection] = useState('home');
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
  const nav = NAV.filter((n) => n.id !== 'gallery' || showGallery);
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
      let here = 'home';
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
    action: 'View full size',
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
      {/* A blueprint grid over the light, with beams running along its lines
          and a few registration marks — the page's working-drawing layer. */}
      <div className="lp-grid" aria-hidden="true">
        <i className="lp-beam lp-beam-x" />
        <i className="lp-beam lp-beam-y" />
        {MARKS.map(([x, y]) => (
          <b key={`${x}-${y}`} style={{ '--gx': x, '--gy': y }} />
        ))}
      </div>
      <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}`}>
        <a href="#home" className="lp-nav-brand" aria-label="ATLAS — MIL Digital">
          <img src={atlasWordmark} alt="ATLAS — MIL Digital" />
        </a>
        <nav className="lp-nav-links" aria-label="Page sections" ref={navRef}>
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
          <PillCta to={home}>{user ? 'Open ATLAS' : 'Sign in'}</PillCta>
        </div>
        <span className="lp-nav-progress" aria-hidden="true" />
      </header>

      <main>
        {/* The first screen: pitch on the left, the mark on the right, and the
            client band already in view at its foot. */}
        <div className="lp-first">
          <section id="home" className="lp-hero" aria-label="MIL Digital">
            <div className="lp-hero-copy">
              <Headline text={settings.headline} key={settings.headline} />
              <p className="lp-lede">{settings.lede}</p>
              <div className="lp-hero-actions">
                <PillCta to={home} size="lg">
                  {user ? 'Open ATLAS' : 'Sign in to ATLAS'}
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
                    <strong>{BRANDS_SERVED}+ brands</strong>
                    <span>{data?.stats?.activeClients ? `${data.stats.activeClients} active clients on ATLAS today` : 'trust MIL Digital with their ads'}</span>
                  </span>
                </div>
              </div>
            </div>
            <div className="lp-stage-wrap">
              <span className="lp-rings" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <div className="lp-stage">
                <MilWindow photos={photos} active={active} label={photos[active]?.title ? `MIL — photo: ${photos[active].title}` : 'MIL Digital logo'} />
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
            <section className="lp-clients" aria-label="MIL Digital clients">
              <p className="lp-divider">
                <span>Brands growing with MIL Digital</span>
              </p>
              <LogoMarquee logos={logos} rows={tall ? 2 : 1} />
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

        <Statement text={STATEMENT} />

        <section id="portfolio" className="lp-portfolio">
          <div className="lp-portfolio-copy" data-reveal>
            <h2>
              About <em>MIL Digital</em>
            </h2>
            <p>{settings.about}</p>
          </div>
          <dl className="lp-facts">
            <div data-reveal style={{ '--i': 0 }}>
              <dt>Brands served</dt>
              <dd>
                <CountUp value={BRANDS_SERVED} suffix="+" />
              </dd>
            </div>
            <div data-reveal style={{ '--i': 1 }}>
              <dt>Active clients today</dt>
              <dd>
                <CountUp value={data ? data.stats?.activeClients ?? null : undefined} />
              </dd>
            </div>
            <div data-reveal style={{ '--i': 2 }}>
              <dt>Ad platforms managed</dt>
              <dd>
                <CountUp value={PLATFORMS.length} />
              </dd>
            </div>
          </dl>
        </section>

        <Values />

        {showGallery && (
          <section id="gallery" className="lp-gallery" aria-labelledby="lp-gallery-title">
            {count > 0 ? (
              <div data-reveal>
                <SqueezeCarousel
                  slides={slides}
                  onIndexChange={setActive}
                  label="MIL Digital gallery"
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
                        Behind the scenes at <em>MIL Digital</em>
                      </h2>
                      <p>The team, our clients and the everyday work. Hover a photo to widen it; click to open it.</p>
                    </div>
                  }
                />
              </div>
            ) : (
              <div className="lp-gallery-empty" data-reveal>
                <h2 id="lp-gallery-title">
                  Behind the scenes at <em>MIL Digital</em>
                </h2>
                <p>Belum ada foto. Galeri ini tersembunyi dari pengunjung sampai foto pertama diunggah — foto yang sama juga tampil di dalam huruf mil.</p>
                <button type="button" className="lp-ghost" onClick={() => setManaging(true)}>
                  <ImagePlus size={16} aria-hidden /> Tambah foto galeri
                </button>
              </div>
            )}
          </section>
        )}

        <section className="lp-platforms" aria-labelledby="lp-platform-title">
          <h2 id="lp-platform-title" data-reveal>
            Platforms we <em>manage</em>
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

        <Inside home={home} signedIn={Boolean(user)} />
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
