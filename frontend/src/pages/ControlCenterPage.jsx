import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUpRight, CalendarDays, Check, CheckCircle2, Circle, CircleAlert, Clock3, Database, ListChecks,
  Loader2, Radar, RefreshCw, Search, Sparkles, Undo2,
} from 'lucide-react';
import api from '../api/client';
import useSessionState from '../hooks/useSessionState.js';
import SelectMenu from '../components/common/SelectMenu.jsx';
import { presetBrandSettings } from '../components/common/brandSettingsLink.js';
import { MOM_TYPE_LABELS, OVERDUE_DAYS, dateLabel, daysSince, taskGroups } from '../components/mom/momModel.js';
import atlasIcon from '../assets/atlas-icon.png';
import atlasWordmark from '../assets/atlas-wordmark.png';
import '../components/dashboard/console.css';

// Pusat Kendali — the cross-brand operational reading: which brands are
// missing data for the month, and which MOM follow-ups have been left open.
// Admin-only (route guard + API).

const EASE = [0.16, 1, 0.3, 1];
const pad = (n) => String(n).padStart(2, '0');
const monthKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const monthLabel = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
const shortMonth = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
const errorText = (err) => err?.response?.data?.message || err?.response?.data?.error || 'Data belum bisa dimuat. Periksa koneksi API, lalu coba lagi.';

function monthOptions() {
  const now = new Date();
  return Array.from({ length: 13 }, (_, i) => {
    const key = monthKeyOf(new Date(now.getFullYear(), now.getMonth() + 1 - i, 1));
    return { value: key, label: monthLabel(key), description: i === 0 ? 'Bulan depan' : i === 1 ? 'Bulan berjalan' : undefined };
  });
}

const PLATFORM_LABEL = { meta: 'Meta', shopee: 'Shopee', tiktok: 'TikTok' };
const DATASET_LABEL = {
  meta: 'Meta Ads (gabungan)', boost: 'Boost Post', nonboost: 'Non-Boost Post', cpas: 'CPAS',
  order: 'Order', performance_overview: 'Performance Overview',
  product_performance: 'Product Performance', produk: 'Iklan Produk', produk_otomatis: 'Iklan Produk Otomatis',
  toko: 'Iklan Toko', toko_keyword: 'Iklan Toko — Keyword', live: 'Iklan Live', overview: 'Store Overview',
  tiktok: 'GMV Max', tiktok_order: 'Shop Orders',
};
const DATA_STATE = {
  complete: { label: 'Lengkap', tone: 'good', Icon: Check },
  partial: { label: 'Belum lengkap', tone: 'warn', Icon: Clock3 },
  missing: { label: 'Belum ada', tone: 'bad', Icon: CircleAlert },
  failed: { label: 'Impor gagal', tone: 'bad', Icon: CircleAlert },
  mismatch: { label: 'Salah periode', tone: 'bad', Icon: CircleAlert },
  upcoming: { label: 'Belum waktunya', tone: 'idle', Icon: CalendarDays },
};
const BRAND_STATE = {
  attention: { label: 'Perlu tindakan', tone: 'bad' },
  partial: { label: 'Belum lengkap', tone: 'warn' },
  complete: { label: 'Lengkap', tone: 'good' },
  idle: { label: 'Tanpa aktivitas', tone: 'idle' },
};

function datasetDetail(d) {
  if (d.state === 'missing') return d.lastMonthWithData ? `terakhir ${shortMonth(d.lastMonthWithData)}` : '';
  if (d.state === 'partial') return `${d.missingDays} hari kurang`;
  if (d.state === 'complete') return d.snapshot ? 'snapshot bulanan' : `${d.coveredDays} hari`;
  if (d.state === 'failed') return 'tidak masuk Dashboard';
  if (d.state === 'mismatch') return 'periode file tidak cocok';
  return '';
}

