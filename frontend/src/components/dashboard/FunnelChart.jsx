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
          const stepConv = idx > 0 && prevVal > 0
            ? (Number(step.value || 0) / prevVal) * 100
            : null;

          return (
            <div key={idx} style={{ position: 'relative' }}>

              {/* Connector conversion line between steps -- always shown for
                  every non-first step, never hidden just because a value
                  along the way happens to be 0. */}
              {idx > 0 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.75rem',
                  color: 'var(--primary)',
                  fontWeight: '600',
                  margin: '-0.5rem 0 0.5rem 2rem',
                  background: 'rgba(59, 130, 246, 0.08)',
                  padding: '0.15rem 0.6rem',
                  borderRadius: '4px',
                  width: 'fit-content'
                }}>
                  <span>↓ Tingkat Konversi Tahap: {stepConv !== null ? formatPercent(stepConv) : '- (tahap sebelumnya 0)'}</span>
                </div>
              )}

              {/* Bar Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: '130px', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '500' }}>
                  {step.name}
                </div>
                
                <div style={{ flex: 1, position: 'relative', background: 'var(--bg-elevated)', borderRadius: '6px', height: '36px', overflow: 'hidden' }}>
                  {/* Progress fill */}
                  <div style={{
                    width: `${percentOfTotal}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--primary) 0%, #8b5cf6 100%)',
                    borderRadius: '6px',
                    transition: 'width 0.5s ease-out'
                  }}></div>
                </div>

                <div style={{ flexShrink: 0, whiteSpace: 'nowrap', textAlign: 'right', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text)' }}>
                  {formatNumber(step.value)}
                </div>
                <div style={{ flexShrink: 0, whiteSpace: 'nowrap', textAlign: 'right', width: '90px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {idx === 0 ? 'Basis (100%)' : formatPercent(percentOfTotal)}
                </div>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}
