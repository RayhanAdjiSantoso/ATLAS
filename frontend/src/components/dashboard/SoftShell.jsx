import { motion, useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Database, LayoutPanelLeft } from 'lucide-react';
import FilterPanel from './FilterPanel.jsx';
import { STRIP_METRICS, formatStripValue } from './domains.js';
import { Delta, Figure, InfoTip } from './figures.jsx';
import atlasWordmark from '../../assets/atlas-wordmark.png';
import './softShell.css';

// Business Overview, Soft Blue — a calmer, more systematic
// frame around the same analysis: brand and period in one header, channel
// and domain as tab rows, then headline tiles and the analysis at full width.
// Every number and renderer inside is the classic console's own; only the
// frame changes, so the two layouts can be compared on the same data.

const TILE_STYLE = ['is-plain', 'is-accent', 'is-violet'];

function Tiles({ entry }) {
  const loading = entry.status === 'loading' || entry.status === 'idle';
  const kpis = entry.data?.kpis || {};
  const head = STRIP_METRICS.slice(0, 3);
  const rest = STRIP_METRICS.slice(3);
  return (
    <>
      <div className="soft-tiles">
        {head.map((m, i) => {
          const metric = kpis[m.key];
          return (
            <div className={`soft-tile ${TILE_STYLE[i]}`} key={m.key}>
              <div className="soft-tile-top">
                <span className="soft-tile-label">{m.label}<InfoTip text={m.note} /></span>
              </div>
              <div className="soft-tile-gross">
                <div className="soft-tile-val">
                  {loading ? <span className="con-skel is-wide" /> : <Figure text={formatStripValue(metric?.value, m.kind)} absentReason={m.absent} />}
                </div>
                {!loading && <Delta value={metric?.growth} invert={m.invert} />}
              </div>
              {!loading && m.net && metric?.net?.value != null && (
                <div className="soft-tile-net" title={`Setelah dikurangi batal −${formatStripValue(metric.net.cancelled || 0, m.kind)} dan retur −${formatStripValue(metric.net.returned || 0, m.kind)}`}>
                  <span>Net <strong>{formatStripValue(metric.net.value, m.kind)}</strong></span>
                  <Delta value={metric.net.growth} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="soft-card soft-strip">
        {rest.map((m) => {
          const metric = kpis[m.key];
          return (
            <div className="soft-strip-cell" key={m.key}>
              <span className="soft-strip-label">{m.label}<InfoTip text={m.note} /></span>
              <span className="soft-strip-val">
                {loading ? <span className="con-skel is-narrow" /> : <Figure text={formatStripValue(metric?.value, m.kind)} absentReason={m.absent} />}
              </span>
              {!loading && <Delta value={metric?.growth} invert={m.invert} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function SoftShell({
  filters, setFilters, views, view, setViewId, channel, channelDomains, domainKey, setActiveKey,
  question, kpiEntry, onClassic, children,
}) {
  // One column. The app sidebar already is the navigation between modules,
  // so inside this page the channel and domain switches sit above the
  // reading as two tab rows, and everything below them gets the full width.
  const reduce = useReducedMotion();
  const spring = reduce ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 40, mass: .6 };
  return (
    <div className="con dashboard-console soft-shell">
      <div className="soft-frame">
        <header className="soft-masthead">
          <div className="soft-masthead-copy">
            <h1><span>Business</span> Overview<span className="soft-title-dot" aria-hidden="true">.</span></h1>
            <p>Satu pandangan untuk memahami performa brand di seluruh channel.</p>

          </div>
          <div className="soft-masthead-signature">
            <img src={atlasWordmark} alt="ATLAS" />
            <span>Ruang analisis bisnis</span>
          </div>
        </header>

        {/* Brand, period, and comparison reflow within the command bar. */}
        <header className="soft-command">
          <FilterPanel filters={filters} onChange={setFilters} />
          <button type="button" className="soft-icon-btn" onClick={onClassic} title="Kembali ke tampilan klasik" aria-label="Kembali ke tampilan klasik">
            <LayoutPanelLeft size={17} aria-hidden="true" />
          </button>
        </header>

        {/* Channel: the primary switch — an ATLAS blue rail with a sliding active surface. */}
        <nav className="soft-tabs" aria-label="Channel" role="tablist">
          {views.map((v) => {
            const Icon = v.Icon;
            const on = v.id === view.id;
            return (
              <button type="button" role="tab" key={v.id} aria-selected={on} className={`soft-tab${on ? ' is-on' : ''}`} onClick={() => setViewId(v.id)}>
                {on && <motion.span layoutId="soft-tab-pill" className="soft-tab-pill" transition={spring} aria-hidden="true" />}
                <span className="soft-tab-ico" aria-hidden="true"><Icon size={17} /></span>
                <span className="soft-tab-text">
                  <strong>{v.label}</strong>
                  <small>{v.ready ? v.hint : 'Belum ada data'}</small>
                </span>
              </button>
            );
          })}
        </nav>

        {channel?.ready && (
          <nav className="soft-subtabs" aria-label={`Analisis ${channel.label}`} role="tablist">
            {channelDomains.map((d) => {
              const on = d.key === domainKey;
              return (
                <button type="button" role="tab" key={d.key} aria-selected={on} className={`soft-subtab${on ? ' is-on' : ''}`} onClick={() => setActiveKey(d.key)}>
                  {on && <motion.span layoutId="soft-subtab-line" className="soft-subtab-line" transition={spring} aria-hidden="true" />}
                  {d.label}
                </button>
              );
            })}
          </nav>
        )}

        <div className="soft-head">
          <div>
            <h2>{channel ? `${channel.label} · ${channelDomains.find((d) => d.key === domainKey)?.label ?? ''}` : 'Executive Snapshot'}</h2>
            <p>{question}</p>
          </div>
          {!channel && <Link to="/daily-tracking" className="soft-head-link">Isi Daily Tracking <ArrowUpRight size={14} aria-hidden="true" /></Link>}
        </div>

        {channel?.ready && kpiEntry && <Tiles entry={kpiEntry} />}

        <div className="soft-content dashboard-body"><div className="con-canvas">{children}</div></div>

        <p className="soft-source">
          <Database size={13} aria-hidden="true" /> Semua angka membaca file di <Link to="/data-brand">Data Brand</Link> untuk brand dan periode di atas.
        </p>
      </div>
    </div>
  );
}
