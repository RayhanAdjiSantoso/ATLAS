import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Circle, CircleAlert, CheckCircle2,
  Loader2, NotebookPen, PenLine, Plus, Save, Trash2, UsersRound,
} from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../contexts/AuthContext.jsx';
import useSessionState from '../../hooks/useSessionState.js';
import DatePicker from '../dashboard/DatePicker.jsx';
import SelectMenu from '../common/SelectMenu.jsx';
import { describeError } from '../brandSettings/describeError.js';
import {
  MOM_TYPES, MOM_TYPE_LABELS, dateLabel, emptyMinute, longDateLabel, parseISO, recapPreview, taskGroups, taskStats,
} from './momModel.js';

// Minutes of Meeting for one brand — the editor and the meeting history.
// Lives in Brand Tracking, beside the numbers the meetings talk about; it
// loads, saves and deletes its own records, so the page only hands it a brand.

const EASE = [0.16, 1, 0.3, 1];

function SectionHead({ title, description, meta }) {
  return (
    <div className="brand-workspace-head">
      <div><h2>{title}</h2><p>{description}</p></div>
      {meta && <span className="brand-section-meta">{meta}</span>}
    </div>
  );
}

const MOM_TEXT_FIELDS = ['meeting_recap', 'todo_mil', 'todo_client'];
const MOM_FORM_FIELDS = ['meeting_date', 'meeting_type', ...MOM_TEXT_FIELDS];
const minuteDraft = (minute) => Object.fromEntries(MOM_FORM_FIELDS.map((key) => [key, minute[key] ?? '']));
const monthHeading = (iso) => parseISO(iso).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
const updatedLabel = (minute) => {
  if (!minute?.updated_at) return null;
  const when = new Date(minute.updated_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  return `Diperbarui ${when}${minute.updated_by_name ? ` oleh ${minute.updated_by_name}` : ''}`;
};

// A task textarea that also says what Brand Overview will make of it, so the
// "PIC:" convention is learnt from the count changing rather than from a manual.
function MomTaskField({ label, guidance, scope, value, onChange, placeholder, left }) {
  const groups = taskGroups(value, scope);
  const count = groups.reduce((total, group) => total + group.tasks.length, 0);
  const pics = groups.filter((group) => group.name !== 'Tanpa PIC').length;
  return (
    <label className={`mom-field${left ? ' is-left' : ''}`}>
      <span className="mom-field-label">
        {label}
        <em className={count ? 'has-value' : ''}>{count ? `${count} tugas${pics ? ` · ${pics} PIC` : ''}` : 'Belum ada tugas'}</em>
      </span>
      <small>{guidance}</small>
      <textarea rows="6" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

// One saved meeting, minimisable the same way a dataset row in Performance Database is:
// chevron + summary line at rest, the full record underneath when opened.
function MinuteRow({ minute, open, onToggle, onEdit, onDelete, busy, editing, index, reduced }) {
  const stats = taskStats(minute);
  const done = new Set(minute.completed_task_keys ?? []);
  const date = parseISO(minute.meeting_date);
  const tone = stats.total === 0 ? 'is-idle' : stats.done === stats.total ? 'is-ok' : 'is-ref';

  return (
    <motion.article
      className={`mom-row${open ? ' is-open' : ''}${editing ? ' is-editing' : ''}`}
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * .022, duration: .2, ease: EASE }}
    >
      <div className="mom-row-head">
        <button type="button" className="brand-ds-name" onClick={onToggle} aria-expanded={open}>
          <span className="brand-ds-chev" aria-hidden="true"><ChevronDown size={15} /></span>
          <span className="mom-date-tile" aria-hidden="true">
            <b>{date.getDate()}</b>
            <small>{date.toLocaleDateString('id-ID', { month: 'short' })}</small>
          </span>
          <span className="brand-ds-label">
            <strong>{longDateLabel(minute.meeting_date)}</strong>
            <small>{MOM_TYPE_LABELS[minute.meeting_type] ?? minute.meeting_type}{editing ? ' · sedang diedit' : ''}</small>
          </span>
        </button>
        <p className="mom-row-preview">
          {minute.meeting_recap ? recapPreview(minute.meeting_recap, 160) : <em>Tanpa recap — hanya to do list</em>}
        </p>
        <span className={`brand-ds-status ${tone}`}>
          {stats.total ? <>{stats.done === stats.total && <Check size={12} />}{stats.done}/{stats.total} tugas selesai</> : 'Tanpa tugas'}
        </span>
        <span className="brand-ds-fileacts mom-row-acts">
          <button type="button" onClick={onEdit} disabled={editing}><PenLine size={14} /> Edit</button>
          <button type="button" className="is-danger" onClick={onDelete} disabled={busy}><Trash2 size={14} /> Hapus</button>
        </span>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="brand-ds-detail"
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: .24, ease: EASE }}
          >
            <div className="mom-row-detail">
              <section className="mom-detail-recap">
                <h4>Meeting recap</h4>
                {minute.meeting_recap ? <p>{minute.meeting_recap}</p> : <p className="mom-muted">Recap belum diisi untuk meeting ini.</p>}
              </section>
              <div className="mom-detail-tasks">
                {[['mil', 'To do list MIL', 'todo_mil'], ['client', 'To do list Client', 'todo_client']].map(([scope, title, field]) => {
                  const groups = taskGroups(minute[field], scope);
                  return (
                    <section key={scope}>
                      <h4>{title}</h4>
                      {groups.length ? groups.map((group) => (
                        <div className="mom-detail-pic" key={group.name}>
                          <strong>{group.name}</strong>
                          <ul>
                            {group.tasks.map((task) => (
                              <li key={task.key} className={done.has(task.key) ? 'is-done' : ''}>
                                {done.has(task.key) ? <CheckCircle2 size={14} aria-label="Selesai" /> : <Circle size={14} aria-label="Aktif" />}
                                <span>{task.text}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )) : <p className="mom-muted">Tidak ada tugas.</p>}
                    </section>
                  );
                })}
              </div>
              <p className="mom-detail-foot">{updatedLabel(minute)} · Status tugas dicentang dari Brand Overview.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function MinutesView({ brand, minutes, loading, onSave, onDelete, busy, reduced }) {
  const [draft, setDraft] = useState(emptyMinute);
  const [editing, setEditing] = useState(null);
  const [composerOpen, setComposerOpen] = useSessionState('brand-settings:mom-composer', true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [expanded, setExpanded] = useState(() => new Set());
  const [formError, setFormError] = useState('');
  const composerRef = useRef(null);
  const recapRef = useRef(null);

  const setField = (key) => (value) => { setDraft((current) => ({ ...current, [key]: value })); setFormError(''); };
  const hasContent = MOM_TEXT_FIELDS.some((key) => (draft[key] ?? '').trim());
  const dirty = editing ? MOM_FORM_FIELDS.some((key) => (draft[key] ?? '') !== (editing[key] ?? '')) : hasContent;
  const confirmDiscard = () => !dirty || window.confirm('Perubahan pada catatan ini belum disimpan. Buang perubahan?');

  // Editing from a row far down the history used to change a form the user
  // could not see. Bring it into view and put the cursor in the recap.
  const focusComposer = () => setTimeout(() => {
    composerRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    recapRef.current?.focus({ preventScroll: true });
  }, 80);

  const resetDraft = () => { setEditing(null); setDraft(emptyMinute()); setFormError(''); };
  const startNew = () => { if (!confirmDiscard()) return; resetDraft(); setComposerOpen(true); focusComposer(); };
  const startEdit = (minute) => {
    if (editing?.id !== minute.id) {
      if (!confirmDiscard()) return;
      setEditing(minute);
      setDraft(minuteDraft(minute));
      setFormError('');
    }
    setComposerOpen(true);
    focusComposer();
  };
  const cancel = () => { if (confirmDiscard()) resetDraft(); };

  const submit = async (event) => {
    event?.preventDefault();
    if (busy) return;
    if (!draft.meeting_date) { setFormError('Pilih tanggal meeting terlebih dahulu.'); return; }
    if (!hasContent) { setFormError('Isi meeting recap atau minimal satu to do list sebelum menyimpan.'); return; }
    const result = await onSave(draft, editing?.id);
    if (!result.ok) { setFormError(result.error); return; }
    resetDraft();
    setExpanded((current) => new Set(current).add(result.minute.id));
    if (typeFilter !== 'all' && typeFilter !== result.minute.meeting_type) setTypeFilter('all');
  };

  const remove = async (minute) => {
    const removed = await onDelete(minute);
    if (removed && editing?.id === minute.id) resetDraft();
  };

  const counts = useMemo(() => minutes.reduce((acc, minute) => ({ ...acc, [minute.meeting_type]: (acc[minute.meeting_type] ?? 0) + 1 }), {}), [minutes]);
  const shown = typeFilter === 'all' ? minutes : minutes.filter((minute) => minute.meeting_type === typeFilter);
  const allOpen = shown.length > 0 && shown.every((minute) => expanded.has(minute.id));
  const toggleRow = (id) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const completedWhileEditing = editing?.completed_task_keys?.length ?? 0;

  return (
    <>
      <SectionHead
        title="Minutes of Meeting"
        description="Simpan hasil pembahasan dan pembagian tindak lanjut per meeting. Catatan tampil di Brand Overview sesuai periode tanggal meeting."
        meta={`${minutes.length} catatan`}
      />

      <div className="mom-composer" ref={composerRef}>
        <div className={`mom-composer-bar${composerOpen ? ' is-open' : ''}`}>
          <button type="button" className="brand-ds-name" onClick={() => setComposerOpen((current) => !current)} aria-expanded={composerOpen} aria-controls="mom-composer-form">
            <span className="brand-ds-chev" aria-hidden="true"><ChevronDown size={15} /></span>
            <span className="mom-composer-icon" aria-hidden="true">{editing ? <PenLine size={15} /> : <NotebookPen size={15} />}</span>
            <span className="brand-ds-label">
              <strong>{editing ? `Edit catatan · ${dateLabel(editing.meeting_date)}` : 'Catatan meeting baru'}</strong>
              <small>{editing ? (updatedLabel(editing) ?? 'Perubahan tersimpan untuk semua modul') : `Untuk ${brand?.brand_name ?? 'brand ini'}`}</small>
            </span>
          </button>
          {dirty && <span className="brand-ds-status is-partial">Belum disimpan</span>}
          {editing && <button type="button" className="mom-ghost" onClick={startNew}><Plus size={13} /> Catatan baru</button>}
        </div>

        <AnimatePresence initial={false}>
          {composerOpen && (
            <motion.form
              id="mom-composer-form"
              className="mom-form"
              onSubmit={submit}
              onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit(event); }}
              initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: .24, ease: EASE }}
            >
              <div className="mom-form-grid">
                <div className="mom-field is-left">
                  <span className="mom-field-label" id="mom-date-label">Tanggal meeting</span>
                  <small>Hari pertemuan berlangsung. Menentukan periode dashboard tempat catatan ini tampil.</small>
                  <DatePicker id="mom-date" label="Tanggal meeting" value={draft.meeting_date} onChange={setField('meeting_date')} />
                </div>
                <div className="mom-field">
                  <span className="mom-field-label" id="mom-type-label">Tipe meeting</span>
                  <small>Membedakan pertemuan terjadwal dari diskusi cepat.</small>
                  <SelectMenu id="mom-type" label="Tipe meeting" icon={UsersRound} value={draft.meeting_type} options={MOM_TYPES} onChange={setField('meeting_type')} />
                </div>
                <label className="mom-field is-wide">
                  <span className="mom-field-label">Meeting recap</span>
                  <small>Keputusan, insight, dan konteks penting. Bagian ini yang dirangkum Gemini di Brand Overview.</small>
                  <textarea ref={recapRef} rows="6" value={draft.meeting_recap} onChange={(event) => setField('meeting_recap')(event.target.value)} placeholder="Contoh: Klien setuju menaikkan budget iklan Shopee 20% mulai minggu depan untuk push produk hero…" />
                </label>
                <MomTaskField
                  left scope="mil" label="To do list MIL" value={draft.todo_mil} onChange={setField('todo_mil')}
                  guidance="Tulis nama PIC diakhiri titik dua, lalu satu tugas per baris di bawahnya."
                  placeholder={'Ucup:\nSiapkan laporan performa iklan\nUpdate materi konten minggu depan'}
                />
                <MomTaskField
                  scope="client" label="To do list Client" value={draft.todo_client} onChange={setField('todo_client')}
                  guidance="Format sama. Tugas tanpa nama PIC dikelompokkan sebagai “Tanpa PIC”."
                  placeholder={'Tim Marketing:\nKirim foto produk baru\nKonfirmasi jadwal promo'}
                />
              </div>

              {completedWhileEditing > 0 && (
                <p className="mom-form-note"><CircleAlert size={14} /> {completedWhileEditing} tugas pada catatan ini sudah ditandai selesai. Mengubah teks tugas tersebut akan mengembalikannya ke daftar aktif.</p>
              )}
              {formError && <p className="mom-form-error" role="alert"><CircleAlert size={14} /> {formError}</p>}

              <div className="brand-save-bar">
                <span>{editing ? 'Mengedit catatan tersimpan' : 'Tekan Ctrl / ⌘ + Enter untuk menyimpan cepat'}</span>
                <span className="mom-save-actions">
                  {(editing || dirty) && <button type="button" className="btn btn-secondary" onClick={cancel}>{editing ? 'Batal edit' : 'Kosongkan'}</button>}
                  <button type="submit" className="btn btn-primary" disabled={busy || !hasContent || (editing && !dirty)}>
                    {busy ? <Loader2 size={16} className="brand-spin" /> : <Save size={16} />}
                    {busy ? 'Menyimpan…' : editing ? (dirty ? 'Simpan perubahan' : 'Tersimpan') : 'Simpan catatan'}
                  </button>
                </span>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>

      <div className="mom-history">
        <div className="mom-history-head">
          <div className="mom-history-title">
            <span className="brand-picker-section-label">Riwayat meeting</span>
            <small>{minutes.length ? `${shown.length} dari ${minutes.length} catatan · terbaru di atas` : 'Belum ada catatan'}</small>
          </div>
          {minutes.length > 0 && (
            <div className="brand-status-filter" role="group" aria-label="Filter tipe meeting">
              {[{ value: 'all', label: 'Semua' }, ...MOM_TYPES].map((type) => (
                <button key={type.value} type="button" aria-pressed={typeFilter === type.value} className={typeFilter === type.value ? 'is-selected' : ''} onClick={() => setTypeFilter(type.value)}>
                  {type.label}<b className="mom-count">{type.value === 'all' ? minutes.length : counts[type.value] ?? 0}</b>
                </button>
              ))}
            </div>
          )}
          {shown.length > 0 && (
            <button type="button" className="mom-ghost" onClick={() => setExpanded(allOpen ? new Set() : new Set(shown.map((minute) => minute.id)))}>
              {allOpen ? <><ChevronsDownUp size={13} /> Tutup semua</> : <><ChevronsUpDown size={13} /> Buka semua</>}
            </button>
          )}
        </div>

        {shown.map((minute, index) => {
          const showMonth = index === 0 || shown[index - 1].meeting_date.slice(0, 7) !== minute.meeting_date.slice(0, 7);
          return (
            <Fragment key={minute.id}>
              {showMonth && <div className="mom-month">{monthHeading(minute.meeting_date)}</div>}
              <MinuteRow
                minute={minute} index={index} reduced={reduced} busy={busy}
                open={expanded.has(minute.id)} editing={editing?.id === minute.id}
                onToggle={() => toggleRow(minute.id)} onEdit={() => startEdit(minute)} onDelete={() => remove(minute)}
              />
            </Fragment>
          );
        })}

        {loading && !minutes.length && (
          <div className="mom-empty"><Loader2 size={20} className="brand-spin" /><strong>Memuat catatan meeting…</strong></div>
        )}
        {!loading && !minutes.length && (
          <div className="mom-empty">
            <UsersRound size={24} />
            <strong>Belum ada catatan meeting</strong>
            <span>Catatan pertama langsung tersedia di Brand Overview untuk periode tanggalnya.</span>
            <button type="button" className="brand-new" onClick={startNew}><Plus size={14} /> Tulis catatan pertama</button>
          </div>
        )}
        {minutes.length > 0 && !shown.length && (
          <div className="mom-empty">
            <strong>Tidak ada catatan bertipe {MOM_TYPE_LABELS[typeFilter]}</strong>
            <button type="button" className="mom-ghost" onClick={() => setTypeFilter('all')}>Tampilkan semua tipe</button>
          </div>
        )}
      </div>
    </>
  );
}

export default function MinutesOfMeeting({ brand }) {
  const { isViewOnly } = useAuth();
  const reduced = useReducedMotion();
  const [minutes, setMinutes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const brandId = brand?.brand_id ?? null;

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setNotice(null);
    try {
      const { data } = await api.get(`/brands/${brandId}/minutes`);
      setMinutes(data.minutes ?? []);
    } catch (err) {
      setMinutes([]);
      setNotice(describeError(err, 'Catatan meeting gagal dimuat'));
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => { setMinutes([]); load(); }, [load]);

  // Failures go back to the editor that caused them (shown inline beside the
  // form) instead of the flash above, which sits far from a form the user has
  // scrolled down to.
  const save = async (minute, id) => {
    if (isViewOnly) return { ok: false, error: 'Akun ini hanya dapat melihat data.' };
    if (!brandId) return { ok: false, error: 'Pilih brand terlebih dahulu.' };
    setBusy(true);
    try {
      const payload = {
        meeting_date: minute.meeting_date,
        meeting_type: minute.meeting_type,
        meeting_recap: minute.meeting_recap,
        todo_client: minute.todo_client,
        todo_mil: minute.todo_mil,
      };
      const { data } = id
        ? await api.put(`/brands/${brandId}/minutes/${id}`, payload)
        : await api.post(`/brands/${brandId}/minutes`, payload);
      setMinutes((current) => [data.minute, ...current.filter((item) => item.id !== data.minute.id)]
        .sort((a, b) => b.meeting_date.localeCompare(a.meeting_date) || b.id - a.id));
      setNotice(id
        ? `Catatan meeting ${dateLabel(data.minute.meeting_date)} diperbarui.`
        : `Catatan meeting ${dateLabel(data.minute.meeting_date)} tersimpan dan tersedia di Brand Overview.`);
      return { ok: true, minute: data.minute };
    } catch (err) {
      return { ok: false, error: describeError(err, id ? 'Gagal memperbarui catatan' : 'Gagal menyimpan catatan') };
    } finally {
      setBusy(false);
    }
  };

  const remove = async (minute) => {
    if (!brandId || isViewOnly) return false;
    if (!window.confirm(`Hapus catatan meeting ${dateLabel(minute.meeting_date)}? Status to do list ikut terhapus dan tindakan ini tidak dapat dibatalkan.`)) return false;
    setBusy(true);
    try {
      await api.delete(`/brands/${brandId}/minutes/${minute.id}`);
      setMinutes((current) => current.filter((item) => item.id !== minute.id));
      setNotice(`Catatan meeting ${dateLabel(minute.meeting_date)} dihapus.`);
      return true;
    } catch (err) {
      setNotice(describeError(err, 'Gagal menghapus catatan'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="brand-workspace bt-mom">
      {notice && (
        <div className="brand-flash">
          <CircleAlert size={15} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>Tutup</button>
        </div>
      )}
      <div className="soft-card bp-panel">
        <MinutesView key={brandId ?? 'none'} brand={brand} minutes={minutes} loading={loading} onSave={save} onDelete={remove} busy={busy} reduced={reduced} />
      </div>
    </section>
  );
}
