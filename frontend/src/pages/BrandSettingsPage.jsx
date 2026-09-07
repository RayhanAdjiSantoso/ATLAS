import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import {
  Archive, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert,
  CloudUpload, Database, Download, FileSpreadsheet, Layers3, Loader2, Plus, Save,
  Sparkles, Trash2, Upload,
} from 'lucide-react';
import api from '../api/client';
import atlasIcon from '../assets/atlas-icon.png';
import atlasWordmark from '../assets/atlas-wordmark.png';
import '../components/dashboard/console.css';

// Pengaturan Brand — the one place a brand is described and its source files
// live. Every other module (Report Generator, Dashboard, Meta Automation)
// reads what is uploaded here instead of asking for its own upload.
//
// Four ideas drive the layout:
//
//   1. One brand at a time. The brand picker is docked INSIDE the hero so the
//      page can never look like two cards colliding, and "which brand am I
//      editing" is answered before anything below it is read.
//   2. Three destinations, not three anchors — each tab swaps the canvas.
//   3. Data & file is the feature, not an appendix: a glass marketplace rail,
//      an accent-lit platform banner, and a dataset x month coverage matrix.
//   4. The month axis is windowed, never unbounded. A brand accumulates a new
//      month forever; the matrix shows MONTH_WINDOW of them at a time with
//      paging, and picking one month narrows the whole panel to it — table,
//      day detail, and every upload target. That is also what makes uploading
//      unambiguous: a file dropped while "Juni 2026" is selected is stored
//      against June, not against "whatever the file looked like".

const MONTH_WINDOW = 6;
const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const EASE = [0.16, 1, 0.3, 1];

// Channel ids are the Report Generator's own vocabulary (the values it writes
// into ads_reports.raw_uploads) plus the Dashboard's three file_type values,
// so a file stored here needs no translation to be reused downstream. Shopee's
// ad products are listed one per row on purpose: Iklan Toko, Iklan Toko —
// Keyword and Iklan Live are separate exports in Seller Centre, not one file.
const PLATFORMS = [
  {
    id: 'meta',
    label: 'Meta Ads',
    role: 'Paid social · awareness → conversion',
    accent: '#1e3eb8',
    wash: '#4f7cff',
    tint: 'rgba(79,124,255,.13)',
    datasets: [
      { channel: 'meta', name: 'Meta Ads', hint: 'Boost & Non-Boost · export Ads Manager', kind: 'core' },
      { channel: 'cpas', name: 'CPAS', hint: 'Breakdown umur, gender & bulan', kind: 'extra' },
    ],
  },
  {
    id: 'shopee',
    label: 'Shopee',
    role: 'Marketplace · penjualan & iklan toko',
    accent: '#ee4d2d',
    wash: '#ff6a3d',
    tint: 'rgba(238,77,45,.13)',
    datasets: [
      { channel: 'order', name: 'Order', hint: 'Pesanan Shopee · semua status', kind: 'core' },
      { channel: 'performance_overview', name: 'Performance Overview', hint: 'Kinerja harian toko', kind: 'core' },
      { channel: 'product_performance', name: 'Product Performance', hint: 'Produk · status Siap Dikirim', kind: 'core' },
      { channel: 'produk', name: 'Iklan Produk', hint: 'Iklan produk (manual)', kind: 'core' },
      { channel: 'produk_otomatis', name: 'Iklan Produk Otomatis', hint: 'Iklan produk mode otomatis', kind: 'extra' },
      { channel: 'toko', name: 'Iklan Toko', hint: 'Iklan toko', kind: 'extra' },
      { channel: 'toko_keyword', name: 'Iklan Toko — Keyword', hint: 'Kata pencarian per iklan toko', kind: 'extra' },
      { channel: 'live', name: 'Iklan Live', hint: 'Sesi live yang diiklankan', kind: 'extra' },
      { channel: 'overview', name: 'Product / Store Overview', hint: 'Kunjungan & konversi harian', kind: 'extra' },
      { channel: 'product_master', name: 'Referensi Kategori Produk', hint: 'Nama produk → Category / Series', kind: 'reference' },
    ],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    role: 'Shop & GMV Max · konten komersial',
    accent: '#111827',
    wash: '#12c8d4',
    tint: 'rgba(18,200,212,.16)',
    datasets: [
      { channel: 'tiktok', name: 'GMV Max', hint: 'Performa kampanye GMV Max', kind: 'core' },
      { channel: 'tiktok_order', name: 'Shop Orders', hint: 'Pesanan TikTok Shop', kind: 'extra' },
    ],
  },
];

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

const PERIOD_SOURCE_LABEL = {
  declared: 'periode dari header file',
  filename: 'periode dari nama file',
  rows: 'periode dari isi baris',
  none: 'periode mengikuti slot bulan',
};

