import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Archive, ArrowUpRight, Check, CircleAlert, Compass, Loader2, NotebookPen, Plus, Save, Search, Settings2, Trash2, X,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext.jsx';
import useSessionState from '../hooks/useSessionState.js';
import { matchesBrandStatus, BRAND_STATUS_LABELS } from '../components/common/BrandStatusFilter.jsx';
import { presetBrandSettings } from '../components/common/brandSettingsLink.js';
import { describeError } from '../components/brandSettings/describeError.js';
import atlasWordmark from '../assets/atlas-wordmark.png';
import '../components/dashboard/console.css';
import '../components/dashboard/softShell.css';
import './brandPages.css';

// Pengaturan Brand — the first stop in ATLAS. A quiet list of every client
// MIL runs on the left (a status dot and a name, nothing repeated per row),
// and on the right the selected brand's Brand Setting: status (shared by
// every module), brand context, current direction, and for admins deleting
// an empty brand. Moving between brands is one click and the page never
// covers itself with a popup. The brand's files, meeting notes and ad
// accounts live in Data Brand; the setting links straight there.

const CONTEXT_FIELDS = [
  ['brand_products_customer', 'Brand, Produk & Customer', 'Apa yang dijual brand dan siapa customer utamanya?'],
  ['positioning_driver', 'Positioning & Purchase Driver', 'Bagaimana positioning dan alasan utama customer memilih brand?'],
  ['key_products_channels', 'Key Products & Channels', 'Produk dan channel apa yang paling penting bagi bisnis?'],
  ['business_characteristics', 'Business Characteristics', 'Pola bisnis apa yang perlu diketahui saat membaca data?'],
  ['historical_learning', 'Historical Learning', 'Apa yang historically bekerja atau tidak bekerja dan perlu diingat?'],
];

const DIRECTION_FIELDS = [
  ['objective_target', 'Objective & Target', 'Apa satu objective utama brand saat ini?'],
  ['strategic_priorities', 'Strategic Priorities', 'Maksimum 3–5 area hasil yang sedang diprioritaskan.'],
  ['constraints_concerns', 'Constraints & Concerns', 'Batasan atau risiko nyata yang perlu diperhatikan?'],
];

const SECTIONS = [
  {
    id: 'context', label: 'Brand context', Icon: NotebookPen, fields: CONTEXT_FIELDS,
    note: 'Fakta yang tidak dapat disimpulkan dari angka. Perbarui hanya saat ada perubahan material pada bisnis.',
  },
  {
    id: 'direction', label: 'Current direction', Icon: Compass, fields: DIRECTION_FIELDS,
    note: 'Objective, prioritas, dan constraint yang menghubungkan data dengan keputusan. Review setiap kuartal.',
  },
];
const ALL_FIELDS = [...CONTEXT_FIELDS, ...DIRECTION_FIELDS];
const EASE = [0.16, 1, 0.3, 1];

const filled = (profile, fields) => fields.filter(([key]) => (profile?.[key] ?? '').trim()).length;

function Field({ label, guidance, value, onChange, disabled }) {
  return (
    <label className="brand-field bp-field">
      <span>{label}</span>
      <small>{guidance}</small>
      <textarea value={value ?? ''} rows="4" onChange={(event) => onChange(event.target.value)} placeholder="Belum diisi" disabled={disabled} />
    </label>
  );
}

const STATUS_CHOICES = ['active', 'off', 'freeze'];
const FILTERS = ['all', 'active', 'off', 'freeze', 'unknown'];

