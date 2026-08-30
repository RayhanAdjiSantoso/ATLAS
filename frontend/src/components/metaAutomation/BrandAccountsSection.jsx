import { useEffect, useState } from 'react';
import { Pencil, Trash2, Plus, X } from 'lucide-react';
import api from '../../api/client.js';

const EMPTY_THRESHOLDS = { resultDrop: '', cprIncrease: '', minSpend: '', minResults: '' };
const EMPTY_URGENT = { cprSpike: '', spendSpike: '', minSpendDaily: '', minBaselineRes: '' };
const EMPTY_CHECKS = { resultDrop: true, cprIncrease: true, minSpend: true, minResults: true };
const EMPTY_URGENT_CHECKS = { cprSpike: true, spendSpike: true, minSpendDaily: true, minBaselineRes: true };

const EMPTY_FORM = {
  id: '',
  client: '',
  type: 'MAIN',
  portfolio: '',
  token: '',
  resultOverride: [],
  thresholds: EMPTY_THRESHOLDS,
  urgentThresholds: EMPTY_URGENT,
  thresholdChecks: EMPTY_CHECKS,
  urgentChecks: EMPTY_URGENT_CHECKS,
};

// Daftar action_type Meta yang umum dipakai sebagai "result" -- dikurasi dari
// OPT_GOAL_MAP/EVENT_MAP di Weekly.gs. Bukan daftar tertutup: field di
// bawahnya tetap bisa diketik manual (mis. custom conversion ID unik per akun
// yang tidak mungkin didaftar di sini).
const METRIC_OPTIONS = [
  { value: 'link_click', label: 'Link Click (juga proxy Profile Visit)' },
  { value: 'landing_page_view', label: 'Landing Page View' },
  { value: 'lead', label: 'Lead' },
  { value: 'post_engagement', label: 'Post Engagement' },
  { value: 'like', label: 'Page Like' },
  { value: 'rsvp', label: 'Event Response' },
  { value: 'video_view', label: 'Video View (ThruPlay)' },
  { value: 'omni_app_install', label: 'App Install' },
  { value: 'reach', label: 'Reach' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'estimated_ad_recallers', label: 'Estimated Ad Recall' },
  { value: 'onsite_conversion.messaging_conversation_started_7d', label: 'Messaging Conversation Started' },
  { value: 'onsite_conversion.call_confirm', label: 'Call Confirmed' },
  { value: 'offsite_conversion.fb_pixel_purchase', label: 'Purchase (Pixel)' },
  { value: 'omni_purchase', label: 'Purchase (Omni)' },
  { value: 'offsite_conversion.fb_pixel_add_to_cart', label: 'Add to Cart' },
  { value: 'offsite_conversion.fb_pixel_view_content', label: 'View Content' },
  { value: 'offsite_conversion.fb_pixel_initiate_checkout', label: 'Initiate Checkout' },
  { value: 'offsite_conversion.fb_pixel_add_payment_info', label: 'Add Payment Info' },
  { value: 'offsite_conversion.fb_pixel_contact', label: 'Contact' },
  { value: 'offsite_conversion.fb_pixel_lead', label: 'Lead (Pixel)' },
  { value: 'offsite_conversion.fb_pixel_complete_registration', label: 'Complete Registration' },
  { value: 'offsite_conversion.fb_pixel_search', label: 'Search' },
  { value: 'offsite_conversion.fb_pixel_subscribe', label: 'Subscribe' },
];

// Weekly/Daily menyimpan sebagian ambang sebagai pecahan (0.15 = 15%) --
// field-field ini ditampilkan/diinput sebagai persen lalu dikonversi saat
// dikirim ke API, sisanya (Rupiah/jumlah) apa adanya.
const PERCENT_FIELDS = ['resultDrop', 'cprIncrease', 'cprSpike', 'spendSpike'];

function thresholdsToForm(obj) {
  const out = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v == null) return;
    out[k] = String(PERCENT_FIELDS.includes(k) ? v * 100 : v);
  });
  return out;
}

function thresholdsToPayload(form) {
  const out = {};
  Object.entries(form).forEach(([k, v]) => {
    const trimmed = String(v).trim();
    if (trimmed === '') return;
    const num = Number(trimmed);
    if (Number.isNaN(num)) return;
    out[k] = PERCENT_FIELDS.includes(k) ? num / 100 : num;
  });
  return out;
}

function accountToForm(a) {
  return {
    id: a.id,
    client: a.client,
    type: a.type || 'MAIN',
    portfolio: a.portfolio || '',
    token: '',
    resultOverride: Object.entries(a.resultOverride || {}).map(([key, value]) => ({ key, value })),
    thresholds: { ...EMPTY_THRESHOLDS, ...thresholdsToForm(a.thresholds) },
    urgentThresholds: { ...EMPTY_URGENT, ...thresholdsToForm(a.urgentThresholds) },
    thresholdChecks: { ...EMPTY_CHECKS, ...(a.thresholdChecks || {}) },
    urgentChecks: { ...EMPTY_URGENT_CHECKS, ...(a.urgentChecks || {}) },
  };
}