const VIEWS = [
  { id: 'context', label: 'Brand context', Icon: Database, note: 'Identitas yang memberi arti pada angka' },
  { id: 'direction', label: 'Current direction', Icon: Layers3, note: 'Arah kerja yang membingkai keputusan' },
  { id: 'data', label: 'Data & file', Icon: Archive, note: 'Satu perpustakaan sumber untuk semua modul' },
];

/* ── Month model ────────────────────────────────────────────────────────
   Months are derived from what the brand actually has (plus the current
   month), never hard-coded, so the axis grows with the data instead of
   being a fixed four columns. */

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

function buildMonth(key) {
  const [year, month] = key.split('-').map(Number);
  return {
    key,
    year,
    month,
    label: MONTH_SHORT[month - 1],
    full: `${MONTH_NAMES[month - 1]} ${year}`,
    days: daysInMonth(year, month),
  };
}

function buildMonthAxis(files) {
  const now = new Date();
  const keys = files.map((f) => f.period_month?.slice(0, 7)).filter(Boolean);
  const latest = monthKey(now);
  const earliestKey = keys.length ? keys.slice().sort()[0] : null;

  // Always show at least one full window ending at the current month, even
  // for a brand with no files yet — an empty grid you can click into beats
  // an empty state with nothing to aim at.
  const fallback = new Date(now.getFullYear(), now.getMonth() - (MONTH_WINDOW - 1), 1);
  const start = earliestKey && earliestKey < monthKey(fallback) ? earliestKey : monthKey(fallback);

  const axis = [];
  const cursor = new Date(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1);
  const end = new Date(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)) - 1, 1);
  while (cursor <= end && axis.length < 120) {
    axis.push(buildMonth(monthKey(cursor)));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return axis;
}

const fileKey = (platform, channel, month) => `${platform}:${channel}:${month ?? 'ref'}`;

function cellState(file, month) {
  if (!file) return 'empty';
  if (!month) return 'ref';
  if (file.covered_days >= month.days) return 'full';
  if (file.covered_days > 0) return 'partial';
  // A file is there but no date column could be read — a monthly snapshot
  // export (Product Performance, some ad exports). Saying "belum ada" would
  // be a lie; saying "30 hari" would be a bigger one.
  return 'snapshot';
}

function datasetStatus(dataset, months, lookup, platformId) {
  if (dataset.kind === 'reference') {
    return lookup.get(fileKey(platformId, dataset.channel, null))
      ? { label: 'Referensi', tone: 'ref' }
      : { label: 'Belum ada', tone: 'idle' };
  }
  const present = months.filter((m) => lookup.has(fileKey(platformId, dataset.channel, m.key)));
  if (!present.length) return dataset.kind === 'extra' ? { label: 'Opsional', tone: 'idle' } : { label: 'Belum ada', tone: 'warn' };
  if (present.length === months.length) return { label: 'Lengkap', tone: 'ok' };
  return { label: `${present.length}/${months.length} bulan`, tone: 'partial' };
}

function platformSummary(platform, months, lookup) {
  const core = platform.datasets.filter((d) => d.kind === 'core');
  const slots = core.length * Math.max(months.length, 1);
  const filled = core.reduce((sum, d) => sum + months.filter((m) => lookup.has(fileKey(platform.id, d.channel, m.key))).length, 0);
  const active = platform.datasets.filter((d) => (d.kind === 'reference'
    ? lookup.has(fileKey(platform.id, d.channel, null))
    : months.some((m) => lookup.has(fileKey(platform.id, d.channel, m.key))))).length;
  const monthStates = months.map((month) => {
    const states = core.map((d) => cellState(lookup.get(fileKey(platform.id, d.channel, month.key)), month));
    if (states.length && states.every((s) => s !== 'empty')) return { ...month, state: 'full' };
    if (states.some((s) => s !== 'empty')) return { ...month, state: 'partial' };
    return { ...month, state: 'empty' };
  });
  return { ready: slots ? Math.round((filled / slots) * 100) : 0, active, monthStates };
}

/* ── Brand picker ───────────────────────────────────────────────────────── */

