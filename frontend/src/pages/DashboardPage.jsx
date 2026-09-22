import useSessionState, { sessionKey } from '../hooks/useSessionState.js';
import { Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUpRight, BarChart3, Brain, CalendarDays, Check, CheckCircle2, ChevronDown, Circle,
  CircleAlert, Copy, Database, Download, FileText, ListChecks, Loader2, RefreshCw, Sparkles, UsersRound,
} from 'lucide-react';
import FilterPanel from '../components/dashboard/FilterPanel.jsx';
import DashboardTab from '../components/dashboard/DashboardTab.jsx';
import { useConsoleData } from '../components/dashboard/useConsoleData.js';
import {
  CHANNELS,
  CHANNEL_BY_ID,
  CHANNEL_DOMAINS,
  DOMAIN_BY_KEY,
  EXECUTIVE_VIEW,
  STRIP_METRICS,
  VIEWS,
  VIEW_BY_ID,
  formatStripValue,
} from '../components/dashboard/domains.js';
import { Delta, Figure, InfoTip, Spark } from '../components/dashboard/figures.jsx';
import ExecutiveSummary from '../components/dashboard/ExecutiveSummary.jsx';
import '../components/dashboard/console.css';
import atlasIcon from '../assets/atlas-icon.png';
import atlasWordmark from '../assets/atlas-wordmark.png';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext.jsx';
import SelectMenu from '../components/common/SelectMenu.jsx';
import { MOM_TYPE_LABELS, OVERDUE_DAYS, dateLabel, daysSince, longDateLabel, parseISO, recapPreview, taskGroups, taskStats } from '../components/mom/momModel.js';

const DASH_EASE = [0.16, 1, 0.3, 1];

// Business Overview as a console rather than a tab strip.
//
// The page it replaces put eight equal pill buttons on one line and showed one
// of them at a time, which meant it could never tell you where you were, only
// where you could go — and seven eighths of the analysis was invisible at any
// moment. Here every domain is present: the focused one opens full width with
// its whole body, the rest stay as live summaries underneath, and the KPI strip
// and period bar never leave the screen. Nothing was dropped in the move; the
// focused panel renders exactly the same renderers as before.
//
// "Upload Data" is no longer one of these tabs. Ingest is not analysis, and it
// now lives on its own page (Pengaturan Brand) so every module reads from one
// place instead of each surface growing an uploader.

// Figure, Delta and Spark now live in ./figures.jsx — Executive Snapshot needs
// the same three signatures, and two implementations of "absent is not zero"
// is one too many for a rule the product depends on.

// "batal −Rp7.555.050 · retur −Rp1.885.150" — what separates the gross
// headline from its net line.
function netBreakdown(net, kind) {
  const f = (v) => formatStripValue(v, kind);
  return `Setelah dikurangi batal −${f(net.cancelled || 0)} dan retur −${f(net.returned || 0)}`;
}

