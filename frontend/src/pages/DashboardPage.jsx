import useSessionState from '../hooks/useSessionState.js';
import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, ArrowDown, Minus, ArrowRight, BarChart3, Brain, CalendarDays, Check, CheckCircle2, ChevronDown, Circle, Database, Download, FileText, ListChecks, Loader2, Sparkles, UsersRound } from 'lucide-react';
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

const MOM_TYPE_LABELS = { regular: 'Meeting reguler', non_regular: 'Meeting non reguler', whatsapp_quick_call: 'WhatsApp (quick call)' };
const lines = (value) => (value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
const dateLabel = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

function taskGroups(value, scope) {
  const groups = [];
  let current = { name: 'Tanpa PIC', tasks: [] };
  for (const raw of lines(value)) {
    const clean = raw.replace(/^[-•✓]\s*/, '');
    if (/^[^:]{1,60}:$/.test(clean)) {
      if (current.tasks.length) groups.push(current);
      current = { name: clean.slice(0, -1).trim(), tasks: [] };
    } else current.tasks.push({ text: clean, key: `${scope}|${current.name}|${clean}`.toLowerCase() });
  }
  if (current.tasks.length) groups.push(current);
  return groups;
}

function TaskBoard({ title, scope, minute, onToggle }) {
  const groups = taskGroups(minute?.[scope === 'mil' ? 'todo_mil' : 'todo_client'], scope);
  const done = new Set(minute?.completed_task_keys ?? []);
  const openGroups = groups.map((group) => ({ ...group, tasks: group.tasks.filter((task) => !done.has(task.key)) })).filter((group) => group.tasks.length);
  const completed = groups.flatMap((group) => group.tasks.map((task) => ({ ...task, person: group.name }))).filter((task) => done.has(task.key));
  return <section className="mom-task-board">
    <div className="mom-task-head"><span>{title}</span><small>{groups.flatMap((g) => g.tasks).length - completed.length} aktif</small></div>
    {!openGroups.length && <p className="mom-dash-empty">Tidak ada tindak lanjut aktif.</p>}
    {openGroups.map((group) => <div className="mom-assignee" key={group.name}><strong><span />{group.name}</strong><ul>{group.tasks.map((task) => <li key={task.key}><button type="button" onClick={() => onToggle(task.key, true)} aria-label={`Tandai selesai: ${task.text}`}><Circle size={15} /></button><span>{task.text}</span></li>)}</ul></div>)}
    {completed.length > 0 && <details className="mom-done"><summary><CheckCircle2 size={14} /> Sudah dilakukan <span>{completed.length}</span><ChevronDown size={14} /></summary><ul>{completed.map((task) => <li key={task.key}><button type="button" onClick={() => onToggle(task.key, false)} aria-label={`Kembalikan ke aktif: ${task.text}`}><CheckCircle2 size={15} /></button><span><small>{task.person}</small>{task.text}</span></li>)}</ul></details>}
  </section>;
}

const AI_SECTIONS = [
  ['diagnosis', 'Ringkasan eksekutif'], ['objective_alignment', 'Keputusan & kesepakatan'],
  ['winning', 'Poin utama'], ['challenge', 'Isu terbuka'], ['strategic_direction', 'Langkah berikutnya'],
  ['action_items', 'Tindak lanjut'], ['risks', 'Risiko'], ['data_gaps', 'Konteks yang masih dibutuhkan'],
];

function MinutesOverview({ filters }) {
  const [minutes, setMinutes] = useState([]);
  const [status, setStatus] = useState('idle');
  const [selected, setSelected] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiError, setAiError] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [taskSaveError, setTaskSaveError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const latest = minutes[0];

  useEffect(() => {
    let alive = true;
    if (!filters.brandId) { setMinutes([]); setSelected([]); setStatus('idle'); return undefined; }
    setStatus('loading');
    api.get(`/brands/${filters.brandId}/minutes`, { params: { startDate: filters.startDate, endDate: filters.endDate } })
      .then(({ data }) => { if (!alive) return; const list = data.minutes ?? []; setMinutes(list); setSelected(list.map((item) => item.id)); setStatus('ready'); })
      .catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, [filters.brandId, filters.startDate, filters.endDate, reloadKey]);

  const chosen = useMemo(() => minutes.filter((item) => selected.includes(item.id)), [minutes, selected]);
  const summaryText = useMemo(() => aiSummary ? AI_SECTIONS.map(([key, label]) => {
    const value = aiSummary[key]; if (!value || (Array.isArray(value) && !value.length)) return null;
    return `${label.toUpperCase()}\n${Array.isArray(value) ? value.map((item) => `• ${item}`).join('\n') : value}`;
  }).filter(Boolean).join('\n\n') : '', [aiSummary]);

  const generate = async () => {
    if (!selected.length) return;
    setGenerating(true); setAiError('');
    try { const { data } = await api.post(`/brands/${filters.brandId}/minutes/summary`, { minute_ids: selected }); setAiSummary(data.summary); setSummaryOpen(true); }
    catch (err) { setAiError(err?.response?.data?.message || err?.response?.data?.error || 'Gemini gagal membuat ringkasan. Coba lagi.'); }
    finally { setGenerating(false); }
  };

  const toggleTask = async (minute, key, checked) => {
    const current = new Set(minute.completed_task_keys ?? []); checked ? current.add(key) : current.delete(key);
    const keys = [...current];
    setMinutes((items) => items.map((item) => item.id === minute.id ? { ...item, completed_task_keys: keys } : item));
    setTaskSaveError(null);
    try { await api.patch(`/brands/${filters.brandId}/minutes/${minute.id}/tasks`, { completed_task_keys: keys }); }
    catch {
      setMinutes((items) => items.map((item) => item.id === minute.id ? minute : item));
      setTaskSaveError({ minute, key, checked });
    }
  };

  const download = async () => {
    if (!chosen.length) return;
    setDownloading(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Minutes Of Meeting — Summary', 48, 54);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 106, 144); doc.text(`${chosen.length} recap terpilih`, 48, 72);
      doc.setTextColor(15, 26, 58); doc.setFontSize(10);
      const wrapped = doc.splitTextToSize(summaryText, 499);
      let y = 96;
      for (const row of wrapped) { if (y > 790) { doc.addPage(); y = 48; } doc.text(row, 48, y); y += 14; }
      doc.save('Minutes-of-Meeting-Summary.pdf');
    } finally { setDownloading(false); }
  };

  return (
    <section className="mom-dashboard" aria-labelledby="mom-dashboard-title">
      <div className="mom-dashboard-head"><div><h2 id="mom-dashboard-title">Minutes Of Meeting</h2><p>Recap keputusan dan tindak lanjut dalam periode dashboard.</p></div>{latest && <span><CalendarDays size={13} /> Terbaru {dateLabel(latest.meeting_date)}</span>}</div>
      {status === 'loading' && <div className="mom-dash-state"><Loader2 size={17} className="brand-spin" /> Memuat catatan meeting…</div>}
      {status === 'error' && <div className="mom-dash-state is-error"><span>Catatan meeting gagal dimuat. Periksa koneksi API, lalu coba lagi.</span><button type="button" onClick={() => setReloadKey((key) => key + 1)}>Coba lagi</button></div>}
      {status !== 'loading' && status !== 'error' && !filters.brandId && <div className="mom-dash-state"><UsersRound size={18} /> Pilih satu brand untuk melihat Minutes Of Meeting.</div>}
      {status === 'ready' && !latest && <div className="mom-dash-state"><FileText size={18} /> Belum ada MOM pada periode ini. Tambahkan melalui Pengaturan Brand.</div>}
      {latest && <div className="mom-workspace">
        <div className="mom-summary-pane">
          <div className="mom-recap-controls"><details className="mom-recap-picker"><summary><span><FileText size={14} /> {selected.length ? `${selected.length} recap dipilih` : 'Pilih recap'}</span><ChevronDown size={15} /></summary><div>{minutes.map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => { setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]); setAiSummary(null); }} /><span><strong>{dateLabel(item.meeting_date)}</strong><small>{MOM_TYPE_LABELS[item.meeting_type]}</small></span></label>)}</div></details><button type="button" className="btn btn-primary" onClick={generate} disabled={!selected.length || generating}>{generating ? <Loader2 size={15} className="brand-spin" /> : <Brain size={15} />}{generating ? 'Gemini sedang merangkum…' : 'Buat ringkasan AI'}</button></div>
          {aiError && <div className="mom-ai-error">{aiError}</div>}
          <button type="button" className="mom-summary-title" onClick={() => setSummaryOpen((open) => !open)} aria-expanded={summaryOpen}><span><Brain size={15} /><span><strong>Ringkasan meeting</strong><small>{aiSummary ? `Disusun dari ${chosen.length} recap terpilih` : 'Pilih recap lalu buat ringkasan dengan Gemini'}</small></span></span><ChevronDown size={17} /></button>
          {summaryOpen && <div className="mom-ai-content">{aiSummary ? <>{AI_SECTIONS.map(([key, label]) => { const value = aiSummary[key]; if (!value || (Array.isArray(value) && !value.length)) return null; return <section key={key}><h3>{label}</h3>{Array.isArray(value) ? <ul>{value.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>{value}</p>}</section>; })}<button type="button" className="mom-download" onClick={download} disabled={downloading}><Download size={14} />{downloading ? 'Menyiapkan PDF…' : 'Download summary PDF'}</button></> : <div className="mom-ai-empty"><Brain size={21} /><span>Ringkasan AI akan tampil terstruktur di sini.</span></div>}</div>}
        </div>
        <aside className="mom-task-rail" aria-label="To Do List"><div className="mom-rail-title"><ListChecks size={15} /><span><strong>To Do List</strong><small>Dari catatan meeting terbaru</small></span></div>{taskSaveError && <div className="mom-task-error"><span>Status tugas belum tersimpan.</span><button type="button" onClick={() => toggleTask(taskSaveError.minute, taskSaveError.key, taskSaveError.checked)}>Coba lagi</button></div>}<TaskBoard title="MIL" scope="mil" minute={latest} onToggle={(key, checked) => toggleTask(latest, key, checked)} /><TaskBoard title="Client" scope="client" minute={latest} onToggle={(key, checked) => toggleTask(latest, key, checked)} /></aside>
      </div>}
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
        <nav className="brand-view-nav dashboard-domain-nav" aria-label="Domain analisis" role="tablist">
          {DOMAINS.map((d) => {
            const entry = read(d.key);
            const isActive = d.key === activeKey;
            const Icon = d.Icon;
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
                <Icon size={15} />
                <span>{d.label}</span>
                <span
                  className={`dashboard-domain-dot${entry.status === 'ready' ? ' is-ready' : ''}${entry.status === 'loading' ? ' is-loading' : ''}`}
                  aria-hidden
                />
              </button>
            );
          })}
        </nav>
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
