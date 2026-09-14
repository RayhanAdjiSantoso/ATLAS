import useSessionState, { sessionKey } from '../hooks/useSessionState.js';
import { Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUp, ArrowDown, ArrowUpRight, Minus, ArrowRight, BarChart3, Brain, CalendarDays, Check, CheckCircle2, ChevronDown, Circle,
  CircleAlert, Copy, Database, Download, FileText, ListChecks, Loader2, RefreshCw, Sparkles, UsersRound,
} from 'lucide-react';
import FilterPanel from '../components/dashboard/FilterPanel.jsx';
import DashboardTab from '../components/dashboard/DashboardTab.jsx';
import { useConsoleData } from '../components/dashboard/useConsoleData.js';
import {
  DOMAINS,
  DOMAIN_BY_KEY,
  HEADLINES,
  STRIP_METRICS,
  formatStripValue,
} from '../components/dashboard/domains.js';
import '../components/dashboard/console.css';
import atlasIcon from '../assets/atlas-icon.png';
import atlasWordmark from '../assets/atlas-wordmark.png';
import api from '../api/client';
import SelectMenu from '../components/common/SelectMenu.jsx';
import { MOM_TYPE_LABELS, dateLabel, longDateLabel, parseISO, recapPreview, taskGroups, taskStats } from '../components/mom/momModel.js';

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

// Absent and zero must never look alike: a missing figure is an em dash in the
// muted tier that says why on hover, a real zero prints like any other number.
function Figure({ text, absentReason }) {
  if (text == null) {
    return (
      <span className="con-null" title={absentReason || 'Data belum tersedia untuk periode ini'}>
        &mdash;
      </span>
    );
  }
  return <>{text}</>;
}

// Colour carries meaning here and nowhere else on this page. The arrow always
// follows the raw sign; the colour follows the business reading, so a rising
// cancellation rate is red even though the number went up.
function Delta({ value, invert = false }) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const flat = Math.abs(n) < 0.05;
  const rising = n > 0;
  const good = invert ? !rising : rising;
  const cls = flat ? 'is-flat' : good ? 'is-up' : 'is-down';
  const Icon = flat ? Minus : rising ? ArrowUp : ArrowDown;

  return (
    <span className={`con-delta ${cls}`}>
      <Icon size={11} strokeWidth={2.6} />
      {`${n > 0 ? '+' : ''}${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(n)}%`}
    </span>
  );
}

