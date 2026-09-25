import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Ban, Check, CheckCircle2, ClipboardCopy, History, KeyRound, Lock, Pencil, Plus, Search, ShieldCheck, UserCog, Users, X,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext.jsx';
import atlasIcon from '../assets/atlas-icon.png';
import atlasWordmark from '../assets/atlas-wordmark.png';
import '../components/dashboard/console.css';
import './accessSettings.css';

// Pengaturan Akses — who has an account, what each role may open, and who
// changed what.
//
// Accounts are only ever created here (public sign-up was removed for Shopee
// Open Platform's data-protection audit). The server decides every rule shown
// on this page; the page only mirrors it so that a button which would be
// refused is disabled up front instead of failing after a click.

const ROLE_ORDER = ['superadmin', 'admin', 'user', 'client'];
const ROLE_NOTE = {
  superadmin: 'Semua fitur, termasuk mengatur hak akses setiap role.',
  admin: 'Semua fitur. Bisa membuat dan mengelola akun user & client.',
  user: 'Tim internal yang mengerjakan ads. Fiturnya diatur di tab Hak Akses Role.',
  client: 'Akun klien. Hanya melihat brand miliknya sendiri.',
};
const ACTION_LABEL = {
  create: 'membuat akun',
  update: 'mengubah akun',
  reset_password: 'mereset password',
  permission: 'mengubah hak akses role',
};

const dateTime = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDate = (v) => (v ? dateTime.format(new Date(v)) : '—');

function canManage(actorRole, targetRole) {
  if (actorRole === 'superadmin') return true;
  if (actorRole === 'admin') return targetRole === 'user' || targetRole === 'client';
  return false;
}

function RoleBadge({ role, label }) {
  return <span className={`acc-role acc-role-${role}`}>{label ?? role}</span>;
}

