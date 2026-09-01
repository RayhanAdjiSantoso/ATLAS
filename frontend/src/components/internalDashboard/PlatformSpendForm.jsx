import { useEffect, useState, useCallback } from 'react';
import { Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../../api/client.js';
import { AD_PLATFORMS, PLATFORM_SPEND_FIELDS } from './constants.js';

const ALL_FIELDS = [
  ...PLATFORM_SPEND_FIELDS.required,
  ...PLATFORM_SPEND_FIELDS.optionalRaw,
  ...PLATFORM_SPEND_FIELDS.ratios,
];
const emptyForm = () => Object.fromEntries(ALL_FIELDS.map((f) => [f.key, '']));
const platformLabel = (v) => AD_PLATFORMS.find((p) => p.value === v)?.label || v;
const fmtMoney = (v) => (v == null ? '-' : `Rp${new Intl.NumberFormat('id-ID').format(Number(v))}`);

function FieldGrid({ fields, form, setForm }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
      {fields.map((f) => (
        <div className="form-group" key={f.key}>
          <label>
            {f.label}
            {f.proxy && (
              <span className="badge badge-warning" style={{ marginLeft: '0.4rem', fontSize: '0.65rem' }}>PROXY</span>
            )}
          </label>
          <input type="number" min="0" step={f.kind === 'int' ? '1' : 'any'} value={form[f.key]}
            onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
        </div>
      ))}
    </div>
  );
}

// §2.5 client_platform_spend_monthly — one platform at a time.
export default function PlatformSpendForm({ clientId, period, onPickPeriod, onSaved }) {
  const [entries, setEntries] = useState([]);
  const [platform, setPlatform] = useState(AD_PLATFORMS[0].value);
  const [form, setForm] = useState(emptyForm());
  const [showRatios, setShowRatios] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!clientId) { setEntries([]); return; }
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/platform-spend', { params: { brand_id: clientId } })
      .then((res) => setEntries(res.data.entries || []))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat data'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  const existing = entries.find((e) => e.period === period && e.platform === platform);

  useEffect(() => {
    if (existing) {
      setForm(Object.fromEntries(ALL_FIELDS.map((f) => [f.key, existing[f.key] ?? ''])));
      if (PLATFORM_SPEND_FIELDS.ratios.some((f) => existing[f.key] != null)) setShowRatios(true);
    } else {
      setForm(emptyForm());
    }
    setMessage(null);
  }, [entries, period, platform]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    const missing = PLATFORM_SPEND_FIELDS.required.filter((f) => form[f.key] === '' || Number.isNaN(Number(form[f.key])));
    if (missing.length) {
      setMessage({ type: 'error', text: `Field wajib belum lengkap: ${missing.map((f) => f.label).join(', ')}` });
      return;
    }
    if (existing && !window.confirm(`Timpa data ${platformLabel(platform)} — ${period}?`)) return;

    const payload = { brand_id: clientId, period, platform };
    for (const f of ALL_FIELDS) {
      if (form[f.key] !== '' && !Number.isNaN(Number(form[f.key]))) payload[f.key] = Number(form[f.key]);
    }

    setSaving(true);
    setMessage(null);
    try {
      await api.post('/internal-dashboard/platform-spend', payload);
      setMessage({ type: 'success', text: `Tersimpan: ${platformLabel(platform)} — ${period}.` });
      load();
      onSaved?.();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menyimpan' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Hapus ${platformLabel(row.platform)} — ${row.period}?`)) return;
    setError('');
    try {
      await api.delete(`/internal-dashboard/platform-spend/${row.id}`);
      load();
      onSaved?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus');
    }
  };

  if (!clientId) return <div className="empty-state">Pilih client dan periode dulu.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <h3 style={{ marginBottom: '0.25rem' }}>Spend per Platform — {period}</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          §2.5 — satu platform per submit. Field wajib = raw yang bisa dijumlahkan.
        </p>

        <div className="form-group">
          <label>Platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {AD_PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}{entries.some((en) => en.period === period && en.platform === p.value) ? ' — sudah ada' : ''}</option>
            ))}
          </select>
        </div>

        <h4 style={{ fontSize: '0.85rem', margin: '0.5rem 0', color: 'var(--text-muted)' }}>Wajib</h4>
        <FieldGrid fields={PLATFORM_SPEND_FIELDS.required} form={form} setForm={setForm} />

        <h4 style={{ fontSize: '0.85rem', margin: '0.5rem 0', color: 'var(--text-muted)' }}>Opsional</h4>
        <FieldGrid fields={PLATFORM_SPEND_FIELDS.optionalRaw} form={form} setForm={setForm} />

        <button type="button" className="btn btn-secondary" style={{ margin: '0.75rem 0' }}
          onClick={() => setShowRatios((v) => !v)}>
          {showRatios ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Cross-check Ads Manager (opsional)
        </button>
        {showRatios && (
          <div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Field rasio ini <strong>hanya untuk cek tampilan 1 bulan</strong> lawan Ads Manager. Semua
              agregasi lintas periode (S1/S2/S3/S7) dihitung ulang dari field wajib — kolom rasio ini
              tidak pernah dijumlahkan/dirata-rata.
            </p>
            <FieldGrid fields={PLATFORM_SPEND_FIELDS.ratios} form={form} setForm={setForm} />
          </div>
        )}

        {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Menyimpan...' : existing ? 'Simpan Perubahan' : 'Simpan'}
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <h3 style={{ fontSize: '1rem', padding: '1rem 1.5rem 0' }}>Data tersimpan</h3>
        {loading ? (
          <div className="empty-state">Memuat...</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">Belum ada data platform spend.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ marginTop: '1rem' }}>
              <thead>
                <tr><th>Periode</th><th>Platform</th><th>Spend</th><th>Purchase</th><th>Purchase Value</th><th /></tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} style={e.period === period ? { background: 'var(--primary-light)' } : undefined}>
                    <td>{e.period}</td>
                    <td>{platformLabel(e.platform)}</td>
                    <td>{fmtMoney(e.amount_spent)}</td>
                    <td>{e.purchase ?? '-'}</td>
                    <td>{fmtMoney(e.purchase_value)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button type="button" className="btn btn-secondary btn-icon" title="Edit"
                          onClick={() => { onPickPeriod(e.period); setPlatform(e.platform); }}><Pencil size={16} /></button>
                        <button type="button" className="btn btn-danger btn-icon" title="Hapus"
                          onClick={() => handleDelete(e)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
