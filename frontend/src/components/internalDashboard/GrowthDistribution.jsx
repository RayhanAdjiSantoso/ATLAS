// Histogram of per-client revenue growth for the like-for-like cohort, plus
// the "entered" / "left" lists shown separately (breakdown §4).
export default function GrowthDistribution({ data }) {
  if (!data) return null;
  const { buckets = [], entered = [], left = [], basis, compare } = data;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const totalInBuckets = buckets.reduce((a, b) => a + b.count, 0);

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Distribusi Pertumbuhan Client</h3>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        {compare === 'target' ? 'Actual vs target' : compare === 'yoy' ? 'YoY' : 'MoM'} · basis {basis === 'like_for_like' ? 'like-for-like' : 'semua client'} · {totalInBuckets} client
      </p>

      {totalInBuckets === 0 ? (
        <div className="empty-state">Belum ada client dengan data di kedua periode.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {buckets.map((b) => (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ width: 110, fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right' }}>{b.label}</span>
              <div style={{ flex: 1, background: 'var(--border)', borderRadius: 4, height: 20 }}>
                <div style={{ width: `${(b.count / max) * 100}%`, background: 'var(--primary)', height: '100%', borderRadius: 4 }} />
              </div>
              <span style={{ width: 28, fontSize: '0.8rem', fontWeight: 600 }}>{b.count}</span>
            </div>
          ))}
        </div>
      )}

      {(entered.length > 0 || left.length > 0) && (
        <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {entered.length > 0 && (
            <div style={{ margin: '0.4rem 0' }}>
              <strong>Belum ada pembanding ({entered.length})</strong> — client dengan data periode ini tapi tidak di periode pembanding:
              <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>
                {entered.map((e) => (
                  <li key={e.brand_id} style={{ margin: '0.15rem 0' }}>
                    {e.brand_name}
                    {e.flag && <span style={{ color: 'var(--danger)' }}> — ⚠ {e.flag}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {left.length > 0 && (
            <div style={{ margin: '0.4rem 0' }}>
              <strong>Tidak ada data periode ini ({left.length})</strong>:
              <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>
                {left.map((e) => (
                  <li key={e.brand_id} style={{ margin: '0.15rem 0' }}>
                    {e.brand_name}
                    {e.flag && <span style={{ color: 'var(--danger)' }}> — ⚠ {e.flag}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
