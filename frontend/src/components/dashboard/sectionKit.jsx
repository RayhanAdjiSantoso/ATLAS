import { InfoTip } from './figures.jsx';
import { formatPercent } from '../../utils/format.js';

// Shared building blocks for every Business Overview domain.
//
// Traffic & Funnel was rebuilt first and set the pattern: a period banner
// saying what the numbers cover, panels whose heading carries a "?" with the
// file/sheet/column the figures come from, one headline number per panel with
// its change beside it, and tables that keep numbers right-aligned and
// tabular. Every other domain now draws from this same kit instead of
// hand-rolling its own spacing, so the tabs read as one product.
//
// Class names live in console.css under the `dsec-` prefix.

export const fmtNum = (v) => new Intl.NumberFormat('id-ID').format(Number(v) || 0);
// Chart interiors only (a donut's centre), where a full rupiah figure would
// overlap the ring. Every figure a user checks against Seller Centre prints
// in full elsewhere on the same panel.
export const fmtIdrShort = (v) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const f = (d, suffix) => `Rp${(n / d).toLocaleString('id-ID', { maximumFractionDigits: 1 })} ${suffix}`;
  if (abs >= 1e9) return f(1e9, 'M');
  if (abs >= 1e6) return f(1e6, 'jt');
  if (abs >= 1e3) return f(1e3, 'rb');
  return fmtIdr(n);
};

export const fmtIdr = (v) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(Number(v) || 0);

// Absent is not zero: a missing figure is an em dash that says why on hover.
export function Figure({ value, format = fmtNum, absentReason }) {
  if (value == null) {
    return <span className="con-null" title={absentReason || 'Data belum tersedia untuk periode ini'}>&mdash;</span>;
  }
  return format(value);
}

// Change against the comparison period. `invert` marks the metrics where a
// rise is bad news (cancellations, days-to-repeat), so colour follows the
// business reading rather than the raw sign.
export function GrowthPill({ value, invert = false }) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  const up = n >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`dsec-growth ${good ? 'is-up' : 'is-down'}`}>
      {up ? '▲' : '▼'} {formatPercent(Math.abs(n), 1)}
    </span>
  );
}

// "Periode data" strip at the top of a domain: what the numbers cover, at
// what grain, and against what they are compared.
export function PeriodBanner({ kicker, title, note, warn, children }) {
  return (
    <div className="dsec-period">
      <div>
        <span className="dsec-period-kicker">{kicker}</span>
        <strong>{title}</strong>
        {warn && <em>{warn}</em>}
      </div>
      <p>{note}{children}</p>
    </div>
  );
}

export function SectionWarn({ children }) {
  if (!children) return null;
  return <div className="dsec-warn">{children}</div>;
}

// A titled panel. `note` fills the "?" beside the title; `action` takes a
// control (a metric picker, a level switch) on the opposite side.
export function Panel({ title, note, action, className = '', children, bodyClass = '' }) {
  return (
    <div className={`card dsec-panel ${className}`.trim()}>
      {(title || action) && (
        <div className="dsec-head">
          {title && <h3>{title}</h3>}
          {note && <InfoTip text={note} />}
          {action && <div className="dsec-head-action">{action}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </div>
  );
}

// The one number a panel is about, with its change beside it.
export function TotalLine({ label, value, format = fmtNum, growth, invert = false, absentReason, sub }) {
  return (
    <div className="dsec-total">
      <span>{label}</span>
      <strong><Figure value={value} format={format} absentReason={absentReason} /></strong>
      <GrowthPill value={growth} invert={invert} />
      {sub && <i>{sub}</i>}
    </div>
  );
}

// Parts of a whole: one bar, then each part with its value, share and change.
// Items: { key, label, value, pct, growth, color }.
export function ShareBar({ items = [], format = fmtNum, columns }) {
  const style = columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined;
  return (
    <>
      <div className="dsec-bar">
        {items.map((it) => (
          <div
            key={it.key}
            style={{ width: `${it.pct || 0}%`, background: it.color }}
            title={`${it.label}: ${it.pct == null ? '—' : formatPercent(it.pct, 1)}`}
          />
        ))}
      </div>
      <div className="dsec-parts" style={style}>
        {items.map((it) => (
          <div className="dsec-part" key={it.key}>
            <div className="dsec-part-name">
              <i style={{ background: it.color }} />
              {it.label}
            </div>
            <div className="dsec-part-val"><Figure value={it.value} format={format} absentReason={it.absentReason} /></div>
            <div className="dsec-part-meta">
              <span>{it.pct == null ? '—' : formatPercent(it.pct, 1)}</span>
              <GrowthPill value={it.growth} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// One table style across the console. Columns: { key, label, align, note,
// render(row), width }. `rows` are already sorted by the caller.
export function DataTable({ columns = [], rows = [], empty = 'Belum ada data untuk periode ini.', dense = false }) {
  if (!rows.length) return <p className="dsec-empty">{empty}</p>;
  return (
    <div className="dsec-table-wrap">
      <table className={`dsec-table${dense ? ' is-dense' : ''}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={c.align ? { textAlign: c.align } : undefined}>
                {c.label}
                {c.note && <InfoTip text={c.note} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? row.key ?? i}>
              {columns.map((c) => (
                <td key={c.key} style={c.align ? { textAlign: c.align } : undefined}>
                  {c.render ? c.render(row, i) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Equal-width auto-fitting grid for KPI cards and small panels.
export function CardGrid({ min = 190, children, className = '' }) {
  return (
    <div
      className={`dsec-grid ${className}`.trim()}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` }}
    >
      {children}
    </div>
  );
}

// Reading of the period, in the colour of its verdict. Same callout language
// as Business Growth's headline, reused by every domain that has an insight.
export function InsightCard({ tone, label, detail }) {
  const toneColor = tone === 'up' ? 'var(--success)' : tone === 'down' ? 'var(--danger)' : 'var(--text-muted)';
  const toneBg = tone === 'up' ? 'var(--success-bg)' : tone === 'down' ? 'var(--danger-bg)' : 'var(--bg-elevated)';
  return (
    <div className="con-insight" style={{ background: toneBg }}>
      <span className="con-insight-dot" style={{ background: toneColor }} aria-hidden />
      <div>
        <div className="con-insight-label" style={{ color: toneColor }}>{label}</div>
        <div className="con-insight-detail">{detail}</div>
      </div>
    </div>
  );
}

// Main | compare pairing. Without a comparison it just renders the main side,
// so callers don't need two layouts.
export function ComparePair({ mainLabel, compareLabel, children }) {
  const [main, compare] = Array.isArray(children) ? children : [children, null];
  if (!compare) return main;
  return (
    <div className="dsec-pair">
      <div className="dsec-pair-head">{mainLabel}</div>
      <div className="dsec-pair-head is-cmp">{compareLabel}</div>
      {main}
      {compare}
    </div>
  );
}
