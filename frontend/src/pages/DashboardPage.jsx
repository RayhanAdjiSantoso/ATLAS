import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, ArrowDown, Minus, ArrowRight, Database } from 'lucide-react';
import FilterPanel from '../components/dashboard/FilterPanel.jsx';
import DashboardTab from '../components/dashboard/DashboardTab.jsx';
import { useConsoleData } from '../components/dashboard/useConsoleData.js';
import {
  DOMAINS,
  DOMAIN_BY_KEY,
  HEADLINES,
  STRIP_METRICS,
  formatStripValue,
} from '../components/dashboard/domains.js';
import '../components/dashboard/console.css';

// Business Overview as a console rather than a tab strip.
//
// The page it replaces put eight equal pill buttons on one line and showed one
// of them at a time, which meant it could never tell you where you were, only
// where you could go — and seven eighths of the analysis was invisible at any
// moment. Here every domain is present: the focused one opens full width with
// its whole body, the rest stay as live summaries underneath, and the KPI strip
// and period bar never leave the screen. Nothing was dropped in the move; the
// focused panel renders exactly the same renderers as before.
//
// "Upload Data" is no longer one of these tabs. Ingest is not analysis, and it
// now lives on its own page (Pengaturan Brand) so every module reads from one
// place instead of each surface growing an uploader.

// Absent and zero must never look alike: a missing figure is an em dash in the
// muted tier that says why on hover, a real zero prints like any other number.
function Figure({ text, absentReason }) {
  if (text == null) {
    return (
      <span className="con-null" title={absentReason || 'Data belum tersedia untuk periode ini'}>
        &mdash;
      </span>
    );
  }
  return <>{text}</>;
}

// Colour carries meaning here and nowhere else on this page. The arrow always
// follows the raw sign; the colour follows the business reading, so a rising
// cancellation rate is red even though the number went up.
function Delta({ value, invert = false }) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const flat = Math.abs(n) < 0.05;
  const rising = n > 0;
  const good = invert ? !rising : rising;
  const cls = flat ? 'is-flat' : good ? 'is-up' : 'is-down';
  const Icon = flat ? Minus : rising ? ArrowUp : ArrowDown;

  return (
    <span className={`con-delta ${cls}`}>
      <Icon size={11} strokeWidth={2.6} />
      {`${n > 0 ? '+' : ''}${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(n)}%`}
    </span>
  );
}