function BrandPicker({ brands, brand, sector, onSelect, reduced }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (!wrap.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="brand-picker" ref={wrap}>
      <button type="button" className={`brand-picker-btn ${open ? 'is-open' : ''}`} onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="brand-picker-mark" aria-hidden="true">{(brand?.brand_name ?? '?').slice(0, 1)}</span>
        <span className="brand-picker-text">
          <strong>{brand?.brand_name ?? 'Pilih brand'}</strong>
          <small>{sector || `${brands.length} brand terdaftar`}</small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            className="brand-picker-menu" role="listbox"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: .99 }}
            transition={{ duration: .16, ease: EASE }}
          >
            {brands.map((item) => (
              <li key={item.brand_id}>
                <button
                  type="button" role="option" aria-selected={item.brand_id === brand?.brand_id}
                  className={item.brand_id === brand?.brand_id ? 'is-active' : ''}
                  onClick={() => { onSelect(item); setOpen(false); }}
                >
                  <span className="brand-picker-mark" aria-hidden="true">{item.brand_name.slice(0, 1)}</span>
                  <span className="brand-picker-text"><strong>{item.brand_name}</strong></span>
                  {item.brand_id === brand?.brand_id && <Check size={15} />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Shared pieces ──────────────────────────────────────────────────────── */

function Field({ label, guidance, value, onChange }) {
  return (
    <label className="brand-field">
      <span>{label}</span>
      <small>{guidance}</small>
      <textarea value={value ?? ''} rows="4" onChange={(event) => onChange(event.target.value)} placeholder="Belum diisi" />
    </label>
  );
}

function ViewShell({ children, viewId, reduced }) {
  return (
    <motion.section
      key={viewId} className="brand-workspace"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
      transition={{ duration: .22, ease: EASE }}
    >
      {children}
    </motion.section>
  );
}

// Turns an axios failure into something actionable rather than "gagal".
function describeError(err, what) {
  const status = err?.response?.status;
  const body = err?.response?.data?.message || err?.response?.data?.error;
  if (status === 404) return `${what}: endpoint belum dikenal server (404). Backend kemungkinan masih proses lama — restart API-nya (npm run dev di folder backend).`;
  if (status === 401) return `${what}: sesi berakhir. Login ulang.`;
  if (status === 413) return `${what}: file terlalu besar untuk server.`;
  if (!err?.response) return `${what}: API tidak merespons. Pastikan backend berjalan di port 5001.`;
  return `${what}: ${body || `HTTP ${status}`}`;
}

function SectionHead({ title, description, meta, tone }) {
  return (
    <div className="brand-workspace-head">
      <div><h2>{title}</h2><p>{description}</p></div>
      {meta && <span className={`brand-section-meta ${tone || ''}`}>{meta}</span>}
    </div>
  );
}

function SaveBar({ profile, saving, dirty, onSave }) {
  return (
    <div className="brand-save-bar">
      <span>
        {profile?.updated_at
          ? `Terakhir diperbarui ${new Date(profile.updated_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}${profile.updated_by_name ? ` oleh ${profile.updated_by_name}` : ''}`
          : 'Belum pernah disimpan untuk brand ini'}
      </span>
      <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving || !dirty}>
        {saving ? <Loader2 size={16} className="brand-spin" /> : <Save size={16} />}
        {saving ? 'Menyimpan…' : dirty ? 'Simpan perubahan' : 'Tersimpan'}
      </button>
    </div>
  );
}

/* ── Data & file ────────────────────────────────────────────────────────── */

function DayStrip({ file, month, wash }) {
  const bitmap = file?.day_bitmap ?? '';
  return (
    <div className="brand-daygrid-month">
      <div className="brand-daygrid-head">
        <strong>{month.full}</strong>
        <span className={!file ? 'is-empty' : file.covered_days >= month.days ? 'is-full' : file.covered_days > 0 ? 'is-partial' : 'is-empty'}>
          {file ? (file.covered_days > 0 ? `${file.covered_days} / ${month.days} hari` : 'snapshot bulanan') : 'belum ada'}
        </span>
      </div>
      <div className="brand-daygrid-pips" style={{ '--pip-accent': wash }}>
        {Array.from({ length: month.days }, (_, index) => (
          <i key={index} className={bitmap[index] === '1' ? 'is-on' : ''} title={`${index + 1} ${month.full}`} />
        ))}
      </div>
    </div>
  );
}

function DatasetRow({ platform, dataset, months, lookup, index, reduced, onPick, onDelete, busyKey }) {
  const [open, setOpen] = useState(false);
  const isReference = dataset.kind === 'reference';
  const status = datasetStatus(dataset, months, lookup, platform.id);
  const detailMonths = isReference ? [] : months;
  const refFile = isReference ? lookup.get(fileKey(platform.id, dataset.channel, null)) : null;
  const lastMonth = months[months.length - 1];

  return (
    <motion.div
      className={`brand-ds ${open ? 'is-open' : ''}`}
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * .022, duration: .2, ease: EASE }}
    >
      <div className="brand-ds-row">
        <button type="button" className="brand-ds-name" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="brand-ds-chev" aria-hidden="true"><ChevronDown size={15} /></span>
          <span className="brand-ds-icon" aria-hidden="true"><FileSpreadsheet size={15} /></span>
          <span className="brand-ds-label">
            <strong>{dataset.name}</strong>
            <small>{dataset.hint}</small>
          </span>
        </button>

        {isReference
          ? <span className="brand-cov is-ref" style={{ gridColumn: `span ${months.length}` }} title="File referensi tanpa periode">
              {refFile ? refFile.original_filename : 'Tanpa periode — berlaku untuk semua bulan'}
            </span>
          : months.map((month) => {
            const file = lookup.get(fileKey(platform.id, dataset.channel, month.key));
            const state = cellState(file, month);
            const pct = file && file.covered_days ? Math.round((file.covered_days / month.days) * 100) : state === 'snapshot' ? 100 : 0;
            const key = fileKey(platform.id, dataset.channel, month.key);
            return (
              <button
                key={month.key} type="button"
                className={`brand-cov is-${state} ${busyKey === key ? 'is-busy' : ''}`}
                style={{ '--cov-accent': platform.accent, '--cov-wash': platform.wash, '--cov-fill': `${pct}%` }}
                onClick={() => onPick(dataset, month)}
                title={file
                  ? `${month.full} · ${file.covered_days > 0 ? `${file.covered_days} dari ${month.days} hari` : 'snapshot bulanan'} · ${file.original_filename} (klik untuk ganti)`
                  : `${month.full} · belum ada file (klik untuk upload)`}
              >
                <i aria-hidden="true" />
                <b>{busyKey === key ? '…' : state === 'empty' ? '+' : state === 'snapshot' ? '✓' : file.covered_days}</b>
              </button>
            );
          })}

        <span />
        <span className={`brand-ds-status is-${status.tone}`}>
          {status.tone === 'ok' && <Check size={12} />}{status.label}
        </span>
        <button
          type="button" className="brand-row-action"
          onClick={() => onPick(dataset, isReference ? null : lastMonth)}
          aria-label={`Upload ${dataset.name}`}
        >
          <CloudUpload size={16} />
        </button>
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
            <div className="brand-ds-detail-inner">
              {isReference
                ? <p className="brand-ds-note">File referensi tanpa periode. ATLAS memakainya untuk memetakan nama produk ke Category / Series di seluruh laporan.</p>
                : (
                  <div className="brand-daygrid">
                    {detailMonths.map((month) => (
                      <DayStrip key={month.key} month={month} wash={platform.wash} file={lookup.get(fileKey(platform.id, dataset.channel, month.key))} />
                    ))}
                  </div>
                )}
              <div className="brand-ds-files">
                {(isReference ? (refFile ? [[null, refFile]] : []) : months.map((m) => [m, lookup.get(fileKey(platform.id, dataset.channel, m.key))]).filter(([, f]) => f)).map(([month, file]) => (
                  <div className="brand-ds-file" key={file.id}>
                    <span className="brand-ds-fileinfo">
                      <FileSpreadsheet size={14} />
                      <strong>{month ? month.full : 'Referensi'}</strong>
                      {file.original_filename}
                      {file.row_count ? ` · ${file.row_count.toLocaleString('id-ID')} baris` : ''}
                      {file.period_source ? ` · ${PERIOD_SOURCE_LABEL[file.period_source] ?? file.period_source}` : ''}
                      {` · ${new Date(file.uploaded_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                    </span>
                    <span className="brand-ds-fileacts">
                      <button type="button" onClick={() => onPick(dataset, month)}><Upload size={14} /> Ganti</button>
                      <a href={`/api/brands/${file.brand_id}/library/${file.id}/download`} download><Download size={14} /> Unduh</a>
                      <button type="button" className="is-danger" onClick={() => onDelete(file)}><Trash2 size={14} /> Hapus</button>
                    </span>
                  </div>
                ))}
                {!isReference && !months.some((m) => lookup.has(fileKey(platform.id, dataset.channel, m.key))) && (
                  <p className="brand-ds-note"><CircleAlert size={14} /> Belum ada file untuk dataset ini pada rentang bulan yang sedang ditampilkan.</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function MonthRail({ axis, windowStart, setWindowStart, focus, setFocus, lookup, platformId, reduced }) {
  const canPrev = windowStart > 0;
  const canNext = windowStart + MONTH_WINDOW < axis.length;
  const visible = axis.slice(windowStart, windowStart + MONTH_WINDOW);

  return (
    <div className="brand-month-rail">
      <button type="button" className="brand-month-page" onClick={() => setWindowStart(Math.max(0, windowStart - MONTH_WINDOW))} disabled={!canPrev} aria-label="Bulan sebelumnya">
        <ChevronLeft size={16} />
      </button>
      <LayoutGroup id={`brand-month-${platformId}`}>
        <div className="brand-month-track" role="group" aria-label="Filter bulan">
          {visible.map((month) => {
            const has = [...lookup.keys()].some((key) => key.startsWith(`${platformId}:`) && key.endsWith(`:${month.key}`));
            const active = focus === month.key;
            return (
              <button
                key={month.key} type="button"
                className={`brand-month-chip ${active ? 'is-active' : ''} ${has ? 'has-data' : ''}`}
                onClick={() => setFocus(active ? null : month.key)}
                aria-pressed={active}
              >
                {active && (
                  <motion.span
                    className="brand-month-pill" layoutId={`brand-month-pill-${platformId}`} aria-hidden="true"
                    transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42, mass: .6 }}
                  />
                )}
                <i aria-hidden="true" />
                <span>{month.label}</span>
                <small>{String(month.year).slice(2)}</small>
              </button>
            );
          })}
        </div>
      </LayoutGroup>
      <button type="button" className="brand-month-page" onClick={() => setWindowStart(Math.min(axis.length - MONTH_WINDOW, windowStart + MONTH_WINDOW))} disabled={!canNext} aria-label="Bulan berikutnya">
        <ChevronRight size={16} />
      </button>
      <button type="button" className={`brand-month-all ${focus ? '' : 'is-active'}`} onClick={() => setFocus(null)}>
        {focus ? 'Tampilkan semua bulan' : `${visible.length} bulan ditampilkan`}
      </button>
    </div>
  );
}

function PlatformPanel({ platform, months, lookup, reduced, onPick, onDelete, busyKey, focusMonth }) {
  const summary = useMemo(() => platformSummary(platform, months, lookup), [platform, months, lookup]);
  const target = focusMonth ?? months[months.length - 1];

  return (
    <motion.div
      key={platform.id} className="brand-market-panel"
      style={{ '--mk-accent': platform.accent, '--mk-wash': platform.wash, '--mk-tint': platform.tint, '--ds-months': months.length }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: -8 }}
      transition={{ duration: .2, ease: EASE }}
    >
      <div className="brand-market-banner">
        <span className="brand-market-banner-glow" aria-hidden="true" />
        <span className="brand-market-mark" aria-hidden="true">{platform.label.slice(0, 1)}</span>
        <span className="brand-market-headline">
          <strong>{platform.label}</strong>
          <small>{platform.role}</small>
        </span>
        <span className="brand-market-months" aria-label="Ketersediaan per bulan">
          {summary.monthStates.map((month) => (
            <span key={month.key} className={`brand-market-month is-${month.state}`} title={`${month.full} · ${month.state === 'full' ? 'lengkap' : month.state === 'partial' ? 'sebagian' : 'belum ada'}`}>
              <i aria-hidden="true" />{month.label}
            </span>
          ))}
        </span>
        <span className="brand-market-ready">
          <span className="brand-market-ready-num">{summary.ready}%</span>
          <small>dataset inti siap</small>
          <span className="brand-market-ready-bar">
            <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: summary.ready / 100 }} transition={{ duration: .45, ease: EASE }} />
          </span>
        </span>
      </div>

      <div className="brand-ds-table">
        <div className="brand-ds-head">
          <span>Dataset</span>
          {months.map((month) => (
            <span key={month.key} className="brand-ds-head-month">{month.label}<small>{String(month.year).slice(2)}</small></span>
          ))}
          <span />
          <span>Status</span>
          <span />
        </div>
        {platform.datasets.map((dataset, index) => (
          <DatasetRow
            key={dataset.channel} platform={platform} dataset={dataset} months={months} lookup={lookup}
            index={index} reduced={reduced} onPick={onPick} onDelete={onDelete} busyKey={busyKey}
          />
        ))}
      </div>

      <div className="brand-drop">
        <span className="brand-drop-icon"><CloudUpload size={20} /></span>
        <span className="brand-drop-copy">
          <strong>Upload file {platform.label} · {target?.full}</strong>
          <small>
            Klik sel bulan pada tabel di atas untuk menaruh file tepat di bulan itu—atau pilih bulan di rail untuk mengunci semua upload ke satu periode.
          </small>
        </span>
        <span className="brand-drop-cta">{focusMonth ? `Terkunci ke ${focusMonth.full}` : 'Bulan mengikuti sel'}</span>
      </div>
    </motion.div>
  );
}

function DataView({ brand, files, months, axis, windowStart, setWindowStart, focus, setFocus, lookup, reduced, onPick, onDelete, busyKey, marketId, setMarketId }) {
  const platform = PLATFORMS.find((p) => p.id === marketId) ?? PLATFORMS[0];
  const focusMonth = focus ? months.find((m) => m.key === focus) : null;

  const totals = useMemo(() => {
    const all = PLATFORMS.flatMap((p) => p.datasets.map((d) => `${p.id}:${d.channel}`));
    const withData = new Set(files.map((f) => `${f.platform}:${f.channel}`));
    return { all: all.length, active: all.filter((k) => withData.has(k)).length };
  }, [files]);

  const span = files.filter((f) => f.period_month).map((f) => f.period_month).sort();

  return (
    <>
      <SectionHead
        title="Data & file"
        description={`Perpustakaan data milik ${brand?.brand_name ?? 'brand ini'}. Report Generator, Dashboard, dan Meta Automation membaca dari sini—tidak ada upload ulang di halaman lain.`}
        meta={<><Check size={13} /> {totals.active} dari {totals.all} dataset aktif</>}
        tone="brand-ready-meta"
      />

      <div className="brand-data-summary">
        <div>
          <strong>Rentang data brand</strong>
          <span>{span.length ? `${buildMonth(span[0].slice(0, 7)).full} – ${buildMonth(span[span.length - 1].slice(0, 7)).full}` : 'Belum ada data'}</span>
        </div>
        <div>
          <strong>Bulan aktif</strong>
          <span>{focusMonth ? focusMonth.full : `${months.length} bulan ditampilkan`}</span>
        </div>
        <div>
          <strong>Total file tersimpan</strong>
          <span>{files.length} file</span>
        </div>
        <div>
          <strong>Untuk Report Generator</strong>
          <span className="brand-data-link">Pilih brand &amp; periode <ArrowUpRight size={13} /></span>
        </div>
      </div>

      <div className="brand-market-zone" style={{ '--mk-accent': platform.accent, '--mk-wash': platform.wash, '--mk-tint': platform.tint }}>
        <LayoutGroup id="brand-market">
          <nav className="brand-market-rail" aria-label="Sumber data marketplace">
            {PLATFORMS.map((item) => {
              const itemSummary = platformSummary(item, months, lookup);
              const active = item.id === marketId;
              return (
                <button
                  key={item.id} type="button"
                  className={`brand-market-tab ${active ? 'is-active' : ''}`}
                  style={{ '--mk-accent': item.accent, '--mk-wash': item.wash, '--mk-tint': item.tint }}
                  onClick={() => setMarketId(item.id)}
                  aria-pressed={active}
                >
                  {active && (
                    <motion.span
                      className="brand-market-pill" layoutId="brand-market-pill" aria-hidden="true"
                      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 44, mass: .6 }}
                    />
                  )}
                  <span className="brand-market-tab-mark" aria-hidden="true">
                    {item.label.slice(0, 1)}
                    <i className={`brand-market-dot ${itemSummary.ready === 100 ? 'is-full' : itemSummary.ready > 0 ? 'is-partial' : 'is-empty'}`} />
                  </span>
                  <span className="brand-market-tab-text">
                    <strong>{item.label}</strong>
                    <small>{itemSummary.active} dataset · {itemSummary.ready}% siap</small>
                  </span>
                </button>
              );
            })}
          </nav>
        </LayoutGroup>

        <MonthRail
          axis={axis} windowStart={windowStart} setWindowStart={setWindowStart}
          focus={focus} setFocus={setFocus} lookup={lookup} platformId={platform.id} reduced={reduced}
        />

        <div className="brand-cov-legend">
          <span><i className="is-full" /> Lengkap</span>
          <span><i className="is-partial" /> Sebagian</span>
          <span><i className="is-snapshot" /> Snapshot bulanan</span>
          <span><i className="is-empty" /> Belum ada</span>
          <span className="brand-cov-legend-hint">Klik sel untuk upload ke bulan itu · klik nama dataset untuk detail hari.</span>
        </div>

        <AnimatePresence mode="wait">
          <PlatformPanel
            key={platform.id} platform={platform} months={months} lookup={lookup} reduced={reduced}
            onPick={onPick} onDelete={onDelete} busyKey={busyKey} focusMonth={focusMonth}
          />
        </AnimatePresence>
      </div>
    </>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function BrandSettingsPage() {
  const reduced = useReducedMotion();
  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState(null);
  const [activeView, setActiveView] = useState('context');
  const [marketId, setMarketId] = useState('shopee');

  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const [windowStart, setWindowStart] = useState(0);
  const [focus, setFocus] = useState(null);

  const pending = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => {
    let alive = true;
    api.get('/brands')
      .then(({ data }) => {
        if (!alive) return;
        const list = data.brands ?? [];
        setBrands(list);
        setBrand((current) => current ?? list[0] ?? null);
      })
      .catch(() => alive && setError('Gagal memuat daftar brand.'));
    return () => { alive = false; };
  }, []);

  const loadBrand = useCallback(async (brandId) => {
    setLoading(true);
    setError(null);
    try {
      const [profileRes, libraryRes] = await Promise.all([
        api.get(`/brands/${brandId}/profile`),
        api.get(`/brands/${brandId}/library`),
      ]);
      setProfile(profileRes.data.profile);
      setDraft(profileRes.data.profile ?? {});
      setFiles(libraryRes.data.files ?? []);
    } catch (err) {
      setError(describeError(err, 'Gagal memuat data brand'));
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!brand) return;
    setFocus(null);
    loadBrand(brand.brand_id);
  }, [brand, loadBrand]);

  const axis = useMemo(() => buildMonthAxis(files), [files]);
  useEffect(() => { setWindowStart(Math.max(0, axis.length - MONTH_WINDOW)); }, [axis.length]);

  const windowMonths = useMemo(() => axis.slice(windowStart, windowStart + MONTH_WINDOW), [axis, windowStart]);
  const months = useMemo(() => {
    if (!focus) return windowMonths;
    const picked = axis.find((m) => m.key === focus);
    return picked ? [picked] : windowMonths;
  }, [axis, windowMonths, focus]);

  const lookup = useMemo(() => {
    const map = new Map();
    for (const file of files) map.set(fileKey(file.platform, file.channel, file.period_month?.slice(0, 7) ?? null), file);
    return map;
  }, [files]);

  const dirty = useMemo(
    () => [...CONTEXT_FIELDS, ...DIRECTION_FIELDS].some(([key]) => (draft[key] ?? '') !== (profile?.[key] ?? '')),
    [draft, profile],
  );

  const saveProfile = async () => {
    if (!brand) return;
    setSaving(true);
    try {
      const { data } = await api.put(`/brands/${brand.brand_id}/profile`, draft);
      setProfile((current) => ({ ...current, ...data.profile }));
      setNotice('Perubahan tersimpan.');
    } catch (err) {
      setNotice(describeError(err, 'Gagal menyimpan perubahan'));
    } finally {
      setSaving(false);
    }
  };

  // Upload targets a single (platform, channel, month) slot. The month is
  // whatever cell was clicked — or the focused month when the whole panel is
  // narrowed to one — so a file can never land in a period the user did not
  // choose.
  const pickFile = (dataset, month) => {
    if (!brand) {
      setNotice('Pilih brand terlebih dahulu sebelum mengunggah file.');
      return;
    }
    pending.current = { dataset, month: focus ? months[0] : month };
    fileInput.current.value = '';
    fileInput.current.click();
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    const target = pending.current;
    if (!file || !target || !brand) return;

    const key = fileKey(marketId, target.dataset.channel, target.month?.key ?? null);
    setBusyKey(key);
    setNotice(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('platform', marketId);
      form.append('channel', target.dataset.channel);
      if (target.month) form.append('month', target.month.key);
      const { data } = await api.post(`/brands/${brand.brand_id}/library`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setFiles((current) => [...current.filter((f) => f.id !== data.file.id), data.file]);
      setError(null);
      const where = `${target.dataset.name} · ${target.month ? target.month.full : 'referensi'}`;
      setNotice(data.warning
        ? `${where} tersimpan. ${data.warning}`
        : `${where} tersimpan (${data.file.covered_days} hari terdeteksi).`);
    } catch (err) {
      setNotice(describeError(err, `Gagal mengunggah ${file.name}`));
    } finally {
      setBusyKey(null);
      pending.current = null;
    }
  };

  const removeFile = async (file) => {
    if (!brand) return;
    setBusyKey(fileKey(file.platform, file.channel, file.period_month?.slice(0, 7) ?? null));
    try {
      await api.delete(`/brands/${brand.brand_id}/library/${file.id}`);
      setFiles((current) => current.filter((f) => f.id !== file.id));
      setNotice('File dihapus dari perpustakaan.');
    } catch (err) {
      setNotice(describeError(err, 'Gagal menghapus file'));
    } finally {
      setBusyKey(null);
    }
  };

  const createBrand = async (event) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const { data } = await api.post('/brands', { brandName: name });
      setBrands((current) => [...current, data.brand].sort((a, b) => a.brand_name.localeCompare(b.brand_name)));
      setBrand(data.brand);
      setCreating(false);
      setNotice(`Brand "${data.brand.brand_name}" dibuat. Lengkapi context dan datanya di bawah.`);
    } catch (err) {
      setNotice(err.response?.data?.message || 'Gagal membuat brand baru.');
    }
  };

  const view = VIEWS.find((v) => v.id === activeView);
  const setField = (key) => (value) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="con brand-settings">
      <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" hidden onChange={handleFile} />

      <header className="brand-hero">
        <span className="brand-hero-fx" aria-hidden="true"><i className="brand-hero-aurora" /><i className="brand-hero-grid" /></span>

        <div className="brand-hero-main">
          <motion.div
            className="brand-hero-copy"
            initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: .4, ease: EASE }}
          >
            <span className="brand-hero-eye"><Sparkles size={13} /> Brand workspace</span>
            <h1>Pengaturan Brand</h1>
            <p>Identitas, arah, dan file sumber—satu record yang dipakai ATLAS untuk membaca bisnis dan menyusun laporan.</p>
            <div className="brand-hero-stats">
              <span><strong>{brands.length}</strong> brand dikelola</span>
              <span><strong>{files.length}</strong> file tersimpan</span>
              <span><strong>{PLATFORMS.length}</strong> sumber marketplace</span>
            </div>
          </motion.div>

          <motion.div
            className="brand-hero-badge" aria-hidden="true"
            initial={reduced ? false : { opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: .45, ease: EASE, delay: .06 }}
          >
            <span className="brand-hero-ring" /><span className="brand-hero-ring brand-hero-ring-b" />
            <img src={atlasIcon} alt="" className="brand-hero-mark" />
            <img src={atlasWordmark} alt="" className="brand-hero-logo" />
            <small>Source of truth</small>
          </motion.div>
        </div>

        <div className="brand-dock">
          <div className="brand-dock-copy">
            <span>Brand yang sedang dikelola</span>
            <small>Setiap perubahan terikat pada satu sumber kebenaran.</small>
          </div>
          <BrandPicker brands={brands} brand={brand} sector={profile?.sector} onSelect={setBrand} reduced={reduced} />
          {creating ? (
            <form className="brand-new-form" onSubmit={createBrand}>
              <input
                value={newName} onChange={(event) => setNewName(event.target.value)}
                placeholder="Nama brand baru" autoFocus
                onKeyDown={(event) => { if (event.key === 'Escape') setCreating(false); }}
              />
              <button type="submit" className="brand-new" disabled={!newName.trim()}><Check size={15} /> Simpan</button>
            </form>
          ) : (
            <button type="button" className="brand-new" onClick={() => { setNewName(''); setCreating(true); }}>
              <Plus size={16} /> Brand baru
            </button>
          )}
        </div>
      </header>

      <LayoutGroup id="brand-workspace-nav">
        <nav className="brand-view-nav" aria-label="Bagian pengaturan brand" role="tablist">
          {VIEWS.map(({ id, label, Icon }) => (
            <button
              key={id} type="button" role="tab" aria-selected={activeView === id}
              className={`brand-view-tab ${activeView === id ? 'is-active' : ''}`}
              onClick={() => setActiveView(id)}
            >
              {activeView === id && (
                <motion.span
                  layoutId="brand-active-view" className="brand-view-pill" aria-hidden="true"
                  transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 44, mass: .6 }}
                />
              )}
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </LayoutGroup>

      <div className="brand-view-caption">
        <span>{view?.note}</span>
        <span className="brand-caption-rule" />
        {loading
          ? <span className="brand-caption-load"><Loader2 size={13} className="brand-spin" /> Memuat data brand…</span>
          : <span className="brand-caption-saved"><Check size={13} /> Tersimpan per brand</span>}
      </div>

      {error && (
        <div className="brand-flash is-error">
          <CircleAlert size={15} />
          <span>{error}</span>
          <button type="button" onClick={() => brand && loadBrand(brand.brand_id)}>Coba lagi</button>
        </div>
      )}
      {notice && (
        <div className="brand-flash">
          <CircleAlert size={15} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>Tutup</button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {activeView === 'context' && (
          <ViewShell viewId="context" reduced={reduced}>
            <SectionHead
              title="Brand context"
              description="Isi fakta yang tidak dapat disimpulkan dari angka. Perbarui hanya saat ada perubahan material pada bisnis."
              meta="5 field esensial"
            />
            <div className="brand-context-grid">
              {CONTEXT_FIELDS.map(([key, label, guidance]) => (
                <Field key={key} label={label} guidance={guidance} value={draft[key]} onChange={setField(key)} />
              ))}
            </div>
            <div className="brand-workspace-foot">
              <CircleAlert size={15} />
              <span>Jangan menulis ulang metrics dashboard di sini—berikan konteks yang menjelaskan <em>mengapa</em> angka dapat berubah.</span>
            </div>
            <SaveBar profile={profile} saving={saving} dirty={dirty} onSave={saveProfile} />
          </ViewShell>
        )}

        {activeView === 'direction' && (
          <ViewShell viewId="direction" reduced={reduced}>
            <SectionHead
              title="Current direction"
              description="Objective, prioritas, dan constraint yang membantu tim menghubungkan data dengan keputusan yang tepat."
              meta="Review quarterly"
            />
            <div className="brand-context-grid brand-direction-grid">
              {DIRECTION_FIELDS.map(([key, label, guidance]) => (
                <Field key={key} label={label} guidance={guidance} value={draft[key]} onChange={setField(key)} />
              ))}
            </div>
            <SaveBar profile={profile} saving={saving} dirty={dirty} onSave={saveProfile} />
          </ViewShell>
        )}

        {activeView === 'data' && (
          <ViewShell viewId="data" reduced={reduced}>
            <DataView
              brand={brand} files={files} months={months} axis={axis}
              windowStart={windowStart} setWindowStart={(next) => { setWindowStart(next); setFocus(null); }}
              focus={focus} setFocus={setFocus} lookup={lookup} reduced={reduced}
              onPick={pickFile} onDelete={removeFile} busyKey={busyKey}
              marketId={marketId} setMarketId={setMarketId}
            />
          </ViewShell>
        )}
      </AnimatePresence>
    </div>
  );
}
