import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Archive, ArrowUpRight, Check, CircleAlert, Compass, Loader2, NotebookPen, Plus, Save, Search, X,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext.jsx';
import useSessionState from '../hooks/useSessionState.js';
import BrandStatusFilter, { matchesBrandStatus, BRAND_STATUS_LABELS } from '../components/common/BrandStatusFilter.jsx';
import { presetBrandSettings } from '../components/common/brandSettingsLink.js';
import { describeError } from '../components/brandSettings/describeError.js';
import atlasWordmark from '../assets/atlas-wordmark.png';
import '../components/dashboard/console.css';
import '../components/dashboard/softShell.css';
import './brandPages.css';

// Pengaturan Brand — the first stop in ATLAS: every client MIL runs, its
// status (shared by every module), and for each brand the two narrative
// records analysis reads — brand context and current direction. Those open
// from the brand's own row in a side drawer, so the list stays in view and
// moving from one brand to the next is one click. The brand's files, meeting
// notes and ad accounts live in Data Brand; each row links straight there.

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

// One brand's context and direction, edited beside the list. Loads its own
// profile, keeps an unsaved draft, and asks before throwing that draft away.
function BrandDetail({ brand, isViewOnly, onClose, onOpenData }) {
  const reduced = useReducedMotion();
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState({});
  const [section, setSection] = useState('context');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const panelRef = useRef(null);

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

  const close = useCallback(() => {
    if (dirty && !window.confirm('Perubahan belum disimpan. Tutup tanpa menyimpan?')) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

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
    <motion.div
      className="bp-scrim" onMouseDown={(event) => event.target === event.currentTarget && close()}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}
    >
      <motion.aside
        ref={panelRef} tabIndex={-1} className="bp-drawer" role="dialog" aria-modal="true" aria-labelledby="bp-drawer-title"
        initial={reduced ? { opacity: 0 } : { x: '100%' }} animate={reduced ? { opacity: 1 } : { x: 0 }} exit={reduced ? { opacity: 0 } : { x: '100%' }}
        transition={{ duration: .32, ease: [0.32, 0.72, 0, 1] }}
      >
        <header className="bp-drawer-head">
          <div>
            <span className={`bp-status-chip is-${brand.status || 'unknown'}`}>
              <i aria-hidden="true" />{BRAND_STATUS_LABELS[brand.status || 'unknown']}
            </span>
            <h2 id="bp-drawer-title">{brand.brand_name}</h2>
            <p>{profile?.sector || 'Detail brand'}</p>
          </div>
          <div className="bp-drawer-head-actions">
            <button type="button" className="bp-ghost" onClick={() => { if (!dirty || window.confirm('Perubahan belum disimpan. Pindah ke Data Brand tanpa menyimpan?')) onOpenData(brand); }}>
              <Archive size={15} aria-hidden="true" /> Data &amp; file <ArrowUpRight size={14} aria-hidden="true" />
            </button>
            <button type="button" className="bp-icon-btn" onClick={close} aria-label="Tutup">
              <X size={18} />
            </button>
          </div>
        </header>

        <nav className="bp-segment" role="tablist" aria-label="Bagian detail brand">
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

        <div className="bp-drawer-body">
          {message && (
            <p className={`bp-drawer-msg is-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
              {message.tone === 'ok' ? <Check size={15} /> : <CircleAlert size={15} />} {message.text}
            </p>
          )}
          <p className="bp-drawer-note">{active.note}</p>
          {loading ? (
            <p className="bp-loading"><Loader2 size={14} className="brand-spin" /> Memuat detail brand…</p>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={section} className="bp-fields"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ duration: .18, ease: EASE }}
              >
                {active.fields.map(([key, label, guidance]) => (
                  <Field key={key} label={label} guidance={guidance} value={draft[key]} disabled={isViewOnly} onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))} />
                ))}
                {section === 'context' && (
                  <p className="bp-drawer-hint"><CircleAlert size={14} /> Jangan menulis ulang metrics dashboard di sini — berikan konteks yang menjelaskan <em>mengapa</em> angka dapat berubah.</p>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        <footer className="bp-drawer-foot">
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
      </motion.aside>
    </motion.div>
  );
}

export default function BrandSettingsPage() {
  const { isViewOnly } = useAuth();
  const reduced = useReducedMotion();
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

  // The open drawer lives in the URL (?detail=<id>), so Data Brand's
  // "Context & direction" link opens the right brand directly.
  const detailId = Number(params.get('detail')) || null;
  const detailBrand = detailId ? brands.find((b) => b.brand_id === detailId) ?? null : null;
  const openDetail = (b) => setParams((p) => { const next = new URLSearchParams(p); next.set('detail', String(b.brand_id)); return next; });
  const closeDetail = () => setParams((p) => { const next = new URLSearchParams(p); next.delete('detail'); return next; });

  const navigateToData = (b) => {
    presetBrandSettings({ brandId: b.brand_id, view: 'data' });
    navigate('/data-brand');
  };

  const shown = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return brands.filter((b) => matchesBrandStatus(b, listStatus) && b.brand_name.toLowerCase().includes(q));
  }, [brands, listQuery, listStatus]);

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
      openDetail(data.brand);
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
          <label className="bp-search">
            <Search size={16} aria-hidden="true" />
            <input value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="Cari nama brand…" aria-label="Cari brand" />
          </label>
          <div className="bp-stats">
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

        <section className="soft-card bp-panel" aria-label="Daftar brand">
          <div className="bp-panel-head">
            <div>
              <h2>Daftar brand</h2>
              <p>Status dipakai bersama oleh seluruh modul. Menonaktifkan brand tidak menghapus data dan laporannya.</p>
            </div>
            <BrandStatusFilter value={listStatus} onChange={setListStatus} />
          </div>

          <div className="bp-table" role="table" aria-label="Brand">
            <div className="bp-row bp-row-head" role="row">
              <span role="columnheader">Brand</span>
              <span role="columnheader">Status klien</span>
              <span role="columnheader" className="bp-col-actions">Aksi</span>
            </div>
            {shown.map((b, index) => (
              <motion.div
                key={b.brand_id} role="row" className={`bp-row${detailId === b.brand_id ? ' is-open' : ''}`}
                initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 12) * .018, duration: .2, ease: EASE }}
              >
                <span role="cell" className="bp-brand">
                  <i className={`brand-status-dot is-${b.status || 'unknown'}`} aria-hidden="true" />
                  <button type="button" onClick={() => openDetail(b)}>{b.brand_name}</button>
                </span>
                <span role="cell">
                  <select
                    className={`brand-status-value is-${b.status || 'unknown'}`} aria-label={`Status ${b.brand_name}`}
                    value={b.status ?? ''} disabled={isViewOnly || statusBusy === b.brand_id} onChange={(event) => changeStatus(b, event.target.value)}
                  >
                    {!b.status && <option value="" disabled>Belum diatur</option>}
                    {['active', 'off', 'freeze'].map((status) => <option key={status} value={status}>{BRAND_STATUS_LABELS[status]}</option>)}
                  </select>
                  {statusBusy === b.brand_id && <span className="bp-saving" role="status"><Loader2 size={13} className="brand-spin" /> Menyimpan…</span>}
                </span>
                <span role="cell" className="bp-col-actions">
                  <button type="button" className="bp-row-btn is-primary" onClick={() => openDetail(b)}>
                    <NotebookPen size={14} aria-hidden="true" /> Detail
                  </button>
                  <button type="button" className="bp-row-btn" onClick={() => navigateToData(b)}>
                    <Archive size={14} aria-hidden="true" /> Data &amp; file
                  </button>
                </span>
              </motion.div>
            ))}
            {loaded && !shown.length && <p className="brand-picker-empty">Tidak ada brand yang cocok. Ubah pencarian atau filter status.</p>}
            {!loaded && <p className="bp-loading"><Loader2 size={14} className="brand-spin" /> Memuat daftar brand…</p>}
          </div>
          <p className="bp-foot-note">
            File bulanan, Minutes of Meeting, Meta Automation, dan Google Ads setiap brand ada di <Link to="/data-brand">Data Brand</Link>.
          </p>
        </section>
      </div>

      <AnimatePresence>
        {detailBrand && (
          <BrandDetail key={detailBrand.brand_id} brand={detailBrand} isViewOnly={isViewOnly} onClose={closeDetail} onOpenData={navigateToData} />
        )}
      </AnimatePresence>
    </div>
  );
}
