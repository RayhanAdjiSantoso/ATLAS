import useSessionState from '../hooks/useSessionState.js';
import BrandStatusFilter, { matchesBrandStatus, BRAND_STATUS_LABELS } from '../components/common/BrandStatusFilter.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert,
  Database, Download, FileSpreadsheet, Loader2, Plus, RefreshCw,
  Trash2, Upload, NotebookPen, CalendarRange, HelpCircle, BadgeCheck, CalendarClock,
} from 'lucide-react';
import MetaAutomationSection from '../components/brandSettings/MetaAutomationSection.jsx';
import MetaDatasetSpecs from '../components/brandSettings/MetaDatasetSpecs.jsx';
import GoogleAdsSection from '../components/brandSettings/GoogleAdsSection.jsx';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext.jsx';
import SearchField from '../components/common/SearchField.jsx';
import MetaAdsAutoFetchPanel from '../components/brandSettings/MetaAdsAutoFetchPanel.jsx';
import { BrandLogo } from '../reportGenerator/components/BrandLogo';
import { describeError } from '../components/brandSettings/describeError.js';
import '../components/dashboard/console.css';
import '../components/dashboard/softShell.css';
import './brandPages.css';

// The file is behind login, so a plain <a href> (which carries no token)
// gets the 401 JSON back and saves it as "download.json". Fetch it with the
// token and hand the browser the bytes under the original file name.
async function downloadLibraryFile(file) {
  try {
    const { data } = await api.get(`/brands/${file.brand_id}/library/${file.id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.original_filename || `file-${file.id}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    window.alert('File gagal diunduh. Coba lagi, atau muat ulang halaman.');
  }
}

// Data Collection Hub — where each brand's source material lives: the monthly file
// library every other module reads (Report Generator, Business Overview,
// Meta Automation) and its ad-account links. The brand's identity (status,
// brand context, current direction) is set in Pengaturan Brand; this page
// only reads the profile for the picker's subtitle and links back to it.
// Minutes of Meeting lives in Brand Tracking (components/mom/MinutesOfMeeting).
//
// The frame is Business Overview's soft layout — masthead, then a white
// command card holding the brand and its numbers — so the modules read as
// one product. Inside Performance Database:
//
//   1. One platform at a time, switched from a tab row under the card.
//   2. The month axis is a window of MONTH_WINDOW months, ending at the
//      current month by default and paged back as far as needed (the same
//      reach as Brand Tracking's month picker, not just back to the oldest
//      file), and picking one month narrows the whole panel to it — table,
//      day detail, and every upload target. That is also what makes uploading
//      unambiguous: a file dropped while "Juni 2026" is selected is stored
//      against June, not against "whatever the file looked like".
//   3. The how-to (replace vs. add a part, Google's automatic months) folds
//      into one disclosure, so the matrix is the first thing read.

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
      // Boost Post and Non Boost Post are separate slots, but a manual upload
      // is still the one Ads Manager export: it posts as `meta` (uploadChannel)
      // and the server splits its rows into both slots by campaign name
      // (services/metaUploadSplit.js). The API auto-fetch splits by the
      // account's Kata Kunci Boost Post instead.
      // `specs` points at the account type and catalog sections in Automate
      // Input with API (MetaAdsAutoFetchPanel), which lists the breakdowns
      // and metrics each file needs — the hint stays short instead of
      // repeating them.
      { channel: 'boost', uploadChannel: 'meta', name: 'Boost Post', hint: 'Export Ads Manager · campaign Boost Post', kind: 'core', specs: { type: 'MAIN', sections: ['boost'] } },
      { channel: 'nonboost', uploadChannel: 'meta', name: 'Non Boost Post', hint: 'Export Ads Manager · campaign E-commerce & B2B', kind: 'core', specs: { type: 'MAIN', sections: ['ecom', 'b2b'] } },
      { channel: 'cpas', name: 'CPAS', hint: 'Export Ads Manager · akun CPAS Shopee/Tokopedia', kind: 'core', specs: { type: 'CPAS', sections: ['cpas'] } },
      // The combined file of before the split. Shown only for brands that
      // still have one; an upload here is split like any other Meta export.
      { channel: 'meta', uploadChannel: 'meta', name: 'Meta Ads (gabungan lama)', hint: 'Opsional · arsip sebelum Boost & Non-Boost dipisah — tidak diperlukan bila Boost Post, Non Boost Post, atau CPAS sudah ada', kind: 'extra', legacy: true },
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
      { channel: 'order', name: 'Order', hint: 'Seller Centre › Pesanan Saya › Semua', kind: 'core' },
      { channel: 'performance_overview', name: 'Performance Overview', hint: 'Seller Centre › Performa Toko › Tinjauan › Status Siap Dikirim', kind: 'core' },
      { channel: 'overview', name: 'Product Overview', hint: 'Seller Centre › Performa Toko › Produk › Tinjauan Produk', kind: 'extra' },
      { channel: 'product_performance', name: 'Product Performance', hint: 'Seller Centre › Performa Toko › Produk › Performa Produk › Status Siap Dikirim', kind: 'core' },
      { channel: 'produk', name: 'Iklan Produk', hint: 'Seller Centre › Iklan Shopee › Iklan Produk › Download "Data Keseluruhan Iklan"', kind: 'core' },
      { channel: 'produk_otomatis', name: 'Iklan Produk Otomatis', hint: 'Seller Centre › Iklan Shopee › Iklan Produk › Download "Rincian Data Iklan Produk Otomatis"', kind: 'extra' },
      { channel: 'toko', name: 'Iklan Toko', hint: 'Seller Centre › Iklan Shopee › Iklan Toko+ › Download "Shop+ Ads Data"', kind: 'extra' },
      { channel: 'toko_keyword', name: 'Iklan Toko — Keyword', hint: 'Seller Centre › Iklan Shopee › Iklan Toko+ › Download "Data Kata Pencarian"', kind: 'extra' },
      { channel: 'live', name: 'Iklan Live', hint: 'Seller Centre › Iklan Shopee › Iklan Live', kind: 'extra' },
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
  {
    // Search terms and change history are filed here automatically after each
    // Google Ads Script run (googleAdsService.syncLibraryMonth); an upload in
    // the same month replaces that copy. Auction insights are upload-only:
    // Google does not open those metrics to scripts or the API. The
    // `autoOnly` slots are monthly archive copies of the synced datasets: the
    // report reads the synced data itself, so they take no upload.
    id: 'google',
    label: 'Google Ads',
    role: 'Search · kompetisi lelang & konteks perubahan',
    accent: '#1557b0',
    wash: '#4b9bff',
    tint: 'rgba(26,115,232,.13)',
    datasets: [
      { channel: 'auction_insights', name: 'Auction Insights', hint: 'Unggah manual · Google Ads › Insights & reports › Auction insights', kind: 'core' },
      { channel: 'search_terms', name: 'Search Terms', hint: 'Otomatis tiap hari, bulan berjalan s.d. kemarin · bisa diganti file Search terms report', kind: 'core' },
      { channel: 'change_history', name: 'Change History', hint: 'Otomatis tiap hari, bulan berjalan s.d. kemarin · bulan sebelum akun terhubung unggah manual', kind: 'core' },
      { channel: 'ads', name: 'Performa Iklan', hint: 'Arsip otomatis · performa per iklan + headline & description', kind: 'extra', autoOnly: true },
      { channel: 'conversions', name: 'Konversi per Action', hint: 'Arsip otomatis · konversi per conversion action per campaign', kind: 'extra', autoOnly: true },
      { channel: 'impression_share', name: 'Impression Share', hint: 'Arsip otomatis · Search IS, Lost IS budget/rank per campaign, ad group, keyword', kind: 'extra', autoOnly: true },
      { channel: 'campaign_settings', name: 'Setting Campaign', hint: 'Arsip otomatis · budget, bidding, target, lokasi yang berlaku di bulan itu', kind: 'extra', autoOnly: true },
      { channel: 'keyword_quality', name: 'Quality Score', hint: 'Arsip otomatis · snapshot Quality Score terakhir di bulan itu', kind: 'extra', autoOnly: true },
      { channel: 'devices', name: 'Device', hint: 'Arsip otomatis · performa per device per campaign', kind: 'extra', autoOnly: true },
      { channel: 'hourly', name: 'Per Jam', hint: 'Arsip otomatis · performa per tanggal & jam (zona waktu akun)', kind: 'extra', autoOnly: true },
      { channel: 'landing_pages', name: 'Landing Page', hint: 'Arsip otomatis · traffic & konversi per landing page', kind: 'extra', autoOnly: true },
    ],
  },
];

