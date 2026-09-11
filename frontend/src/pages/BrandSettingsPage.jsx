import useSessionState from '../hooks/useSessionState.js';
import BrandStatusFilter, { matchesBrandStatus, BRAND_STATUS_LABELS } from '../components/common/BrandStatusFilter.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import {
  Archive, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert,
  CloudUpload, Database, Download, FileSpreadsheet, Layers3, Loader2, Plus, RefreshCw, Save,
  Search, Sparkles, Trash2, Upload,
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
  import: 'periode dari hasil impor',
  mismatch: '⚠ periode file DI LUAR bulan ini',
};

const VIEWS = [
  { id: 'brands', label: 'Daftar brand', Icon: Layers3, note: 'Kelola status klien dari satu daftar bersama' },
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

// Shopee splits a big month's export into parts, so a slot holds a list.
// The month's coverage is their union: part 1 stopping on the 24th and part 2
// running from the 24th is a complete month, not two partial ones.
function mergeParts(parts, month) {
  if (!parts?.length) return null;
  const days = month?.days ?? 0;
  let bitmap = null;
  if (days) {
    const merged = Array(days).fill('0');
    for (const part of parts) {
      const bits = part.day_bitmap ?? '';
      for (let i = 0; i < days; i += 1) if (bits[i] === '1') merged[i] = '1';
    }
    bitmap = merged.join('');
  }
  return {
    parts,
    dayBitmap: bitmap,
    coveredDays: bitmap ? [...bitmap].filter((c) => c === '1').length : 0,
    rowCount: parts.reduce((total, part) => total + (part.row_count ?? 0), 0),
    inDashboard: parts.some((part) => part.dashboard_upload_id),
  };
}

function cellState(merged, month) {
  if (!merged) return 'empty';
  if (!month) return 'ref';
  if (merged.coveredDays >= month.days) return 'full';
  if (merged.coveredDays > 0) return 'partial';
  // Files are there but no date column could be read — a monthly snapshot
  // export (Product Performance, some ad exports). Saying "belum ada" would
  // be a lie; saying "30 hari" would be a bigger one.
  return 'snapshot';
}

// Tiga dataset ini dibaca Dashboard Business Overview dari tabel fakta, bukan
// dari byte filenya. Untuk ketiganya "tersimpan" dan "terbaca" adalah dua hal
// berbeda, dan perbedaan itu yang dulu disembunyikan status "Lengkap".
const DASHBOARD_CHANNELS = new Set(['order', 'performance_overview', 'product_performance']);

// Satu predikat untuk semuanya — chip status, catatan merah, tombol "Impor
// ulang", dan label per file. Sebelumnya catatan dan tombol memakai syarat
// berbeda: catatan muncul kalau dashboard_upload_id kosong, tombol hanya
// kalau import_status === 'failed'. File yang diunggah sebelum kolom itu ada
// (import_status NULL) lolos syarat pertama dan gagal syarat kedua, jadi
// catatannya menyuruh mengklik tombol yang tidak pernah dirender.
function needsImport(channel, file) {
  if (!DASHBOARD_CHANNELS.has(channel)) return false;
  if (file.import_status === 'success') return false;
  return file.import_status === 'failed' || file.dashboard_upload_id == null;
}

function failedImports(channel, parts) {
  return (parts ?? []).filter((file) => needsImport(channel, file));
}

function datasetStatus(dataset, months, lookup, platformId) {
  if (dataset.kind === 'reference') {
    return lookup.get(fileKey(platformId, dataset.channel, null))
      ? { label: 'Referensi', tone: 'ref' }
      : { label: 'Belum ada', tone: 'idle' };
  }
  const present = months.filter((m) => lookup.has(fileKey(platformId, dataset.channel, m.key)));
  if (!present.length) return dataset.kind === 'extra' ? { label: 'Opsional', tone: 'idle' } : { label: 'Belum ada', tone: 'warn' };

  // File ada, tapi untuk dataset Dashboard belum tentu datanya terbaca.
  // Menampilkan "Lengkap" di keadaan itu adalah kebohongan yang membuat
  // orang berhenti mencari masalah.
  if (DASHBOARD_CHANNELS.has(dataset.channel)) {
    const stuck = months.flatMap((m) => failedImports(dataset.channel, lookup.get(fileKey(platformId, dataset.channel, m.key))));
    if (stuck.length) return { label: 'Belum diimpor', tone: 'warn' };
  }

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
    const states = core.map((d) => cellState(mergeParts(lookup.get(fileKey(platform.id, d.channel, month.key)), month), month));
    if (states.length && states.every((s) => s !== 'empty')) return { ...month, state: 'full' };
    if (states.some((s) => s !== 'empty')) return { ...month, state: 'partial' };
    return { ...month, state: 'empty' };
  });
  return { ready: slots ? Math.round((filled / slots) * 100) : 0, active, monthStates };
}

