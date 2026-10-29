import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Check, CircleAlert, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import SelectMenu from '../common/SelectMenu.jsx';
import SubscriptionsSection from '../metaAutomation/SubscriptionsSection.jsx';
import { describeError } from './describeError.js';
import './metaAdsAutoFetch.css';

const EMPTY = { id: '', type: 'MAIN', mainKind: 'MIXED', boostMatch: '', token: '' };

// What a MAIN account holds. Only a mixed one needs Kata Kunci Boost Post to
// split its campaigns; the others are Boost or Non Boost Post as a whole.
const MAIN_KINDS = [
  { value: 'MIXED', label: 'Gabungan', description: 'Boost Post + Non Boost Post, dipisah kata kunci' },
  { value: 'BOOST', label: 'Boost Post', description: 'Khusus campaign Boost Post' },
  { value: 'NONBOOST', label: 'Non Boost Post', description: 'Khusus campaign Non Boost Post' },
];
const mainKindLabel = (kind) => MAIN_KINDS.find((k) => k.value === kind)?.label ?? 'Gabungan';
const needsKeyword = (type, mainKind) => type !== 'CPAS' && (mainKind || 'MIXED') === 'MIXED';
const keywordNotNeeded = (type, mainKind) => (type === 'CPAS' ? 'Tidak diperlukan untuk CPAS' : 'Tidak diperlukan untuk akun khusus ' + mainKindLabel(mainKind));