const PERIOD_SOURCE_LABEL = {
  declared: 'periode dari header file',
  filename: 'periode dari nama file',
  rows: 'periode dari isi baris',
  none: 'periode mengikuti slot bulan',
  import: 'periode dari hasil impor',
  mismatch: '⚠ periode file DI LUAR bulan ini',
};

/* ── Month model ────────────────────────────────────────────────────────
   A window of MONTH_WINDOW months ending at `endKey`. Not bounded by the
   brand's files: paging back reaches any earlier month, as Brand Tracking's
   month picker does, so a month can be filled before anything exists around
   it. Paging forward stops at the current month — nothing is uploaded for a
   month that has not started. */

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
const shiftMonthKey = (key, delta) => monthKey(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + delta, 1));

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

function monthWindow(endKey) {
  return Array.from({ length: MONTH_WINDOW }, (_, i) => buildMonth(shiftMonthKey(endKey, i - (MONTH_WINDOW - 1))));
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

// Tiga dataset ini dibaca Business Overview dari tabel fakta, bukan
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
  // The old combined Meta export is an archive, never a gap to close: the
  // split Boost / Non Boost / CPAS files replace it.
  if (dataset.legacy) return { label: 'Arsip · opsional', tone: 'ref' };
  if (!present.length) return dataset.autoOnly ? { label: 'Otomatis', tone: 'idle' } : dataset.kind === 'extra' ? { label: 'Opsional', tone: 'idle' } : { label: 'Belum ada', tone: 'warn' };

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
              <SearchField
                className="brand-picker-search"
                value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder="Cari nama brand…" autoFocus aria-label="Cari brand"
              />
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

/* ── Performance Database ────────────────────────────────────────────────────────── */

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

function DatasetRow({ platform, dataset, months, lookup, index, reduced, onPick, onDelete, onReimport, busyKey, targetMonth, onShowSpecs }) {
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
                onClick={() => (merged || dataset.autoOnly ? setOpen(true) : onPick(dataset, month))}
                title={merged
                  ? `${month.full} · ${merged.coveredDays > 0 ? `${merged.coveredDays} dari ${month.days} hari` : 'snapshot bulanan'} · ${merged.parts.length} file (klik untuk melihat detail)`
                  : dataset.autoOnly ? `${month.full} · belum ada arsip (terisi otomatis setelah bulan selesai)` : `${month.full} · belum ada file (klik untuk upload)`}
              >
                <i aria-hidden="true" />
                <b>{busyKey === key ? '…' : state === 'empty' ? (dataset.autoOnly ? '·' : '+') : state === 'snapshot' ? '✓' : merged.coveredDays}</b>
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
          {!isReference && !dataset.autoOnly && targetMonth && (
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
              {dataset.specs && (onShowSpecs ? (
                <p className="brand-ds-note">
                  <button type="button" className="brand-inline-link" onClick={() => onShowSpecs(dataset.specs)}>
                    Lihat breakdown &amp; metrik yang harus ada
                  </button>
                  <span>di Automate Input with API</span>
                </p>
              ) : (
                // Non-admins cannot open Automate Input with API: show the list here.
                <MetaDatasetSpecs sections={dataset.specs.sections} />
              ))}
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
                      {!dataset.autoOnly && <button type="button" onClick={() => onPick(dataset, month, file)}><Upload size={14} /> Ganti</button>}
                      <button type="button" onClick={() => downloadLibraryFile(file)}><Download size={14} /> Unduh</button>
                      <button type="button" className="is-danger" onClick={() => onDelete(file)}><Trash2 size={14} /> Hapus</button>
                    </span>
                  </div>
                ))}
                {dataset.autoOnly && (
                  <p className="brand-ds-note">
                    <CircleAlert size={14} />
                    Arsip bulanan yang dibuat ATLAS dari data sinkron Google Ads Script, terisi setelah bulannya selesai. Report membaca data sinkron langsung,
                    jadi slot ini tidak menerima unggahan. Bulan yang sudah tersinkron sebelum slot ini ada bisa diisi lewat Data Collection Hub › Performance Database › Input Performance Data › Google Ads › Isi arsip.
                  </p>
                )}
                {!isReference && !dataset.autoOnly && (
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

function MonthRail({ windowMonths, windowEnd, setWindowEnd, focus, setFocus, lookup, platformId, reduced }) {
  const latest = monthKey(new Date());
  const canNext = windowEnd < latest;
  const visible = windowMonths;

  return (
    <div className="brand-month-rail">
      <button type="button" className="brand-month-page" onClick={() => setWindowEnd(shiftMonthKey(windowEnd, -MONTH_WINDOW))} aria-label="Bulan sebelumnya">
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
      <button type="button" className="brand-month-page" onClick={() => { const next = shiftMonthKey(windowEnd, MONTH_WINDOW); setWindowEnd(next > latest ? latest : next); }} disabled={!canNext} aria-label="Bulan berikutnya">
        <ChevronRight size={16} />
      </button>
      <button type="button" className={`brand-month-all ${focus ? '' : 'is-active'}`} onClick={() => setFocus(null)}>
        {focus ? 'Tampilkan semua bulan' : `${visible.length} bulan ditampilkan`}
      </button>
    </div>
  );
}

function PlatformPanel({ platform, months, lookup, reduced, onPick, onDelete, onReimport, busyKey, focusMonth, onShowSpecs }) {
  const summary = useMemo(() => platformSummary(platform, months, lookup), [platform, months, lookup]);
  const datasets = useMemo(() => platform.datasets.filter((d) => !d.legacy
    || [...lookup.keys()].some((k) => k.startsWith(`${platform.id}:${d.channel}:`))), [platform, lookup]);

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
        {/* No per-month chips here: the dataset cells below already show each
            month's state, and the chips made a third row of months. */}
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
        {datasets.map((dataset, index) => (
          <DatasetRow
            key={dataset.channel} platform={platform} dataset={dataset} months={months} lookup={lookup}
            index={index} reduced={reduced} onPick={onPick} onDelete={onDelete} onReimport={onReimport} busyKey={busyKey}
            targetMonth={focusMonth ?? months[months.length - 1]} onShowSpecs={onShowSpecs}
          />
        ))}
      </div>

    </motion.div>
  );
}

// The platform switch carries each platform's own mark and how ready its
// core datasets are for the months on screen.
const PLATFORM_LOGO = { meta: 'meta', shopee: 'shopee', tiktok: 'tiktok', google: 'google' };

function DataView({ brand, months, windowMonths, windowEnd, setWindowEnd, focus, setFocus, lookup, reduced, onPick, onDelete, onReimport, onLibraryChanged, busyKey, marketId, setMarketId }) {
  const { isAdmin } = useAuth();
  const accountsRef = useRef(null);
  const [accountsVersion, setAccountsVersion] = useState(0);
  // A Meta dataset row's "Lihat breakdown & metrik": the auto-fetch panel
  // switches to that account type and scrolls to its highlighted sections.
  const [specFocus, setSpecFocus] = useState(null);
  // Meta's two automation panels share one place, as tabs: pulling data from
  // the API is the daily job and opens first; account and subscription setup
  // is occasional. Non-admins only have the second.
  const [metaPane, setMetaPane] = useState(isAdmin ? 'api' : 'accounts');
  const showSpecs = (specs) => { setMetaPane('api'); setSpecFocus({ ...specs, at: Date.now() }); };
  const openAccounts = () => {
    if (marketId === 'meta') setMetaPane('accounts');
    requestAnimationFrame(() => {
      accountsRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      accountsRef.current?.focus({ preventScroll: true });
    });
  };
  const platform = PLATFORMS.find((p) => p.id === marketId) ?? PLATFORMS[0];
  const focusMonth = focus ? months.find((m) => m.key === focus) : null;
  const target = focusMonth ?? months[months.length - 1];

  return (
    <div className="soft-card bp-panel bp-data" style={{ '--mk-accent': platform.accent, '--mk-wash': platform.wash, '--mk-tint': platform.tint }}>
      <div className="bp-panel-head">
        <div>
          <h2>Input Performance Data</h2>
          <p>Perpustakaan data {brand?.brand_name ?? 'brand ini'}. Report Generator, Business Overview, dan Meta Automation membaca dari sini — tidak ada upload ulang di halaman lain.</p>
        </div>
      </div>

      <nav className="soft-subtabs bp-platforms" aria-label="Sumber data" role="tablist">
        {PLATFORMS.map((item) => {
          const itemSummary = platformSummary(item, months, lookup);
          const on = item.id === marketId;
          return (
            <button
              key={item.id} type="button" role="tab" aria-selected={on}
              className={`soft-subtab bp-platform${on ? ' is-on' : ''}`}
              onClick={() => setMarketId(item.id)}
            >
              {on && (
                <motion.span
                  layoutId="bp-platform-line" className="soft-subtab-line" aria-hidden="true"
                  transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 40, mass: .6 }}
                />
              )}
              <BrandLogo name={PLATFORM_LOGO[item.id]} size={18} />
              <span>{item.label}</span>
              <small className={itemSummary.ready === 100 ? 'is-full' : itemSummary.ready > 0 ? 'is-partial' : ''}>{itemSummary.ready}%</small>
            </button>
          );
        })}
      </nav>

      <div className="bp-toolbar">
        <MonthRail
          windowMonths={windowMonths} windowEnd={windowEnd} setWindowEnd={setWindowEnd}
          focus={focus} setFocus={setFocus} lookup={lookup} platformId={platform.id} reduced={reduced}
        />
        <div className="brand-cov-legend">
          <span><i className="is-full" /> Lengkap</span>
          <span><i className="is-partial" /> Sebagian</span>
          <span><i className="is-snapshot" /> Snapshot bulanan</span>
          <span><i className="is-empty" /> Belum ada</span>
          <span className="brand-cov-legend-hint">Klik sel kosong untuk upload · sel berisi atau nama dataset untuk detail.</span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <PlatformPanel
          key={platform.id} platform={platform} months={months} lookup={lookup} reduced={reduced}
          onPick={onPick} onDelete={onDelete} onReimport={onReimport} busyKey={busyKey} focusMonth={focusMonth}
          onShowSpecs={isAdmin && platform.id === 'meta' ? showSpecs : undefined}
        />
      </AnimatePresence>

      <details className="bp-help">
        <summary>
          <HelpCircle size={16} aria-hidden="true" />
          <strong>Cara upload &amp; memperbarui file</strong>
          <span>Upload ke {platform.label} · {focusMonth ? `terkunci ke ${focusMonth.full}` : `bulan mengikuti sel (terbaru: ${target?.full ?? '—'})`}</span>
          <ChevronDown size={16} aria-hidden="true" className="bp-help-chev" />
        </summary>
        <div className="bp-help-grid">
          <span>
            <strong>File pertama</strong>
            <small>Klik sel bulan yang kosong. File disimpan ke bulan sel itu — atau ke bulan yang dipilih di atas bila panel dikunci ke satu bulan.</small>
          </span>
          <span>
            <strong>File periode diperbarui?</strong>
            <small>Buka detail dataset dan tekan <b>Ganti</b>. File serta hasil impor lama diganti, sehingga data lama tidak dijumlahkan dua kali.</small>
          </span>
          <span>
            <strong>Ekspor memang terpecah?</strong>
            <small>Gunakan <b>+ part</b> hanya untuk lanjutan file pada bulan yang sama dan pastikan tanggalnya tidak tumpang tindih. File revisi harus memakai Ganti.</small>
          </span>
          {platform.id === 'google' && (
            <>
              <span>
                <strong>Sebagian terisi otomatis</strong>
                <small>Search Terms, Change History, dan arsip lainnya diisi otomatis setiap hari setelah Google Ads Script berjalan (bulan berjalan sampai kemarin), untuk akun di <button type="button" className="brand-inline-link" onClick={openAccounts}>pengaturan Google Ads</button> pada channel ini. File yang Anda unggah untuk suatu bulan selalu menggantikan hasil otomatis.</small>
              </span>
              <span>
                <strong>Auction Insights</strong>
                <small>Tidak bisa ditarik otomatis oleh Google. Unduh dari Google Ads › Insights &amp; reports › Auction insights, pilih rentang satu bulan, lalu unggah ke bulannya.</small>
              </span>
              <span>
                <strong>Change History sebelum akun terhubung</strong>
                <small>Google hanya menyimpan 30 hari ke belakang. Untuk bulan sebelum akun terhubung, unduh dari Google Ads › Change history dan unggah ke bulannya.</small>
              </span>
            </>
          )}
        </div>
      </details>

      {platform.id === 'meta' && (
        <section ref={accountsRef} className="bp-channel-accounts mx-group" tabIndex={-1} aria-label="Otomasi Meta Ads">
          <div className="mx-group-head">
            <h3>Otomasi Meta Ads</h3>
            {isAdmin && (
              <div className="mx-switch" role="tablist" aria-label="Otomasi Meta Ads">
                {[
                  { id: 'api', label: 'Tarik data API', Icon: CalendarClock },
                  { id: 'accounts', label: 'Akun & langganan', Icon: BadgeCheck },
                ].map(({ id, label, Icon }) => (
                  <button key={id} type="button" role="tab" aria-selected={metaPane === id} className={metaPane === id ? 'is-on' : ''} onClick={() => setMetaPane(id)}>
                    <Icon size={15} aria-hidden="true" /> {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Both stay mounted (hidden, not removed): switching back keeps
              the chosen month, open forms and loaded tables. */}
          {isAdmin && (
            <div role="tabpanel" hidden={metaPane !== 'api'}>
              <MetaAdsAutoFetchPanel brand={brand} accountsVersion={accountsVersion} onLibraryChanged={onLibraryChanged} onOpenAutomation={openAccounts} specFocus={specFocus} />
            </div>
          )}
          <div role="tabpanel" hidden={metaPane !== 'accounts'}>
            <MetaAutomationSection key={brand?.brand_id ?? 'none'} brand={brand} onAccountAdded={() => setAccountsVersion((version) => version + 1)} />
          </div>
        </section>
      )}
      {platform.id === 'google' && (
        <section ref={accountsRef} className="bp-channel-accounts" tabIndex={-1} aria-label="Pengaturan akun Google Ads">
          <GoogleAdsSection key={brand?.brand_id ?? 'none'} brand={brand} />
        </section>
      )}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function BrandDataPage() {
  const { isViewOnly } = useAuth();
  const reduced = useReducedMotion();
  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState(null);
  const [lastBrandId, setLastBrandId] = useSessionState('brand-settings:brand', null);
  // Same session keys as before the split, so links elsewhere that preset a
  // brand and platform (Pusat Kendali, Meta Automation) still land on them.
  const [activeView, setActiveView] = useSessionState('brand-settings:view', 'data');
  const [marketId, setMarketId] = useSessionState('brand-settings:platform', 'shopee');
  // Restore legacy account tabs inside their corresponding data channel. A
  // stale 'mom' (Minutes of Meeting moved to Brand Tracking) lands here too.
  useEffect(() => {
    if (activeView === 'meta-automation') setMarketId('meta');
    if (activeView === 'google-ads') setMarketId('google');
    if (activeView !== 'data') setActiveView('data');
  }, [activeView, setActiveView, setMarketId]);

  const [profile, setProfile] = useState(null);

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const [windowEnd, setWindowEnd] = useState(() => monthKey(new Date()));
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

  // Just the file list, without loadBrand's full-page loading state — used
  // when a file appears outside the upload flow (Meta Ads auto-fetch).
  const refreshFiles = useCallback(async (brandId) => {
    try {
      const res = await api.get(`/brands/${brandId}/library`);
      setFiles(res.data.files ?? []);
    } catch { /* the grid keeps its last known state */ }
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
    setWindowEnd(monthKey(new Date()));
    loadBrand(brand.brand_id);
  }, [brand, loadBrand]);

  const windowMonths = useMemo(() => monthWindow(windowEnd), [windowEnd]);
  const months = useMemo(() => {
    if (!focus) return windowMonths;
    const picked = windowMonths.find((m) => m.key === focus);
    return picked ? [picked] : windowMonths;
  }, [windowMonths, focus]);

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

  // Upload targets a single (platform, channel, month) slot. The month is
  // whatever cell was clicked — or the focused month when the whole panel is
  // narrowed to one — so a file can never land in a period the user did not
  // choose.
  const pickFile = (dataset, month, replaceFile = null) => {
    if (isViewOnly) {
      setNotice('Akun ini hanya dapat melihat data.');
      return;
    }
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
      form.append('channel', target.dataset.uploadChannel ?? target.dataset.channel);
      if (target.month) form.append('month', target.month.key);
      if (target.replaceFile?.id) form.append('replaceFileId', String(target.replaceFile.id));
      const { data } = await api.post(`/brands/${brand.brand_id}/library`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const saved = data.files ?? [data.file];
      const savedIds = new Set(saved.map((f) => f.id));
      // A split Meta export also removed the month's earlier Meta files, so
      // the whole list is reloaded rather than patched.
      if (data.split) await refreshFiles(brand.brand_id);
      else setFiles((current) => [...current.filter((f) => !savedIds.has(f.id)), ...saved]);
      setError(null);
      const where = data.split
        ? `Meta Ads · ${target.month.full}`
        : `${target.dataset.name} · ${target.month ? target.month.full : 'referensi'}`;
      const parts = [data.warnings?.length ? data.warnings.join(' ') : `${saved.length} file · ${saved.reduce((t, f) => t + (f.covered_days ?? 0), 0)} hari terdeteksi`];
      if (data.split) {
        parts.unshift(`dipisah: ${data.split.boost.toLocaleString('id-ID')} baris Boost Post, ${data.split.nonboost.toLocaleString('id-ID')} baris Non Boost Post`);
      }
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
    if (!brand || isViewOnly) return;
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
    if (!brand || isViewOnly) return;
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


  // Whole-library figures for the command card.
  const totals = useMemo(() => {
    const all = PLATFORMS.flatMap((p) => p.datasets.filter((d) => !d.legacy).map((d) => `${p.id}:${d.channel}`));
    const withData = new Set(files.map((f) => `${f.platform}:${f.channel}`));
    return { all: all.length, active: all.filter((k) => withData.has(k)).length };
  }, [files]);
  const span = files.filter((f) => f.period_month).map((f) => f.period_month).sort();
  const spanLabel = span.length
    ? `${buildMonth(span[0].slice(0, 7)).full} – ${buildMonth(span[span.length - 1].slice(0, 7)).full}`
    : 'Belum ada data';

  return (
    // Frame and masthead come from BrandSettingLayout (shared with the
    // other Brand Setting sections).
    <>
      <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" multiple hidden onChange={handleFile} />

      <section className="soft-card bp-command" aria-label="Brand yang dikelola">
        <div className="bp-command-brand">
          <span className="bp-label">Brand</span>
          <BrandPicker brands={brands} brand={brand} sector={profile?.sector} onSelect={setBrand} reduced={reduced} />
        </div>
        <div className="bp-stats">
          <div className="bp-stat">
            <span><CalendarRange size={14} aria-hidden="true" /> Rentang data</span>
            <strong className="is-text">{loading ? '…' : spanLabel}</strong>
          </div>
          <div className="bp-stat">
            <span><FileSpreadsheet size={14} aria-hidden="true" /> File tersimpan</span>
            <strong>{loading ? '…' : files.length}</strong>
          </div>
          <div className="bp-stat">
            <span><Database size={14} aria-hidden="true" /> Dataset aktif</span>
            <strong>{loading ? '…' : totals.active}<small>/{totals.all}</small></strong>
          </div>
        </div>
        {brand && (
          <Link to={`/pengaturan-brand?detail=${brand.brand_id}`} className="bp-ghost" title="Brand context dan current direction diatur di Brand Setting">
            <NotebookPen size={15} aria-hidden="true" /> Context &amp; direction
          </Link>
        )}
      </section>

      {loading && <p className="bp-loading"><Loader2 size={14} className="brand-spin" /> Memuat data {brand?.brand_name ?? 'brand'}…</p>}
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
        {activeView === 'data' && (
          <ViewShell viewId="data" reduced={reduced}>
            <DataView
              brand={brand} months={months} windowMonths={windowMonths}
              windowEnd={windowEnd} setWindowEnd={(next) => { setWindowEnd(next); setFocus(null); }}
              focus={focus} setFocus={setFocus} lookup={lookup} reduced={reduced}
              onPick={pickFile} onDelete={removeFile} onReimport={reimportFile} busyKey={busyKey}
              onLibraryChanged={() => brand && refreshFiles(brand.brand_id)}
              marketId={marketId} setMarketId={setMarketId}
            />
          </ViewShell>
        )}

      </AnimatePresence>
    </>
  );
}