/* ── Brand picker ───────────────────────────────────────────────────────── */

function BrandPicker({ brands, brand, sector, onSelect, reduced }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useSessionState('brand-settings:search', '');
  const [status, setStatus] = useSessionState('brand-settings:status', 'active');
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (!wrap.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // 141 brands is past the point where scrolling is a reasonable way to find
  // one; typing two letters is not.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return brands.filter(b => matchesBrandStatus(b, status));
    return brands.filter(b => matchesBrandStatus(b, status))
      .filter((item) => item.brand_name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.brand_name.toLowerCase().startsWith(q);
        const bStarts = b.brand_name.toLowerCase().startsWith(q);
        return aStarts === bStarts ? 0 : aStarts ? -1 : 1;
      });
  }, [brands, query, status]);

  return (
    <div className="brand-picker" ref={wrap}>
      <button type="button" className={`brand-picker-btn ${open ? 'is-open' : ''}`} onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="brand-picker-text">
          <strong>{brand?.brand_name ?? 'Pilih brand'}</strong>
          <small>{sector || `${brands.length} brand terdaftar`}</small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="brand-picker-menu"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: .99 }}
            transition={{ duration: .16, ease: EASE }}
          >
            <div className="brand-picker-menu-head">
              <label className="brand-picker-search">
                <Search size={16} aria-hidden="true" />
                <input
                  value={query} onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cari nama brand…" autoFocus aria-label="Cari brand"
                />
              </label>
              <span>{shown.length} brand ditemukan</span>
            </div>
            <div className="brand-picker-menu-body">
              <aside className="brand-picker-filters">
                <span className="brand-picker-section-label">Status klien</span>
                <BrandStatusFilter value={status} onChange={setStatus} />
              </aside>
              <div className="brand-picker-results">
                <div className="brand-picker-results-head">
                  <span className="brand-picker-section-label">Daftar brand</span>
                  <small>Pilih untuk membuka pengaturan</small>
                </div>
                <ul role="listbox">
                  {shown.map((item) => {
                    const itemStatus = item.status || 'unknown';
                    return (
                      <li key={item.brand_id}>
                        <button
                          type="button" role="option" aria-selected={item.brand_id === brand?.brand_id}
                          className={item.brand_id === brand?.brand_id ? 'is-active' : ''}
                          onClick={() => { onSelect(item); setOpen(false); }}
                        >
                          <span className={`brand-status-dot is-${itemStatus}`} aria-hidden="true" />
                          <span className="brand-picker-result-copy">
                            <strong>{item.brand_name}</strong>
                            <small>{BRAND_STATUS_LABELS[itemStatus]}</small>
                          </span>
                          {item.brand_id === brand?.brand_id && <Check size={15} />}
                        </button>
                      </li>
                    );
                  })}
                  {!shown.length && <li className="brand-picker-empty">Tidak ada brand yang cocok. Coba ubah pencarian atau status.</li>}
                </ul>
              </div>
            </div>
          </motion.div>
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