// The Executive Snapshot KPI row, pinned. It stays whichever domain is
// focused, which is what lets the snapshot panel below stop repeating it.
function KpiStrip({ entry }) {
  const loading = entry.status === 'loading' || entry.status === 'idle';
  const kpis = entry.data?.kpis || {};
  const trend = (entry.data?.trends || []).map((t) => Number(t.gmv || 0));

  return (
    <div className="con-kpis">
      {STRIP_METRICS.map((m) => {
        const metric = kpis[m.key];
        const text = formatStripValue(metric?.value, m.kind);
        return (
          <div className="con-kpi" key={m.key}>
            <div className="con-kpi-label">
              {m.label}
              <InfoTip text={m.note} />
            </div>
            <div className="con-kpi-val">
              {loading ? <span className="con-skel is-wide" /> : <Figure text={text} absentReason={m.absent} />}
            </div>
            {!loading && m.net && metric?.net?.value != null && (
              <div className="con-kpi-net" title={netBreakdown(metric.net, m.kind)}>
                Net {formatStripValue(metric.net.value, m.kind)}
                <Delta value={metric.net.growth} />
              </div>
            )}
            <div className="con-kpi-foot">
              {loading
                ? <span className="con-skel is-narrow" style={{ height: '.7rem' }} />
                : <Delta value={metric?.growth} invert={m.invert} />}
              {!loading && m.spark && <Spark values={trend} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const AI_SECTIONS = [
  ['diagnosis', 'Ringkasan eksekutif'], ['objective_alignment', 'Keputusan & kesepakatan'],
  ['winning', 'Poin utama'], ['challenge', 'Isu terbuka'], ['strategic_direction', 'Langkah berikutnya'],
  ['action_items', 'Tindak lanjut'], ['risks', 'Risiko'], ['data_gaps', 'Konteks yang masih dibutuhkan'],
];
const hasValue = (value) => (Array.isArray(value) ? value.length > 0 : Boolean(value));
const sameIds = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
const summaryToText = (summary) => AI_SECTIONS.map(([key, label]) => {
  const value = summary?.[key];
  if (!hasValue(value)) return null;
  return `${label.toUpperCase()}\n${Array.isArray(value) ? value.map((item) => `• ${item}`).join('\n') : value}`;
}).filter(Boolean).join('\n\n');

// A to-do is not a reading of the dashboard period. It was agreed in some
// meeting and stays owed until someone ticks it, so the rail gathers every
// open task from every meeting of the brand — a task from July still shows
// when the dashboard is set to today — and each task carries the meeting it
// came from. PIC headings merge across meetings (case-insensitively), newest
// meeting first, so one person's backlog reads as one list.
function collectTasks(minutes, scope) {
  const field = scope === 'mil' ? 'todo_mil' : 'todo_client';
  const open = new Map();
  const done = [];
  for (const minute of minutes) {
    const completed = new Set(minute.completed_task_keys ?? []);
    for (const group of taskGroups(minute[field], scope)) {
      const groupKey = group.name.toLowerCase();
      for (const task of group.tasks) {
        const item = { ...task, person: group.name, minuteId: minute.id, date: minute.meeting_date, type: minute.meeting_type };
        if (completed.has(task.key)) {
          done.push(item);
        } else {
          if (!open.has(groupKey)) open.set(groupKey, { name: group.name, tasks: [] });
          open.get(groupKey).tasks.push(item);
        }
      }
    }
  }
  const groups = [...open.values()];
  return { groups, done, openCount: groups.reduce((count, group) => count + group.tasks.length, 0) };
}

function TaskBoard({ title, scope, minutes, onToggle }) {
  const { groups, done, openCount } = useMemo(() => collectTasks(minutes, scope), [minutes, scope]);
  const total = openCount + done.length;

  return (
    <section className="mom-task-board">
      <div className="mom-task-head">
        <span>{title}</span>
        <small>{total ? `${openCount} aktif · ${done.length} selesai` : 'Tidak ada tugas'}</small>
      </div>
      {!total && <p className="mom-dash-empty">Belum ada tugas untuk {title} di catatan meeting mana pun.</p>}
      {total > 0 && !openCount && <p className="mom-dash-done"><CheckCircle2 size={14} /> Semua tugas {title} sudah selesai.</p>}
      {groups.map((group) => (
        <div className="mom-assignee" key={group.name.toLowerCase()}>
          <strong><span aria-hidden="true" />{group.name}<em>{group.tasks.length}</em></strong>
          <ul>
            {group.tasks.map((task) => (
              <li key={`${task.minuteId}|${task.key}`}>
                <button type="button" onClick={() => onToggle(task.minuteId, task.key, true)} aria-label={`Tandai selesai: ${task.text}`}><Circle size={15} /></button>
                <span>
                  {task.text}
                  <small className={`mom-task-src${daysSince(task.date) > OVERDUE_DAYS ? ' is-overdue' : ''}`}>
                    {dateLabel(task.date)} · {MOM_TYPE_LABELS[task.type]}{daysSince(task.date) > OVERDUE_DAYS ? ` · tertunda ${daysSince(task.date)} hari` : ''}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {done.length > 0 && (
        <details className="mom-done">
          <summary><CheckCircle2 size={14} /> Sudah dilakukan <span>{done.length}</span><ChevronDown size={14} /></summary>
          <ul>
            {done.map((task) => (
              <li key={`${task.minuteId}|${task.key}`}>
                <button type="button" onClick={() => onToggle(task.minuteId, task.key, false)} aria-label={`Kembalikan ke aktif: ${task.text}`}><CheckCircle2 size={15} /></button>
                <span><small>{task.person} · {dateLabel(task.date)}</small>{task.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function RecapItem({ minute, open, onToggle }) {
  const stats = taskStats(minute);
  const date = parseISO(minute.meeting_date);
  return (
    <li className={`mom-recap-item${open ? ' is-open' : ''}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}>
        <span className="mom-date-tile" aria-hidden="true"><b>{date.getDate()}</b><small>{date.toLocaleDateString('id-ID', { month: 'short' })}</small></span>
        <span className="mom-recap-copy">
          <strong>{longDateLabel(minute.meeting_date)}</strong>
          <small>{MOM_TYPE_LABELS[minute.meeting_type]}{!open && minute.meeting_recap ? ` · ${recapPreview(minute.meeting_recap, 110)}` : ''}</small>
        </span>
        {stats.total > 0 && <span className="mom-recap-tasks" title="Tugas selesai">{stats.done}/{stats.total}</span>}
        <span className="brand-ds-chev" aria-hidden="true"><ChevronDown size={15} /></span>
      </button>
      {open && <p>{minute.meeting_recap || 'Recap belum diisi untuk meeting ini — catatan hanya berisi to do list.'}</p>}
    </li>
  );
}

function MinutesOverview({ filters }) {
  const { isViewOnly } = useAuth();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useSessionState('dashboard:mom-open', true);
  const [allMinutes, setAllMinutes] = useState([]);
  const [status, setStatus] = useState('idle');
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState([]);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiError, setAiError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [recapsOpen, setRecapsOpen] = useState(true);
  const [openRecaps, setOpenRecaps] = useState(() => new Set());
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [taskError, setTaskError] = useState(null);

  // Task writes are optimistic and can overlap. The refs hold the latest list
  // (so a second click builds on the first, not on a stale render), the last
  // server-confirmed keys per record (the rollback target), and a sequence per
  // record so only the newest response is allowed to settle the UI.
  const minutesRef = useRef([]);
  const confirmedRef = useRef(new Map());
  const seqRef = useRef(new Map());
  // Tasks answer to the brand; recaps and the summary answer to the period.
  const brandScope = `${filters.brandId}|${reloadKey}`;
  const periodScope = `${brandScope}|${filters.startDate}|${filters.endDate}`;
  const brandScopeRef = useRef(brandScope);
  const periodScopeRef = useRef(periodScope);
  brandScopeRef.current = brandScope;
  periodScopeRef.current = periodScope;

  const commit = (list) => { minutesRef.current = list; setAllMinutes(list); };

  // The brand's whole record, once per brand. The period filter used to go to
  // the API, which is what made a to-do vanish whenever the dashboard range
  // did not cover the day its meeting took place.
  useEffect(() => {
    let alive = true;
    setTaskError(null);
    if (!filters.brandId) { commit([]); setStatus('idle'); return undefined; }
    setStatus('loading');
    api.get(`/brands/${filters.brandId}/minutes`)
      .then(({ data }) => {
        if (!alive) return;
        const list = data.minutes ?? [];
        commit(list);
        confirmedRef.current = new Map(list.map((minute) => [minute.id, minute.completed_task_keys ?? []]));
        setStatus('ready');
      })
      .catch(() => { if (alive) { commit([]); setStatus('error'); } });
    return () => { alive = false; };
  }, [filters.brandId, reloadKey]);

  const periodMinutes = useMemo(() => allMinutes.filter((minute) =>
    (!filters.startDate || minute.meeting_date >= filters.startDate)
    && (!filters.endDate || minute.meeting_date <= filters.endDate)), [allMinutes, filters.startDate, filters.endDate]);
  const periodIds = periodMinutes.map((minute) => minute.id).join(',');

  // Recap choice and the Gemini summary are period readings: a new brand or
  // range starts from "every meeting in range" with no summary carried over.
  // Keyed on the id list, so ticking a task (same ids) never resets them.
  useEffect(() => {
    setSelected(periodIds ? periodIds.split(',').map(Number) : []);
    setAiSummary(null); setAiError(''); setOpenRecaps(new Set());
  }, [periodIds, filters.brandId]);

  const activeTasks = useMemo(() => allMinutes.reduce((count, minute) => { const stats = taskStats(minute); return count + stats.total - stats.done; }, 0), [allMinutes]);
  const stale = aiSummary && !sameIds(aiSummary.ids, selected);
  const periodLabel = `${dateLabel(filters.startDate)} – ${dateLabel(filters.endDate)}`;

  const toggleTask = (minuteId, key, checked) => {
    if (isViewOnly) return;
    const requestScope = brandScopeRef.current;
    const current = minutesRef.current.find((minute) => minute.id === minuteId);
    if (!current) return;
    const set = new Set(current.completed_task_keys ?? []);
    if (checked) set.add(key); else set.delete(key);
    const keys = [...set];
    commit(minutesRef.current.map((minute) => (minute.id === minuteId ? { ...minute, completed_task_keys: keys } : minute)));
    setTaskError(null);
    const seq = (seqRef.current.get(minuteId) ?? 0) + 1;
    seqRef.current.set(minuteId, seq);
    const settle = (serverKeys) => commit(minutesRef.current.map((minute) => (minute.id === minuteId ? { ...minute, completed_task_keys: serverKeys } : minute)));
    api.patch(`/brands/${filters.brandId}/minutes/${minuteId}/tasks`, { completed_task_keys: keys })
      .then(({ data }) => {
        if (brandScopeRef.current !== requestScope) return;
        const serverKeys = data.minute?.completed_task_keys ?? keys;
        confirmedRef.current.set(minuteId, serverKeys);
        if (seqRef.current.get(minuteId) === seq) settle(serverKeys);
      })
      .catch(() => {
        if (brandScopeRef.current !== requestScope || seqRef.current.get(minuteId) !== seq) return;
        settle(confirmedRef.current.get(minuteId) ?? []);
        setTaskError({ minuteId, key, checked });
      });
  };

  const generate = async () => {
    if (!selected.length || generating || isViewOnly) return;
    const requestScope = periodScopeRef.current;
    const ids = [...selected];
    setGenerating(true); setAiError('');
    try {
      const { data } = await api.post(`/brands/${filters.brandId}/minutes/summary`, { minute_ids: ids });
      if (periodScopeRef.current !== requestScope) return;
      setAiSummary({ content: data.summary, brandName: data.brand_name, ids, generatedAt: new Date() });
      setSummaryOpen(true);
    } catch (err) {
      if (periodScopeRef.current === requestScope) setAiError(err?.response?.data?.message || err?.response?.data?.error || 'Gemini gagal membuat ringkasan. Coba lagi.');
    } finally {
      setGenerating(false);
    }
  };

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryToText(aiSummary.content));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setAiError('Teks belum bisa disalin otomatis oleh browser. Pilih teks ringkasan secara manual.');
    }
  };

  const download = async () => {
    if (!aiSummary) return;
    setDownloading(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const width = doc.internal.pageSize.getWidth();
      const height = doc.internal.pageSize.getHeight();
      const margin = 48;
      const measure = width - margin * 2;
      let y = margin;
      const ensure = (space) => { if (y + space > height - margin) { doc.addPage(); y = margin; } };

      doc.setFillColor(30, 62, 184); doc.rect(0, 0, width, 5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(15, 26, 58);
      doc.text('Minutes of Meeting — Ringkasan', margin, y + 12); y += 32;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90, 106, 144);
      const usedDates = allMinutes.filter((minute) => aiSummary.ids.includes(minute.id)).map((minute) => dateLabel(minute.meeting_date)).join(', ');
      [
        `Brand: ${aiSummary.brandName ?? '—'}`,
        `Periode dashboard: ${periodLabel}`,
        ...doc.splitTextToSize(`Meeting yang dirangkum (${aiSummary.ids.length}): ${usedDates}`, measure),
        `Dibuat: ${aiSummary.generatedAt.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`,
      ].forEach((line) => { doc.text(line, margin, y); y += 13; });
      y += 6; doc.setDrawColor(221, 226, 238); doc.line(margin, y, width - margin, y); y += 20;

      for (const [key, label] of AI_SECTIONS) {
        const value = aiSummary.content[key];
        if (!hasValue(value)) continue;
        ensure(40);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(30, 62, 184);
        doc.text(label.toUpperCase(), margin, y); y += 15;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(15, 26, 58);
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
          const bullet = Array.isArray(value);
          const rows = doc.splitTextToSize(String(item), bullet ? measure - 14 : measure);
          rows.forEach((row, index) => {
            ensure(15);
            if (bullet && index === 0) doc.text('•', margin, y);
            doc.text(row, bullet ? margin + 14 : margin, y);
            y += 15;
          });
          y += bullet ? 3 : 0;
        }
        y += 12;
      }

      const pages = doc.internal.getNumberOfPages();
      for (let page = 1; page <= pages; page += 1) {
        doc.setPage(page);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 132, 160);
        doc.text('ATLAS · MIL Digital', margin, height - 24);
        doc.text(`Halaman ${page} dari ${pages}`, width - margin, height - 24, { align: 'right' });
      }
      const slug = (aiSummary.brandName ?? 'brand').replace(/[^\w-]+/g, '-').replace(/-+/g, '-');
      doc.save(`MOM-${slug}-${filters.startDate}_${filters.endDate}.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  // Hands the brand and the MOM tab to Pengaturan Brand, so "Kelola catatan"
  // lands on this brand's meetings rather than wherever that page was last left.
  const openInSettings = () => {
    try {
      sessionStorage.setItem(sessionKey('brand-settings:view'), JSON.stringify('mom'));
      if (filters.brandId) sessionStorage.setItem(sessionKey('brand-settings:brand'), JSON.stringify(Number(filters.brandId)));
    } catch { /* storage blocked — the link still navigates */ }
  };

  const collapsedLine = !filters.brandId
    ? 'Pilih brand untuk melihat catatan meeting'
    : status === 'loading' ? 'Memuat catatan meeting…'
      : status === 'error' ? 'Catatan meeting gagal dimuat'
        : `${periodMinutes.length} meeting di periode · ${activeTasks} tugas aktif dari semua meeting`;

  return (
    <section className={`mom-dashboard${open ? ' is-open' : ''}`} aria-labelledby="mom-dashboard-title">
      <header className="mom-dashboard-head">
        <div className="mom-head-main">
          <h2 id="mom-dashboard-title" className="mom-head-title">
            <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-controls="mom-dashboard-body">
              <span className="brand-ds-chev" aria-hidden="true"><ChevronDown size={16} /></span>
              <span className="mom-head-icon" aria-hidden="true"><UsersRound size={16} /></span>
              <span>Minutes of Meeting</span>
            </button>
          </h2>
          <p>{open ? 'Recap mengikuti periode dashboard; to do list menampilkan semua tugas yang belum selesai.' : collapsedLine}</p>
        </div>
        <div className="mom-head-meta">
          {status === 'ready' && allMinutes.length > 0 && <span className="brand-section-meta"><CalendarDays size={12} /> Terbaru {dateLabel(allMinutes[0].meeting_date)}</span>}
          {status === 'ready' && <span className="brand-section-meta">{periodMinutes.length} meeting di periode</span>}
          {status === 'ready' && activeTasks > 0 && <span className="brand-section-meta is-tasks">{activeTasks} tugas aktif</span>}
          <Link to="/pengaturan-brand" className="mom-head-link" onClick={openInSettings}>Kelola catatan <ArrowUpRight size={13} /></Link>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="mom-dashboard-body"
            className="mom-dashboard-body"
            initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: .24, ease: DASH_EASE }}
          >
            {!filters.brandId && <div className="mom-dash-state"><UsersRound size={18} /> Pilih satu brand untuk melihat Minutes of Meeting.</div>}
            {filters.brandId && status === 'loading' && <div className="mom-dash-state"><Loader2 size={17} className="brand-spin" /> Memuat catatan meeting…</div>}
            {filters.brandId && status === 'error' && (
              <div className="mom-dash-state is-error">
                <CircleAlert size={17} /><span>Catatan meeting gagal dimuat. Periksa koneksi API, lalu coba lagi.</span>
                <button type="button" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={13} /> Coba lagi</button>
              </div>
            )}
            {filters.brandId && status === 'ready' && !allMinutes.length && (
              <div className="mom-dash-state is-empty">
                <FileText size={18} />
                <span>Belum ada catatan meeting untuk brand ini.</span>
                <Link to="/pengaturan-brand" onClick={openInSettings}>Tambah di Pengaturan Brand <ArrowUpRight size={13} /></Link>
              </div>
            )}

            {status === 'ready' && allMinutes.length > 0 && (
              <div className="mom-workspace">
                <div className="mom-summary-pane">
                  {!periodMinutes.length && (
                    <div className="mom-period-empty">
                      <FileText size={18} />
                      <span>
                        <strong>Tidak ada meeting pada {periodLabel}</strong>
                        Recap dan ringkasan AI mengikuti periode dashboard. To do list di samping tetap menampilkan semua tugas yang belum selesai dari meeting sebelumnya.
                      </span>
                    </div>
                  )}

                  {periodMinutes.length > 0 && (
                    <>
                      <div className="mom-toolbar">
                        <div className="mom-toolbar-select">
                          <SelectMenu
                            multiple label="Recap untuk diringkas" menuTitle="Recap dalam periode" icon={FileText}
                            value={selected} onChange={setSelected}
                            summary={selected.length ? `${selected.length} dari ${periodMinutes.length} recap dipilih` : 'Pilih recap'}
                            options={periodMinutes.map((minute) => ({
                              value: minute.id,
                              label: `${dateLabel(minute.meeting_date)} · ${MOM_TYPE_LABELS[minute.meeting_type]}`,
                              description: minute.meeting_recap ? recapPreview(minute.meeting_recap, 70) : 'Tanpa recap — hanya to do list',
                            }))}
                          />
                        </div>
                        <button type="button" className="btn btn-primary mom-generate" onClick={generate} disabled={isViewOnly || !selected.length || generating}>
                          {generating ? <Loader2 size={15} className="brand-spin" /> : <Sparkles size={15} />}
                          {generating ? 'Gemini sedang merangkum…' : aiSummary ? 'Buat ulang ringkasan' : 'Buat ringkasan AI'}
                        </button>
                      </div>
                      {aiError && (
                        <div className="mom-ai-error" role="alert">
                          <CircleAlert size={14} /><span>{aiError}</span>
                          <button type="button" onClick={generate} disabled={generating || !selected.length}>Coba lagi</button>
                        </div>
                      )}

                      <div className="mom-block">
                        <button type="button" className="mom-block-title" onClick={() => setSummaryOpen((current) => !current)} aria-expanded={summaryOpen}>
                          <span className="mom-block-icon" aria-hidden="true"><Brain size={15} /></span>
                          <span className="mom-block-copy">
                            <strong>Ringkasan meeting</strong>
                            <small>{aiSummary
                              ? `Dari ${aiSummary.ids.length} recap · dibuat ${aiSummary.generatedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`
                              : 'Pilih recap lalu buat ringkasan terstruktur dengan Gemini'}</small>
                          </span>
                          <span className="brand-ds-chev" aria-hidden="true"><ChevronDown size={15} /></span>
                        </button>
                        {summaryOpen && (
                          <div className="mom-block-body">
                            {!aiSummary && (
                              <div className="mom-ai-empty">
                                {generating ? <Loader2 size={20} className="brand-spin" /> : <Brain size={20} />}
                                <span>{generating
                                  ? `Gemini sedang menyusun ringkasan dari ${selected.length} recap…`
                                  : 'Ringkasan eksekutif, kesepakatan, isu terbuka, dan tindak lanjut akan tampil terstruktur di sini.'}</span>
                              </div>
                            )}
                            {aiSummary && (
                              <>
                                {stale && <p className="mom-stale"><CircleAlert size={14} /> Pilihan recap berubah sejak ringkasan ini dibuat. Buat ulang agar isinya sesuai pilihan sekarang.</p>}
                                <div className={`mom-ai-content${stale ? ' is-stale' : ''}`}>
                                  {AI_SECTIONS.map(([key, label]) => {
                                    const value = aiSummary.content[key];
                                    if (!hasValue(value)) return null;
                                    return (
                                      <section key={key}>
                                        <h3>{label}</h3>
                                        {Array.isArray(value) ? <ul>{value.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>{value}</p>}
                                      </section>
                                    );
                                  })}
                                </div>
                                <div className="brand-ds-fileacts mom-ai-actions">
                                  <button type="button" onClick={copySummary}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Tersalin' : 'Salin teks'}</button>
                                  <button type="button" onClick={download} disabled={downloading}>
                                    {downloading ? <Loader2 size={14} className="brand-spin" /> : <Download size={14} />}
                                    {downloading ? 'Menyiapkan PDF…' : 'Unduh PDF'}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="mom-block">
                        <button type="button" className="mom-block-title" onClick={() => setRecapsOpen((current) => !current)} aria-expanded={recapsOpen}>
                          <span className="mom-block-icon" aria-hidden="true"><FileText size={15} /></span>
                          <span className="mom-block-copy">
                            <strong>Recap meeting</strong>
                            <small>{periodMinutes.length} catatan dalam periode · buka untuk membaca lengkap</small>
                          </span>
                          <span className="brand-ds-chev" aria-hidden="true"><ChevronDown size={15} /></span>
                        </button>
                        {recapsOpen && (
                          <ul className="mom-recap-list">
                            {periodMinutes.map((minute) => (
                              <RecapItem
                                key={minute.id} minute={minute} open={openRecaps.has(minute.id)}
                                onToggle={() => setOpenRecaps((current) => {
                                  const next = new Set(current);
                                  if (next.has(minute.id)) next.delete(minute.id); else next.add(minute.id);
                                  return next;
                                })}
                              />
                            ))}
                          </ul>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <aside className="mom-task-rail" aria-label="To do list">
                  <div className="mom-rail-title">
                    <ListChecks size={15} />
                    <span><strong>To do list</strong><small>Semua tugas terbuka dari seluruh meeting · tidak terikat periode</small></span>
                  </div>
                  {taskError && (
                    <div className="mom-task-error" role="alert">
                      <span>Status tugas belum tersimpan.</span>
                      <button type="button" onClick={() => toggleTask(taskError.minuteId, taskError.key, taskError.checked)}>Coba lagi</button>
                    </div>
                  )}
                  <TaskBoard title="MIL" scope="mil" minutes={allMinutes} onToggle={toggleTask} />
                  <TaskBoard title="Client" scope="client" minutes={allMinutes} onToggle={toggleTask} />
                </aside>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export default function DashboardPage() {
  // View first, domain second. The top bar holds Executive Snapshot and the
  // three channels; only a channel has domains beneath it. The session key is
  // unchanged, so a session that remembered 'shopee' still opens on Shopee.
  const [viewId, setViewId] = useSessionState('dashboard:channel', 'snapshot');
  const [activeKey, setActiveKey] = useSessionState('dashboard:section', 'Business Growth');
  const [productLevel, setProductLevel] = useSessionState('dashboard:product-level', 'category');
  const reduceMotion = useReducedMotion();

  const [filters, setFilters] = useSessionState('dashboard:filters', {
    brandId: '',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    compare: false,
    compareStartDate: '',
    compareEndDate: '',
  });

  const { read, retry } = useConsoleData({ filters, activeKey, productLevel });

  const view = VIEW_BY_ID[viewId] ?? EXECUTIVE_VIEW;
  const isSnapshot = view.id === EXECUTIVE_VIEW.id;
  const channel = isSnapshot ? null : CHANNEL_BY_ID[view.id];
  const channelDomains = channel ? CHANNEL_DOMAINS[channel.id] : [];
  const domainKey = channelDomains.some((d) => d.key === activeKey)
    ? activeKey
    : (channelDomains[0]?.key ?? activeKey);
  const active = DOMAIN_BY_KEY[domainKey];
  const activeEntry = read(domainKey);

  // Only a channel view owns the domain selection. The snapshot leaves the
  // remembered domain untouched, so coming back to a channel lands where it
  // was left rather than resetting to the first tab.
  useEffect(() => {
    if (!isSnapshot && domainKey !== activeKey) setActiveKey(domainKey);
  }, [isSnapshot, domainKey, activeKey, setActiveKey]);

  return (
    <div className="con dashboard-console">
      <header className="brand-hero dashboard-hero">
        <span className="brand-hero-fx" aria-hidden="true"><i className="brand-hero-aurora" /><i className="brand-hero-grid" /></span>

        <div className="brand-hero-main dashboard-hero-main">
          <motion.div
            className="brand-hero-copy"
            initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: .4, ease: DASH_EASE }}
          >
            <span className="brand-hero-eye"><Sparkles size={13} /> Business intelligence workspace</span>
            <h1>Dashboard Business Overview</h1>
            <p>Executive Snapshot merangkum seluruh channel; tab di sebelahnya membuka pembacaan mendalam per channel — Meta Ads, Shopee, dan TikTok.</p>
            <div className="brand-hero-stats">
              <span><strong>{CHANNELS.length}</strong> channel</span>
              <span><strong>{CHANNEL_DOMAINS.shopee.length}</strong> domain per channel</span>
              <span><strong>{filters.compare ? '2' : '1'}</strong> periode dibaca</span>
            </div>
          </motion.div>

          <motion.div
            className="brand-hero-badge" aria-hidden="true"
            initial={reduceMotion ? false : { opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: .45, ease: DASH_EASE, delay: .06 }}
          >
            <span className="brand-hero-ring" /><span className="brand-hero-ring brand-hero-ring-b" />
            <img src={atlasIcon} alt="" className="brand-hero-mark" />
            <img src={atlasWordmark} alt="" className="brand-hero-logo" />
            <small>Business intelligence</small>
          </motion.div>
        </div>

        <div className="brand-dock dashboard-dock">
          <div className="dashboard-dock-copy">
            <span><BarChart3 size={15} /> Ruang lingkup analisis</span>
            <small>Brand dan periode berikut menjadi dasar seluruh angka di bawah.</small>
          </div>
          <FilterPanel filters={filters} onChange={setFilters} />
        </div>
      </header>

      <LayoutGroup id="dashboard-view-nav">
        <div className="section-nav-shell is-four">
        <nav className="brand-view-nav dashboard-channel-nav" aria-label="Tampilan" role="tablist">
          {VIEWS.map((v) => {
            const isActive = v.id === view.id;
            const Icon = v.Icon;
            return (
              <button
                type="button" role="tab" key={v.id}
                className={`brand-view-tab${isActive ? ' is-active' : ''}`}
                style={{ '--ch-accent': v.accent }}
                onClick={() => setViewId(v.id)}
                aria-selected={isActive}
              >
                {isActive && (
                  <motion.span
                    className="brand-view-pill"
                    layoutId="dashboard-active-view"
                    transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 44, mass: .6 }}
                  />
                )}
                <span className="brand-view-tab-ico" aria-hidden="true"><Icon size={16} /></span>
                <span className="brand-view-tab-copy">
                  <strong>{v.label}</strong>
                  <small>{v.hint}{!v.ready && <span className="dashboard-channel-soon">belum ada data</span>}</small>
                </span>
              </button>
            );
          })}
        </nav>
        </div>
      </LayoutGroup>

      <div className={isSnapshot ? undefined : "channel-workspace"} style={channel ? { '--ch-accent': channel.accent } : undefined}>
      {!isSnapshot && (
      <LayoutGroup id="dashboard-domain-nav">
        <div className="section-nav-shell is-dashboard channel-domain-rail">
        <h2 className="channel-rail-title">Analisis {channel.label}</h2>
        <nav className="brand-view-nav dashboard-domain-nav" aria-label="Domain analisis" role="tablist">
          {channelDomains.map((d) => {
            const entry = channel.ready ? read(d.key) : { status: 'idle' };
            const isActive = d.key === domainKey;
            const stateLabel = !channel.ready ? 'Belum ada data'
              : entry.status === 'ready' ? 'Siap dibaca'
                : entry.status === 'loading' ? 'Memuat…'
                  : entry.status === 'error' ? 'Gagal dimuat' : 'Belum dimuat';
            return (
              <button
                type="button"
                role="tab"
                key={d.key}
                className={`brand-view-tab dashboard-domain-tab${isActive ? ' is-active' : ''}`}
                onClick={() => setActiveKey(d.key)}
                aria-selected={isActive}
                title={d.label}
              >
                {isActive && (
                  <motion.span
                    className="brand-view-pill"
                    layoutId="dashboard-active-domain"
                    transition={reduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 520, damping: 44, mass: .6 }}
                  />
                )}
                <span className="brand-view-tab-copy">
                  <strong>{d.label}</strong>
                  <small>
                    <span
                      className={`dashboard-domain-dot${entry.status === 'ready' ? ' is-ready' : ''}${entry.status === 'loading' ? ' is-loading' : ''}${entry.status === 'error' ? ' is-error' : ''}`}
                      aria-hidden
                    />
                    {stateLabel}
                  </small>
                </span>
              </button>
            );
          })}
        </nav>
        </div>
      </LayoutGroup>
      )}

      <div className="dashboard-domain-caption">
        <span>{isSnapshot ? EXECUTIVE_VIEW.question : channel.ready ? active.question : channel.note}</span>
        <span className="brand-caption-rule" />
        <Link to="/pengaturan-brand"><Database size={13} /> Data bersumber dari <strong>Pengaturan Brand</strong></Link>
      </div>

      <div className="con-body dashboard-body">
        <div className="con-canvas">
          {isSnapshot ? (
            <>
              {/* Both readings here are brand-level rather than per-channel:
                  the snapshot is the sum of the channels, and a meeting record
                  answers to the brand. That is why they live on this view
                  instead of repeating above every channel. */}
              <ExecutiveSummary filters={filters} />
              <MinutesOverview filters={filters} />
            </>
          ) : (
            <>
              {channel.ready && <KpiStrip entry={read('Executive Snapshot')} />}

              <section className="con-focus channel-analysis" aria-labelledby="con-focus-title">
                <div className="con-focus-head">
                  <h2 id="con-focus-title">
                    <span className="con-focus-channel" style={{ '--ch-accent': channel.accent }}>
                      <i aria-hidden="true" />{channel.label}
                    </span>
                    {active.label}
                  </h2>
                  <p className="con-focus-q">{channel.ready ? active.question : channel.hint}</p>
                </div>
                {channel.ready ? (
                  // Keyed on the domain so the settle animation replays on every
                  // exchange, and so a domain's local view state never leaks into
                  // the next one.
                  <div className="con-focus-body" key={`${channel.id}:${domainKey}`} data-anim={reduceMotion ? undefined : 'in'}>
                    <DashboardTab
                      activeTab={domainKey}
                      filters={filters}
                      data={activeEntry.data}
                      status={activeEntry.status}
                      error={activeEntry.error}
                      onRetry={() => retry(domainKey)}
                      productPerformanceLevel={productLevel}
                      setProductPerformanceLevel={setProductLevel}
                      onNavigateTab={setActiveKey}
                    />
                  </div>
                ) : (
                  // An empty state that says what has to happen, not just that
                  // nothing is here. The steps are a real sequence — the file
                  // has to land before the importer can fill the domains.
                  <div className="con-focus-body channel-pending">
                    <div className="channel-pending-main">
                      <span className="channel-pending-ico" style={{ '--ch-accent': channel.accent }} aria-hidden="true">
                        <Database size={20} />
                      </span>
                      <div>
                        <strong>{channel.label} belum punya data terimpor</strong>
                        <p>{channel.note}</p>
                      </div>
                    </div>
                    <ol className="channel-pending-steps">
                      <li>Unggah file {channel.label} pada Pengaturan Brand</li>
                      <li>Importer memindahkannya ke tabel fakta</li>
                      <li>Seluruh domain {channel.label} di atas ikut terisi</li>
                    </ol>
                    <p className="channel-pending-note">
                      Belanja iklan {channel.label} yang sudah diisi di Daily Tracking tetap terbaca pada Executive Snapshot.
                    </p>
                    <Link to="/pengaturan-brand" className="mom-head-link">Buka Pengaturan Brand <ArrowUpRight size={13} /></Link>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