// Bare trend line for the GMV cell. No axes, no tooltip and no library: the
// full daily chart is one click away in Business Growth, and this only has to
// say which way the month went.
function Spark({ values = [] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = span > 0 ? 20 - ((v - min) / span) * 20 : 10;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <svg className="con-spark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden focusable="false">
      <polyline points={points} fill="none" stroke="var(--acc-300)" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
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
              {m.note && <span className="con-kpi-note" title={m.note} aria-label={m.note}>i</span>}
            </div>
            <div className="con-kpi-val">
              {loading ? <span className="con-skel is-wide" /> : <Figure text={text} />}
            </div>
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

function TaskBoard({ title, scope, minute, onToggle }) {
  const groups = taskGroups(minute?.[scope === 'mil' ? 'todo_mil' : 'todo_client'], scope);
  const done = new Set(minute?.completed_task_keys ?? []);
  const total = groups.reduce((count, group) => count + group.tasks.length, 0);
  const openGroups = groups.map((group) => ({ ...group, tasks: group.tasks.filter((task) => !done.has(task.key)) })).filter((group) => group.tasks.length);
  const completed = groups.flatMap((group) => group.tasks.map((task) => ({ ...task, person: group.name }))).filter((task) => done.has(task.key));
  const pct = total ? Math.round((completed.length / total) * 100) : 0;

  return (
    <section className="mom-task-board">
      <div className="mom-task-head">
        <span>{title}</span>
        <small>{total ? `${total - completed.length} aktif · ${completed.length} selesai` : 'Tidak ada tugas'}</small>
      </div>
      {total > 0 && (
        <div className="mom-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Progres tugas ${title}`}>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      {!total && <p className="mom-dash-empty">Catatan ini tidak memuat tugas untuk {title}.</p>}
      {total > 0 && !openGroups.length && <p className="mom-dash-done"><CheckCircle2 size={14} /> Semua tugas {title} sudah selesai.</p>}
      {openGroups.map((group) => (
        <div className="mom-assignee" key={group.name}>
          <strong><span aria-hidden="true" />{group.name}</strong>
          <ul>
            {group.tasks.map((task) => (
              <li key={task.key}>
                <button type="button" onClick={() => onToggle(task.key, true)} aria-label={`Tandai selesai: ${task.text}`}><Circle size={15} /></button>
                <span>{task.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {completed.length > 0 && (
        <details className="mom-done">
          <summary><CheckCircle2 size={14} /> Sudah dilakukan <span>{completed.length}</span><ChevronDown size={14} /></summary>
          <ul>
            {completed.map((task) => (
              <li key={task.key}>
                <button type="button" onClick={() => onToggle(task.key, false)} aria-label={`Kembalikan ke aktif: ${task.text}`}><CheckCircle2 size={15} /></button>
                <span><small>{task.person}</small>{task.text}</span>
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
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useSessionState('dashboard:mom-open', true);
  const [minutes, setMinutes] = useState([]);
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
  const [sourceId, setSourceId] = useState(null);
  const [taskError, setTaskError] = useState(null);

  // Task writes are optimistic and can overlap. The refs hold the latest list
  // (so a second click builds on the first, not on a stale render), the last
  // server-confirmed keys per record (the rollback target), and a sequence per
  // record so only the newest response is allowed to settle the UI.
  const minutesRef = useRef([]);
  const confirmedRef = useRef(new Map());
  const seqRef = useRef(new Map());
  const scope = `${filters.brandId}|${filters.startDate}|${filters.endDate}|${reloadKey}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const commit = (list) => { minutesRef.current = list; setMinutes(list); };

  useEffect(() => {
    let alive = true;
    // A summary, a failed request or a task source from the previous brand or
    // period must not survive into this one — the old code kept showing the
    // last brand's Gemini summary after the brand filter changed.
    setAiSummary(null); setAiError(''); setTaskError(null); setSourceId(null); setOpenRecaps(new Set());
    if (!filters.brandId) { commit([]); setSelected([]); setStatus('idle'); return undefined; }
    setStatus('loading');
    api.get(`/brands/${filters.brandId}/minutes`, { params: { startDate: filters.startDate, endDate: filters.endDate } })
      .then(({ data }) => {
        if (!alive) return;
        const list = data.minutes ?? [];
        commit(list);
        confirmedRef.current = new Map(list.map((minute) => [minute.id, minute.completed_task_keys ?? []]));
        setSelected(list.map((minute) => minute.id));
        setStatus('ready');
      })
      .catch(() => { if (alive) { commit([]); setStatus('error'); } });
    return () => { alive = false; };
  }, [filters.brandId, filters.startDate, filters.endDate, reloadKey]);

  const source = minutes.find((minute) => minute.id === sourceId) ?? minutes[0];
  const activeTasks = useMemo(() => minutes.reduce((count, minute) => { const stats = taskStats(minute); return count + stats.total - stats.done; }, 0), [minutes]);
  const stale = aiSummary && !sameIds(aiSummary.ids, selected);
  const periodLabel = `${dateLabel(filters.startDate)} – ${dateLabel(filters.endDate)}`;

  const toggleTask = (minuteId, key, checked) => {
    const requestScope = scopeRef.current;
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
        if (scopeRef.current !== requestScope) return;
        const serverKeys = data.minute?.completed_task_keys ?? keys;
        confirmedRef.current.set(minuteId, serverKeys);
        if (seqRef.current.get(minuteId) === seq) settle(serverKeys);
      })
      .catch(() => {
        if (scopeRef.current !== requestScope || seqRef.current.get(minuteId) !== seq) return;
        settle(confirmedRef.current.get(minuteId) ?? []);
        setTaskError({ minuteId, key, checked });
      });
  };

  const generate = async () => {
    if (!selected.length || generating) return;
    const requestScope = scopeRef.current;
    const ids = [...selected];
    setGenerating(true); setAiError('');
    try {
      const { data } = await api.post(`/brands/${filters.brandId}/minutes/summary`, { minute_ids: ids });
      if (scopeRef.current !== requestScope) return;
      setAiSummary({ content: data.summary, brandName: data.brand_name, ids, generatedAt: new Date() });
      setSummaryOpen(true);
    } catch (err) {
      if (scopeRef.current === requestScope) setAiError(err?.response?.data?.message || err?.response?.data?.error || 'Gemini gagal membuat ringkasan. Coba lagi.');
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
      const usedDates = minutes.filter((minute) => aiSummary.ids.includes(minute.id)).map((minute) => dateLabel(minute.meeting_date)).join(', ');
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
        : `${minutes.length} meeting · ${activeTasks} tugas aktif · ${periodLabel}`;

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
          <p>{open ? 'Recap keputusan dan tindak lanjut dalam periode dashboard.' : collapsedLine}</p>
        </div>
        <div className="mom-head-meta">
          {status === 'ready' && minutes.length > 0 && <span className="brand-section-meta"><CalendarDays size={12} /> Terbaru {dateLabel(minutes[0].meeting_date)}</span>}
          {status === 'ready' && <span className="brand-section-meta">{minutes.length} meeting</span>}
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
            {filters.brandId && status === 'ready' && !minutes.length && (
              <div className="mom-dash-state is-empty">
                <FileText size={18} />
                <span>Belum ada catatan meeting pada {periodLabel}.</span>
                <Link to="/pengaturan-brand" onClick={openInSettings}>Tambah di Pengaturan Brand <ArrowUpRight size={13} /></Link>
              </div>
            )}

            {status === 'ready' && minutes.length > 0 && source && (
              <div className="mom-workspace">
                <div className="mom-summary-pane">
                  <div className="mom-toolbar">
                    <div className="mom-toolbar-select">
                      <SelectMenu
                        multiple label="Recap untuk diringkas" menuTitle="Recap dalam periode" icon={FileText}
                        value={selected} onChange={setSelected}
                        summary={selected.length ? `${selected.length} dari ${minutes.length} recap dipilih` : 'Pilih recap'}
                        options={minutes.map((minute) => ({
                          value: minute.id,
                          label: `${dateLabel(minute.meeting_date)} · ${MOM_TYPE_LABELS[minute.meeting_type]}`,
                          description: minute.meeting_recap ? recapPreview(minute.meeting_recap, 70) : 'Tanpa recap — hanya to do list',
                        }))}
                      />
                    </div>
                    <button type="button" className="btn btn-primary mom-generate" onClick={generate} disabled={!selected.length || generating}>
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
                        <small>{minutes.length} catatan dalam periode · buka untuk membaca lengkap</small>
                      </span>
                      <span className="brand-ds-chev" aria-hidden="true"><ChevronDown size={15} /></span>
                    </button>
                    {recapsOpen && (
                      <ul className="mom-recap-list">
                        {minutes.map((minute) => (
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
                </div>

                <aside className="mom-task-rail" aria-label="To do list">
                  <div className="mom-rail-title">
                    <ListChecks size={15} />
                    <span><strong>To do list</strong><small>{source.id === minutes[0].id ? 'Dari catatan meeting terbaru' : `Dari meeting ${dateLabel(source.meeting_date)}`}</small></span>
                  </div>
                  {minutes.length > 1 && (
                    <div className="mom-rail-source">
                      <SelectMenu
                        label="Sumber to do list" menuTitle="Pilih catatan meeting" icon={CalendarDays}
                        value={source.id} onChange={setSourceId}
                        options={minutes.map((minute, index) => {
                          const stats = taskStats(minute);
                          return {
                            value: minute.id,
                            label: `${dateLabel(minute.meeting_date)}${index === 0 ? ' · terbaru' : ''}`,
                            description: `${MOM_TYPE_LABELS[minute.meeting_type]} · ${stats.total ? `${stats.total - stats.done} tugas aktif` : 'tanpa tugas'}`,
                          };
                        })}
                      />
                    </div>
                  )}
                  {taskError && (
                    <div className="mom-task-error" role="alert">
                      <span>Status tugas belum tersimpan.</span>
                      <button type="button" onClick={() => toggleTask(taskError.minuteId, taskError.key, taskError.checked)}>Coba lagi</button>
                    </div>
                  )}
                  <TaskBoard title="MIL" scope="mil" minute={source} onToggle={(key, checked) => toggleTask(source.id, key, checked)} />
                  <TaskBoard title="Client" scope="client" minute={source} onToggle={(key, checked) => toggleTask(source.id, key, checked)} />
                </aside>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function ModuleCard({ domain, entry, onOpen, index = 0 }) {
  // Domains kept out of the idle prefetch (e.g. Root Cause Analysis, which
  // costs several queries per period) sit at status 'idle' until opened —
  // that must read as "open to load", not a skeleton that never resolves.
  const deferred = domain.prefetch === false && entry.status === 'idle';
  const loading = !deferred && (entry.status === 'loading' || entry.status === 'idle');
  const failed = entry.status === 'error';
  const headline = entry.status === 'ready' ? HEADLINES[domain.key](entry.data) : null;

  return (
    <button type="button" className="con-mod" onClick={onOpen} style={{ '--i': index }}>
      <div className="con-mod-top">{domain.label}</div>

      <div className="con-mod-val">
        {loading && <span className="con-skel is-wide" />}
        {failed && <span className="con-null" title={entry.error}>&mdash;</span>}
        {deferred && <span className="con-null" title="Belum dimuat">&mdash;</span>}
        {headline && <Figure text={headline.value} absentReason={headline.caption} />}
      </div>

      <div className="con-mod-cap">
        {loading && <span className="con-skel is-narrow" style={{ height: '.7rem' }} />}
        {failed && 'Gagal dimuat. Buka domain ini untuk mencoba lagi.'}
        {deferred && domain.question}
        {headline && headline.caption}
      </div>

      <div className="con-mod-foot">
        {headline?.delta != null ? <Delta value={headline.delta} /> : <span>Buka analisis</span>}
        <ArrowRight size={13} strokeWidth={2.4} />
      </div>
    </button>
  );
}

export default function DashboardPage() {
  const [activeKey, setActiveKey] = useSessionState('dashboard:section', 'Executive Snapshot');
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

  const active = DOMAIN_BY_KEY[activeKey];
  const activeEntry = read(activeKey);
  const others = DOMAINS.filter((d) => d.key !== activeKey);

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
            <p>Delapan sudut analisis untuk membaca pertumbuhan, pelanggan, transaksi, produk, dan akar perubahan dalam satu ruang kerja.</p>
            <div className="brand-hero-stats">
              <span><strong>{DOMAINS.length}</strong> domain analisis</span>
              <span><strong>{filters.compare ? '2' : '1'}</strong> periode dibaca</span>
              <span><strong>Shopee</strong> sumber data</span>
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

      <LayoutGroup id="dashboard-domain-nav">
        <div className="section-nav-shell is-dashboard">
        <nav className="brand-view-nav dashboard-domain-nav" aria-label="Domain analisis" role="tablist">
          {DOMAINS.map((d) => {
            const entry = read(d.key);
            const isActive = d.key === activeKey;
            const Icon = d.Icon;
            // The dot used to carry load state alone; it now says it in words
            // too, which also gives every tab a second line of real content.
            const stateLabel = entry.status === 'ready' ? 'Siap dibaca'
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
                <span className="brand-view-tab-ico" aria-hidden="true"><Icon size={16} /></span>
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

      <div className="dashboard-domain-caption">
        <span>{active.question}</span>
        <span className="brand-caption-rule" />
        <Link to="/pengaturan-brand"><Database size={13} /> Data bersumber dari <strong>Pengaturan Brand</strong></Link>
      </div>

      <div className="con-body dashboard-body">
        <div className="con-canvas">
          <KpiStrip entry={read('Executive Snapshot')} />
          <MinutesOverview filters={filters} />

          <section className="con-focus" aria-labelledby="con-focus-title">
            <div className="con-focus-head">
              <h2 id="con-focus-title">{active.label}</h2>
              <p className="con-focus-q">{active.question}</p>
            </div>
            {/* Keyed on the domain so the settle animation replays on every
                exchange, and so a domain's local view state never leaks into
                the next one. */}
            <div className="con-focus-body" key={activeKey} data-anim={reduceMotion ? undefined : 'in'}>
              <DashboardTab
                activeTab={activeKey}
                filters={filters}
                data={activeEntry.data}
                status={activeEntry.status}
                error={activeEntry.error}
                onRetry={() => retry(activeKey)}
                productPerformanceLevel={productLevel}
                setProductPerformanceLevel={setProductLevel}
                onNavigateTab={setActiveKey}
              />
            </div>
          </section>

          <div className="con-mods" key={activeKey} data-anim={reduceMotion ? undefined : 'in'}>
            {others.map((d, i) => (
              <ModuleCard
                key={d.key}
                index={i}
                domain={d}
                entry={read(d.key)}
                onOpen={() => setActiveKey(d.key)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
