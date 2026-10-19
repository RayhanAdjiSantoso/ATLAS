import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUpRight, Check, CircleAlert, Compass, FolderOpen, Lightbulb, Loader2, NotebookPen, Plus, RotateCcw, Save, Target, Trash2, X,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext.jsx';
import useSessionState from '../hooks/useSessionState.js';
import { matchesBrandStatus, BRAND_STATUS_LABELS } from '../components/common/BrandStatusFilter.jsx';
import { presetBrandSettings } from '../components/common/brandSettingsLink.js';
import { describeError } from '../components/brandSettings/describeError.js';
import AnnualTargetCard from '../components/annualTarget/AnnualTargetCard.jsx';
import SearchField from '../components/common/SearchField.jsx';
import SelectMenu from '../components/common/SelectMenu.jsx';
import '../components/dashboard/console.css';
import '../components/dashboard/softShell.css';
import './brandPages.css';
import './brandContext.css';

// Brand Context — the first stop in ATLAS.
//
// Top: the portfolio in two meters (client status, industry of the active
// brands); the status meter's legend doubles as the list filter.
// Left: every client, searchable, with its monogram, industry and status.
// Right: the selected brand's workspace — status and industry (shared by
// every module), then three tabs: brand context, current direction and the
// annual target. The narrative fields carry an index beside them (what is
// filled, what changed) and a save bar that says how many changes are
// unsaved. Moving between brands is one click and asks first when a draft
// would be lost. Files, meeting notes and ad accounts live in Data
// Collection Hub; the workspace links straight there.

const CONTEXT_FIELDS = [
  ['brand_products_customer', 'Product & Customer Context', 'Apa yang dijual brand dan siapa customer utamanya?'],
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
    id: 'context', label: 'Brand Context', Icon: NotebookPen, fields: CONTEXT_FIELDS,
  },
  {
    id: 'direction', label: 'Brand Direction', Icon: Compass, fields: DIRECTION_FIELDS,
    note: 'Objective, prioritas, dan constraint yang menghubungkan data dengan keputusan. Review setiap kuartal.',
  },
];
const ALL_FIELDS = [...CONTEXT_FIELDS, ...DIRECTION_FIELDS];
const EASE = [0.23, 1, 0.32, 1];

const INDUSTRY_CHOICES = [
  { value: 'Retail Fashion', color: '#315fca' },
  { value: 'Retail Non-Fashion', color: '#64a7ea' },
  { value: 'Food & Beverage', color: '#f59e0b' },
  { value: 'B2B Services', color: '#805ad5' },
];
const INDUSTRY_ALIASES = {
  'Retail-Fashion': 'Retail Fashion',
  'Retail-Non Fashion': 'Retail Non-Fashion',
  'Food & Beverages': 'Food & Beverage',
  'B2B + Services': 'B2B Services',
};
const canonicalIndustry = (value) => INDUSTRY_ALIASES[value] ?? value ?? '';

const STATUS_CHOICES = ['active', 'off', 'freeze'];
const FILTERS = ['all', 'active', 'off', 'freeze', 'unknown'];
const FILTER_LABELS = { all: 'All', ...BRAND_STATUS_LABELS };

const isFilled = (v) => Boolean((v ?? '').trim());
const filled = (profile, fields) => fields.filter(([key]) => isFilled(profile?.[key])).length;
const words = (v) => ((v ?? '').trim() ? v.trim().split(/\s+/).length : 0);
const initials = (name) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.trim().slice(0, 2)).toUpperCase();
};
const statusOf = (brand) => brand.status || 'unknown';

// A small completeness ring: share of a section's fields that are filled.
function Ring({ value, size = 18 }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="bc-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="bc-ring-track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="bc-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(Math.max(value, 0), 1))} />
    </svg>
  );
}