// Deleting a brand, at the foot of Brand Setting (admins only). An empty
// brand (a duplicate, a typo) is deleted after its name is typed back. A
// brand that still holds data shows that data first and suggests "Nonaktif";
// deleting it anyway is a separate, deliberate step that wipes everything the
// brand holds and asks for "HAPUS <nama brand>". The server checks the same
// phrase, and refuses while a client login account is bound to the brand.
function DeleteBrand({ brand, onDeleted }) {
  const [state, setState] = useState({ phase: 'idle' });
  const [typed, setTyped] = useState('');
  const phrase = `HAPUS ${brand.brand_name.trim()}`;

  const check = async () => {
    setState({ phase: 'checking' });
    try {
      const { data } = await api.get(`/brands/${brand.brand_id}/delete-check`);
      setState({ phase: data.canDelete ? 'confirm' : 'blocked', ...data });
    } catch (err) {
      setState({ phase: 'error', text: describeError(err, 'Gagal memeriksa brand') });
    }
  };

  const remove = async () => {
    setState((s) => ({ ...s, phase: 'deleting' }));
    try {
      await api.delete(`/brands/${brand.brand_id}`);
      onDeleted(brand);
    } catch (err) {
      const blocking = err.response?.data?.details?.blocking;
      setState(blocking ? { phase: 'blocked', blocking } : { phase: 'error', text: describeError(err, 'Gagal menghapus brand') });
    }
  };

  const removeWithData = async () => {
    setState((s) => ({ ...s, phase: 'wiping' }));
    try {
      const { data } = await api.delete(`/brands/${brand.brand_id}?withData=1`, { data: { confirm: phrase } });
      onDeleted(brand, data.removed);
    } catch (err) {
      setState((s) => ({ ...s, phase: 'force', error: describeError(err, 'Gagal menghapus brand beserta datanya') }));
    }
  };

  return (
    <section className="bp-danger" aria-label="Hapus brand">
      <div className="bp-danger-head">
        <div>
          <strong>Hapus brand</strong>
          <small>Hanya untuk brand tanpa data — misalnya brand ganda atau salah ketik.</small>
        </div>
        {(state.phase === 'idle' || state.phase === 'error') && (
          <button type="button" className="bp-danger-btn is-ghost" onClick={check}><Trash2 size={15} aria-hidden="true" /> Hapus brand</button>
        )}
        {state.phase === 'checking' && <span className="bp-loading"><Loader2 size={14} className="brand-spin" /> Memeriksa data…</span>}
      </div>
      {state.phase === 'error' && <p className="bp-drawer-msg is-error" role="alert"><CircleAlert size={15} /> {state.text}</p>}
      {state.phase === 'blocked' && (
        <div className="bp-danger-body">
          <p>{brand.brand_name} masih punya data, jadi tidak bisa dihapus. Ubah statusnya menjadi <b>Nonaktif</b> — data dan laporannya tetap aman.</p>
          <ul>{state.blocking.map((b) => <li key={b.label}><span>{b.label}</span><b>{b.count.toLocaleString('id-ID')}</b></li>)}</ul>
          <div className="bp-danger-actions is-split">
            <button type="button" className="bp-ghost" onClick={() => setState({ phase: 'idle' })}>Tutup</button>
            {state.boundAccounts ? (
              <small className="bp-danger-note">Ada {state.boundAccounts} akun login klien yang terikat ke brand ini — pindahkan atau hapus di Pengaturan Akses dulu sebelum menghapus beserta data.</small>
            ) : (
              <button type="button" className="bp-danger-btn is-ghost" onClick={() => { setTyped(''); setState((s) => ({ ...s, phase: 'force', error: null })); }}>
                <Trash2 size={15} aria-hidden="true" /> Hapus beserta semua data…
              </button>
            )}
          </div>
        </div>
      )}
      {(state.phase === 'force' || state.phase === 'wiping') && (
        <div className="bp-danger-body is-force">
          <p>
            <b>Ini tidak bisa dibatalkan.</b> {brand.brand_name} dan <b>semua datanya</b> akan dihapus permanen dari ATLAS:
            file Data Brand, laporan tersimpan, data Shopee, Daily Tracking, Google &amp; Meta Ads, catatan meeting, dan lainnya.
          </p>
          <ul>{state.blocking.map((b) => <li key={b.label}><span>{b.label}</span><b>{b.count.toLocaleString('id-ID')}</b></li>)}</ul>
          {state.error && <p className="bp-drawer-msg is-error" role="alert"><CircleAlert size={15} /> {state.error}</p>}
          <p>Ketik <b>{phrase}</b> untuk konfirmasi.</p>
          <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={phrase} aria-label="Ketik konfirmasi hapus beserta data" autoFocus />
          <div className="bp-danger-actions">
            <button type="button" className="bp-ghost" onClick={() => { setTyped(''); setState((s) => ({ ...s, phase: 'blocked', error: null })); }} disabled={state.phase === 'wiping'}>Batal</button>
            <button type="button" className="bp-danger-btn" onClick={removeWithData} disabled={typed.trim() !== phrase || state.phase === 'wiping'}>
              {state.phase === 'wiping' ? <Loader2 size={15} className="brand-spin" /> : <Trash2 size={15} aria-hidden="true" />}
              {state.phase === 'wiping' ? 'Menghapus…' : 'Hapus brand & semua data'}
            </button>
          </div>
        </div>
      )}
      {(state.phase === 'confirm' || state.phase === 'deleting') && (
        <div className="bp-danger-body">
          <p>
            {brand.brand_name} belum punya data. Menghapusnya permanen
            {state.cleared?.length ? <> dan ikut menghapus: {state.cleared.map((c) => c.label).join(', ')}</> : null}.
            Ketik <b>{brand.brand_name}</b> untuk konfirmasi.
          </p>
          <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={brand.brand_name} aria-label="Ketik nama brand untuk konfirmasi" autoFocus />
          <div className="bp-danger-actions">
            <button type="button" className="bp-ghost" onClick={() => { setTyped(''); setState({ phase: 'idle' }); }} disabled={state.phase === 'deleting'}>Batal</button>
            <button type="button" className="bp-danger-btn" onClick={remove} disabled={typed.trim() !== brand.brand_name.trim() || state.phase === 'deleting'}>
              {state.phase === 'deleting' ? <Loader2 size={15} className="brand-spin" /> : <Trash2 size={15} aria-hidden="true" />} Hapus permanen
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// Brand Setting: the selected brand's status, context and direction, shown
// beside the list in the page itself. Status saves on the spot (it is shared
// by every module); the narrative fields keep an unsaved draft, which the
// page asks about before switching to another brand (see onDirtyChange).
function BrandSetting({ brand, isViewOnly, canDelete, statusBusy, onStatus, onDeleted, onOpenData, onDirtyChange }) {
  const reduced = useReducedMotion();
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState({});
  const [section, setSection] = useState('context');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessage(null);
    api.get(`/brands/${brand.brand_id}/profile`)
      .then(({ data }) => {
        if (!alive) return;
        setProfile(data.profile);
        setDraft(data.profile ?? {});
      })
      .catch((err) => alive && setMessage({ tone: 'error', text: describeError(err, 'Gagal memuat brand') }))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [brand.brand_id]);

  const dirty = useMemo(() => ALL_FIELDS.some(([key]) => (draft[key] ?? '') !== (profile?.[key] ?? '')), [draft, profile]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  const save = async () => {
    if (isViewOnly || !dirty) return;
    setSaving(true);
    setMessage(null);
    try {
      const { data } = await api.put(`/brands/${brand.brand_id}/profile`, draft);
      setProfile((current) => ({ ...current, ...data.profile }));
      setMessage({ tone: 'ok', text: 'Perubahan tersimpan.' });
    } catch (err) {
      setMessage({ tone: 'error', text: describeError(err, 'Gagal menyimpan perubahan') });
    } finally {
      setSaving(false);
    }
  };

  const active = SECTIONS.find((s) => s.id === section);
  const spring = reduced ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 40, mass: .6 };

  return (
    <motion.section
      key={brand.brand_id} className="soft-card bp-setting" aria-labelledby="bp-setting-title"
      initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22, ease: EASE }}
    >
      <header className="bp-setting-head">
        <div>
          <span className="bp-setting-kicker"><Settings2 size={14} aria-hidden="true" /> Brand Setting</span>
          <h2 id="bp-setting-title">{brand.brand_name}</h2>
          {profile?.sector && <p>{profile.sector}</p>}
        </div>
        <button type="button" className="bp-ghost" onClick={() => { if (!dirty || window.confirm('Perubahan belum disimpan. Pindah ke Data Brand tanpa menyimpan?')) onOpenData(brand); }}>
          <Archive size={15} aria-hidden="true" /> Data &amp; file <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      </header>

      <section className="bp-status-block" aria-label="Status klien">
        <div className="bp-status-copy">
          <strong>Status klien</strong>
          <small>Dipakai bersama oleh seluruh modul. Menonaktifkan tidak menghapus data dan laporan.</small>
        </div>
        <div className="bp-status-seg" role="radiogroup" aria-label="Status klien">
          {STATUS_CHOICES.map((status) => {
            const on = brand.status === status;
            return (
              <button
                key={status} type="button" role="radio" aria-checked={on}
                className={`is-${status}${on ? ' is-on' : ''}`}
                disabled={isViewOnly || statusBusy}
                onClick={() => !on && onStatus(brand, status)}
              >
                <i aria-hidden="true" />{BRAND_STATUS_LABELS[status]}
              </button>
            );
          })}
          {statusBusy && <Loader2 size={15} className="brand-spin" aria-label="Menyimpan status" />}
        </div>
      </section>

      <nav className="bp-segment" role="tablist" aria-label="Bagian Brand Setting">
        {SECTIONS.map(({ id, label, Icon, fields }) => {
          const on = id === section;
          return (
            <button key={id} type="button" role="tab" aria-selected={on} className={on ? 'is-on' : ''} onClick={() => setSection(id)}>
              {on && <motion.span layoutId="bp-segment-pill" className="bp-segment-pill" transition={spring} aria-hidden="true" />}
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
              <small>{loading ? '…' : `${filled(draft, fields)}/${fields.length}`}</small>
            </button>
          );
        })}
      </nav>

      <div className="bp-setting-body">
        {message && (
          <p className={`bp-drawer-msg is-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
            {message.tone === 'ok' ? <Check size={15} /> : <CircleAlert size={15} />} {message.text}
          </p>
        )}
        <p className="bp-drawer-note">{active.note}</p>
        {loading ? (
          <p className="bp-loading"><Loader2 size={14} className="brand-spin" /> Memuat brand…</p>
        ) : (
          <div className="bp-fields" key={section}>
            {active.fields.map(([key, label, guidance]) => (
              <Field key={key} label={label} guidance={guidance} value={draft[key]} disabled={isViewOnly} onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))} />
            ))}
            {section === 'context' && (
              <p className="bp-drawer-hint"><CircleAlert size={14} /><span>Jangan menulis ulang metrics dashboard di sini — berikan konteks yang menjelaskan <em>mengapa</em> angka dapat berubah.</span></p>
            )}
          </div>
        )}
      </div>

      <footer className="bp-setting-foot">
        <span>
          {profile?.updated_at
            ? `Terakhir diperbarui ${new Date(profile.updated_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}${profile.updated_by_name ? ` oleh ${profile.updated_by_name}` : ''}`
            : 'Belum pernah disimpan untuk brand ini'}
        </span>
        <button type="button" className="bp-primary" onClick={save} disabled={isViewOnly || saving || !dirty || loading}>
          {saving ? <Loader2 size={16} className="brand-spin" /> : <Save size={16} />}
          {isViewOnly ? 'Lihat saja' : saving ? 'Menyimpan…' : dirty ? 'Simpan perubahan' : 'Tersimpan'}
        </button>
      </footer>

      {canDelete && !loading && <DeleteBrand brand={brand} onDeleted={onDeleted} />}
    </motion.section>
  );
}

export default function BrandSettingsPage() {
  const { isViewOnly, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [brands, setBrands] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [listQuery, setListQuery] = useSessionState('brand-settings:list-query', '');
  const [listStatus, setListStatus] = useSessionState('brand-settings:list-status', 'all');
  const [statusBusy, setStatusBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    let alive = true;
    api.get('/brands')
      .then(({ data }) => alive && setBrands(data.brands ?? []))
      .catch(() => alive && setError('Gagal memuat daftar brand.'))
      .finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, []);

  // The selected brand lives in the URL (?detail=<id>), so Data Brand's
  // "Context & direction" link opens the right brand directly. With none
  // chosen, the first brand in the list is shown.
  const detailId = Number(params.get('detail')) || null;
  const setDetail = (id) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (id) next.set('detail', String(id)); else next.delete('detail');
    return next;
  }, { replace: true });
  // The open Brand Setting reports an unsaved draft here, so switching brand
  // can ask first instead of dropping it.
  const dirtyRef = useRef(false);
  const onDirtyChange = useCallback((d) => { dirtyRef.current = d; }, []);

  const navigateToData = (b) => {
    presetBrandSettings({ brandId: b.brand_id, view: 'data' });
    navigate('/data-brand');
  };

  const shown = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return brands.filter((b) => matchesBrandStatus(b, listStatus) && b.brand_name.toLowerCase().includes(q));
  }, [brands, listQuery, listStatus]);

  const selected = (detailId && brands.find((b) => b.brand_id === detailId)) || shown[0] || null;
  const select = (b) => {
    if (b.brand_id === selected?.brand_id) return;
    if (dirtyRef.current && !window.confirm('Perubahan brand context/direction belum disimpan. Pindah brand tanpa menyimpan?')) return;
    dirtyRef.current = false;
    setDetail(b.brand_id);
  };

  const counts = useMemo(() => ({
    active: brands.filter((b) => b.status === 'active').length,
    unset: brands.filter((b) => !b.status).length,
  }), [brands]);

  async function changeStatus(item, status) {
    if (isViewOnly) return;
    setStatusBusy(item.brand_id);
    setError(null);
    try {
      const { data } = await api.patch(`/brands/${item.brand_id}/status`, { status });
      setBrands((list) => list.map((b) => (b.brand_id === item.brand_id ? data.brand : b)));
      setNotice(`${item.brand_name}: status ${BRAND_STATUS_LABELS[status].toLowerCase()} tersimpan.`);
    } catch (err) {
      setError(describeError(err, 'Gagal menyimpan status brand'));
    } finally {
      setStatusBusy(null);
    }
  }

  const brandDeleted = (b, removed) => {
    setBrands((list) => list.filter((x) => x.brand_id !== b.brand_id));
    dirtyRef.current = false;
    setDetail(null);
    const what = removed?.length ? ` beserta ${removed.map((r) => `${r.count.toLocaleString('id-ID')} ${r.label.toLowerCase()}`).join(', ')}` : '';
    setNotice(`Brand "${b.brand_name}" dihapus${what}.`);
  };

  const createBrand = async (event) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name || creatingBusy || isViewOnly) return;
    setCreatingBusy(true);
    try {
      const { data } = await api.post('/brands', { brandName: name });
      setBrands((current) => [...current, data.brand].sort((a, b) => a.brand_name.localeCompare(b.brand_name)));
      setCreating(false);
      setNotice(`Brand "${data.brand.brand_name}" dibuat. Lengkapi brand context dan current direction-nya.`);
      dirtyRef.current = false;
      setDetail(data.brand.brand_id);
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Gagal membuat brand baru.');
    } finally {
      setCreatingBusy(false);
    }
  };

  return (
    <div className="con brand-settings soft-shell bp">
      <div className="soft-frame">
        <header className="soft-masthead">
          <div className="soft-masthead-copy">
            <h1><span>Pengaturan</span> Brand<span className="soft-title-dot" aria-hidden="true">.</span></h1>
            <p>Daftar klien MIL Digital: atur status setiap brand, lalu lengkapi brand context dan current direction yang dibaca seluruh analisis ATLAS.</p>
          </div>
          <div className="soft-masthead-signature">
            <img src={atlasWordmark} alt="ATLAS" />
            <span>Ruang pengaturan klien</span>
          </div>
        </header>

        <section className="soft-card bp-command" aria-label="Cari dan saring brand">
          <div className="bp-stats is-start">
            <div className="bp-stat"><span>Brand aktif</span><strong>{loaded ? counts.active : '…'}</strong></div>
            <div className="bp-stat"><span>Total brand</span><strong>{loaded ? brands.length : '…'}</strong></div>
            <div className="bp-stat"><span>Status belum diatur</span><strong>{loaded ? counts.unset : '…'}</strong></div>
          </div>
          {!isViewOnly && (creating ? (
            <form className="bp-new-form" onSubmit={createBrand}>
              <input
                value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Nama brand baru" autoFocus
                onKeyDown={(event) => { if (event.key === 'Escape') setCreating(false); }} aria-label="Nama brand baru"
              />
              <button type="submit" className="bp-primary" disabled={creatingBusy || !newName.trim()}>
                {creatingBusy ? <Loader2 size={15} className="brand-spin" /> : <Check size={15} />} Simpan
              </button>
              <button type="button" className="bp-icon-btn" onClick={() => setCreating(false)} aria-label="Batal"><X size={16} /></button>
            </form>
          ) : (
            <button type="button" className="bp-primary" onClick={() => { setNewName(''); setCreating(true); }}>
              <Plus size={16} /> Brand baru
            </button>
          ))}
        </section>

        {error && (
          <div className="brand-flash is-error">
            <CircleAlert size={15} />
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>Tutup</button>
          </div>
        )}
        {notice && (
          <div className="brand-flash">
            <CircleAlert size={15} />
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)}>Tutup</button>
          </div>
        )}

        <div className="bp-master">
          <aside className="soft-card bp-list" aria-label="Daftar brand">
            <div className="bp-list-head">
              <label className="bp-search">
                <Search size={16} aria-hidden="true" />
                <input value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="Cari nama brand…" aria-label="Cari brand" />
              </label>
              {/* The status filter as a clear segmented control, each choice
                  carrying its own count. */}
              <div className="bp-filter" role="radiogroup" aria-label="Filter status klien">
                {FILTERS.map((key) => {
                  const on = listStatus === key;
                  const n = key === 'all' ? brands.length : brands.filter((b) => matchesBrandStatus(b, key)).length;
                  return (
                    <button key={key} type="button" role="radio" aria-checked={on} className={`is-${key}${on ? ' is-on' : ''}`} onClick={() => setListStatus(key)}>
                      {key !== 'all' && <i aria-hidden="true" />}
                      <span>{key === 'all' ? 'Semua' : BRAND_STATUS_LABELS[key]}</span>
                      <b>{loaded ? n : '…'}</b>
                    </button>
                  );
                })}
              </div>
            </div>
            <ul className="bp-list-items">
              {shown.map((b) => {
                const status = b.status || 'unknown';
                const on = b.brand_id === selected?.brand_id;
                return (
                  <li key={b.brand_id}>
                    <button type="button" className={`bp-list-item${on ? ' is-on' : ''}`} aria-current={on ? 'true' : undefined} onClick={() => select(b)}>
                      <span className="bp-list-name">{b.brand_name}</span>
                      <span className={`bp-status-chip is-${status}`}><i aria-hidden="true" />{BRAND_STATUS_LABELS[status]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {loaded && !shown.length && <p className="brand-picker-empty">Tidak ada brand yang cocok. Ubah pencarian atau filter status.</p>}
            {!loaded && <p className="bp-loading"><Loader2 size={14} className="brand-spin" /> Memuat daftar brand…</p>}
          </aside>

          {selected ? (
            <BrandSetting
              key={selected.brand_id} brand={selected} isViewOnly={isViewOnly}
              canDelete={isAdmin && !isViewOnly} statusBusy={statusBusy === selected.brand_id}
              onStatus={changeStatus} onDeleted={brandDeleted} onOpenData={navigateToData} onDirtyChange={onDirtyChange}
            />
          ) : (
            <div className="soft-card bp-setting bp-setting-empty">{loaded ? 'Pilih brand di daftar untuk membuka Brand Setting.' : 'Memuat…'}</div>
          )}
        </div>
        <p className="bp-foot-note">
          File bulanan, Minutes of Meeting, Meta Automation, dan Google Ads setiap brand ada di <Link to="/data-brand">Data Brand</Link>.
        </p>
      </div>
    </div>
  );
}