function DayStrip({ merged, month, wash }) {
  const bitmap = merged?.dayBitmap ?? '';
  const parts = merged?.parts?.length ?? 0;
  return (
    <div className="brand-daygrid-month">
      <div className="brand-daygrid-head">
        <strong>{month.full}</strong>
        <span className={!merged ? 'is-empty' : merged.coveredDays >= month.days ? 'is-full' : merged.coveredDays > 0 ? 'is-partial' : 'is-empty'}>
          {merged ? (merged.coveredDays > 0 ? `${merged.coveredDays} / ${month.days} hari${parts > 1 ? ` · ${parts} part` : ''}` : 'snapshot bulanan') : 'belum ada'}
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

function DatasetRow({ platform, dataset, months, lookup, index, reduced, onPick, onDelete, onReimport, busyKey, targetMonth }) {
  const [open, setOpen] = useState(false);
  const isReference = dataset.kind === 'reference';
  const status = datasetStatus(dataset, months, lookup, platform.id);
  const detailMonths = isReference ? [] : months;
  const refFile = isReference ? lookup.get(fileKey(platform.id, dataset.channel, null))?.[0] : null;
  const lastMonth = months[months.length - 1];
  // Which month a "+ part" lands in: the one the panel is filtered to, or the
  // most recent one on screen. Never ambiguous, and it is the same month the
  // row's upload button uses.
  const partMonth = targetMonth ?? lastMonth;
  const targetParts = isReference ? [] : (lookup.get(fileKey(platform.id, dataset.channel, partMonth?.key)) ?? []);

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
            const key = fileKey(platform.id, dataset.channel, month.key);
            const merged = mergeParts(lookup.get(key), month);
            const state = cellState(merged, month);
            const pct = merged?.coveredDays ? Math.round((merged.coveredDays / month.days) * 100) : state === 'snapshot' ? 100 : 0;
            return (
              <button
                key={month.key} type="button"
                className={`brand-cov is-${state} ${busyKey === key ? 'is-busy' : ''}`}
                style={{ '--cov-accent': platform.accent, '--cov-wash': platform.wash, '--cov-fill': `${pct}%` }}
                onClick={() => merged ? setOpen(true) : onPick(dataset, month)}
                title={merged
                  ? `${month.full} · ${merged.coveredDays > 0 ? `${merged.coveredDays} dari ${month.days} hari` : 'snapshot bulanan'} · ${merged.parts.length} file (klik untuk melihat detail)`
                  : `${month.full} · belum ada file (klik untuk upload)`}
              >
                <i aria-hidden="true" />
                <b>{busyKey === key ? '…' : state === 'empty' ? '+' : state === 'snapshot' ? '✓' : merged.coveredDays}</b>
              </button>
            );
          })}

        <span className="brand-ds-parts">
          {targetParts.map((part) => (
            <em key={part.id} title={`${part.original_filename}${part.row_count ? ` · ${part.row_count.toLocaleString('id-ID')} baris` : ''}`}>
              {part.period_start && part.period_end
                ? `${Number(part.period_start.slice(8, 10))}–${Number(part.period_end.slice(8, 10))}`
                : part.period_source === 'mismatch' ? '⚠ bulan lain' : 'snapshot'}
            </em>
          ))}
          {!isReference && targetMonth && (
            <button
              type="button" className="brand-ds-addpart"
              onClick={() => onPick(dataset, targetMonth)}
              title={`Tambah file untuk ${targetMonth.full} — opsional, isi jika ekspor Shopee terbagi (part 1 of 2)`}
            >
              <Plus size={12} /> {targetParts.length ? 'part' : 'file'}
            </button>
          )}
        </span>
        <span className={`brand-ds-status is-${status.tone}`}>
          {status.tone === 'ok' && <Check size={12} />}{status.label}
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
            <div className="brand-ds-detail-inner">
              {isReference
                ? <p className="brand-ds-note">File referensi tanpa periode. ATLAS memakainya untuk memetakan nama produk ke Category / Series di seluruh laporan.</p>
                : (
                  <div className="brand-daygrid">
                    {detailMonths.map((month) => (
                      <DayStrip key={month.key} month={month} wash={platform.wash} merged={mergeParts(lookup.get(fileKey(platform.id, dataset.channel, month.key)), month)} />
                    ))}
                  </div>
                )}
              {months.flatMap((m) => failedImports(dataset.channel, lookup.get(fileKey(platform.id, dataset.channel, m.key)))).slice(0, 1).map((f) => (
                <p className="brand-ds-failnote" key={f.id}>
                  <CircleAlert size={14} />
                  <span>
                    <strong>File tersimpan, tetapi datanya belum masuk Dashboard.</strong>{' '}
                    {f.import_error || 'Impor sebelumnya tidak pernah selesai — kemungkinan terputus sebelum sempat mencatat alasannya.'} Byte filenya sudah ada di server, jadi cukup klik
                    “Impor ulang” di bawah — tidak perlu mengunggah ulang.
                  </span>
                </p>
              ))}
              <div className="brand-ds-files">
                {(isReference
                  ? (refFile ? [[null, refFile]] : [])
                  : months.flatMap((m) => (lookup.get(fileKey(platform.id, dataset.channel, m.key)) ?? []).map((f) => [m, f]))
                ).map(([month, file]) => (
                  <div className="brand-ds-file" key={file.id}>
                    <span className="brand-ds-fileinfo">
                      <FileSpreadsheet size={14} />
                      <strong>
                        {month ? month.full : 'Referensi'}
                        {file.period_start && file.period_end && (lookup.get(fileKey(platform.id, dataset.channel, month?.key))?.length ?? 0) > 1
                          ? ` · ${Number(file.period_start.slice(8, 10))}–${Number(file.period_end.slice(8, 10))}`
                          : ''}
                      </strong>
                      {file.original_filename}
                      {file.row_count ? ` · ${file.row_count.toLocaleString('id-ID')} baris` : ''}
                      {file.period_source ? ` · ${PERIOD_SOURCE_LABEL[file.period_source] ?? file.period_source}` : ''}
                      {needsImport(dataset.channel, file)
                        ? ' · BELUM masuk Dashboard'
                        : file.dashboard_upload_id || file.import_status === 'success'
                          ? ` · terbaca Dashboard${file.import_rows ? ` (${file.import_rows.toLocaleString('id-ID')} baris)` : ''}`
                          : ''}
                      {` · ${new Date(file.uploaded_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                    </span>
                    <span className="brand-ds-fileacts">
                      {needsImport(dataset.channel, file) && (
                        <button type="button" className="is-retry" onClick={() => onReimport(file)} disabled={busyKey === `import-${file.id}`}>
                          {busyKey === `import-${file.id}` ? 'Mengimpor…' : <><RefreshCw size={14} /> Impor ulang</>}
                        </button>
                      )}
                      <button type="button" onClick={() => onPick(dataset, month, file)}><Upload size={14} /> Ganti</button>
                      <a href={`/api/brands/${file.brand_id}/library/${file.id}/download`} download><Download size={14} /> Unduh</a>
                      <button type="button" className="is-danger" onClick={() => onDelete(file)}><Trash2 size={14} /> Hapus</button>
                    </span>
                  </div>
                ))}
                {!isReference && (
                  <p className="brand-ds-note">
                    <CircleAlert size={14} />
                    {DASHBOARD_CHANNELS.has(dataset.channel)
                      ? 'Ekspor yang terbagi (part 1 of 2) boleh diunggah ke bulan yang sama. ATLAS menggabungkan cakupan dan menyaring transaksi yang memiliki identitas sama.'
                      : 'Ekspor yang terbagi boleh diunggah ke bulan yang sama. Pastikan rentang setiap part saling melanjutkan dan tidak tumpang tindih.'}
                  </p>
                )}
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

function PlatformPanel({ platform, months, lookup, reduced, onPick, onDelete, onReimport, busyKey, focusMonth }) {
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
          <span className="brand-ds-head-parts">Part <small>opsional</small></span>
          <span>Status</span>
        </div>
        {platform.datasets.map((dataset, index) => (
          <DatasetRow
            key={dataset.channel} platform={platform} dataset={dataset} months={months} lookup={lookup}
            index={index} reduced={reduced} onPick={onPick} onDelete={onDelete} onReimport={onReimport} busyKey={busyKey}
            targetMonth={focusMonth ?? months[months.length - 1]}
          />
        ))}
      </div>

      <div className="brand-drop">
        <span className="brand-drop-icon"><CloudUpload size={20} /></span>
        <span className="brand-drop-copy">
          <strong>Upload file {platform.label} · {target?.full}</strong>
          <small>
            Klik sel bulan yang kosong untuk file pertama. Buka detail dataset lalu gunakan Ganti untuk pembaruan file, atau + part hanya jika ekspornya memang terbagi.
          </small>
        </span>
        <span className="brand-drop-cta">{focusMonth ? `Terkunci ke ${focusMonth.full}` : 'Bulan mengikuti sel'}</span>
      </div>
    </motion.div>
  );
}

function DataView({ brand, files, months, axis, windowStart, setWindowStart, focus, setFocus, lookup, reduced, onPick, onDelete, onReimport, busyKey, marketId, setMarketId }) {
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

      <div className="brand-data-guard" role="note" aria-label="Panduan aman memperbarui data">
        <span className="brand-data-guard-icon"><CircleAlert size={18} /></span>
        <span className="brand-data-guard-intro">
          <strong>Satu pusat data untuk seluruh ATLAS</strong>
          <small>Dashboard dan Report Generator membaca file dari halaman ini. Pastikan brand, dataset, dan bulan sudah tepat sebelum memilih file.</small>
        </span>
        <span>
          <strong>File periode diperbarui?</strong>
          <small>Buka detail dataset dan tekan <b>Ganti</b>. File serta hasil impor lama diganti, sehingga data lama tidak dijumlahkan dua kali.</small>
        </span>
        <span>
          <strong>Ekspor memang terpecah?</strong>
          <small>Gunakan <b>+ part</b> hanya untuk lanjutan file pada bulan yang sama dan pastikan tanggalnya tidak tumpang tindih. File revisi harus memakai Ganti.</small>
        </span>
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
          <span className="brand-cov-legend-hint">Sel kosong untuk upload · sel berisi atau nama dataset untuk melihat detail.</span>
        </div>

      <AnimatePresence mode="wait">
          <PlatformPanel
            key={platform.id} platform={platform} months={months} lookup={lookup} reduced={reduced}
            onPick={onPick} onDelete={onDelete} onReimport={onReimport} busyKey={busyKey} focusMonth={focusMonth}
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
  const [lastBrandId, setLastBrandId] = useSessionState('brand-settings:brand', null);
  const [listQuery, setListQuery] = useSessionState('brand-settings:list-query', '');
  const [listStatus, setListStatus] = useSessionState('brand-settings:list-status', 'all');
  const [statusBusy, setStatusBusy] = useState(null);
  const [activeView, setActiveView] = useSessionState('brand-settings:view', 'brands');
  const [marketId, setMarketId] = useSessionState('brand-settings:platform', 'shopee');

  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
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
        setBrand((current) => current ?? list.find(b => b.brand_id === lastBrandId) ?? list.find(b => b.status === 'active') ?? list[0] ?? null);
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
    setLastBrandId(brand.brand_id);
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
    for (const file of files) {
      const key = fileKey(file.platform, file.channel, file.period_month?.slice(0, 7) ?? null);
      const parts = map.get(key) ?? [];
      parts.push(file);
      map.set(key, parts);
    }
    for (const parts of map.values()) {
      parts.sort((a, b) => (a.period_start ?? '').localeCompare(b.period_start ?? '') || a.part_index - b.part_index);
    }
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
  const pickFile = (dataset, month, replaceFile = null) => {
    if (!brand) {
      setNotice('Pilih brand terlebih dahulu sebelum mengunggah file.');
      return;
    }
    pending.current = { dataset, month: focus ? months[0] : month, replaceFile };
    fileInput.current.value = '';
    fileInput.current.click();
  };

  const handleFile = async (event) => {
    const picked = [...(event.target.files ?? [])];
    const target = pending.current;
    if (!picked.length || !target || !brand) return;

    const key = fileKey(marketId, target.dataset.channel, target.month?.key ?? null);
    setBusyKey(key);
    setNotice(null);
    try {
      const form = new FormData();
      // One field name, several files: a split month is filed in one action.
      for (const item of picked) form.append('file', item);
      form.append('platform', marketId);
      form.append('channel', target.dataset.channel);
      if (target.month) form.append('month', target.month.key);
      if (target.replaceFile?.id) form.append('replaceFileId', String(target.replaceFile.id));
      const { data } = await api.post(`/brands/${brand.brand_id}/library`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const saved = data.files ?? [data.file];
      const savedIds = new Set(saved.map((f) => f.id));
      setFiles((current) => [...current.filter((f) => !savedIds.has(f.id)), ...saved]);
      setError(null);
      const where = `${target.dataset.name} · ${target.month ? target.month.full : 'referensi'}`;
      const parts = [data.warnings?.length ? data.warnings.join(' ') : `${saved.length} file · ${saved.reduce((t, f) => t + (f.covered_days ?? 0), 0)} hari terdeteksi`];
      // The three Dashboard datasets are also parsed into the fact tables
      // Business Overview reads; say so, because "tersimpan" alone left the
      // dashboard's zeros unexplained.
      if (data.imported?.rowsInserted) parts.push(`${data.imported.rowsInserted.toLocaleString('id-ID')} baris masuk ke Dashboard`);
      if (data.imported?.errors?.length) parts.push(`gagal masuk ke Dashboard: ${data.imported.errors.join('; ')}`);
      setNotice(`${where} ${target.replaceFile ? 'diganti' : 'tersimpan'} — ${parts.join(' · ')}.`);
    } catch (err) {
      setNotice(describeError(err, `Gagal mengunggah ${picked.map((f) => f.name).join(', ')}`));
    } finally {
      setBusyKey(null);
      pending.current = null;
    }
  };

  // Impor ulang memakai byte yang sudah tersimpan di server — tidak menuntut
  // pengguna mengunggah file yang sama untuk kedua kalinya.
  const reimportFile = async (file) => {
    if (!brand) return;
    setBusyKey(`import-${file.id}`);
    setNotice(null);
    try {
      const { data } = await api.post(`/brands/${brand.brand_id}/library/${file.id}/import`);
      await loadBrand(brand.brand_id);
      setError(null);
      // 0 baris bukan kegagalan: importer melewati baris yang sudah ada
      // (ON CONFLICT DO NOTHING), jadi periode yang datanya sudah lengkap
      // memang tidak menambah apa pun. Mengatakan "0 baris" tanpa penjelasan
      // membuat orang mengira impornya tidak jalan.
      const n = data.imported.rowsInserted;
      setNotice(n > 0
        ? `${file.original_filename}: ${n.toLocaleString('id-ID')} baris masuk ke Dashboard.`
        : `${file.original_filename}: tidak ada baris baru — datanya memang sudah ada di Dashboard. Status sekarang tercatat benar.`);
    } catch (err) {
      setNotice(describeError(err, `Impor ulang ${file.original_filename} gagal`));
    } finally {
      setBusyKey(null);
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
    if (!name || creatingBusy) return;
    setCreatingBusy(true);
    try {
      const { data } = await api.post('/brands', { brandName: name });
      setBrands((current) => [...current, data.brand].sort((a, b) => a.brand_name.localeCompare(b.brand_name)));
      setBrand(data.brand);
      setCreating(false);
      setActiveView('context');
      setNotice(`Brand "${data.brand.brand_name}" dibuat. Lengkapi context dan datanya di bawah.`);
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Gagal membuat brand baru.');
    } finally { setCreatingBusy(false); }
  };

  async function changeStatus(item, status) {
    setStatusBusy(item.brand_id);
    setError(null);
    try {
      const { data } = await api.patch(`/brands/${item.brand_id}/status`, { status });
      setBrands(list => list.map(b => b.brand_id === item.brand_id ? data.brand : b));
      setBrand(current => current?.brand_id === item.brand_id ? data.brand : current);
      setNotice(`${item.brand_name}: status ${BRAND_STATUS_LABELS[status].toLowerCase()} tersimpan.`);
    } catch (err) { setError(describeError(err, 'Gagal menyimpan status brand')); }
    finally { setStatusBusy(null); }
  }
  const view = VIEWS.find((v) => v.id === activeView);
  const setField = (key) => (value) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="con brand-settings">
      <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" multiple hidden onChange={handleFile} />

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
              <button type="submit" className="brand-new" disabled={creatingBusy || !newName.trim()}><Check size={15} /> Simpan</button>
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

        {activeView === 'brands' && <section className="brand-list-panel" aria-label="Daftar brand">
        <SectionHead title="Daftar brand" description="Status ini digunakan bersama oleh seluruh modul. Menonaktifkan brand tidak menghapus data dan laporan." meta={`${brands.filter(b => b.status === 'active').length} aktif dari ${brands.length} brand`} />
        <div className="brand-list-tools">
          <input aria-label="Cari dalam daftar brand" placeholder="Cari nama brand…" value={listQuery} onChange={e => setListQuery(e.target.value)} />
          <BrandStatusFilter value={listStatus} onChange={setListStatus} />
        </div>
        <div className="brand-list-table"><table><thead><tr><th>Brand</th><th>Status klien</th><th>Pengaturan</th></tr></thead><tbody>
          {brands.filter(b => matchesBrandStatus(b, listStatus) && b.brand_name.toLowerCase().includes(listQuery.trim().toLowerCase())).map(b => <tr key={b.brand_id}>
            <td>{b.brand_name}</td><td><select className={`brand-status-value is-${b.status || 'unknown'}`} aria-label={`Status ${b.brand_name}`} value={b.status ?? ''} disabled={statusBusy === b.brand_id} onChange={e => changeStatus(b, e.target.value)}>
              {!b.status && <option value="" disabled>Belum diatur</option>}
              {['active', 'off', 'freeze'].map(status => <option key={status} value={status}>{BRAND_STATUS_LABELS[status]}</option>)}
            </select>{statusBusy === b.brand_id && <span role="status"> Menyimpan…</span>}</td>
            <td><button type="button" className="brand-new" onClick={() => { setBrand(b); setActiveView('data'); }}>Buka data &amp; file</button></td>
          </tr>)}
        </tbody></table></div>
        {!brands.some(b => matchesBrandStatus(b, listStatus) && b.brand_name.toLowerCase().includes(listQuery.trim().toLowerCase())) && <p className="brand-picker-empty">Tidak ada brand yang cocok. Ubah pencarian atau filter status.</p>}
      </section>}
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
              onPick={pickFile} onDelete={removeFile} onReimport={reimportFile} busyKey={busyKey}
              marketId={marketId} setMarketId={setMarketId}
            />
          </ViewShell>
        )}
      </AnimatePresence>
    </div>
  );
}