function Field({ id, index, label, guidance, value, original, onChange, disabled }) {
  const changed = (value ?? '') !== (original ?? '');
  const full = isFilled(value);
  return (
    <label className={`bc-field${full ? ' is-filled' : ''}${changed ? ' is-changed' : ''}`} id={id} data-annotate={id}>
      <span className="bc-field-head">
        <span className="bc-field-num">{String(index + 1).padStart(2, '0')}</span>
        <b>{label}</b>
        <span className="bc-field-state">{changed ? 'Diubah' : full ? 'Terisi' : 'Belum diisi'}</span>
      </span>
      <small>{guidance}</small>
      <textarea value={value ?? ''} rows="4" onChange={(event) => onChange(event.target.value)} placeholder="Belum diisi — tulis konteks yang tidak terlihat dari angka." disabled={disabled} />
      {full && <span className="bc-field-count">{words(value)} kata</span>}
    </label>
  );
}

// Deleting a brand, at the foot of Brand Setting (admins only). An empty
// brand (a duplicate, a typo) is deleted after its name is typed back. A
// brand that still holds data shows that data first and suggests "Inactive";
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
      {state.phase === 'error' && <p className="bc-msg is-error" role="alert"><CircleAlert size={15} /> {state.text}</p>}
      {state.phase === 'blocked' && (
        <div className="bp-danger-body">
          <p>{brand.brand_name} masih punya data, jadi tidak bisa dihapus. Ubah statusnya menjadi <b>Inactive</b> — data dan laporannya tetap aman.</p>
          <ul>{state.blocking.map((b) => <li key={b.label}><span>{b.label}</span><b>{b.count.toLocaleString('id-ID')}</b></li>)}</ul>
          <div className="bp-danger-actions is-split">
            <button type="button" className="bp-ghost" onClick={() => setState({ phase: 'idle' })}>Tutup</button>
            {state.boundAccounts ? (
              <small className="bp-danger-note">Ada {state.boundAccounts} akun login yang dibatasi ke brand ini — pindahkan atau hapus di Pengaturan Akses dulu sebelum menghapus beserta data.</small>
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
            file Data Collection Hub, laporan tersimpan, data Shopee, Brand Tracking, Google &amp; Meta Ads, catatan meeting, dan lainnya.
          </p>
          <ul>{state.blocking.map((b) => <li key={b.label}><span>{b.label}</span><b>{b.count.toLocaleString('id-ID')}</b></li>)}</ul>
          {state.error && <p className="bc-msg is-error" role="alert"><CircleAlert size={15} /> {state.error}</p>}
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

// The selected brand's workspace. Status saves on the spot (it is shared by
// every module); industry and the narrative fields keep an unsaved draft,
// which the page asks about before switching to another brand (see
// onDirtyChange).
function BrandSetting({ brand, isViewOnly, canDelete, statusBusy, onStatus, onDeleted, onOpenData, onDirtyChange, onIndustrySaved }) {
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
        const next = { ...(data.profile ?? {}), industry: canonicalIndustry(data.profile?.industry) };
        setProfile(next);
        setDraft(next);
      })
      .catch((err) => alive && setMessage({ tone: 'error', text: describeError(err, 'Gagal memuat brand') }))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [brand.brand_id]);

  const changes = useMemo(
    () => ALL_FIELDS.filter(([key]) => (draft[key] ?? '') !== (profile?.[key] ?? '')).length
      + ((draft.industry ?? '') !== (profile?.industry ?? '') ? 1 : 0),
    [draft, profile],
  );
  const dirty = changes > 0;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  const save = async () => {
    if (isViewOnly || !dirty) return;
    setSaving(true);
    setMessage(null);
    try {
      const { data } = await api.put(`/brands/${brand.brand_id}/profile`, draft);
      setProfile((current) => ({ ...current, ...data.profile }));
      setDraft((current) => ({ ...current, ...data.profile }));
      onIndustrySaved(brand.brand_id, data.profile.industry);
      setMessage({ tone: 'ok', text: 'Perubahan tersimpan.' });
    } catch (err) {
      setMessage({ tone: 'error', text: describeError(err, 'Gagal menyimpan perubahan') });
    } finally {
      setSaving(false);
    }
  };
  const discard = () => { setDraft(profile ?? {}); setMessage(null); };

  // Jump from the index to a field: scroll it into view and put the caret in it.
  const focusField = (key) => {
    const box = document.getElementById(`bc-f-${key}`);
    if (!box) return;
    box.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    box.querySelector('textarea')?.focus({ preventScroll: true });
  };

  // "target" is the annual target tab: its own data and saves, not profile fields.
  const onTarget = section === 'target';
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const spring = reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42, mass: 0.6 };
  const status = statusOf(brand);
  const filledAll = filled(draft, ALL_FIELDS);
  const updated = profile?.updated_at
    ? `Terakhir diperbarui ${new Date(profile.updated_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}${profile.updated_by_name ? ` oleh ${profile.updated_by_name}` : ''}`
    : 'Belum pernah disimpan untuk brand ini';
  const tabs = [
    ...SECTIONS.map(({ id, label, Icon, fields }) => ({ id, label, Icon, done: filled(draft, fields), total: fields.length })),
    { id: 'target', label: 'Target tahunan', Icon: Target, year: new Date().getFullYear() },
  ];

  return (
    <motion.section
      key={brand.brand_id} className="soft-card bc-ws bp-setting" aria-labelledby="bc-ws-title" data-annotate="brand-workspace"
      initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE }}
    >
      <header className="bc-ws-head">
        <span className={`bc-mono is-lg is-${status}`} aria-hidden="true">{initials(brand.brand_name)}</span>
        <div className="bc-ws-title">
          <h2 id="bc-ws-title">{brand.brand_name}</h2>
          <div className="bc-ws-meta">
            <span className={`bc-pill is-${status}`}><i aria-hidden="true" />{BRAND_STATUS_LABELS[status]}</span>
            <span className="bc-pill is-plain">{draft.industry || 'Industri belum diatur'}</span>
            {!loading && (
              <span className="bc-ws-complete" title="Kolom brand context dan current direction yang terisi">
                <Ring value={filledAll / ALL_FIELDS.length} /> {filledAll}/{ALL_FIELDS.length} kolom profil terisi
              </span>
            )}
          </div>
        </div>
        <button type="button" className="bp-ghost bc-ws-link" onClick={() => { if (!dirty || window.confirm('Perubahan belum disimpan. Pindah ke Data Collection Hub tanpa menyimpan?')) onOpenData(brand); }}>
          <FolderOpen size={15} aria-hidden="true" /> Data Collection Hub <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      </header>

      <div className="bc-controls">
        <div className="bc-control">
          <span className="bc-control-label" id="bc-status-label">Client&apos;s Status</span>
          <div className="bc-status" role="radiogroup" aria-labelledby="bc-status-label">
            {STATUS_CHOICES.map((s) => {
              const on = brand.status === s;
              return (
                <button
                  key={s} type="button" role="radio" aria-checked={on}
                  className={`is-${s}${on ? ' is-on' : ''}`}
                  disabled={isViewOnly || statusBusy}
                  onClick={() => !on && onStatus(brand, s)}
                >
                  {on && <motion.span layoutId={`bc-status-pill-${brand.brand_id}`} className="bc-status-pill" transition={spring} aria-hidden="true" />}
                  <i aria-hidden="true" /><span>{BRAND_STATUS_LABELS[s]}</span>
                </button>
              );
            })}
            {statusBusy && <Loader2 size={15} className="brand-spin" aria-label="Menyimpan status" />}
          </div>
        </div>
        <div className="bc-control">
          <span className="bc-control-label">Client&apos;s Industry</span>
          <SelectMenu
            value={draft.industry ?? ''}
            onChange={(industry) => setDraft((current) => ({ ...current, industry }))}
            options={INDUSTRY_CHOICES.map(({ value }) => ({ value, label: value }))}
            placeholder="Pilih kategori industri"
            label="Client's Industry"
            menuTitle="Client's Industry"
            className="bc-industry-menu"
            disabled={isViewOnly || loading}
          />
        </div>
      </div>

      {/* The open tab's pill is placed by CSS (translateX by index), not a
          shared-layout animation: the bar is sticky, and layout animations
          measured mid-scroll made the pill rise from below instead of
          sliding across. */}
      <nav className="bc-tabs" role="tablist" aria-label="Bagian profil brand" style={{ '--bc-tab': Math.max(tabs.findIndex((t) => t.id === section), 0) }}>
        <span className="bc-tab-pill" aria-hidden="true" />
        {tabs.map(({ id, label, Icon, done, total, year }) => {
          const on = id === section;
          return (
            <button key={id} type="button" role="tab" aria-selected={on} className={on ? 'is-on' : ''} onClick={() => setSection(id)}>
              <Icon size={16} aria-hidden="true" />
              <span className="bc-tab-label">{label}</span>
              {year ? <small>{year}</small> : (
                <small className={done === total ? 'is-full' : ''}>
                  {!loading && <Ring value={done / total} size={14} />}{loading ? '…' : `${done}/${total}`}
                </small>
              )}
            </button>
          );
        })}
      </nav>

      <AnimatePresence initial={false}>
        {message && (
          <motion.p
            key={message.text} className={`bc-msg is-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
          >
            {message.tone === 'ok' ? <Check size={15} /> : <CircleAlert size={15} />} {message.text}
          </motion.p>
        )}
      </AnimatePresence>

      {onTarget ? (
        <div className="bc-body is-target">
          <AnnualTargetCard brandId={brand.brand_id} canEdit={!isViewOnly} />
        </div>
      ) : loading ? (
        <div className="bc-body"><div className="bc-skeleton" aria-label="Memuat brand" role="status"><i /><i /><i /></div></div>
      ) : (
        <motion.div
          key={section} className="bc-body"
          initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: EASE }}
        >
          <aside className="bc-index" aria-label={`Isi ${active.label}`}>
            {active.note && <p className="bc-index-note">{active.note}</p>}
            <ol>
              {active.fields.map(([key, label], i) => {
                const changed = (draft[key] ?? '') !== (profile?.[key] ?? '');
                return (
                  <li key={key}>
                    <button type="button" className={`${isFilled(draft[key]) ? 'is-filled' : ''}${changed ? ' is-changed' : ''}`} onClick={() => focusField(key)}>
                      <span className="bc-index-num">{isFilled(draft[key]) ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                      <span>{label}</span>
                      {changed && <i aria-label="diubah" />}
                    </button>
                  </li>
                );
              })}
            </ol>
            {section === 'context' && (
              <p className="bc-tip"><Lightbulb size={14} aria-hidden="true" /><span>Don’t just list the dashboard metrics, provide context that explains <em>why</em>!</span></p>
            )}
          </aside>
          <div className="bc-fields">
            {active.fields.map(([key, label, guidance], i) => (
              <Field
                key={key} id={`bc-f-${key}`} index={i} label={label} guidance={guidance}
                value={draft[key]} original={profile?.[key]} disabled={isViewOnly}
                onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))}
              />
            ))}
          </div>
        </motion.div>
      )}

      {!onTarget && (
        <footer className={`bc-savebar${dirty ? ' is-dirty' : ''}`}>
          <span className="bc-save-state"><i aria-hidden="true" />{dirty ? `${changes} perubahan belum disimpan` : updated}</span>
          <div>
            {dirty && !isViewOnly && (
              <button type="button" className="bp-ghost" onClick={discard} disabled={saving}><RotateCcw size={14} aria-hidden="true" /> Batalkan</button>
            )}
            <button type="button" className="bp-primary" onClick={save} disabled={isViewOnly || saving || !dirty || loading}>
              {saving ? <Loader2 size={16} className="brand-spin" /> : dirty ? <Save size={16} /> : <Check size={16} />}
              {isViewOnly ? 'Lihat saja' : saving ? 'Menyimpan…' : dirty ? 'Simpan perubahan' : 'Tersimpan'}
            </button>
          </div>
        </footer>
      )}

      {canDelete && !loading && <DeleteBrand brand={brand} onDeleted={onDeleted} />}
    </motion.section>
  );
}

// One horizontal meter: segments sized by count, a legend under it.
function Meter({ title, note, items, onPick, picked }) {
  const total = items.reduce((a, it) => a + it.count, 0);
  return (
    <div className="bc-meter">
      <header><span>{title}</span>{note && <small>{note}</small>}</header>
      <div className="bc-meter-bar" role="img" aria-label={`${title}: ${items.map((it) => `${it.label} ${it.count}`).join(', ')}`}>
        {total ? items.filter((it) => it.count).map((it) => (
          <span key={it.key} className={`is-${it.key}`} style={{ flexGrow: it.count, background: it.color }} title={`${it.label} · ${it.count}`} />
        )) : <span className="is-empty" style={{ flexGrow: 1 }} />}
      </div>
      <div className="bc-meter-legend">
        {items.map((it) => {
          const content = (
            <>
              <i style={{ background: it.color }} className={`is-${it.key}`} aria-hidden="true" />
              <span>{it.label}</span>
              <b>{it.count}</b>
            </>
          );
          return onPick ? (
            <button key={it.key} type="button" aria-pressed={picked === it.key} className={picked === it.key ? 'is-on' : ''} onClick={() => onPick(picked === it.key ? 'all' : it.key)} title={picked === it.key ? 'Tampilkan semua brand' : `Saring daftar: ${it.label}`}>
              {content}
            </button>
          ) : <span key={it.key}>{content}</span>;
        })}
      </div>
    </div>
  );
}

export default function BrandSettingsPage() {
  const { isViewOnly, isAdmin } = useAuth();
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

  // The selected brand lives in the URL (?detail=<id>), so Data Collection Hub's
  // "Context & direction" link opens the right brand directly. With none
  // chosen, the brand last open in Brand Setting (shared with Data Collection
  // Hub, so switching sections keeps the brand) is shown, else the first in
  // the list.
  const detailId = Number(params.get('detail')) || null;
  const [lastBrandId, setLastBrandId] = useSessionState('brand-settings:brand', null);
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

  const selected = (detailId && brands.find((b) => b.brand_id === detailId))
    || (lastBrandId && brands.find((b) => b.brand_id === lastBrandId))
    || shown[0] || null;
  useEffect(() => {
    if (selected) setLastBrandId(selected.brand_id);
  }, [selected?.brand_id, setLastBrandId]);
  const select = (b) => {
    if (b.brand_id === selected?.brand_id) return;
    if (dirtyRef.current && !window.confirm('Perubahan brand context/direction belum disimpan. Pindah brand tanpa menyimpan?')) return;
    dirtyRef.current = false;
    setDetail(b.brand_id);
  };

  const counts = useMemo(() => ({
    all: brands.length,
    active: brands.filter((b) => b.status === 'active').length,
    off: brands.filter((b) => b.status === 'off').length,
    freeze: brands.filter((b) => b.status === 'freeze').length,
    unknown: brands.filter((b) => !b.status).length,
  }), [brands]);

  const statusItems = [
    { key: 'active', label: BRAND_STATUS_LABELS.active, count: counts.active, color: '#22a06b' },
    { key: 'off', label: BRAND_STATUS_LABELS.off, count: counts.off, color: '#a3afc2' },
    { key: 'freeze', label: BRAND_STATUS_LABELS.freeze, count: counts.freeze, color: '#e2a03f' },
    { key: 'unknown', label: BRAND_STATUS_LABELS.unknown, count: counts.unknown, color: '#dfe5ef' },
  ];
  const industryItems = useMemo(() => {
    const active = brands.filter((brand) => brand.status === 'active');
    const items = INDUSTRY_CHOICES.map((item) => ({
      key: item.value, label: item.value, color: item.color,
      count: active.filter((brand) => canonicalIndustry(brand.industry) === item.value).length,
    }));
    const categorized = items.reduce((a, it) => a + it.count, 0);
    return { items, categorized, active: active.length };
  }, [brands]);

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

  const industrySaved = (brandId, industry) => {
    setBrands((list) => list.map((brand) => (brand.brand_id === brandId ? { ...brand, industry } : brand)));
  };

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
    // The page's frame and masthead belong to BrandSettingLayout, shared
    // with Data Collection Hub.
    <>
      <section className="soft-card bc-portfolio bp-portfolio" aria-label="MIL Digital Portofolio" data-annotate="portfolio">
        <div className="bc-port-total">
          <span className="bc-eyebrow">MIL Digital Portofolio</span>
          <strong>{loaded ? brands.length : '…'}</strong>
          <small>Total Brands · {counts.active} active</small>
        </div>
        <Meter title="Brands by Status" note="Click to filter the list" items={statusItems} onPick={setListStatus} picked={listStatus} />
        <Meter
          title="Active Brands by Industry"
          note={loaded ? `${industryItems.categorized} of ${industryItems.active} categorized` : 'Loading breakdown…'}
          items={industryItems.items}
        />
        {!isViewOnly && (
          <div className="bc-port-actions">
            {creating ? (
              <form className="bc-new-form" onSubmit={createBrand}>
                <input
                  value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Nama brand baru" autoFocus
                  onKeyDown={(event) => { if (event.key === 'Escape') setCreating(false); }} aria-label="Nama brand baru"
                />
                <div>
                  <button type="button" className="bp-ghost" onClick={() => setCreating(false)}>Batal</button>
                  <button type="submit" className="bp-primary" disabled={creatingBusy || !newName.trim()}>
                    {creatingBusy ? <Loader2 size={15} className="brand-spin" /> : <Check size={15} />} Simpan
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" className="bp-primary" onClick={() => { setNewName(''); setCreating(true); }}>
                <Plus size={16} /> Brand baru
              </button>
            )}
          </div>
        )}
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

      <div className="bc-master">
        <aside className="soft-card bc-list" aria-label="Daftar brand" data-annotate="brand-list">
          <div className="bc-list-head bp-list-head">
            <SearchField className="bc-search" value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="Search" aria-label="Cari brand" />
            <div className="bc-chips" role="radiogroup" aria-label="Filter client's status">
              {FILTERS.map((key) => {
                const on = listStatus === key;
                return (
                  <button key={key} type="button" role="radio" aria-checked={on} className={`is-${key}${on ? ' is-on' : ''}`} onClick={() => setListStatus(key)}>
                    {key !== 'all' && <i aria-hidden="true" />}
                    <span>{FILTER_LABELS[key]}</span>
                    <b>{loaded ? counts[key] : '·'}</b>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="bc-list-count" aria-live="polite">
            {loaded ? `${shown.length} brand${listStatus !== 'all' ? ` · ${FILTER_LABELS[listStatus].toLowerCase()}` : ''}${listQuery.trim() ? ` · “${listQuery.trim()}”` : ''}` : 'Memuat daftar brand…'}
          </p>
          <motion.ul layoutScroll className="bc-list-items bp-list-items">
            {shown.map((b) => {
              const status = statusOf(b);
              const on = b.brand_id === selected?.brand_id;
              return (
                <li key={b.brand_id}>
                  <button type="button" className={`bc-item${on ? ' is-on' : ''}`} aria-current={on ? 'true' : undefined} onClick={() => select(b)}>
                    {on && <motion.span layoutId="bc-item-sheet" className="bc-item-sheet" transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 44, mass: 0.6 }} aria-hidden="true" />}
                    <span className={`bc-mono is-${status}`} aria-hidden="true">{initials(b.brand_name)}</span>
                    <span className="bc-item-text">
                      <b>{b.brand_name}</b>
                      <small className={b.industry ? '' : 'is-missing'}>{canonicalIndustry(b.industry) || 'Industri belum diatur'}</small>
                    </span>
                    <span className={`bc-dot is-${status}`} title={BRAND_STATUS_LABELS[status]}><span className="bc-sr">{BRAND_STATUS_LABELS[status]}</span></span>
                  </button>
                </li>
              );
            })}
          </motion.ul>
          {loaded && !shown.length && <p className="bc-list-empty">Tidak ada brand yang cocok. Ubah pencarian atau filter status.</p>}
          {!loaded && <p className="bp-loading"><Loader2 size={14} className="brand-spin" /> Memuat daftar brand…</p>}
        </aside>

        {selected ? (
          <BrandSetting
            key={selected.brand_id} brand={selected} isViewOnly={isViewOnly}
            canDelete={isAdmin && !isViewOnly} statusBusy={statusBusy === selected.brand_id}
            onStatus={changeStatus} onDeleted={brandDeleted} onOpenData={navigateToData} onDirtyChange={onDirtyChange}
            onIndustrySaved={industrySaved}
          />
        ) : (
          <div className="soft-card bc-ws bc-ws-empty">{loaded ? 'Pilih brand di daftar untuk membuka profilnya.' : 'Memuat…'}</div>
        )}
      </div>
    </>
  );
}
