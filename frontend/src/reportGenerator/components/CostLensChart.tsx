import type { CSSProperties } from 'react';
import { computeDelta } from '../lib/delta';
import './costLens.css';

// A result read beside what it cost, one item per row.
//
// Every column draws the same way: two bars of equal weight, last period
// (pale, on top) and this period (solid, below), each labelled with its own
// value — the comparison period is read, not guessed. This period's value
// is green when it got better and red when it got worse (a cost is better
// lower), so a glance down any column judges it; the exact %change is the
// table's job, below.
// Each metric keeps its own column and its own scale (no second y-axis), so
// one item still reads across a single row.
//
// Plain DOM rather than canvas: the bars are widths, so html2canvas (the
// section export) draws them exactly as they show.

export interface CostLensItem {
  key: string;
  label: string;
  // Shorter name for the row; the tooltip and copy keep `label`.
  tick?: string;
  // The item's own bar colour (a campaign tinted by NV / RM).
  color?: string;
}

export interface CostLensMetric {
  key: string;
  label: string;
  format: (v: number) => string;
  // How the lead metric's change is judged; ignored on the other columns.
  tone: 'higher-better' | 'lower-better' | 'neutral';
  cur: (number | null)[];
  old: (number | null)[];
}

const COST_INK = '#475569';

const width = (v: number | null, max: number) => (v === null || max <= 0 ? 0 : Math.max(0, Math.min(100, (v / max) * 100)));

// Whether this period's value got better, worse, or cannot be judged.
function changeOf(old: number | null, cur: number | null, tone: CostLensMetric['tone']) {
  if (old === null || cur === null) return null;
  const { deltaNum } = computeDelta(old, cur);
  if (deltaNum === null || deltaNum === 0 || tone === 'neutral') return null;
  const good = tone === 'lower-better' ? deltaNum < 0 : deltaNum > 0;
  return { cls: good ? 'is-good' : 'is-bad' };
}

export function CostLensChart({
  items,
  metrics,
  hasOld,
  p1,
  p2,
  itemNoun,
  color,
  onLabelClick,
  copiedKey,
}: {
  items: CostLensItem[];
  metrics: CostLensMetric[];
  hasOld: boolean;
  p1: string;
  p2: string;
  itemNoun: string;
  color: string;
  onLabelClick?: (item: CostLensItem) => void;
  copiedKey?: string | null;
}) {
  if (!items.length || !metrics.length) return null;
  const max = metrics.map((m) => Math.max(0, ...m.cur.map((v) => v ?? 0), ...(hasOld ? m.old.map((v) => v ?? 0) : [])));
  const cols = `minmax(170px, 1.15fr) minmax(0, 1.2fr)${' minmax(0, 1fr)'.repeat(metrics.length - 1)}`;

  return (
    <div className="cl" style={{ '--cl-cols': cols, '--cl-accent': color } as CSSProperties}>
      <ul className="cl-key" aria-label="Keterangan grafik">
        {hasOld && (
          <li>
            <span className="cl-key-bar is-old" aria-hidden="true" />
            <b>{p1}</b> · periode lalu
          </li>
        )}
        <li>
          <span className="cl-key-bar" aria-hidden="true" />
          <b>{p2}</b> · periode ini
        </li>
        {hasOld && (
          <li>
            Angka <em className="is-good">hijau</em> membaik, <em className="is-bad">merah</em> memburuk
            <span className="cl-key-note">· biaya membaik bila turun</span>
          </li>
        )}
      </ul>

      <div className="cl-grid" role="table" aria-label={`${metrics[0].label} per ${itemNoun}`}>
        <div className="cl-row cl-head" role="row">
          <span role="columnheader" className="cl-name">{itemNoun}</span>
          {metrics.map((m, i) => (
            <span role="columnheader" key={m.key} className={i === 0 ? 'cl-h is-lead' : 'cl-h'}>
              <small>{i === 0 ? 'Metrik terpilih' : 'Biaya'}</small>
              <b>{m.label}</b>
            </span>
          ))}
        </div>

        {items.map((it, row) => (
          <div className="cl-row" role="row" key={it.key}>
            <span role="cell" className="cl-name">
              <i>{row + 1}</i>
              {onLabelClick ? (
                <button type="button" aria-label={`Salin: ${it.label}`} onClick={() => onLabelClick(it)}>
                  {copiedKey === it.key ? 'Disalin' : it.tick ?? it.label}
                </button>
              ) : (
                <span>{it.tick ?? it.label}</span>
              )}
              <span className="cl-name-tip" aria-hidden="true">
                {it.label}
                {onLabelClick && <small>Klik untuk menyalin</small>}
              </span>
            </span>
            {metrics.map((m, i) => {
              const lead = i === 0;
              const cur = m.cur[row];
              const old = hasOld ? m.old[row] : null;
              const ch = hasOld ? changeOf(old, cur, m.tone) : null;
              const ink = lead ? it.color ?? color : COST_INK;
              const bar = (v: number | null, past: boolean) => (
                <span className={past ? 'cl-line is-old' : 'cl-line'}>
                  <span className="cl-track">
                    <span className="cl-bar" style={{ width: `${width(v, max[i])}%`, background: ink }} />
                  </span>
                  <em className={past ? undefined : ch?.cls}>{v === null ? '—' : m.format(v)}</em>
                </span>
              );
              return (
                <span role="cell" key={m.key} className={lead ? 'cl-cell is-lead' : 'cl-cell'}>
                  <span className="cl-bars">
                    {hasOld && bar(old, true)}
                    {bar(cur, false)}
                  </span>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
