const numberFmt = new Intl.NumberFormat('id-ID');

export default function ProductTransitionTable({ data = [], title = 'Top Transisi Produk (Pembelian 1 → Pembelian 2)' }) {
  if (data.length === 0) {
    return (
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--text-muted)' }}>
        Belum ada data transisi produk untuk ditampilkan
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>{title}</h3>
      <table className="table" style={{ width: '100%', minWidth: '600px', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
            <th style={{ padding: '0.5rem', width: '90px', whiteSpace: 'nowrap' }}>Peringkat</th>
            <th style={{ padding: '0.5rem', width: '34%' }}>Produk Pembelian Pertama</th>
            <th style={{ padding: '0.5rem', width: '34%' }}>Produk Pembelian Kedua</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Jumlah Pelanggan</th>
          </tr>
        </thead>
        <tbody>
          {data.map((t, idx) => (
            <tr key={idx} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
              <td style={{ padding: '0.5rem', fontWeight: '600' }}>{idx + 1}</td>
              <td style={{ padding: '0.5rem', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.35' }} title={t.productFirst}>{t.productFirst}</td>
              <td style={{ padding: '0.5rem', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.35' }} title={t.productSecond}>{t.productSecond}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right', verticalAlign: 'top' }}>{numberFmt.format(t.customerCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