function Modal({ title, icon: Icon, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="acc-backdrop" onClick={onClose}>
      <div className={`acc-modal${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="acc-modal-head">
          {Icon && <span className="acc-modal-icon" aria-hidden><Icon size={17} /></span>}
          <h2>{title}</h2>
          <button type="button" className="acc-icon-btn" onClick={onClose} aria-label="Tutup"><X size={16} /></button>
        </header>
        <div className="acc-modal-body">{children}</div>
        {footer && <footer className="acc-modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// The one moment a temporary password is visible. It is not stored anywhere
// readable afterwards, so the admin copies it now and passes it on.
function TempPasswordModal({ account, password, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Email: ${account.email}\nPassword sementara: ${password}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal
      title="Password sementara"
      icon={KeyRound}
      onClose={onClose}
      footer={<button type="button" className="acc-btn acc-btn-primary" onClick={onClose}>Sudah saya simpan</button>}
    >
      <p className="acc-lead">
        Berikan data ini ke <strong>{account.full_name || account.email}</strong>. Password hanya ditampilkan <strong>sekali</strong> — setelah jendela ini ditutup,
        tidak bisa dilihat lagi (reset password bila hilang).
      </p>
      <div className="acc-secret">
        <div><span>Email</span><strong>{account.email}</strong></div>
        <div><span>Password sementara</span><strong className="acc-mono">{password}</strong></div>
        <button type="button" className="acc-btn" onClick={copy}>
          {copied ? <><Check size={14} /> Tersalin</> : <><ClipboardCopy size={14} /> Salin keduanya</>}
        </button>
      </div>
      <p className="acc-note">Saat login pertama, pemilik akun wajib mengganti password ini dengan password miliknya sendiri.</p>
    </Modal>
  );
}

function AccountForm({ mode, initial, roles, brands, actorRole, onCancel, onSaved }) {
  const [email, setEmail] = useState(initial?.email ?? '');
  const [fullName, setFullName] = useState(initial?.full_name ?? '');
  const [role, setRole] = useState(initial?.role ?? (actorRole === 'superadmin' ? 'user' : 'client'));
  const [brandId, setBrandId] = useState(initial?.allowed_brand_id ?? '');
  const [viewOnly, setViewOnly] = useState(Boolean(initial?.is_view_only ?? false));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const allowedRoles = roles.filter((r) => canManage(actorRole, r.key));
  const needsBrand = role === 'client';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (needsBrand && !brandId) return setError('Akun client wajib dibatasi ke satu brand.');
    setSaving(true);
    try {
      const body = { fullName, role, allowedBrandId: brandId || null, isViewOnly: viewOnly };
      if (mode === 'create') {
        const { data } = await api.post('/access/users', { ...body, email });
        onSaved({ created: true, tempPassword: data.tempPassword, account: { email: email.trim().toLowerCase(), full_name: fullName } });
      } else {
        await api.patch(`/access/users/${initial.user_id}`, body);
        onSaved({ created: false });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menyimpan akun.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={mode === 'create' ? 'Buat akun baru' : `Ubah akun — ${initial.email}`}
      icon={mode === 'create' ? Plus : Pencil}
      onClose={onCancel}
      footer={(
        <>
          <button type="button" className="acc-btn" onClick={onCancel}>Batal</button>
          <button type="submit" form="acc-form" className="acc-btn acc-btn-primary" disabled={saving}>
            {saving ? 'Menyimpan…' : mode === 'create' ? 'Buat akun' : 'Simpan perubahan'}
          </button>
        </>
      )}
    >
      <form id="acc-form" className="acc-form" onSubmit={submit}>
        {mode === 'create' && (
          <label className="acc-field">
            <span>Email</span>
            <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@perusahaan.com" />
          </label>
        )}
        <label className="acc-field">
          <span>Nama lengkap</span>
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nama pemilik akun" autoFocus={mode !== 'create'} />
        </label>

        <fieldset className="acc-field">
          <span>Role</span>
          <div className="acc-role-pick">
            {allowedRoles.map((r) => (
              <label key={r.key} className={`acc-role-option${role === r.key ? ' is-active' : ''}`}>
                <input type="radio" name="role" value={r.key} checked={role === r.key} onChange={() => setRole(r.key)} />
                <RoleBadge role={r.key} label={r.label} />
                <small>{ROLE_NOTE[r.key]}</small>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="acc-field">
          <span>Brand yang boleh dilihat {needsBrand ? <em>wajib untuk client</em> : <em>opsional</em>}</span>
          <select value={brandId ?? ''} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">{needsBrand ? '— pilih brand —' : 'Semua brand'}</option>
            {brands.map((b) => <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>)}
          </select>
        </label>

        <label className="acc-check">
          <input type="checkbox" checked={viewOnly} onChange={(e) => setViewOnly(e.target.checked)} />
          <span>
            <strong>Hanya lihat (view-only)</strong>
            <small>Akun bisa membuka data tetapi tidak bisa mengunggah, mengubah, atau menghapus apa pun.</small>
          </span>
        </label>

        {mode === 'create' && (
          <p className="acc-note">Password sementara dibuat otomatis oleh sistem dan ditampilkan sekali setelah akun dibuat.</p>
        )}
        {error && <div className="acc-error" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function AccountsTab({ meta, me, onChanged }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [form, setForm] = useState(null); // { mode, initial }
  const [secret, setSecret] = useState(null); // { account, password }
  const [confirm, setConfirm] = useState(null); // { kind, account }
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError('');
    api.get('/access/users').then(({ data }) => setUsers(data.users)).catch((e) => setError(e.response?.data?.message || 'Daftar akun gagal dimuat.'));
  }, []);
  useEffect(load, [load]);

  const roleLabel = (key) => meta.roles.find((r) => r.key === key)?.label ?? key;
  const shown = useMemo(() => {
    if (!users) return [];
    const needle = query.trim().toLowerCase();
    return users.filter((u) => (roleFilter === 'all' || u.role === roleFilter)
      && (!needle || `${u.full_name} ${u.email} ${u.allowed_brand_name ?? ''}`.toLowerCase().includes(needle)));
  }, [users, query, roleFilter]);
  const counts = useMemo(() => {
    const c = { all: users?.length ?? 0 };
    for (const r of ROLE_ORDER) c[r] = users?.filter((u) => u.role === r).length ?? 0;
    return c;
  }, [users]);

  const runConfirmed = async () => {
    const { kind, account } = confirm;
    setBusy(true);
    try {
      if (kind === 'reset') {
        const { data } = await api.post(`/access/users/${account.user_id}/reset-password`);
        setSecret({ account, password: data.tempPassword });
      } else {
        await api.patch(`/access/users/${account.user_id}`, { isActive: kind === 'activate' });
      }
      setConfirm(null);
      load();
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Aksi gagal.');
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="acc-panel">
      <div className="acc-toolbar">
        <div className="acc-filters" role="tablist" aria-label="Filter role">
          {['all', ...ROLE_ORDER].map((key) => (
            <button key={key} type="button" role="tab" aria-selected={roleFilter === key} className={`acc-chip${roleFilter === key ? ' is-active' : ''}`} onClick={() => setRoleFilter(key)}>
              {key === 'all' ? 'Semua' : roleLabel(key)} <b>{counts[key]}</b>
            </button>
          ))}
        </div>
        <label className="acc-search">
          <Search size={15} aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama, email, atau brand…" aria-label="Cari akun" />
        </label>
        <button type="button" className="acc-btn acc-btn-primary" onClick={() => setForm({ mode: 'create' })}>
          <Plus size={15} /> Buat akun
        </button>
      </div>

      {error && <div className="acc-error" role="alert">{error}</div>}
      {!users && !error && <div className="acc-empty">Memuat akun…</div>}
      {users && shown.length === 0 && <div className="acc-empty">Tidak ada akun yang cocok.</div>}

      {users && shown.length > 0 && (
        <div className="acc-table-wrap">
          <table className="acc-table">
            <thead>
              <tr>
                <th>Akun</th>
                <th>Role</th>
                <th>Brand</th>
                <th>Status</th>
                <th>Login terakhir</th>
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const manageable = canManage(me.role, u.role);
                const self = u.user_id === me.userId;
                return (
                  <tr key={u.user_id} className={u.is_active ? '' : 'is-inactive'}>
                    <td>
                      <div className="acc-person">
                        <span className="acc-avatar" aria-hidden>{(u.full_name || u.email).slice(0, 1).toUpperCase()}</span>
                        <span>
                          <strong>{u.full_name}{self && <em className="acc-you">Anda</em>}</strong>
                          <small>{u.email}</small>
                        </span>
                      </div>
                    </td>
                    <td><RoleBadge role={u.role} label={roleLabel(u.role)} /></td>
                    <td>{u.allowed_brand_name ?? <span className="acc-muted">Semua brand</span>}{u.is_view_only && <span className="acc-tag">view-only</span>}</td>
                    <td>
                      {u.is_active ? <span className="acc-status is-on">Aktif</span> : <span className="acc-status is-off">Nonaktif</span>}
                      {u.must_change_password && <span className="acc-tag is-warn">belum ganti password</span>}
                    </td>
                    <td className="acc-muted">{fmtDate(u.last_login_at)}</td>
                    <td>
                      {manageable ? (
                        <div className="acc-actions">
                          <button type="button" className="acc-icon-btn" title="Ubah akun" aria-label={`Ubah ${u.email}`} onClick={() => setForm({ mode: 'edit', initial: u })}><Pencil size={15} /></button>
                          <button type="button" className="acc-icon-btn" title="Reset password" aria-label={`Reset password ${u.email}`} onClick={() => setConfirm({ kind: 'reset', account: u })}><KeyRound size={15} /></button>
                          {!self && (u.is_active ? (
                            <button type="button" className="acc-icon-btn is-danger" title="Nonaktifkan" aria-label={`Nonaktifkan ${u.email}`} onClick={() => setConfirm({ kind: 'deactivate', account: u })}><Ban size={15} /></button>
                          ) : (
                            <button type="button" className="acc-icon-btn is-good" title="Aktifkan kembali" aria-label={`Aktifkan ${u.email}`} onClick={() => setConfirm({ kind: 'activate', account: u })}><CheckCircle2 size={15} /></button>
                          ))}
                        </div>
                      ) : (
                        <span className="acc-locked" title="Hanya superadmin yang bisa mengelola akun ini"><Lock size={14} /></span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <AccountForm
          mode={form.mode}
          initial={form.initial}
          roles={meta.roles}
          brands={meta.brands}
          actorRole={me.role}
          onCancel={() => setForm(null)}
          onSaved={(result) => {
            setForm(null);
            if (result.created) setSecret({ account: result.account, password: result.tempPassword });
            load();
            onChanged();
          }}
        />
      )}
      {secret && <TempPasswordModal account={secret.account} password={secret.password} onClose={() => setSecret(null)} />}
      {confirm && (
        <Modal
          title={confirm.kind === 'reset' ? 'Reset password?' : confirm.kind === 'deactivate' ? 'Nonaktifkan akun?' : 'Aktifkan kembali akun?'}
          icon={confirm.kind === 'reset' ? KeyRound : confirm.kind === 'deactivate' ? Ban : CheckCircle2}
          onClose={() => setConfirm(null)}
          footer={(
            <>
              <button type="button" className="acc-btn" onClick={() => setConfirm(null)}>Batal</button>
              <button type="button" className={`acc-btn ${confirm.kind === 'deactivate' ? 'acc-btn-danger' : 'acc-btn-primary'}`} disabled={busy} onClick={runConfirmed}>
                {busy ? 'Memproses…' : confirm.kind === 'reset' ? 'Buat password baru' : confirm.kind === 'deactivate' ? 'Nonaktifkan' : 'Aktifkan'}
              </button>
            </>
          )}
        >
          <p className="acc-lead">
            {confirm.kind === 'reset' && <>Password <strong>{confirm.account.email}</strong> diganti dengan password sementara baru. Pemilik akun wajib menggantinya saat login berikutnya.</>}
            {confirm.kind === 'deactivate' && <><strong>{confirm.account.email}</strong> tidak bisa login lagi, dan sesi yang sedang terbuka berhenti dalam waktu kurang dari satu menit. Data yang pernah dibuatnya tetap tersimpan.</>}
            {confirm.kind === 'activate' && <><strong>{confirm.account.email}</strong> bisa login kembali dengan password yang terakhir dimilikinya.</>}
          </p>
        </Modal>
      )}
    </section>
  );
}

function PermissionsTab({ meta, onChanged }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    api.get('/access/permissions').then(({ data }) => setState(data)).catch((e) => setError(e.response?.data?.message || 'Hak akses gagal dimuat.'));
  }, []);

  const toggle = async (role, module, allowed) => {
    setSaving(`${role}:${module}`);
    setError('');
    try {
      const { data } = await api.put('/access/permissions', { role, module, allowed });
      setState((s) => ({ ...s, matrix: data.matrix }));
      onChanged();
    } catch (err) {
      setError(err.response?.data?.message || 'Hak akses gagal disimpan.');
    } finally {
      setSaving(null);
    }
  };

  if (error && !state) return <section className="acc-panel"><div className="acc-error">{error}</div></section>;
  if (!state) return <section className="acc-panel"><div className="acc-empty">Memuat hak akses…</div></section>;

  const roles = ROLE_ORDER.map((key) => meta.roles.find((r) => r.key === key)).filter(Boolean);
  return (
    <section className="acc-panel">
      <div className="acc-perm-intro">
        <ShieldCheck size={18} aria-hidden />
        <p>
          Menentukan menu apa saja yang bisa dibuka setiap role. Perubahan berlaku untuk semua akun dengan role tersebut dalam kurang dari satu menit.
          {' '}<strong>Superadmin</strong> selalu memiliki semua akses, dan <strong>Pengaturan Akses</strong> hanya untuk superadmin & admin — keduanya dikunci agar tidak ada yang terkunci keluar dari sistem.
          {!state.editable && <> Hanya superadmin yang bisa mengubah tabel ini; Anda melihatnya sebagai referensi.</>}
        </p>
      </div>
      {error && <div className="acc-error" role="alert">{error}</div>}
      <div className="acc-table-wrap">
        <table className="acc-table acc-perm">
          <thead>
            <tr>
              <th>Menu / modul</th>
              {roles.map((r) => <th key={r.key}><RoleBadge role={r.key} label={r.label} /></th>)}
            </tr>
          </thead>
          <tbody>
            {meta.modules.map((m) => (
              <tr key={m.key}>
                <td><strong>{m.label}</strong></td>
                {roles.map((r) => {
                  const on = Boolean(state.matrix[r.key]?.[m.key]);
                  const locked = r.key === 'superadmin' || !state.editable;
                  const pending = saving === `${r.key}:${m.key}`;
                  return (
                    <td key={r.key}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`${m.label} untuk ${r.label}`}
                        className={`acc-switch${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}
                        disabled={locked || pending}
                        onClick={() => toggle(r.key, m.key, !on)}
                      >
                        <span />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="acc-perm-fixed">
              <td><strong>Pengaturan Akses</strong><small>dikunci</small></td>
              {roles.map((r) => (
                <td key={r.key}>
                  <span className={`acc-switch is-locked${r.key === 'superadmin' || r.key === 'admin' ? ' is-on' : ''}`}><span /></span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AuditTab() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/access/audit').then(({ data }) => setEntries(data.entries)).catch((e) => setError(e.response?.data?.message || 'Catatan aktivitas gagal dimuat.'));
  }, []);
  const describe = (e) => {
    const d = e.detail || {};
    if (e.action === 'permission') return `${d.role} · ${d.module} → ${d.allowed ? 'diizinkan' : 'ditutup'}`;
    if (e.action === 'create') return [d.role, d.allowedBrandId ? `brand #${d.allowedBrandId}` : null, d.isViewOnly ? 'view-only' : null].filter(Boolean).join(' · ');
    if (e.action === 'update') {
      return Object.entries(d).map(([k, v]) => {
        const label = { full_name: 'nama', role: 'role', allowed_brand_id: 'brand', is_view_only: 'view-only', is_active: 'status' }[k] ?? k;
        const val = k === 'is_active' ? (v ? 'aktif' : 'nonaktif') : k === 'is_view_only' ? (v ? 'ya' : 'tidak') : v ?? 'semua';
        return `${label}: ${val}`;
      }).join(' · ');
    }
    return '';
  };
  return (
    <section className="acc-panel">
      {error && <div className="acc-error">{error}</div>}
      {!entries && !error && <div className="acc-empty">Memuat catatan…</div>}
      {entries && entries.length === 0 && <div className="acc-empty">Belum ada aktivitas.</div>}
      {entries && entries.length > 0 && (
        <ol className="acc-log">
          {entries.map((e) => (
            <li key={e.id}>
              <span className={`acc-log-dot is-${e.action}`} aria-hidden />
              <div>
                <p>
                  <strong>{e.actor_name ?? 'Sistem'}</strong> {ACTION_LABEL[e.action] ?? e.action}
                  {e.target_email && <> <strong>{e.target_name ?? e.target_email}</strong></>}
                </p>
                <small>{describe(e)}{describe(e) ? ' · ' : ''}{fmtDate(e.created_at)}</small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const TABS = [
  { id: 'accounts', label: 'Akun', Icon: Users },
  { id: 'permissions', label: 'Hak Akses Role', Icon: ShieldCheck },
  { id: 'audit', label: 'Catatan Aktivitas', Icon: History },
];

export default function AccessSettingsPage() {
  const { user, refresh } = useAuth();
  const [tab, setTab] = useState('accounts');
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);

  const loadStats = useCallback(() => {
    api.get('/access/users').then(({ data }) => {
      const list = data.users;
      setStats({ total: list.length, active: list.filter((u) => u.is_active).length, clients: list.filter((u) => u.role === 'client').length });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/access/meta').then(({ data }) => setMeta(data)).catch((e) => setError(e.response?.data?.message || 'Halaman tidak bisa dimuat.'));
    loadStats();
  }, [loadStats]);

  const me = { role: user?.role, userId: user?.userId };
  const onChanged = () => {
    loadStats();
    // A permission edit can change this very account's menu.
    refresh().catch(() => {});
  };

  return (
    <div className="con brand-settings access-page">
      <header className="brand-hero">
        <span className="brand-hero-fx" aria-hidden="true"><i className="brand-hero-aurora" /><i className="brand-hero-grid" /></span>
        <div className="brand-hero-main">
          <div className="brand-hero-copy">
            <span className="brand-hero-eye"><UserCog size={13} /> Keamanan &amp; akses</span>
            <h1>Pengaturan Akses</h1>
            <p>Akun ATLAS hanya dibuat dari sini. Tentukan siapa yang boleh masuk, role-nya, brand yang boleh dilihat, dan menu yang bisa dibuka tiap role.</p>
            <div className="brand-hero-stats">
              <span><strong>{stats?.total ?? '—'}</strong> akun</span>
              <span><strong>{stats?.active ?? '—'}</strong> aktif</span>
              <span><strong>{stats?.clients ?? '—'}</strong> akun client</span>
            </div>
          </div>
          <div className="brand-hero-badge" aria-hidden="true">
            <span className="brand-hero-ring" /><span className="brand-hero-ring brand-hero-ring-b" />
            <img src={atlasIcon} alt="" className="brand-hero-mark" />
            <img src={atlasWordmark} alt="" className="brand-hero-logo" />
            <small>Access control</small>
          </div>
        </div>
      </header>

      <nav className="acc-tabs" role="tablist" aria-label="Bagian Pengaturan Akses">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`acc-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>
            <Icon size={16} aria-hidden /> {label}
          </button>
        ))}
      </nav>

      {error && <div className="acc-error" role="alert">{error}</div>}
      {meta && tab === 'accounts' && <AccountsTab meta={meta} me={me} onChanged={onChanged} />}
      {meta && tab === 'permissions' && <PermissionsTab meta={meta} onChanged={onChanged} />}
      {meta && tab === 'audit' && <AuditTab />}
    </div>
  );
}
