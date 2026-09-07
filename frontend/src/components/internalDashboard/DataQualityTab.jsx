import { useEffect, useState } from 'react';
import { Check, X, Minus, Info, AlertTriangle } from 'lucide-react';
import api from '../../api/client.js';
import KpiCard from '../dashboard/KpiCard.jsx';
import { formatPercent } from '../../utils/format.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const money = (v) => (v == null ? '-' : `Rp${new Intl.NumberFormat('id-ID').format(Math.round(v))}`);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('id-ID') : '-');

// yes / no / unknown cell
function TriCell({ v }) {
  if (v === true) return <Check size={14} style={{ color: '#059669' }} />;
  if (v === false) return <X size={14} style={{ color: 'var(--danger)' }} />;
  return <Minus size={14} style={{ color: 'var(--text-muted)' }} />;
}

const STATE_BADGE = {
  complete: ['badge-success', 'Lengkap'],
  partial: ['badge-warning', 'Parsial'],
  empty: ['badge-danger', 'Kosong'],
};
const SEV_BADGE = { critical: 'badge-danger', warning: 'badge-warning', info: 'badge-info' };

const CHANNELS = ['shopee', 'tiktok_shop', 'website', 'offline'];

// S8 — Data Quality.
export default function DataQualityTab() {
  const [period, setPeriod] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyWithData, setOnlyWithData] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/data-quality', { params: { period } })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat data quality'))
      .finally(() => setLoading(false));
  }, [period]);

  const cm = data?.completeness_matrix;
  const rows = (cm?.clients || []).filter((c) => !onlyWithData
    || c.has_monthly_metrics || c.has_channel_sales || c.has_platform_spend);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="card" style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Periode</label>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
        <label style={{ fontSize: '0.85rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={onlyWithData} onChange={(e) => setOnlyWithData(e.target.checked)} />
          Hanya client yang punya data periode ini
        </label>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && !data && <div className="empty-state">Memuat...</div>}

      {data && (
        <>
          {/* KPI ringkas */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
            <KpiCard title="Kelengkapan Data Periode" value={cm.summary.completeness_pct} type="percentage"
              note={`Sel fact-table terisi ÷ (client aktif × 3). Lengkap ${cm.summary.complete} · parsial ${cm.summary.partial} · kosong ${cm.summary.empty}.`} />
            <KpiCard title="Ad Account Belum Ter-mapping" value={data.ad_accounts_unmapped.hard.length + data.ad_accounts_unmapped.soft.length} type="number"
              note={`${data.ad_accounts_unmapped.hard.length} HARD (spend tanpa BM ID) · ${data.ad_accounts_unmapped.soft.length} SOFT (act_ ID belum diisi).`} />
            <KpiCard title="Selisih Rekonsiliasi" value={data.reconciliation.channel_sales_vs_revenue.filter((r) => r.status === 'mismatch').length} type="number"
              note="Client dengan total channel sales ≠ revenue di luar toleransi 0,5%." />
            <KpiCard title="Tindakan Perlu Dikerjakan" value={data.action_items.length} type="number"
              note={`${data.action_items.filter((a) => a.severity === 'critical').length} kritis · ${data.action_items.filter((a) => a.severity === 'warning').length} warning · ${data.action_items.filter((a) => a.severity === 'info').length} info.`} />
          </div>

          {/* Daftar Tindakan terkonsolidasi */}
          <div className="card">
            <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
              <AlertTriangle size={16} /> Daftar Tindakan — {period}
            </h3>
            {data.action_items.length === 0 ? (
              <div className="empty-state">Tidak ada tindakan tertunda periode ini.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {data.action_items.map((a, i) => (
                  <div key={`${a.type}-${a.brand_id}-${i}`} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.85rem' }}>
                    <span className={`badge ${SEV_BADGE[a.severity]}`} style={{ fontSize: '0.6rem', flexShrink: 0, marginTop: 2 }}>
                      {a.severity === 'critical' ? 'KRITIS' : a.severity === 'warning' ? 'WARNING' : 'INFO'}
                    </span>
                    <div>
                      <strong>{a.label}</strong>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{a.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 1. Matriks Kelengkapan */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.5rem 0' }}>
              <h3 style={{ fontSize: '1rem' }}>1 · Matriks Kelengkapan Data — {period}</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>
                Aktif: {cm.summary.active} · isi metrik {cm.summary.active_with_monthly_metrics} · channel {cm.summary.active_with_channel_sales} ·
                spend {cm.summary.active_with_platform_spend} · lengkap-3 {cm.summary.active_with_all_three}. {cm.note}
                {cm.summary.channels_assessed === 0 && ' (client_sales_channels belum diisi — kolom channel semua "—".)'}
              </p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ marginTop: '1rem' }}>
                <thead>
                  <tr>
                    <th>Client</th><th>Status</th><th>Kelengkapan</th><th>Metrik</th><th>Channel sales</th><th>Platform spend</th>
                    {CHANNELS.map((ch) => <th key={ch} style={{ fontSize: '0.68rem' }}>{ch}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.brand_id}>
                      <td>{c.brand_name}</td>
                      <td>{c.status}</td>
                      <td>
                        <span className={`badge ${STATE_BADGE[c.data_state][0]}`} style={{ fontSize: '0.62rem' }}>
                          {STATE_BADGE[c.data_state][1]}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}><TriCell v={c.has_monthly_metrics} /></td>
                      <td style={{ textAlign: 'center' }}><TriCell v={c.has_channel_sales} /></td>
                      <td style={{ textAlign: 'center' }}><TriCell v={c.has_platform_spend} /></td>
                      {CHANNELS.map((ch) => {
                        const x = c.channels.find((y) => y.channel === ch);
                        return <td key={ch} style={{ textAlign: 'center' }}><TriCell v={x ? x.is_used : null} /></td>;
                      })}
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={10} className="empty-state">Tidak ada client.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2. Ad account belum ter-mapping */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.5rem 0' }}>
              <h3 style={{ fontSize: '1rem' }}>2 · Ad Account Belum Ter-mapping</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>{data.ad_accounts_unmapped.note}</p>
            </div>
            {[
              ['hard', 'HARD — spend Meta ada, BM ID kosong', 'badge-danger'],
              ['soft', 'SOFT — BM ID ada, daftar ad account belum diisi', 'badge-warning'],
            ].map(([key, title, badge]) => (
              <div key={key} style={{ padding: '0.75rem 1.5rem 0' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, margin: '0.5rem 0 0.25rem' }}>
                  <span className={`badge ${badge}`} style={{ fontSize: '0.6rem', marginRight: 6 }}>{data.ad_accounts_unmapped[key].length}</span>
                  {title}
                </div>
                {data.ad_accounts_unmapped[key].length === 0 ? (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.25rem 0 0.5rem' }}>— tidak ada</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead><tr><th>Client</th><th>BM ID</th><th>Total Meta spend</th><th>Bulan</th></tr></thead>
                      <tbody>
                        {data.ad_accounts_unmapped[key].map((c) => (
                          <tr key={c.brand_id}>
                            <td>{c.brand_name}</td><td>{c.bm_id || '-'}</td>
                            <td>{money(c.meta_spend_total)}</td><td>{c.months}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
            <div style={{ height: '1rem' }} />
          </div>

          {/* 3. Campaign belum terklasifikasi */}
          <div className="card">
            <h3 style={{ fontSize: '1rem', marginBottom: '0.4rem' }}>3 · Campaign Belum Terklasifikasi</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
              <Info size={14} style={{ marginTop: 2, flexShrink: 0 }} />
              {data.campaign_classification.note}
            </p>
          </div>

          {/* 4. Selisih rekonsiliasi */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.5rem 0' }}>
              <h3 style={{ fontSize: '1rem' }}>4 · Selisih Rekonsiliasi — {period}</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>
                Channel sales (canonical + free-text) vs revenue. Toleransi 0,5%.
              </p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ marginTop: '1rem' }}>
                <thead><tr><th>Client</th><th>Revenue</th><th>Total channel sales</th><th>Selisih</th><th>Selisih %</th><th>Status</th></tr></thead>
                <tbody>
                  {data.reconciliation.channel_sales_vs_revenue.map((r) => (
                    <tr key={r.brand_id}>
                      <td>{r.brand_name}</td>
                      <td>{money(r.revenue)}</td>
                      <td>{r.channel_total == null ? '—' : money(r.channel_total)}</td>
                      <td>{r.diff == null ? '—' : money(r.diff)}</td>
                      <td>{r.diff_pct == null ? '—' : formatPercent(r.diff_pct * 100, 2)}</td>
                      <td>
                        <span className={`badge ${r.status === 'reconciled' ? 'badge-success' : r.status === 'mismatch' ? 'badge-danger' : 'badge-warning'}`}>
                          {r.status === 'reconciled' ? 'cocok' : r.status === 'mismatch' ? 'selisih' : 'belum ada data channel'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {data.reconciliation.channel_sales_vs_revenue.length === 0 && <tr><td colSpan={6} className="empty-state">Belum ada client dengan metrik bulanan.</td></tr>}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0.5rem 1.5rem 1rem', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
              <Info size={13} style={{ marginTop: 2, flexShrink: 0 }} />
              Rekonsiliasi spend: {data.reconciliation.spend.note}
              {data.reconciliation.spend.anomalies.length > 0 && (
                <span> Anomali: {data.reconciliation.spend.anomalies.map((a) => `${a.brand_name} (${a.issue})`).join('; ')}.</span>
              )}
            </p>
          </div>

          {/* 5. Log Ingestion */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <h3 style={{ fontSize: '1rem', padding: '1rem 1.5rem 0' }}>5 · Log Ingestion</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ marginTop: '1rem' }}>
                <thead><tr><th>Waktu</th><th>Client</th><th>Tabel</th><th>Periode</th><th>Aksi</th><th>Baris</th><th>Status</th><th>Oleh</th></tr></thead>
                <tbody>
                  {data.ingestion_log.map((l) => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.created_at)}</td>
                      <td>{l.brand_name || '-'}</td>
                      <td style={{ fontSize: '0.75rem' }}>{l.target_table}</td>
                      <td>{l.period || '-'}</td>
                      <td style={{ fontSize: '0.78rem' }}>{l.method}</td>
                      <td>{l.row_count}</td>
                      <td><span className={`badge ${l.status === 'success' ? 'badge-success' : l.status === 'failed' ? 'badge-danger' : 'badge-warning'}`}>{l.status}</span></td>
                      <td>{l.performed_by_name || '-'}</td>
                    </tr>
                  ))}
                  {data.ingestion_log.length === 0 && <tr><td colSpan={8} className="empty-state">Belum ada log.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
