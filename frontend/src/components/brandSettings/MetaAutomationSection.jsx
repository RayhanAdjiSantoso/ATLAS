import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import SelectMenu from '../common/SelectMenu.jsx';
import { describeError } from './describeError.js';

const EMPTY = { id: '', type: 'MAIN', boostMatch: '', token: '' };

// Keyed by brand in the page: switching clients clears credentials and feedback.
export default function MetaAutomationSection({ brand, onAccountAdded }) {
  const { isViewOnly, can } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const disabled = !brand || isViewOnly || !can('meta_automation') || saving;
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = async (event) => {
    event.preventDefault();
    if (disabled) return;
    const id = 'act_' + form.id.trim().replace(/^act_/i, '');
    if (!/^act_\d+$/.test(id)) {
      setMessage({ type: 'error', text: 'ID Ad Account harus berupa angka, misalnya act_123456789012345.' });
      return;
    }
    if (!form.token.trim()) {
      setMessage({ type: 'error', text: 'Token Meta Ads wajib diisi.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      // The API is an upsert. Avoid overwriting an existing registration when
      // adding an account, especially one already linked to another client.
      const { data } = await api.get('/meta-automation/brands');
      if ((data.brands ?? []).some((account) => String(account.id).replace(/^act_/i, '') === id.slice(4))) {
        setMessage({ type: 'error', text: 'ID Ad Account ini sudah terdaftar. Gunakan ID akun baru untuk menambahkan akun.' });
        return;
      }
      await api.post('/meta-automation/brands', {
        id, client: brand.brand_name, atlasBrandId: brand.brand_id,
        type: form.type, token: form.token.trim(),
        boostMatch: form.type === 'CPAS' ? undefined : form.boostMatch.trim() || undefined,
      });
      setForm(EMPTY);
      setMessage({ type: 'success', text: 'Akun ' + id + ' berhasil ditambahkan ke ' + brand.brand_name + '.' });
      onAccountAdded?.();
    } catch (err) {
      setMessage({ type: 'error', text: describeError(err, 'Gagal menambahkan akun Meta Ads.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="brand-workspace-head">
        <div>
          <h2>Meta Automation</h2>
          <p>Tambahkan akun Meta Ads untuk {brand?.brand_name ?? 'brand yang dipilih'}. Akun otomatis ditautkan ke brand ini.</p>
        </div>
      </div>
      <form onSubmit={save}>
        <fieldset disabled={disabled} className="bp-meta-account-fields">
          <div className="form-group">
            <label htmlFor="meta-account-id">ID Ad Account</label>
            <input id="meta-account-id" value={form.id} onChange={set('id')} placeholder="act_123456789012345" required />
          </div>
          <div className="form-group">
            <label htmlFor="meta-account-type">Tipe Ad Account</label>
            <SelectMenu id="meta-account-type" label="Tipe Ad Account" value={form.type} disabled={disabled}
              options={[{ value: 'MAIN', label: 'MAIN' }, { value: 'CPAS', label: 'CPAS' }]}
              onChange={(type) => setForm((current) => ({ ...current, type }))} />
          </div>
          <div className="form-group">
            <label htmlFor="meta-account-boost">Kata Kunci Boost Post</label>
            <input id="meta-account-boost" value={form.boostMatch} onChange={set('boostMatch')} disabled={disabled || form.type === 'CPAS'} placeholder="mis. profile visit" />
            <small>{form.type === 'CPAS' ? 'Tidak diperlukan untuk akun CPAS.' : 'Nama campaign yang mengandung kata ini masuk Boost Post, sisanya Non-Boost Post.'}</small>
          </div>
          <div className="form-group">
            <label htmlFor="meta-account-token">Token Meta Ads</label>
            <input id="meta-account-token" type="password" autoComplete="new-password" value={form.token} onChange={set('token')} placeholder="Token system user Meta Ads" required />
          </div>
        </fieldset>
        {message && <p className={'alert alert-' + message.type} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}
        {!can('meta_automation') && <p className="bp-drawer-note">Akses Meta Automation diperlukan untuk menambahkan akun.</p>}
        <button type="submit" className="bp-primary" disabled={disabled}>
          {saving ? <Loader2 size={16} className="brand-spin" /> : <Plus size={16} />}
          {saving ? 'Menyimpan…' : 'Tambah akun'}
        </button>
      </form>
    </>
  );
}