function ThresholdFields({ title, note, fields, values, onChange, checks, onChecksChange }) {
  return (
    <div className="form-group">
      <label>{title}</label>
      {note && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>{note}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
        {fields.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 400 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={checks[key]}
                onChange={(e) => onChecksChange({ ...checks, [key]: e.target.checked })}
              />
              {label}
            </label>
            <input
              type="number"
              value={values[key]}
              placeholder={placeholder}
              disabled={!checks[key]}
              onChange={(e) => onChange({ ...values, [key]: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BrandAccountsSection() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    api.get('/meta-automation/brand-accounts')
      .then((res) => setAccounts(res.data.accounts || []))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat akun'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const loadCampaigns = async (accountId) => {
    setCampaigns([]);
    setCampaignsLoading(true);
    try {
      const res = await api.get(`/meta-automation/brand-accounts/${encodeURIComponent(accountId)}/campaigns`);
      setCampaigns(res.data.campaigns || []);
    } catch {
      setCampaigns([]);
    } finally {
      setCampaignsLoading(false);
    }
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setCampaigns([]);
    setFormMessage(null);
  };

  const handleEdit = (a) => {
    setForm(accountToForm(a));
    setFormMessage(null);
    loadCampaigns(a.id);
  };

  const handleSave = async () => {
    if (!form.id.trim() || !form.client.trim()) {
      setFormMessage({ type: 'error', text: 'ID akun dan nama brand wajib diisi.' });
      return;
    }
    const isEdit = accounts.some((a) => a.id === form.id && a.source === 'dynamic');
    if (!isEdit && !form.token.trim()) {
      setFormMessage({ type: 'error', text: 'Token wajib diisi untuk akun baru.' });
      return;
    }

    const confirmed = window.confirm(
      isEdit
        ? `Simpan perubahan ke akun "${form.client}"?`
        : `Tambah akun "${form.client}" baru? Ini akan menyimpan token ke Script Properties Apps Script.`,
    );
    if (!confirmed) return;

    const payload = {
      client: form.client.trim(),
      type: form.type,
      portfolio: form.portfolio.trim(),
      token: form.token.trim() || undefined,
      resultOverride: Object.fromEntries(
        form.resultOverride.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value.trim()]),
      ),
      thresholds: thresholdsToPayload(form.thresholds),
      urgentThresholds: thresholdsToPayload(form.urgentThresholds),
      thresholdChecks: form.thresholdChecks,
      urgentChecks: form.urgentChecks,
    };

    setSaving(true);
    setFormMessage(null);
    try {
      const res = isEdit
        ? await api.put(`/meta-automation/brand-accounts/${encodeURIComponent(form.id)}`, payload)
        : await api.post('/meta-automation/brand-accounts', { ...payload, id: form.id.trim() });
      setFormMessage({ type: 'success', text: `Tersimpan: "${res.data.account.client}".` });
      resetForm();
      load();
    } catch (err) {
      setFormMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menyimpan akun' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (a) => {
    const confirmed = window.confirm(`Hapus akun "${a.client}"? Token-nya juga akan dihapus dari Script Properties. Akun ini tidak boleh masih dipakai config Daily Tracking manapun.`);
    if (!confirmed) return;

    setDeletingId(a.id);
    setError('');
    try {
      const res = await api.delete(`/meta-automation/brand-accounts/${encodeURIComponent(a.id)}`);
      setAccounts(res.data.accounts || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus akun');
    } finally {
      setDeletingId(null);
    }
  };

  const updateOverrideRow = (idx, field, value) => {
    setForm((f) => ({
      ...f,
      resultOverride: f.resultOverride.map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
    }));
  };

  const addOverrideRow = () => {
    setForm((f) => ({ ...f, resultOverride: [...f.resultOverride, { key: '', value: '' }] }));
  };

  const removeOverrideRow = (idx) => {
    setForm((f) => ({ ...f, resultOverride: f.resultOverride.filter((_, i) => i !== idx) }));
  };

  const isExistingAccount = accounts.some((a) => a.id === form.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="empty-state">Memuat...</div>
        ) : accounts.length === 0 ? (
          <div className="empty-state">Belum ada akun.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Brand</th>
                <th>Tipe</th>
                <th>Portfolio</th>
                <th>Sumber</th>
                <th>Token</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.client}</td>
                  <td>{a.type}</td>
                  <td>{a.portfolio}</td>
                  <td>
                    <span className={`badge ${a.source === 'dynamic' ? 'badge-info' : 'badge-warning'}`}>
                      {a.source === 'dynamic' ? 'Dinamis' : 'Hardcoded'}
                    </span>
                  </td>
                  <td><span className={`badge ${a.hasToken ? 'badge-success' : 'badge-danger'}`}>{a.hasToken ? 'Ada' : 'Kosong'}</span></td>
                  <td>
                    {a.source === 'dynamic' && (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button type="button" className="btn btn-secondary btn-icon" title="Edit" onClick={() => handleEdit(a)}>
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-icon"
                          title="Hapus"
                          disabled={deletingId === a.id}
                          onClick={() => handleDelete(a)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '1rem' }}>{form.id ? `Edit: ${form.client}` : 'Tambah Brand Baru'}</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>ID Ad Account (act_...)</label>
            <input
              value={form.id}
              disabled={!!form.id && isExistingAccount}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              placeholder="act_123456789012345"
            />
          </div>
          <div className="form-group">
            <label>Nama Brand</label>
            <input value={form.client} onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))} placeholder="mis. Brand Baru" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>Tipe Ad Account</label>
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="MAIN">MAIN</option>
              <option value="CPAS">CPAS</option>
            </select>
          </div>
          <div className="form-group">
            <label>Portfolio</label>
            <input value={form.portfolio} onChange={(e) => setForm((f) => ({ ...f, portfolio: e.target.value }))} placeholder="mis. Nama Business Manager" />
          </div>
        </div>

        <div className="form-group">
          <label>Token Meta Ads</label>
          <input
            type="password"
            value={form.token}
            onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
            placeholder={form.id ? 'Kosongkan kalau tidak ganti token' : 'Token system user Meta Ads'}
          />
        </div>

        <div className="form-group">
          <label>Metrik: Override Result per Campaign</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Campaign yang namanya mengandung kata kunci ini dipetakan ke jenis konversi tertentu, khusus brand ini.
            Kosongkan (jangan tambah baris) kalau ikut default global saja. Pilih dari dropdown atau ketik manual --
            dropdown campaign cuma aktif untuk akun yang sudah tersimpan (butuh token untuk narik daftar campaign-nya).
          </p>
          {form.resultOverride.map((row, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <select
                  value=""
                  disabled={!isExistingAccount || campaignsLoading}
                  onChange={(e) => { if (e.target.value) updateOverrideRow(idx, 'key', e.target.value); }}
                  style={{ marginBottom: '0.35rem', width: '100%' }}
                >
                  <option value="">
                    {!isExistingAccount ? 'Simpan akun dulu untuk pilih dari daftar' : campaignsLoading ? 'Memuat daftar campaign...' : `Pilih dari ${campaigns.length} campaign...`}
                  </option>
                  {campaigns.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <input
                  value={row.key}
                  onChange={(e) => updateOverrideRow(idx, 'key', e.target.value)}
                  placeholder="atau ketik kata kunci nama campaign manual"
                />
              </div>
              <div style={{ flex: 1 }}>
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) updateOverrideRow(idx, 'value', e.target.value); }}
                  style={{ marginBottom: '0.35rem', width: '100%' }}
                >
                  <option value="">Pilih metrik...</option>
                  {METRIC_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <input
                  value={row.value}
                  onChange={(e) => updateOverrideRow(idx, 'value', e.target.value)}
                  placeholder="atau ketik result type manual (mis. custom conversion)"
                />
              </div>
              <button type="button" className="btn btn-secondary btn-icon" style={{ marginTop: '0.35rem' }} onClick={() => removeOverrideRow(idx)}>
                <X size={16} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={addOverrideRow}>
            <Plus size={14} /> Tambah Override
          </button>
        </div>

        <ThresholdFields
          title="Threshold Weekly Campaign Review"
          note="Uncheck untuk mematikan metrik itu sepenuhnya buat brand ini (tidak akan pernah memicu temuan). Kosongkan angka untuk pakai default global."
          values={form.thresholds}
          checks={form.thresholdChecks}
          onChange={(thresholds) => setForm((f) => ({ ...f, thresholds }))}
          onChecksChange={(thresholdChecks) => setForm((f) => ({ ...f, thresholdChecks }))}
          fields={[
            { key: 'resultDrop', label: 'Result turun (%)', placeholder: 'default 15' },
            { key: 'cprIncrease', label: 'CPR naik (%)', placeholder: 'default 15' },
            { key: 'minSpend', label: 'Min spend (Rp)', placeholder: 'default 50000' },
            { key: 'minResults', label: 'Min results', placeholder: 'default 3' },
          ]}
        />

        <ThresholdFields
          title="Threshold Daily Urgent Check"
          note="Uncheck untuk mematikan metrik itu sepenuhnya buat brand ini (tidak akan pernah memicu temuan). Kosongkan angka untuk pakai default global."
          values={form.urgentThresholds}
          checks={form.urgentChecks}
          onChange={(urgentThresholds) => setForm((f) => ({ ...f, urgentThresholds }))}
          onChecksChange={(urgentChecks) => setForm((f) => ({ ...f, urgentChecks }))}
          fields={[
            { key: 'cprSpike', label: 'CPR melonjak (%)', placeholder: 'default 50' },
            { key: 'spendSpike', label: 'Spend melonjak (%)', placeholder: 'default 100' },
            { key: 'minSpendDaily', label: 'Min spend harian (Rp)', placeholder: 'default 30000' },
            { key: 'minBaselineRes', label: 'Min baseline result', placeholder: 'default 2' },
          ]}
        />

        {formMessage && <div className={`alert alert-${formMessage.type}`}>{formMessage.text}</div>}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={saving}>
            Batal / Form Kosong
          </button>
        </div>
      </div>
    </div>
  );
}
