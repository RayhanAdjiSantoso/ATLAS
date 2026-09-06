import { useEffect, useState } from 'react';
import { Pencil, Trash2, Plus, X, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../../api/client.js';
import BrandCombo from './BrandCombo.jsx';

// Katalog field yang bisa dipantau -- BUKAN daftar metrik tetap lagi.
// User bebas menyusun kombinasi field + arah + threshold sendiri lewat
// rule builder di bawah. 'zero' (berhenti total, tanpa threshold) cuma
// masuk akal & cuma diizinkan untuk spend/results, dan cuma di grup Daily
// (Weekly tidak punya konsep "kemarin").
const FIELD_OPTIONS = [
  { value: 'spend', label: 'Spend' },
  { value: 'results', label: 'Result' },
  { value: 'cpr', label: 'Cost per Result' },
  { value: 'ctr', label: 'CTR' },
  { value: 'cpm', label: 'CPM' },
  { value: 'frequency', label: 'Frequency' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'reach', label: 'Reach' },
  { value: 'clicks', label: 'Clicks' },
  { value: 'cpc', label: 'CPC (Cost per Click)' },
  { value: 'uniqueClicks', label: 'Unique Clicks' },
  { value: 'inlineLinkClicks', label: 'Link Clicks' },
  { value: 'costPerInlineLinkClick', label: 'Cost per Link Click' },
  { value: 'uniqueCtr', label: 'Unique CTR' },
  { value: 'costPerUniqueClick', label: 'Cost per Unique Click' },
  { value: 'socialSpend', label: 'Social Spend' },
  { value: 'fullViewImpressions', label: 'Full View Impressions' },
  { value: 'fullViewReach', label: 'Full View Reach' },
];
const ZERO_ALLOWED_FIELDS = ['spend', 'results'];

function newRule() {
  return { id: null, field: 'results', ruleType: 'delta', direction: 'down', threshold: '' };
}

function ruleToForm(r) {
  return {
    id: r.id,
    field: r.field,
    ruleType: r.ruleType,
    direction: r.direction || 'down',
    threshold: r.threshold != null ? String(r.threshold * 100) : '',
  };
}

function ruleToPayload(r) {
  if (r.ruleType === 'zero') {
    return { id: r.id || undefined, field: r.field, ruleType: 'zero' };
  }
  return { id: r.id || undefined, field: r.field, ruleType: 'delta', direction: r.direction, threshold: Number(r.threshold) / 100 };
}

function plainToForm(obj) {
  const out = {};
  Object.entries(obj || {}).forEach(([k, v]) => { if (v != null) out[k] = String(v); });
  return out;
}
function plainToPayload(form) {
  const out = {};
  Object.entries(form).forEach(([k, v]) => {
    const trimmed = String(v).trim();
    if (trimmed === '') return;
    const num = Number(trimmed);
    if (!Number.isNaN(num)) out[k] = num;
  });
  return out;
}

const EMPTY_FORM = {
  id: '',
  email: '',
  brand: '',
  type: '',
  brandId: '',
  weeklyMetrics: [],
  weeklyGuards: { minSpend: '', minResults: '' },
  dailyMetrics: [],
  dailyGuards: { minSpendDaily: '', minBaselineRes: '' },
  periods: { weeklyDays: '', wideDays: '', baselineDays: '' },
};

function subscriptionToForm(s, brands) {
  const brand = brands.find((b) => b.id === s.brandId);
  return {
    id: s.id,
    email: s.email,
    brand: brand ? brand.client : '',
    type: brand ? (brand.type || 'MAIN') : '',
    brandId: s.brandId,
    weeklyMetrics: (s.weeklyMetrics || []).map(ruleToForm),
    weeklyGuards: { minSpend: '', minResults: '', ...plainToForm(s.weeklyGuards) },
    dailyMetrics: (s.dailyMetrics || []).map(ruleToForm),
    dailyGuards: { minSpendDaily: '', minBaselineRes: '', ...plainToForm(s.dailyGuards) },
    periods: { weeklyDays: '', wideDays: '', baselineDays: '', ...plainToForm(s.periods) },
  };
}

function RuleRow({ rule, onChange, onRemove, allowZero }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
      <div style={{ width: '160px' }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 400 }}>Field</label>
        <select
          value={rule.field}
          style={{ width: '100%' }}
          onChange={(e) => {
            const field = e.target.value;
            const next = { ...rule, field };
            if (next.ruleType === 'zero' && !ZERO_ALLOWED_FIELDS.includes(field)) next.ruleType = 'delta';
            onChange(next);
          }}
        >
          {FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>
      {allowZero && ZERO_ALLOWED_FIELDS.includes(rule.field) && (
        <div style={{ width: '160px' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 400 }}>Tipe Aturan</label>
          <select value={rule.ruleType} style={{ width: '100%' }} onChange={(e) => onChange({ ...rule, ruleType: e.target.value })}>
            <option value="delta">Perubahan (%)</option>
            <option value="zero">Berhenti (nol)</option>
          </select>
        </div>
      )}
      {rule.ruleType === 'delta' && (
        <>
          <div style={{ width: '160px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 400 }}>Arah</label>
            <select value={rule.direction} style={{ width: '100%' }} onChange={(e) => onChange({ ...rule, direction: e.target.value })}>
              <option value="down">Turun</option>
              <option value="up">Naik</option>
            </select>
          </div>
          <div style={{ width: '160px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 400 }}>Threshold (%)</label>
            <input
              type="number"
              value={rule.threshold}
              onChange={(e) => onChange({ ...rule, threshold: e.target.value })}
              style={{ width: '100%' }}
              placeholder="wajib diisi"
            />
          </div>
        </>
      )}
      {rule.ruleType === 'zero' && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>Tanpa threshold.</p>
      )}
      <button type="button" className="btn btn-secondary btn-icon" onClick={onRemove} style={{ marginBottom: '0.1rem' }}>
        <X size={16} />
      </button>
    </div>
  );
}

function GuardHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{ background: 'var(--bg-elevated)', marginBottom: '1rem' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', color: 'var(--text)', fontWeight: 600 }}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Kenapa perlu pengaman volume minimum?
      </button>
      {open && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-muted)' }}>
          <p>
            Threshold mengukur <em>seberapa besar</em> perubahannya. Pengaman mengukur <em>apakah
            perubahan itu bisa dipercaya</em>. Keduanya berbeda, dan tanpa pengaman, campaign
            terkecil justru yang paling sering memicu alarm.
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            Persentase bergerak liar pada angka kecil. Dengan threshold "result turun 15%":
          </p>
          <div style={{ overflowX: 'auto', margin: '0.5rem 0' }}>
            <table style={{ fontSize: '0.8rem' }}>
              <thead>
                <tr><th>Result sebelum → sesudah</th><th>Perubahan</th><th>Memicu alert?</th></tr>
              </thead>
              <tbody>
                <tr><td>2 → 1</td><td>−50%</td><td>Ya</td></tr>
                <tr><td>3 → 2</td><td>−33%</td><td>Ya</td></tr>
                <tr><td>5 → 4</td><td>−20%</td><td>Ya</td></tr>
                <tr><td>40 → 34</td><td>−15%</td><td>Ya</td></tr>
                <tr><td>200 → 170</td><td>−15%</td><td>Ya</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            Tiga baris pertama selisihnya cuma satu konversi, tapi semuanya lolos threshold.
            Campaign seperti itu akan mengirim alert hampir setiap minggu tanpa ada yang benar-benar
            berubah. Min results menyaringnya.
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            Hal serupa berlaku untuk spend. Campaign dengan sisa budget Rp8.000 yang CPR-nya naik
            300% secara persentase terlihat gawat, tapi secara rupiah tidak layak ditindak. Min
            spend menyaringnya.
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            Efeknya paling terasa saat brand yang dipantau sudah banyak: tanpa pengaman, temuan
            yang benar-benar penting tenggelam di antara puluhan alert yang tidak berarti.
          </p>
          <p style={{ marginTop: '0.5rem' }}>
            Kalau ada campaign nyata yang terlewat, turunkan angkanya — jangan menghilangkannya.
          </p>
        </div>
      )}
    </div>
  );
}

