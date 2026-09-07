import { formatPercent } from '../../utils/format.js';

export default function FunnelChart({ data = [], title = 'Analisis Funnel Kunjungan' }) {
  const maxVal = data.length > 0 ? Number(data[0].value || 0) : 0;

  const formatNumber = (val) => {
    return new Intl.NumberFormat('id-ID').format(val);
  };

  const calculatePct = (val) => {
    if (maxVal === 0) return formatPercent(0);
    return formatPercent((Number(val) / maxVal) * 100);
  };

  // Empty state only for a genuinely missing funnel (no stages at all) --
  // a funnel whose first stage happens to be 0 is real data (zero traffic
  // that period), not "no data", so it still renders with every stage at 0.
  if (data.length === 0) {
    return (
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', color: 'var(--text-muted)' }}>
        Belum ada data untuk Funnel
      </div>
    );
  }

  return (
    <div className="card funnel-card" style={{ padding: '1.25rem' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '1.5rem', color: 'var(--text)' }}>{title}</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {data.map((step, idx) => {
          const widthPct = calculatePct(step.value);
          const percentOfTotal = maxVal > 0 ? (Number(step.value) / maxVal) * 100 : 0;
          
          // Conversion from the previous step. When the previous step's
          // value is 0, the rate is 0/0 -- genuinely undefined, not "0%" --
          // so it's shown as "-" rather than silently hidden or misreported
          // as a computed zero.
          const prevVal = idx > 0 ? Number(data[idx - 1].value || 0) : null;
          // Width of the stage above, drawn as a ghost behind this bar. Stages
          // past the first are a few percent of the basis, so as plain bars
          // they read as empty track and the chart whose whole job is drop-off
          // showed none of it. The ghost makes the loss the visible thing: the
          // filled part is what survived, the pale part is what fell away.
          // Both are the true linear fraction — nothing is rescaled.
          const prevPct = prevVal != null && maxVal > 0 ? (prevVal / maxVal) * 100 : null;
          const stepConv = idx > 0 && prevVal > 0
            ? (Number(step.value || 0) / prevVal) * 100
            : null;

          return (
            <div key={idx} style={{ position: 'relative' }}>

              {/* Connector conversion line between steps -- always shown for
                  every non-first step, never hidden just because a value
                  along the way happens to be 0. */}
              {idx > 0 && (
                <div className="con-step">
                  <span className="con-step-txt">
                    Tingkat konversi tahap: {stepConv !== null ? formatPercent(stepConv) : '— (tahap sebelumnya 0)'}
                  </span>
                  {/* The absolute bars below are the true share of the basis,
                      which makes the last stages tiny however healthy they are.
                      This meter is the other half of the story — retention from
                      the stage immediately above — drawn at full scale so a 94%
                      carry-through and a 17% collapse read as different events. */}
                  {stepConv !== null && (
                    <span className="con-step-meter" aria-hidden>
                      <span style={{ width: `${Math.max(Math.min(stepConv, 100), 1)}%` }} />
                    </span>
                  )}
                </div>
              )}

              {/* Bar Row */}
              {/* Grid, not flex with fixed widths: the label and the two
                  numeric columns used to be unshrinkable, so in a narrow
                  container they consumed the row and the bar track — the only
                  part carrying the shape of the funnel — collapsed to a sliver.
                  Here the track is the column that keeps the remaining space
                  and the others give way. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(72px, 118px) minmax(90px, 1fr) auto', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: '500', minWidth: 0 }}>
                  {step.name}
                </div>
                
                <div style={{ position: 'relative', background: 'var(--bg-elevated)', borderRadius: '6px', height: '36px', overflow: 'hidden', minWidth: 0 }}>
                  {/* What the previous stage held, behind what this one kept. */}
                  {prevPct != null && (
                    <div style={{
                      position: 'absolute', inset: 0,
                      width: `${prevPct}%`,
                      background: 'var(--primary-light)',
                      borderRadius: '6px',
                    }} />
                  )}
                  {/* Progress fill. A non-zero stage never renders as nothing:
                      2px is the floor, so "small" and "none" stay different. */}
                  <div style={{
                    position: 'relative',
                    width: percentOfTotal > 0 ? `max(${percentOfTotal}%, 2px)` : 0,
                    height: '100%',
                    background: 'var(--primary)',
                    borderRadius: '6px',
                    transition: 'width 0.5s ease-out'
                  }}></div>
                </div>

                {/* Value and share share one cell — two unshrinkable columns
                    for four characters each was most of the row. */}
                <div style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text)' }}>
                    {formatNumber(step.value)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {idx === 0 ? 'Basis (100%)' : formatPercent(percentOfTotal)}
                  </div>
                </div>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}
