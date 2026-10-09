import { motion, useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Database, LayoutPanelLeft } from 'lucide-react';
import FilterPanel from './FilterPanel.jsx';
import ChannelRoasStrip from './ChannelRoasStrip.jsx';
import { STRIP_METRICS, formatStripValue } from './domains.js';
import { Delta, Figure, InfoTip } from './figures.jsx';
import PageBand from '../common/PageBand.jsx';
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
    <div className="con dashboard-console soft-shell bo-shell" data-channel={view.id}>
      <div className="soft-frame">
        {/* Level 1: the channel, as folder tabs on the shared ATLAS header
            band (the same component Brand Setting and Report Generator use). */}
        <PageBand
          kicker="Workspace · Analisis"
          title="Business Overview"
          desc="Satu pandangan untuk memahami performa brand di seluruh channel."
          tabs={views.map((v) => ({
            key: v.id, label: v.label, hint: v.ready || v.readable ? v.hint : 'Belum ada data', icon: <v.Icon size={19} />, onSelect: () => setViewId(v.id),
          }))}
          activeKey={view.id}
          layoutId="bo-tab-sheet"
          ariaLabel="Channel"
          tools={(
            <>
              <FilterPanel filters={filters} onChange={setFilters} variant="band" />
              <button type="button" className="band-icon-btn" onClick={onClassic} title="Kembali ke tampilan klasik" aria-label="Kembali ke tampilan klasik">
                <LayoutPanelLeft size={17} aria-hidden="true" />
              </button>
            </>
          )}
        />

        {/* Level 2: this channel's analyses, alone on the floor under the band
            (brand and period now live in the band's corner). */}
        {/* Every channel carries the same domains; one whose data is not
            imported yet marks them and opens an honest pending state. */}
        {channel && (
          <nav className="soft-subtabs bo-views" aria-label={`Analisis ${channel.label}`} role="tablist">
            {channelDomains.map((d) => {
              const on = d.key === domainKey;
              return (
                <button type="button" role="tab" key={d.key} aria-selected={on} className={`soft-subtab${on ? ' is-on' : ''}${d.pending ? ' is-pending' : ''}`} onClick={() => setActiveKey(d.key)} title={d.pending ? `${d.label} — data ${channel.label} belum diimpor` : undefined} aria-description={d.pending ? 'belum ada data' : undefined}>
                  {on && <motion.span layoutId="soft-subtab-line" className="soft-subtab-line" transition={spring} aria-hidden="true" />}
                  {d.label}
                </button>
              );
            })}
          </nav>
        )}

        <div className="soft-head">
          <div>
            <h2>{!channel ? 'Executive Snapshot' : `${channel.label} · ${channelDomains.find((d) => d.key === domainKey)?.label ?? ''}`}</h2>
            <p>{question}</p>
          </div>
          {!channel && <Link to="/brand-tracking" className="soft-head-link">Isi Brand Tracking <ArrowUpRight size={14} aria-hidden="true" /></Link>}
        </div>

        {channel && <ChannelRoasStrip channelId={channel.id} filters={filters} />}
        {channel?.ready && kpiEntry && <Tiles entry={kpiEntry} />}

        <div className="soft-content dashboard-body"><div className="con-canvas">{children}</div></div>

        <p className="soft-source">
          <Database size={13} aria-hidden="true" /> Semua angka membaca file di <Link to="/data-brand">Data Collection Hub</Link> untuk brand dan periode di atas.
        </p>
      </div>
    </div>
  );
}