// 'act_123', '123' -> 'act_123'; null when it is not an ad account ID.
const normalizeAccountId = (raw) => {
  const id = 'act_' + String(raw).trim().replace(/^act_/i, '');
  return /^act_\d+$/.test(id) ? id : null;
};

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
  const [editing, setEditing] = useState(null); // { id, accountId, mainKind, boostMatch }
  const [deletingId, setDeletingId] = useState(null);
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

  const saveEdit = async (account) => {
    if (!canEdit || editSaving) return;
    const newId = normalizeAccountId(editing.accountId);
    if (!newId) {
      setEditMessage({ type: 'error', text: 'ID Ad Account harus berupa angka, misalnya act_123456789012345.' });
      return;
    }
    const renaming = newId !== account.id;
    if (renaming && !window.confirm(`Ganti ID ${account.id} menjadi ${newId}? Langganan akun ini ikut pindah ke ID baru; data Meta Ads yang sudah ditarik dengan ID lama tetap tersimpan.`)) return;
    setEditSaving(true);
    setEditMessage(null);
    try {
      if (renaming) {
        // Same guard as adding: the API is an upsert, so never move onto an
        // account that is already registered (possibly another client's).
        const { data } = await api.get('/meta-automation/brands');
        if ((data.brands ?? []).some((a) => a.id === newId)) {
          setEditMessage({ type: 'error', text: 'ID Ad Account ' + newId + ' sudah terdaftar. Gunakan ID lain.' });
          return;
        }
      }
      // brandSave replaces the whole entry: client, type and atlasBrandId must
      // ride along or the account loses its link to this brand. An empty
      // token keeps the stored one; the URL names the account being edited.
      await api.put('/meta-automation/brands/' + encodeURIComponent(account.id), {
        id: newId, client: account.client, type: account.type, atlasBrandId: account.atlasBrandId,
        mainKind: account.type === 'CPAS' ? undefined : editing.mainKind,
        boostMatch: needsKeyword(account.type, editing.mainKind) ? editing.boostMatch.trim() || undefined : undefined,
      });
      setEditing(null);
      setEditMessage({ type: 'success', text: 'Akun ' + newId + ' diperbarui. Berlaku untuk penarikan berikutnya.' });
      await loadAccounts();
    } catch (err) {
      setEditMessage({ type: 'error', text: describeError(err, 'Gagal menyimpan akun Meta Ads.') });
    } finally {
      setEditSaving(false);
    }
  };

  const remove = async (account) => {
    if (!canEdit || deletingId) return;
    setEditMessage(null);
    // Deleting an account deletes its subscriptions too (Apps Script
    // cascade), so name who stops getting notified before asking.
    let subscribers = [];
    try {
      const { data } = await api.get(`/meta-automation/brand/${brandId}/subscriptions`);
      subscribers = (data.subscriptions ?? []).filter((s) => s.brandId === account.id).map((s) => s.email);
    } catch { /* the confirmation below still warns in general terms */ }
    const cascade = subscribers.length
      ? `\n\n${subscribers.length} langganan ikut terhapus: ${subscribers.join(', ')}.`
      : '\n\nLangganan notifikasi akun ini (jika ada) ikut terhapus.';
    if (!window.confirm(`Hapus akun ${account.id} (${account.type}) dari ${brand.brand_name}? Token tersimpannya ikut dihapus dan akun ini tidak lagi ditarik otomatis. Data Meta Ads yang sudah tersimpan di ATLAS tidak terhapus.${cascade}`)) return;
    setDeletingId(account.id);
    try {
      await api.delete('/meta-automation/brands/' + encodeURIComponent(account.id));
      if (editing?.id === account.id) setEditing(null);
      setEditMessage({ type: 'success', text: 'Akun ' + account.id + ' dihapus dari ' + brand.brand_name + '.' });
      onAccountAdded?.();
      await loadAccounts();
    } catch (err) {
      setEditMessage({ type: 'error', text: describeError(err, 'Gagal menghapus akun Meta Ads.') });
    } finally {
      setDeletingId(null);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (disabled) return;
    const id = normalizeAccountId(form.id);
    if (!id) {
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
      if ((data.brands ?? []).some((account) => normalizeAccountId(account.id) === id)) {
        setMessage({ type: 'error', text: 'ID Ad Account ini sudah terdaftar. Gunakan ID akun baru untuk menambahkan akun.' });
        return;
      }
      await api.post('/meta-automation/brands', {
        id, client: brand.brand_name, atlasBrandId: brand.brand_id,
        type: form.type, token: form.token.trim(),
        mainKind: form.type === 'CPAS' ? undefined : form.mainKind,
        boostMatch: needsKeyword(form.type, form.mainKind) ? form.boostMatch.trim() || undefined : undefined,
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
            <div className="bp-meta-accounts" data-feature="meta-kelola-akun">
              <div className="maf-table-wrap mx-table">
                <table className="maf-table">
                  <thead><tr><th>ID Ad Account</th><th>Tipe</th><th>Kata kunci Boost Post</th><th aria-label="Aksi" /></tr></thead>
                  <tbody>
                    {accounts.map((account) => {
                      const isCpas = account.type === 'CPAS';
                      // Hard-coded accounts live in the Apps Script code itself.
                      const editable = canEdit && account.source === 'dynamic';
                      const isEditing = editing?.id === account.id;
                      const rowKind = isEditing ? editing.mainKind : account.mainKind;
                      const onKeyDown = (event) => {
                        if (event.key === 'Enter') { event.preventDefault(); saveEdit(account); }
                        if (event.key === 'Escape') setEditing(null);
                      };
                      return (
                        <tr key={account.id}>
                          <td className="mx-mono">
                            {isEditing ? (
                              <input className="form-input mx-mono" aria-label={'ID Ad Account ' + account.id} value={editing.accountId} autoFocus
                                placeholder="act_123456789012345" disabled={editSaving} onKeyDown={onKeyDown}
                                onChange={(event) => setEditing((current) => ({ ...current, accountId: event.target.value }))} />
                            ) : account.id}
                          </td>
                          <td>
                            <span className="mx-type-cell">
                              <span className={'mx-type is-' + account.type.toLowerCase()}>{account.type}</span>
                              {!isCpas && (isEditing ? (
                                <SelectMenu label={'Jenis akun ' + account.id} value={editing.mainKind} disabled={editSaving} options={MAIN_KINDS}
                                  onChange={(mainKind) => setEditing((current) => ({ ...current, mainKind }))} />
                              ) : <span className="mx-kind">{mainKindLabel(account.mainKind)}</span>)}
                            </span>
                          </td>
                          <td>
                            {!needsKeyword(account.type, rowKind) ? <span className="maf-run-meta">Tidak diperlukan</span>
                              : isEditing ? (
                                <input className="form-input" aria-label={'Kata kunci Boost Post ' + account.id} value={editing.boostMatch}
                                  placeholder="mis. profile visit" disabled={editSaving} onKeyDown={onKeyDown}
                                  onChange={(event) => setEditing((current) => ({ ...current, boostMatch: event.target.value }))} />
                              ) : account.boostMatch || <span className="maf-run-meta">Belum diisi</span>}
                          </td>
                          <td className="maf-row-actions">
                            {isEditing ? (
                              <>
                                <button type="button" className="btn btn-icon" title="Simpan" aria-label={'Simpan akun ' + account.id} onClick={() => saveEdit(account)} disabled={editSaving}>
                                  {editSaving ? <Loader2 size={14} className="maf-spin" /> : <Check size={14} />}
                                </button>
                                <button type="button" className="btn btn-icon" title="Batal" aria-label="Batal" onClick={() => setEditing(null)} disabled={editSaving}>
                                  <X size={14} />
                                </button>
                              </>
                            ) : editable && (
                              <>
                                <button type="button" className="btn btn-icon" title="Edit akun" aria-label={'Edit akun ' + account.id}
                                  onClick={() => { setEditing({ id: account.id, accountId: account.id, mainKind: account.mainKind || 'MIXED', boostMatch: account.boostMatch || '' }); setEditMessage(null); }}
                                  disabled={editSaving || !!deletingId}>
                                  <Pencil size={14} />
                                </button>
                                <button type="button" className="btn btn-icon mx-danger" title="Hapus akun" aria-label={'Hapus akun ' + account.id}
                                  onClick={() => remove(account)} disabled={editSaving || !!deletingId}>
                                  {deletingId === account.id ? <Loader2 size={14} className="maf-spin" /> : <Trash2 size={14} />}
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="maf-hint">Akun MAIN gabungan: campaign yang namanya mengandung kata kunci masuk Boost Post, sisanya Non Boost Post. Akun khusus Boost Post atau Non Boost Post tidak perlu kata kunci. Brand boleh punya lebih dari satu akun MAIN atau CPAS; spend akun setipe dijumlah.</p>
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
                {form.type === 'MAIN' && (
                  <div className="form-group">
                    <label htmlFor="meta-account-kind">Jenis akun MAIN</label>
                    <SelectMenu id="meta-account-kind" label="Jenis akun MAIN" value={form.mainKind} disabled={disabled} options={MAIN_KINDS}
                      onChange={(mainKind) => setForm((current) => ({ ...current, mainKind }))} />
                  </div>
                )}
                <div className="form-group">
                  <label htmlFor="meta-account-boost">Kata kunci Boost Post</label>
                  <input id="meta-account-boost" value={needsKeyword(form.type, form.mainKind) ? form.boostMatch : ''} onChange={set('boostMatch')}
                    disabled={disabled || !needsKeyword(form.type, form.mainKind)}
                    placeholder={needsKeyword(form.type, form.mainKind) ? 'mis. profile visit' : keywordNotNeeded(form.type, form.mainKind)} />
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