function ViewState({ state, onRetry, label }) {
  if (state.status === 'loading' && !state.data) {
    return <div className="mom-empty"><Loader2 size={20} className="brand-spin" /><strong>Memuat {label}…</strong></div>;
  }
  if (state.status === 'error') {
    return (
      <div className="mom-empty">
        <CircleAlert size={22} />
        <strong>{label[0].toUpperCase() + label.slice(1)} gagal dimuat</strong>
        <span>{state.error}</span>
        <button type="button" className="mom-ghost" onClick={onRetry}><RefreshCw size={13} /> Coba lagi</button>
      </div>
    );
  }
  return null;
}

function SectionHead({ title, description, meta }) {
  return (
    <div className="brand-workspace-head">
      <div><h2>{title}</h2><p>{description}</p></div>
      {meta && <span className="brand-section-meta">{meta}</span>}
    </div>
  );
}

/* ── Kelengkapan data ─────────────────────────────────────────────────── */

function CompletenessView({ state, month, scope, onScope, onRetry }) {
  const [filter, setFilter] = useSessionState('control-center:data-filter', 'all');
  const [query, setQuery] = useState('');
  const blocked = ViewState({ state, onRetry, label: 'kelengkapan data' });
  if (blocked) return blocked;

  const { totals, brands, expectedDays, days, historyMonths } = state.data;
  const needle = query.trim().toLowerCase();
  const shown = brands.filter((b) => (filter === 'all' || b.status === filter) && b.brand_name.toLowerCase().includes(needle));
  const cutoff = expectedDays === days ? 'Bulan penuh' : expectedDays === 0 ? 'Belum berjalan' : `Dicek s.d. tanggal ${expectedDays}`;
  const kpis = [
    ['attention', `${totals.missing} belum ada · ${totals.failed} impor gagal · ${totals.mismatch} salah periode`],
    ['partial', 'ada tanggal yang belum tercakup'],
    ['complete', 'semua dataset yang biasa diunggah'],
    ['idle', `tanpa upload ${historyMonths + 1} bulan terakhir`],
  ];

  return (
    <>
      <SectionHead
        title="Kelengkapan data"
        description={`File perpustakaan untuk ${monthLabel(month)}. Dataset yang diharapkan dipelajari dari riwayat upload ${historyMonths} bulan sebelumnya tiap brand, jadi brand tidak ditandai kurang untuk platform yang memang tidak dipakainya.`}
        meta={cutoff}
      />
      <div className="cc-kpis">
        {kpis.map(([key, hint]) => (
          <button
            key={key} type="button" aria-pressed={filter === key}
            className={`cc-kpi is-${BRAND_STATE[key].tone}${filter === key ? ' is-selected' : ''}`}
            onClick={() => setFilter(filter === key ? 'all' : key)}
          >
            <span>{BRAND_STATE[key].label}</span>
            <strong>{totals[key]}</strong>
            <small>{hint}</small>
          </button>
        ))}
      </div>
      <div className="cc-toolbar">
        <label className="brand-picker-search cc-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari brand…" aria-label="Cari brand" />
        </label>
        <div className="brand-status-filter" role="group" aria-label="Cakupan brand">
          {[['active', 'Brand aktif'], ['all', 'Semua brand']].map(([key, label]) => (
            <button key={key} type="button" aria-pressed={scope === key} className={scope === key ? 'is-selected' : ''} onClick={() => onScope(key)}>{label}</button>
          ))}
        </div>
        {filter !== 'all' && <button type="button" className="mom-ghost" onClick={() => setFilter('all')}>Tampilkan semua status</button>}
        <span className="cc-toolbar-count">{shown.length} dari {brands.length} brand</span>
      </div>

      <div className="cc-list">
        {shown.map((brand) => {
          const tone = BRAND_STATE[brand.status].tone;
          const focus = brand.datasets.find((d) => DATA_STATE[d.state].tone === 'bad') ?? brand.datasets[0];
          return (
            <article key={brand.brand_id} className={`cc-row is-${tone}`}>
              <div className="cc-row-head">
                <div className="cc-row-title">
                  <strong>{brand.brand_name}</strong>
                  <span className={`cc-pill is-${tone}`}>{BRAND_STATE[brand.status].label}</span>
                </div>
                <Link to="/pengaturan-brand" className="mom-head-link" onClick={() => presetBrandSettings({ brandId: brand.brand_id, view: 'data', platform: focus?.platform })}>
                  Buka perpustakaan <ArrowUpRight size={13} />
                </Link>
              </div>
              {brand.datasets.length ? (
                <ul className="cc-ds-list">
                  {brand.datasets.map((d) => {
                    const s = DATA_STATE[d.state];
                    const detail = datasetDetail(d);
                    return (
                      <li key={`${d.platform}:${d.channel}`} className={`cc-ds is-${s.tone}`}>
                        <s.Icon size={13} aria-hidden="true" />
                        <span>
                          <b>{PLATFORM_LABEL[d.platform]} · {DATASET_LABEL[d.channel] ?? d.channel}</b>
                          <small>{s.label}{detail ? ` · ${detail}` : ''}{d.parts > 1 ? ` · ${d.parts} part` : ''}</small>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="cc-muted">Belum ada file di perpustakaan dalam {historyMonths + 1} bulan terakhir, jadi belum ada dataset yang bisa diharapkan.</p>
              )}
            </article>
          );
        })}
        {!shown.length && (
          <div className="mom-empty">
            <CheckCircle2 size={22} />
            <strong>{filter === 'attention' && !needle ? 'Tidak ada brand yang perlu tindakan' : 'Tidak ada brand yang cocok'}</strong>
            <span>{needle ? 'Coba kata kunci lain.' : 'Ubah filter status untuk melihat brand lain.'}</span>
          </div>
        )}
      </div>
    </>
  );
}

/* ── To do tertunda ───────────────────────────────────────────────────── */

function TasksView({ state, items, busyMinute, onToggle, undo, onUndo, error, onRetry }) {
  const [age, setAge] = useSessionState('control-center:task-age', 'overdue');
  const [side, setSide] = useSessionState('control-center:task-side', 'all');
  const [groupBy, setGroupBy] = useSessionState('control-center:task-group', 'brand');
  const blocked = ViewState({ state, onRetry, label: 'to do list' });
  if (blocked) return blocked;

  const overdueDays = state.data.overdueDays ?? OVERDUE_DAYS;
  const overdue = items.filter((t) => t.age > overdueDays);
  const filtered = items
    .filter((t) => (age === 'all' || (age === 'overdue' ? t.age > overdueDays : t.age > overdueDays * 2)) && (side === 'all' || t.scope === side))
    .sort((a, b) => b.age - a.age || a.brandName.localeCompare(b.brandName));
  const groups = new Map();
  for (const task of filtered) {
    const key = groupBy === 'brand' ? `b${task.brandId}` : `p${task.person.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { name: groupBy === 'brand' ? task.brandName : task.person, brandId: task.brandId, tasks: [] });
    groups.get(key).tasks.push(task);
  }
  const oldest = items.reduce((max, t) => Math.max(max, t.age), 0);

  return (
    <>
      <SectionHead
        title="To do tertunda"
        description={`Tugas dari Minutes of Meeting yang belum dicentang. Tertunda berarti meeting-nya sudah lebih dari ${overdueDays} hari. Mencentang di sini sama dengan mencentang di Dashboard Business Overview.`}
        meta={`${items.length} tugas terbuka`}
      />
      <div className="cc-kpis">
        <div className="cc-kpi is-bad is-static"><span>Tertunda &gt; {overdueDays} hari</span><strong>{overdue.length}</strong><small>perlu ditindaklanjuti</small></div>
        <div className="cc-kpi is-idle is-static"><span>Terbuka</span><strong>{items.length}</strong><small>seluruh MOM</small></div>
        <div className="cc-kpi is-idle is-static"><span>Brand terlibat</span><strong>{new Set(items.map((t) => t.brandId)).size}</strong><small>punya tugas terbuka</small></div>
        <div className={`cc-kpi is-static ${oldest > overdueDays * 2 ? 'is-bad' : oldest > overdueDays ? 'is-warn' : 'is-good'}`}><span>Paling lama</span><strong>{oldest} hari</strong><small>sejak meeting</small></div>
      </div>
      <div className="cc-toolbar">
        <div className="brand-status-filter" role="group" aria-label="Umur tugas">
          {[['overdue', `> ${overdueDays} hari`], ['stale', `> ${overdueDays * 2} hari`], ['all', 'Semua terbuka']].map(([key, label]) => (
            <button key={key} type="button" aria-pressed={age === key} className={age === key ? 'is-selected' : ''} onClick={() => setAge(key)}>{label}</button>
          ))}
        </div>
        <div className="brand-status-filter" role="group" aria-label="Pihak">
          {[['all', 'MIL & Client'], ['mil', 'MIL'], ['client', 'Client']].map(([key, label]) => (
            <button key={key} type="button" aria-pressed={side === key} className={side === key ? 'is-selected' : ''} onClick={() => setSide(key)}>{label}</button>
          ))}
        </div>
        <div className="brand-status-filter" role="group" aria-label="Kelompokkan">
          {[['brand', 'Per brand'], ['person', 'Per PIC']].map(([key, label]) => (
            <button key={key} type="button" aria-pressed={groupBy === key} className={groupBy === key ? 'is-selected' : ''} onClick={() => setGroupBy(key)}>{label}</button>
          ))}
        </div>
      </div>

      {undo && (
        <div className="cc-undo" role="status">
          <CheckCircle2 size={15} /> <span>“{undo.text}” ditandai selesai.</span>
          <button type="button" onClick={onUndo} disabled={busyMinute === undo.minuteId}><Undo2 size={13} /> Batalkan</button>
        </div>
      )}
      {error && <p className="mom-form-error" role="alert"><CircleAlert size={14} /> {error}</p>}

      <div className="cc-list">
        {[...groups.values()].map((group) => (
          <section key={`${group.name}-${group.brandId}`} className="cc-task-group">
            <div className="cc-task-group-head">
              <strong>{group.name}</strong>
              <span className="cc-count">{group.tasks.length}</span>
              {groupBy === 'brand' && (
                <Link to="/pengaturan-brand" className="mom-head-link" onClick={() => presetBrandSettings({ brandId: group.brandId, view: 'mom' })}>
                  Buka catatan <ArrowUpRight size={13} />
                </Link>
              )}
            </div>
            <ul>
              {group.tasks.map((task) => (
                <li key={`${task.minuteId}|${task.key}`} className="cc-task">
                  <button type="button" className="cc-task-check" disabled={busyMinute === task.minuteId} onClick={() => onToggle(task, true)} aria-label={`Tandai selesai: ${task.text}`}>
                    {busyMinute === task.minuteId ? <Loader2 size={15} className="brand-spin" /> : <Circle size={16} />}
                  </button>
                  <span className="cc-task-body">
                    <strong>{task.text}</strong>
                    <small>
                      {groupBy === 'brand' ? task.person : task.brandName} · {task.scope === 'mil' ? 'MIL' : 'Client'} · meeting {dateLabel(task.meetingDate)} ({MOM_TYPE_LABELS[task.meetingType]})
                    </small>
                  </span>
                  <span className={`cc-age${task.age > overdueDays * 2 ? ' is-bad' : task.age > overdueDays ? ' is-warn' : ''}`}>
                    <Clock3 size={12} aria-hidden="true" /> {task.age} hari
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!filtered.length && (
          <div className="mom-empty">
            <CheckCircle2 size={22} />
            <strong>{age === 'all' ? 'Tidak ada tugas terbuka' : 'Tidak ada tugas yang tertunda'}</strong>
            <span>{age === 'all' ? 'Semua tindak lanjut dari MOM sudah dicentang.' : 'Pilih “Semua terbuka” untuk melihat tugas yang masih baru.'}</span>
          </div>
        )}
      </div>
    </>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

const VIEWS = [
  { id: 'data', label: 'Kelengkapan data', Icon: Database },
  { id: 'tasks', label: 'To do tertunda', Icon: ListChecks },
];

export default function ControlCenterPage() {
  const reduced = useReducedMotion();
  const [view, setView] = useSessionState('control-center:view', 'data');
  // A remembered tab that no longer exists (the removed "Target bulan ini")
  // falls back to the first one instead of rendering an empty card.
  useEffect(() => {
    if (!VIEWS.some((v) => v.id === view)) setView('data');
  }, [view, setView]);
  const [month, setMonth] = useSessionState('control-center:month', monthKeyOf(new Date()));
  const [scope, setScope] = useSessionState('control-center:scope', 'active');
  const [reload, setReload] = useState(0);
  const [completeness, setCompleteness] = useState({ status: 'loading', data: null, error: '' });
  const [tasks, setTasks] = useState({ status: 'loading', data: null, error: '' });
  const [busyMinute, setBusyMinute] = useState(null);
  const [undo, setUndo] = useState(null);
  const [taskError, setTaskError] = useState('');
  const options = useMemo(monthOptions, []);

  useEffect(() => {
    let alive = true;
    setCompleteness((s) => ({ ...s, status: 'loading', error: '' }));
    api.get('/control-center/data-completeness', { params: { month, scope } })
      .then(({ data }) => { if (alive) setCompleteness({ status: 'ready', data, error: '' }); })
      .catch((err) => { if (alive) setCompleteness({ status: 'error', data: null, error: errorText(err) }); });
    return () => { alive = false; };
  }, [month, scope, reload]);

  useEffect(() => {
    let alive = true;
    setTasks((s) => ({ ...s, status: 'loading', error: '' }));
    api.get('/control-center/open-tasks')
      .then(({ data }) => { if (alive) setTasks({ status: 'ready', data, error: '' }); })
      .catch((err) => { if (alive) setTasks({ status: 'error', data: null, error: errorText(err) }); });
    return () => { alive = false; };
  }, [reload]);

  const taskItems = useMemo(() => {
    if (!tasks.data) return [];
    const { minutes, today } = tasks.data;
    return minutes.flatMap((minute) => {
      const done = new Set(minute.completed_task_keys ?? []);
      return [['mil', minute.todo_mil], ['client', minute.todo_client]].flatMap(([scopeKey, text]) =>
        taskGroups(text, scopeKey).flatMap((group) => group.tasks.filter((task) => !done.has(task.key)).map((task) => ({
          ...task, scope: scopeKey, person: group.name, minuteId: minute.id, brandId: minute.brand_id, brandName: minute.brand_name,
          meetingDate: minute.meeting_date, meetingType: minute.meeting_type, age: daysSince(minute.meeting_date, today),
        }))));
    });
  }, [tasks.data]);

  // One write per meeting record at a time: completed_task_keys is replaced
  // wholesale, so two overlapping ticks on the same record would race.
  async function setTaskDone(item, done) {
    const minute = tasks.data?.minutes.find((m) => m.id === item.minuteId);
    if (!minute || busyMinute) return;
    const keys = new Set(minute.completed_task_keys ?? []);
    if (done) keys.add(item.key); else keys.delete(item.key);
    const next = [...keys];
    setBusyMinute(item.minuteId);
    setTaskError('');
    try {
      const { data } = await api.patch(`/brands/${item.brandId}/minutes/${item.minuteId}/tasks`, { completed_task_keys: next });
      setTasks((s) => ({ ...s, data: { ...s.data, minutes: s.data.minutes.map((m) => (m.id === item.minuteId ? { ...m, completed_task_keys: data.minute?.completed_task_keys ?? next } : m)) } }));
      setUndo(done ? item : null);
    } catch (err) {
      setTaskError(`Status tugas belum tersimpan: ${errorText(err)}`);
    } finally {
      setBusyMinute(null);
    }
  }

  const overdueDays = tasks.data?.overdueDays ?? OVERDUE_DAYS;
  const overdueCount = taskItems.filter((t) => t.age > overdueDays).length;
  const counts = {
    data: completeness.data?.totals.attention ?? null,
    tasks: tasks.data ? overdueCount : null,
  };
  const hints = {
    data: counts.data == null ? 'Memuat…' : counts.data ? `${counts.data} brand perlu tindakan` : 'Semua aman',
    tasks: counts.tasks == null ? 'Memuat…' : counts.tasks ? `${counts.tasks} tertunda` : 'Tidak ada yang tertunda',
  };

  return (
    <div className="con brand-settings control-center">
      <header className="brand-hero">
        <span className="brand-hero-fx" aria-hidden="true"><i className="brand-hero-aurora" /><i className="brand-hero-grid" /></span>
        <div className="brand-hero-main">
          <motion.div className="brand-hero-copy" initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4, ease: EASE }}>
            <span className="brand-hero-eye"><Sparkles size={13} /> Operational control</span>
            <h1>Pusat Kendali</h1>
            <p>Brand yang datanya belum lengkap dan tindak lanjut meeting yang tertunda — dalam satu pembacaan lintas klien.</p>
            <div className="brand-hero-stats">
              <span><strong>{counts.data ?? '—'}</strong> brand perlu tindakan</span>
              <span><strong>{counts.tasks ?? '—'}</strong> to do tertunda</span>
            </div>
          </motion.div>
          <motion.div className="brand-hero-badge" aria-hidden="true" initial={reduced ? false : { opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .45, ease: EASE, delay: .06 }}>
            <span className="brand-hero-ring" /><span className="brand-hero-ring brand-hero-ring-b" />
            <img src={atlasIcon} alt="" className="brand-hero-mark" />
            <img src={atlasWordmark} alt="" className="brand-hero-logo" />
            <small>Control center</small>
          </motion.div>
        </div>
        <div className="brand-dock cc-dock">
          <div className="brand-dock-copy">
            <span><Radar size={14} /> Bulan yang dibaca</span>
            <small>Kelengkapan data mengikuti bulan ini; to do tertunda selalu mencakup semua meeting.</small>
          </div>
          <SelectMenu label="Bulan" icon={CalendarDays} value={month} options={options} onChange={setMonth} />
          <button type="button" className="brand-new" onClick={() => { setUndo(null); setReload((r) => r + 1); }}>
            <RefreshCw size={15} /> Muat ulang
          </button>
        </div>
      </header>

      <LayoutGroup id="control-center-nav">
        <div className="section-nav-shell">
          <nav className="brand-view-nav" aria-label="Bagian Pusat Kendali" role="tablist">
            {VIEWS.map(({ id, label, Icon }) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} className={`brand-view-tab${view === id ? ' is-active' : ''}`} onClick={() => setView(id)}>
                {view === id && <motion.span layoutId="control-center-active" className="brand-view-pill" aria-hidden="true" transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 44, mass: .6 }} />}
                <span className="brand-view-tab-ico" aria-hidden="true"><Icon size={16} /></span>
                <span className="brand-view-tab-copy">
                  <strong>{label}</strong>
                  <small>{counts[id] ? <b className="cc-nav-count">{counts[id]}</b> : null}{hints[id]}</small>
                </span>
              </button>
            ))}
          </nav>
        </div>
      </LayoutGroup>

      <section className="brand-workspace cc-workspace">
        {view === 'data' && <CompletenessView state={completeness} month={month} scope={scope} onScope={setScope} onRetry={() => setReload((r) => r + 1)} />}
        {view === 'tasks' && (
          <TasksView
            state={tasks} items={taskItems} busyMinute={busyMinute}
            onToggle={setTaskDone} undo={undo} onUndo={() => undo && setTaskDone(undo, false)}
            error={taskError} onRetry={() => setReload((r) => r + 1)}
          />
        )}
      </section>
    </div>
  );
}