export default function SubscriptionsSection() {
  const [subscriptions, setSubscriptions] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filterEmail, setFilterEmail] = useState('');
  const [filterBrandId, setFilterBrandId] = useState('');

  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get('/meta-automation/subscriptions'),
      api.get('/meta-automation/brands'),
    ])
      .then(([subsRes, brandsRes]) => {
        setSubscriptions(subsRes.data.subscriptions || []);
        setBrands(brandsRes.data.brands || []);
      })
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat langganan'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setFormMessage(null);
  };

  const handleEdit = (s) => {
    setForm(subscriptionToForm(s, brands));
    setFormMessage(null);
  };

  const isEditing = !!form.id;

  const duplicate = !isEditing && form.email.trim() && form.brandId
    ? subscriptions.find((s) => s.email.toLowerCase() === form.email.trim().toLowerCase() && s.brandId === form.brandId)
    : null;

  const weeklyDaysLabel = form.periods.weeklyDays || 3;
  const baselineDaysLabel = form.periods.baselineDays || 7;

  const brandNames = Array.from(new Set(brands.map((b) => b.client))).sort();
  const typesForBrand = Array.from(new Set(brands.filter((b) => b.client === form.brand).map((b) => b.type || 'MAIN'))).sort();

  const updateWeeklyRule = (idx, next) => {
    setForm((f) => ({ ...f, weeklyMetrics: f.weeklyMetrics.map((r, i) => (i === idx ? next : r)) }));
  };
  const updateDailyRule = (idx, next) => {
    setForm((f) => ({ ...f, dailyMetrics: f.dailyMetrics.map((r, i) => (i === idx ? next : r)) }));
  };

  const handleSave = async () => {
    if (!isEditing && !form.email.trim()) {
      setFormMessage({ type: 'error', text: 'Email wajib diisi.' });
      return;
    }
    if (!form.brandId) {
      setFormMessage({ type: 'error', text: 'Brand & Tipe Ad Account wajib dipilih.' });
      return;
    }
    if (!form.weeklyMetrics.length && !form.dailyMetrics.length) {
      setFormMessage({ type: 'error', text: 'Tambahkan minimal satu aturan metrik (Weekly atau Daily).' });
      return;
    }
    const incomplete = [...form.weeklyMetrics, ...form.dailyMetrics].some(
      (r) => r.ruleType === 'delta' && String(r.threshold).trim() === '',
    );
    if (incomplete) {
      setFormMessage({ type: 'error', text: 'Ada aturan dengan threshold masih kosong — isi atau hapus baris itu.' });
      return;
    }
    if (duplicate) {
      setFormMessage({ type: 'error', text: 'Langganan ini sudah ada. Klik "Edit langganan ini" di atas.' });
      return;
    }

    const confirmed = window.confirm(isEditing ? 'Simpan perubahan langganan ini?' : 'Buat langganan baru ini?');
    if (!confirmed) return;

    const payload = {
      brandId: form.brandId,
      weeklyMetrics: form.weeklyMetrics.map(ruleToPayload),
      weeklyGuards: plainToPayload(form.weeklyGuards),
      dailyMetrics: form.dailyMetrics.map(ruleToPayload),
      dailyGuards: plainToPayload(form.dailyGuards),
      periods: plainToPayload(form.periods),
    };
    if (!isEditing) payload.email = form.email.trim();

    setSaving(true);
    setFormMessage(null);
    try {
      const res = isEditing
        ? await api.put(`/meta-automation/subscriptions/${encodeURIComponent(form.id)}`, payload)
        : await api.post('/meta-automation/subscriptions', payload);
      setFormMessage({ type: 'success', text: `Tersimpan: langganan "${res.data.subscription.email}" untuk "${res.data.subscription.brandClient}".` });
      resetForm();
      load();
    } catch (err) {
      setFormMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menyimpan langganan' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s) => {
    const confirmed = window.confirm(`Hapus langganan "${s.email}" untuk brand "${s.brandClient}"? Brand-nya sendiri tidak akan terhapus.`);
    if (!confirmed) return;

    setDeletingId(s.id);
    setError('');
    try {
      const res = await api.delete(`/meta-automation/subscriptions/${encodeURIComponent(s.id)}`);
      setSubscriptions(res.data.subscriptions || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus langganan');
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = subscriptions.filter((s) => {
    if (filterEmail && !s.email.toLowerCase().includes(filterEmail.toLowerCase())) return false;
    if (filterBrandId && s.brandId !== filterBrandId) return false;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Saring Email</label>
          <input value={filterEmail} onChange={(e) => setFilterEmail(e.target.value)} placeholder="cari email..." style={{ width: '100%' }} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Saring Brand</label>
          <select value={filterBrandId} onChange={(e) => setFilterBrandId(e.target.value)} style={{ width: '100%' }}>
            <option value="">Semua brand</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.client} ({b.type})</option>)}
          </select>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="empty-state">Memuat...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">{subscriptions.length === 0 ? 'Belum ada langganan.' : 'Tidak ada langganan yang cocok dengan saringan.'}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Brand</th>
                <th>Tipe</th>
                <th>Aturan Weekly</th>
                <th>Aturan Daily</th>
                <th>Dibuat</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>{s.email}</td>
                  <td>{s.brandClient}</td>
                  <td>{brands.find((b) => b.id === s.brandId)?.type || '-'}</td>
                  <td>{(s.weeklyMetrics || []).length}</td>
                  <td>{(s.dailyMetrics || []).length}</td>
                  <td>{s.createdAt ? new Date(s.createdAt).toLocaleDateString('id-ID') : '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button type="button" className="btn btn-secondary btn-icon" title="Edit" onClick={() => handleEdit(s)}>
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-icon"
                        title="Hapus"
                        disabled={deletingId === s.id}
                        onClick={() => handleDelete(s)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '0.5rem' }}>{isEditing ? `Edit Langganan: ${form.email}` : 'Tambah Langganan Notifikasi'}</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>Email Penerima</label>
            <input
              type="email"
              value={form.email}
              disabled={isEditing}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="nama@mildigital.id"
              style={{ width: '100%' }}
            />
            {isEditing && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Tidak bisa diubah.</p>}
          </div>
          <div className="form-group">
            <label>Brand</label>
            <BrandCombo
              options={brandNames}
              value={form.brand}
              placeholder="Pilih brand..."
              onChange={(v) => setForm((f) => ({ ...f, brand: v, type: '', brandId: '' }))}
            />
          </div>
          <div className="form-group">
            <label>Tipe Ad Account</label>
            <select
              value={form.type}
              disabled={!form.brand}
              style={{ width: '100%' }}
              onChange={(e) => {
                const type = e.target.value;
                const match = brands.find((b) => b.client === form.brand && (b.type || 'MAIN') === type);
                setForm((f) => ({ ...f, type, brandId: match ? match.id : '' }));
              }}
            >
              <option value="">{form.brand ? 'Pilih tipe...' : 'Pilih brand dulu'}</option>
              {typesForBrand.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {duplicate && (
          <div className="alert alert-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
            <span>Langganan "{duplicate.email}" untuk brand ini sudah ada.</span>
            <button type="button" className="btn btn-secondary" onClick={() => handleEdit(duplicate)}>Edit langganan ini</button>
          </div>
        )}

        <div className="form-group">
          <label>Aturan Weekly Campaign Review — dibanding {weeklyDaysLabel} hari sebelumnya</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Susun sendiri field mana yang dipantau, arahnya, dan threshold-nya. Tidak terbatas pilihan tetap.
          </p>
          {form.weeklyMetrics.map((rule, idx) => (
            <RuleRow
              key={idx}
              rule={rule}
              allowZero={false}
              onChange={(next) => updateWeeklyRule(idx, next)}
              onRemove={() => setForm((f) => ({ ...f, weeklyMetrics: f.weeklyMetrics.filter((_, i) => i !== idx) }))}
            />
          ))}
          <button type="button" className="btn btn-secondary" onClick={() => setForm((f) => ({ ...f, weeklyMetrics: [...f.weeklyMetrics, newRule()] }))}>
            <Plus size={14} /> Tambah Aturan Weekly
          </button>
        </div>

        {form.weeklyMetrics.length > 0 && (
          <div className="form-group">
            <label>Pengaman Volume Minimum — Weekly</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 400 }}>Min spend (Rp)</label>
                <input type="number" value={form.weeklyGuards.minSpend} placeholder="default 50000"
                  onChange={(e) => setForm((f) => ({ ...f, weeklyGuards: { ...f.weeklyGuards, minSpend: e.target.value } }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 400 }}>Min results</label>
                <input type="number" value={form.weeklyGuards.minResults} placeholder="default 3"
                  onChange={(e) => setForm((f) => ({ ...f, weeklyGuards: { ...f.weeklyGuards, minResults: e.target.value } }))} />
              </div>
            </div>
          </div>
        )}

        <div className="form-group">
          <label>Aturan Daily Urgent Check — dibanding rata-rata harian {baselineDaysLabel} hari sebelumnya</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Sama seperti Weekly, tapi juga bisa aturan "Berhenti (nol)" untuk Spend/Result (dulu disebut Delivery/Result berhenti) -- tanpa threshold.
          </p>
          {form.dailyMetrics.map((rule, idx) => (
            <RuleRow
              key={idx}
              rule={rule}
              allowZero
              onChange={(next) => updateDailyRule(idx, next)}
              onRemove={() => setForm((f) => ({ ...f, dailyMetrics: f.dailyMetrics.filter((_, i) => i !== idx) }))}
            />
          ))}
          <button type="button" className="btn btn-secondary" onClick={() => setForm((f) => ({ ...f, dailyMetrics: [...f.dailyMetrics, newRule()] }))}>
            <Plus size={14} /> Tambah Aturan Daily
          </button>
        </div>

        {form.dailyMetrics.length > 0 && (
          <div className="form-group">
            <label>Pengaman Volume Minimum — Daily</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 400 }}>Min spend harian (Rp)</label>
                <input type="number" value={form.dailyGuards.minSpendDaily} placeholder="default 30000"
                  onChange={(e) => setForm((f) => ({ ...f, dailyGuards: { ...f.dailyGuards, minSpendDaily: e.target.value } }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 400 }}>Min baseline result</label>
                <input type="number" value={form.dailyGuards.minBaselineRes} placeholder="default 2"
                  onChange={(e) => setForm((f) => ({ ...f, dailyGuards: { ...f.dailyGuards, minBaselineRes: e.target.value } }))} />
              </div>
            </div>
          </div>
        )}

        {(form.weeklyMetrics.length > 0 || form.dailyMetrics.length > 0) && <GuardHelp />}

        <div className="form-group">
          <label>Pengaturan Periode (opsional)</label>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Kosong = pakai default sistem. Untuk klien dengan volume konversi besar, jendela 3 hari sudah stabil; untuk klien kecil, mungkin perlu langsung 7 hari.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 400 }}>Jendela Weekly (hari)</label>
              <input type="number" min="1" value={form.periods.weeklyDays} placeholder="default 3"
                onChange={(e) => setForm((f) => ({ ...f, periods: { ...f.periods, weeklyDays: e.target.value } }))} />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 400 }}>Jendela cadangan (hari)</label>
              <input type="number" min="1" value={form.periods.wideDays} placeholder="default 7"
                onChange={(e) => setForm((f) => ({ ...f, periods: { ...f.periods, wideDays: e.target.value } }))} />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 400 }}>Baseline Daily (hari)</label>
              <input type="number" min="1" value={form.periods.baselineDays} placeholder="default 7"
                onChange={(e) => setForm((f) => ({ ...f, periods: { ...f.periods, baselineDays: e.target.value } }))} />
            </div>
          </div>
        </div>

        {formMessage && <div className={`alert alert-${formMessage.type}`}>{formMessage.text}</div>}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !!duplicate}>
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