// Bare trend line for the GMV cell. No axes, no tooltip and no library: the
// full daily chart is one click away in Business Growth, and this only has to
// say which way the month went.
function Spark({ values = [] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = span > 0 ? 20 - ((v - min) / span) * 20 : 10;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <svg className="con-spark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden focusable="false">
      <polyline points={points} fill="none" stroke="var(--acc-300)" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// The Executive Snapshot KPI row, pinned. It stays whichever domain is
// focused, which is what lets the snapshot panel below stop repeating it.
function KpiStrip({ entry }) {
  const loading = entry.status === 'loading' || entry.status === 'idle';
  const kpis = entry.data?.kpis || {};
  const trend = (entry.data?.trends || []).map((t) => Number(t.gmv || 0));

  return (
    <div className="con-kpis">
      {STRIP_METRICS.map((m) => {
        const metric = kpis[m.key];
        const text = formatStripValue(metric?.value, m.kind);
        return (
          <div className="con-kpi" key={m.key}>
            <div className="con-kpi-label">
              {m.label}
              {m.note && <span className="con-kpi-note" title={m.note} aria-label={m.note}>i</span>}
            </div>
            <div className="con-kpi-val">
              {loading ? <span className="con-skel is-wide" /> : <Figure text={text} />}
            </div>
            <div className="con-kpi-foot">
              {loading
                ? <span className="con-skel is-narrow" style={{ height: '.7rem' }} />
                : <Delta value={metric?.growth} invert={m.invert} />}
              {!loading && m.spark && <Spark values={trend} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModuleCard({ domain, entry, onOpen, index = 0 }) {
  const loading = entry.status === 'loading' || entry.status === 'idle';
  const failed = entry.status === 'error';
  const headline = entry.status === 'ready' ? HEADLINES[domain.key](entry.data) : null;

  return (
    <button type="button" className="con-mod" onClick={onOpen} style={{ '--i': index }}>
      <div className="con-mod-top">{domain.label}</div>

      <div className="con-mod-val">
        {loading && <span className="con-skel is-wide" />}
        {failed && <span className="con-null" title={entry.error}>&mdash;</span>}
        {headline && <Figure text={headline.value} absentReason={headline.caption} />}
      </div>

      <div className="con-mod-cap">
        {loading && <span className="con-skel is-narrow" style={{ height: '.7rem' }} />}
        {failed && 'Gagal dimuat. Buka domain ini untuk mencoba lagi.'}
        {headline && headline.caption}
      </div>

      <div className="con-mod-foot">
        {headline?.delta != null ? <Delta value={headline.delta} /> : <span>Buka analisis</span>}
        <ArrowRight size={13} strokeWidth={2.4} />
      </div>
    </button>
  );
}

export default function DashboardPage() {
  const [activeKey, setActiveKey] = useState('Executive Snapshot');
  const [productLevel, setProductLevel] = useState('category');
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef(null);
  const reduceMotion = useReducedMotion();

  const [filters, setFilters] = useState({
    brandId: '',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    compare: false,
    compareStartDate: '',
    compareEndDate: '',
  });

  const { read, retry } = useConsoleData({ filters, activeKey, productLevel });

  // The control bar gains its edge and shadow only once it has actually left
  // the flow, so a page scrolled to the top shows no seam at all.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { threshold: 1 });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const active = DOMAIN_BY_KEY[activeKey];
  const activeEntry = read(activeKey);
  const others = DOMAINS.filter((d) => d.key !== activeKey);

  return (
    <div className="con">
      <header className="con-head">
        <div>
          <h1>Dashboard Business Overview</h1>
          <p>
            Tujuh sudut analisis atas satu brand dan satu periode. Pilih satu untuk dibuka penuh;
            sisanya tetap terbaca sebagai ringkasan.
          </p>
        </div>
        <span className="con-head-scope">Sumber data Shopee</span>
      </header>

      <div className="con-bar-sentinel" ref={sentinelRef} />
      <div className={`con-bar${stuck ? ' is-stuck' : ''}`}>
        <FilterPanel filters={filters} onChange={setFilters} />
      </div>

      <div className="con-body">
        <nav className="con-rail" aria-label="Domain analisis">
          <div className="con-rail-title">Domain</div>
          {DOMAINS.map((d) => {
            const entry = read(d.key);
            const isActive = d.key === activeKey;
            return (
              <button
                type="button"
                key={d.key}
                className={`con-rail-item${isActive ? ' is-active' : ''}`}
                onClick={() => setActiveKey(d.key)}
                aria-current={isActive ? 'true' : undefined}
                title={d.label}
              >
                {isActive && (
                  <motion.span
                    className="con-rail-glow"
                    layoutId="con-rail-glow"
                    transition={reduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 520, damping: 42, mass: .8 }}
                  />
                )}
                <span className="con-rail-label">{d.label}</span>
                <span
                  className={`con-rail-dot${entry.status === 'ready' ? ' is-ready' : ''}${entry.status === 'loading' ? ' is-loading' : ''}`}
                  aria-hidden
                />
              </button>
            );
          })}

          {/* The rail column runs the height of a long page, so it ends with
              the one thing worth saying there: where these numbers came from.
              It also keeps the new ingest page one click away from the page
              that reads it, now that uploading is no longer a tab here. */}
          <Link to="/pengaturan-brand" className="con-rail-foot">
            <Database size={13} strokeWidth={2} />
            <span>Data masuk lewat <strong>Pengaturan Brand</strong></span>
          </Link>
        </nav>

        <div className="con-canvas">
          <KpiStrip entry={read('Executive Snapshot')} />

          <section className="con-focus" aria-labelledby="con-focus-title">
            <div className="con-focus-head">
              <h2 id="con-focus-title">{active.label}</h2>
              <p className="con-focus-q">{active.question}</p>
            </div>
            {/* Keyed on the domain so the settle animation replays on every
                exchange, and so a domain's local view state never leaks into
                the next one. */}
            <div className="con-focus-body" key={activeKey} data-anim={reduceMotion ? undefined : 'in'}>
              <DashboardTab
                activeTab={activeKey}
                filters={filters}
                data={activeEntry.data}
                status={activeEntry.status}
                error={activeEntry.error}
                onRetry={() => retry(activeKey)}
                productPerformanceLevel={productLevel}
                setProductPerformanceLevel={setProductLevel}
                onNavigateTab={setActiveKey}
              />
            </div>
          </section>

          <div className="con-mods" key={activeKey} data-anim={reduceMotion ? undefined : 'in'}>
            {others.map((d, i) => (
              <ModuleCard
                key={d.key}
                index={i}
                domain={d}
                entry={read(d.key)}
                onOpen={() => setActiveKey(d.key)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
