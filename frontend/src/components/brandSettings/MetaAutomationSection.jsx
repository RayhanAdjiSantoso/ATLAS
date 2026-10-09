import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Check, CircleAlert, Loader2, Pencil, Plus, X } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import SelectMenu from '../common/SelectMenu.jsx';
import SubscriptionsSection from '../metaAutomation/SubscriptionsSection.jsx';
import { describeError } from './describeError.js';
import './metaAdsAutoFetch.css';

const EMPTY = { id: '', type: 'MAIN', boostMatch: '', token: '' };

const TABS = [
  { key: 'accounts', label: 'Akun', hint: 'Ad account untuk automation' },
  { key: 'subscriptions', label: 'Langganan', hint: 'Notifikasi Weekly & Daily' },
];

// Keyed by brand in the page: switching clients clears credentials and feedback.
export default function MetaAutomationSection({ brand, onAccountAdded }) {
  const { isViewOnly, can } = useAuth();
  // Roles without Meta Ads Automation (User internal) still manage this
  // brand's subscriptions through Brand Setting; they see that tab only.
  const subscriptionsOnly = !can('meta_automation') && can('brand_settings');
  const tabs = subscriptionsOnly ? TABS.filter((t) => t.key === 'subscriptions') : TABS;
  const [tab, setTab] = useState(subscriptionsOnly ? 'subscriptions' : 'accounts');
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  // The add form stays folded until asked for: most visits are to read the
  // accounts, and four empty fields made the panel look unfinished.
  const [adding, setAdding] = useState(false);
  const disabled = !brand || isViewOnly || !can('meta_automation') || saving;
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  // The brand's registered accounts, from the same Apps Script registry the
  // add form writes to. null = still loading.
  const [accounts, setAccounts] = useState(null);
  const [accountsError, setAccountsError] = useState('');
  const [editing, setEditing] = useState(null); // { id, value }
  const [editSaving, setEditSaving] = useState(false);
  const [editMessage, setEditMessage] = useState(null);
  const hasAccess = can('meta_automation');
  const canEdit = !!brand && !isViewOnly && hasAccess;
  const brandId = brand?.brand_id;

  const loadAccounts = useCallback(async () => {
    if (!brandId || !hasAccess) return;
    setAccountsError('');
    try {
      const { data } = await api.get('/meta-automation/brands');
      setAccounts((data.brands ?? []).filter((account) => Number(account.atlasBrandId) === Number(brandId)));
    } catch (err) {
      setAccountsError(describeError(err, 'Gagal memuat akun Meta Ads.'));
    }
  }, [brandId, hasAccess]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const saveBoostMatch = async (account) => {
    if (!canEdit || editSaving) return;
    setEditSaving(true);
    setEditMessage(null);
    try {
      // brandSave replaces the whole entry: client, type and atlasBrandId must
      // ride along or the account loses its link to this brand. An empty
      // token keeps the stored one.
      await api.put('/meta-automation/brands/' + encodeURIComponent(account.id), {
        client: account.client, type: account.type, atlasBrandId: account.atlasBrandId,
        boostMatch: editing.value.trim() || undefined,
      });
      setEditing(null);
      setEditMessage({ type: 'success', text: 'Kata kunci Boost Post ' + account.id + ' diperbarui. Berlaku untuk penarikan berikutnya.' });
      await loadAccounts();
    } catch (err) {
      setEditMessage({ type: 'error', text: describeError(err, 'Gagal menyimpan kata kunci Boost Post.') });
    } finally {
      setEditSaving(false);
    }
  };

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
      setAdding(false);
      setMessage({ type: 'success', text: 'Akun ' + id + ' berhasil ditambahkan ke ' + brand.brand_name + '.' });
      onAccountAdded?.();
      loadAccounts();
    } catch (err) {
      setMessage({ type: 'error', text: describeError(err, 'Gagal menambahkan akun Meta Ads.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-card">
      <header className="mx-head">
        <span className="mx-head-ico" aria-hidden="true"><BadgeCheck size={18} /></span>
        <div className="mx-head-copy">
          <h3>Meta Automation</h3>
          <p>{subscriptionsOnly
            ? <>Langganan notifikasi Weekly &amp; Daily untuk akun Meta Ads {brand?.brand_name ?? 'brand yang dipilih'}.</>
            : <>Akun Meta Ads dan langganan notifikasi {brand?.brand_name ?? 'brand yang dipilih'}.</>}</p>
        </div>
        {accounts && <span className={'mx-pill' + (accounts.length ? ' is-on' : '')}>{accounts.length ? accounts.length + ' akun terdaftar' : 'Belum ada akun'}</span>}
      </header>
      <div className="mx-tabs" role="tablist" aria-label="Meta Automation">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" id={'meta-auto-tab-' + t.key} aria-selected={tab === t.key} aria-controls={'meta-auto-panel-' + t.key}
            title={t.hint} className={'mx-tab' + (tab === t.key ? ' is-on' : '')} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'accounts' && accounts?.length > 0 && <b>{accounts.length}</b>}
          </button>
        ))}
      </div>
      {tab === 'subscriptions' ? (
        <div role="tabpanel" id="meta-auto-panel-subscriptions" aria-labelledby="meta-auto-tab-subscriptions" className="bp-meta-subscriptions">
          {!hasAccess && !subscriptionsOnly
            ? <p className="bp-drawer-note">Akses Meta Automation diperlukan untuk mengelola langganan.</p>
            : brand && <SubscriptionsSection brand={brand} readOnly={isViewOnly} />}
        </div>
      ) : (
        <div role="tabpanel" id="meta-auto-panel-accounts" aria-labelledby="meta-auto-tab-accounts" className="mx-panel">
          {accountsError && (
            <div className="mx-notice is-error" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{accountsError.replace(/\.:\s*/, ': ')}</span>
              <button type="button" className="mx-link" onClick={loadAccounts}>Coba lagi</button>
            </div>
          )}
          {accounts === null && !accountsError && hasAccess && brand && (
            <p className="maf-loading"><Loader2 size={14} className="maf-spin" /> Memuat akun…</p>
          )}
          {accounts?.length === 0 && (
            <p className="mx-empty">Belum ada akun Meta Ads yang tertaut ke {brand?.brand_name ?? 'brand ini'}. Tambahkan akun agar laporan dan penarikan otomatis berjalan.</p>
          )}
          {accounts?.length > 0 && (
            <div className="bp-meta-accounts">
              <div className="maf-table-wrap mx-table">
                <table className="maf-table">
                  <thead><tr><th>ID Ad Account</th><th>Tipe</th><th>Kata kunci Boost Post</th><th aria-label="Aksi" /></tr></thead>
                  <tbody>
                    {accounts.map((account) => {
                      const isCpas = account.type === 'CPAS';
                      const editable = canEdit && !isCpas && account.source === 'dynamic';
                      const isEditing = editing?.id === account.id;
                      return (
                        <tr key={account.id}>
                          <td className="mx-mono">{account.id}</td>
                          <td><span className={'mx-type is-' + account.type.toLowerCase()}>{account.type}</span></td>
                          <td>
                            {isCpas ? <span className="maf-run-meta">Tidak diperlukan</span>
                              : isEditing ? (
                                <input className="form-input" aria-label={'Kata kunci Boost Post ' + account.id} value={editing.value} autoFocus
                                  placeholder="mis. profile visit" disabled={editSaving}
                                  onChange={(event) => setEditing({ id: account.id, value: event.target.value })}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') { event.preventDefault(); saveBoostMatch(account); }
                                    if (event.key === 'Escape') setEditing(null);
                                  }} />
                              ) : account.boostMatch || <span className="maf-run-meta">Belum diisi</span>}
                          </td>
                          <td className="maf-row-actions">
                            {isEditing ? (
                              <>
                                <button type="button" className="btn btn-icon" title="Simpan" aria-label="Simpan kata kunci" onClick={() => saveBoostMatch(account)} disabled={editSaving}>
                                  {editSaving ? <Loader2 size={14} className="maf-spin" /> : <Check size={14} />}
                                </button>
                                <button type="button" className="btn btn-icon" title="Batal" aria-label="Batal" onClick={() => setEditing(null)} disabled={editSaving}>
                                  <X size={14} />
                                </button>
                              </>
                            ) : editable && (
                              <button type="button" className="btn btn-icon" title="Edit kata kunci Boost Post" aria-label={'Edit kata kunci Boost Post ' + account.id}
                                onClick={() => { setEditing({ id: account.id, value: account.boostMatch || '' }); setEditMessage(null); }} disabled={editSaving}>
                                <Pencil size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="maf-hint">Campaign yang namanya mengandung kata kunci masuk Boost Post, sisanya Non-Boost Post.</p>
              {editMessage && <p className={'alert alert-' + editMessage.type} role={editMessage.type === 'error' ? 'alert' : 'status'}>{editMessage.text}</p>}
            </div>
          )}

          {message && !adding && <p className={'alert alert-' + message.type} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}
          {!can('meta_automation') && <p className="bp-drawer-note">Akses Meta Automation diperlukan untuk menambahkan akun.</p>}

          {adding ? (
            <form onSubmit={save} className="mx-form">
              <div className="mx-form-head">
                <h4>Tambah akun Meta Ads</h4>
                <p>Akun otomatis ditautkan ke {brand?.brand_name ?? 'brand ini'}.</p>
              </div>
              <fieldset disabled={disabled} className="bp-meta-account-fields">
                <div className="form-group">
                  <label htmlFor="meta-account-id">ID Ad Account</label>
                  <input id="meta-account-id" value={form.id} onChange={set('id')} placeholder="act_123456789012345" required />
                </div>
                <div className="form-group">
                  <label htmlFor="meta-account-type">Tipe akun</label>
                  <SelectMenu id="meta-account-type" label="Tipe Ad Account" value={form.type} disabled={disabled}
                    options={[{ value: 'MAIN', label: 'MAIN' }, { value: 'CPAS', label: 'CPAS' }]}
                    onChange={(type) => setForm((current) => ({ ...current, type }))} />
                </div>
                <div className="form-group">
                  <label htmlFor="meta-account-boost">Kata kunci Boost Post</label>
                  <input id="meta-account-boost" value={form.boostMatch} onChange={set('boostMatch')} disabled={disabled || form.type === 'CPAS'} placeholder={form.type === 'CPAS' ? 'Tidak diperlukan untuk CPAS' : 'mis. profile visit'} />
                </div>
                <div className="form-group">
                  <label htmlFor="meta-account-token">Token Meta Ads</label>
                  <input id="meta-account-token" type="password" autoComplete="new-password" value={form.token} onChange={set('token')} placeholder="Token system user" required />
                </div>
              </fieldset>
              {message && <p className={'alert alert-' + message.type} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}
              <div className="mx-form-actions">
                <button type="button" className="bp-ghost" onClick={() => { setAdding(false); setForm(EMPTY); setMessage(null); }} disabled={saving}>Batal</button>
                <button type="submit" className="bp-primary" disabled={disabled}>
                  {saving ? <Loader2 size={16} className="brand-spin" /> : <Check size={16} />}
                  {saving ? 'Menyimpan…' : 'Simpan akun'}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="mx-add" onClick={() => { setAdding(true); setMessage(null); }} disabled={!brand || isViewOnly || !can('meta_automation')}>
              <Plus size={16} aria-hidden="true" /> Tambah akun Meta Ads
            </button>
          )}
        </div>
      )}
    </div>
  );
}
