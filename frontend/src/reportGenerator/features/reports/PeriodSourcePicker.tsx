import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, CalendarRange, Check, Database, History, Library, Search, X } from 'lucide-react';
import { getPortalContainer } from '../../utils/portalTarget';
import { InlineNotice } from '../../components/InlineNotice';
import api from '../../../api/client.js';
import { formatMonth, type LibraryFile } from './LibraryFileSlot';
import { channelLabel, formatChannelCoverage, formatSavedAt } from './savedPeriodLabels';
import { getSavedPeriods } from './api';
import type { PeriodRole, Platform, SavedPeriod } from './types';
import './librarySource.css';

// Picking stored data has two honest answers, and they are not the same thing:
//
//   • Perpustakaan Brand — the monthly files uploaded in Pengaturan Brand.
//     Whole months, available the moment they are uploaded, whether or not a
//     report was ever built from them.
//   • Arsip Laporan — the periods of reports that were already generated and
//     saved. Exactly the rows that report compared, reusable as one side of a
//     new comparison, so last month's "current" becomes this month's
//     "previous" without touching a file.
//
// One dialog, two tabs, because the question a user asks is "which stored
// data do I want", not "which of our two storage mechanisms".

export interface LibraryMonth {
  month: string; // 'YYYY-MM'
  label: string;
  channels: Record<string, number>;
  start: string | null; // earliest period_start among this month's files
  end: string | null; // latest period_end
}

type Tab = 'library' | 'archive';

interface PeriodSourcePickerProps {
  clientId: number;
  platform: Platform;
  // Which library channels count toward "this month has data" — callers pass
  // only the channels they actually know how to apply.
  periodChannels: readonly string[];
  clientName?: string;
  // Display only: which comparison side is being filled, and what that side
  // already holds (marked in the list).
  sideLabel?: string;
  selectedMonth?: string | null;
  selectedRun?: { runId: number; role: PeriodRole } | null;
  onClose: () => void;
  onPickLibrary: (month: LibraryMonth) => void;
  onPickArchive: (period: SavedPeriod) => void;
}

const SHORT_MONTH = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function rangeText(start: string | null, end: string | null): string {
  if (!start || !end) return 'Rentang tanggal belum terbaca';
  const a = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${end.slice(0, 10)}T00:00:00Z`);
  return `${SHORT_MONTH.format(a)} – ${SHORT_MONTH.format(b)}`;
}

export function PeriodSourcePicker({
  clientId,
  platform,
  periodChannels,
  clientName,
  sideLabel,
  selectedMonth,
  selectedRun,
  onClose,
  onPickLibrary,
  onPickArchive,
}: PeriodSourcePickerProps) {
  const [tab, setTab] = useState<Tab>('library');
  const [months, setMonths] = useState<LibraryMonth[] | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [periods, setPeriods] = useState<SavedPeriod[] | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setMonths(null);
    setLibError(null);
    api
      .get(`/brands/${clientId}/library`)
      .then(({ data }) => {
        if (cancelled) return;
        const files = (data.files as LibraryFile[]).filter((f) => f.platform === platform && f.period_month && periodChannels.includes(f.channel));
        const byMonth = new Map<string, LibraryMonth>();
        for (const f of files) {
          const key = f.period_month!.slice(0, 7);
          const m = byMonth.get(key) ?? { month: key, label: formatMonth(key), channels: {}, start: null, end: null };
          m.channels[f.channel] = (m.channels[f.channel] ?? 0) + 1;
          if (f.period_start && (!m.start || f.period_start < m.start)) m.start = f.period_start;
          if (f.period_end && (!m.end || f.period_end > m.end)) m.end = f.period_end;
          byMonth.set(key, m);
        }
        setMonths([...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)));
      })
      .catch((e) => {
        if (!cancelled) setLibError(e.response?.data?.error || (e as Error).message || 'Perpustakaan tidak bisa dimuat.');
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, platform, periodChannels]);

  useEffect(() => {
    let cancelled = false;
    setPeriods(null);
    setArchiveError(null);
    getSavedPeriods(clientId, platform)
      .then((p) => {
        if (!cancelled) setPeriods(p);
      })
      .catch((e) => {
        if (!cancelled) setArchiveError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, platform]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shownMonths = useMemo(() => {
    if (!months) return [];
    const needle = query.trim().toLowerCase();
    return needle ? months.filter((m) => m.label.toLowerCase().includes(needle)) : months;
  }, [months, query]);

  // Grouped by year so a long library reads as a calendar, not a feed.
  const years = useMemo(() => {
    const groups = new Map<string, LibraryMonth[]>();
    for (const m of shownMonths) {
      const year = m.month.slice(0, 4);
      groups.set(year, [...(groups.get(year) ?? []), m]);
    }
    return [...groups.entries()];
  }, [shownMonths]);

  // Archive entries are grouped by the report they came from, so a run's two
  // sides sit together and it is obvious which comparison a period belonged to.
  const runs = useMemo(() => {
    if (!periods) return [];
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? periods.filter((p) => `${p.label ?? ''} ${p.sourceComparison} ${p.start ?? ''} ${p.end ?? ''}`.toLowerCase().includes(needle))
      : periods;
    const byRun = new Map<number, SavedPeriod[]>();
    for (const p of matched) byRun.set(p.runId, [...(byRun.get(p.runId) ?? []), p]);
    return [...byRun.entries()]
      .map(([runId, list]) => ({
        runId,
        title: list[0].sourceComparison,
        savedAt: list[0].savedAt,
        sides: list.sort((a, b) => (a.role === b.role ? 0 : a.role === 'old' ? -1 : 1)),
      }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }, [periods, query]);

  const subtitle = [sideLabel ? `Untuk ${sideLabel}` : null, clientName ?? null].filter(Boolean).join(' · ');
  const libCount = months?.length ?? null;
  const archiveCount = periods?.length ?? null;

  return createPortal(
    <div className="lib-picker-backdrop" onClick={onClose}>
      <div className="lib-picker" role="dialog" aria-modal="true" aria-labelledby="lib-picker-title" onClick={(e) => e.stopPropagation()}>
        <header className="lib-picker-head">
          <span className="lib-picker-icon" aria-hidden="true"><CalendarRange size={18} /></span>
          <div className="lib-picker-heading">
            <h2 id="lib-picker-title">Ambil data tersimpan</h2>
            <p>{subtitle ? `${subtitle} — ` : ''}pilih satu sumber, isi slot periode ini sekaligus.</p>
          </div>
          <button type="button" className="lib-picker-close" onClick={onClose} aria-label="Tutup">
            <X size={16} />
          </button>
        </header>

        <div className="src-tabs" role="tablist" aria-label="Sumber data tersimpan">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'library'}
            className={`src-tab${tab === 'library' ? ' is-active' : ''}`}
            onClick={() => setTab('library')}
          >
            <Library size={16} aria-hidden="true" />
            <span className="src-tab-text">
              <strong>Perpustakaan Brand</strong>
              <small>File bulanan dari Pengaturan Brand</small>
            </span>
            {libCount !== null && <span className="src-tab-count">{libCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'archive'}
            className={`src-tab${tab === 'archive' ? ' is-active' : ''}`}
            onClick={() => setTab('archive')}
          >
            <Archive size={16} aria-hidden="true" />
            <span className="src-tab-text">
              <strong>Arsip Laporan</strong>
              <small>Periode dari laporan yang pernah dibuat</small>
            </span>
            {archiveCount !== null && <span className="src-tab-count">{archiveCount}</span>}
          </button>
        </div>

        <div className="lib-picker-tools">
          <label className="lib-picker-search">
            <Search size={15} aria-hidden="true" />
            <input
              placeholder={tab === 'library' ? 'Cari bulan atau tahun…' : 'Cari label, bulan, atau laporan…'}
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Cari"
            />
          </label>
          {tab === 'library' && months && !libError && <span className="lib-picker-count">{shownMonths.length} bulan</span>}
          {tab === 'archive' && periods && !archiveError && <span className="lib-picker-count">{runs.length} laporan</span>}
        </div>

        <div className="lib-picker-body">
          {tab === 'library' ? (
            <>
              {libError && <InlineNotice title="Perpustakaan tidak bisa dimuat">{libError}</InlineNotice>}
              {!months && !libError && (
                <div className="lib-picker-grid" aria-busy="true">
                  {[0, 1, 2, 3].map((i) => <span key={i} className="lib-picker-skeleton" />)}
                  <span className="sr-only">Memuat…</span>
                </div>
              )}
              {months && !libError && shownMonths.length === 0 && (
                <div className="lib-picker-empty">
                  <Database size={22} aria-hidden="true" />
                  <strong>{query.trim() ? 'Tidak ada bulan yang cocok' : 'Belum ada file untuk platform ini'}</strong>
                  <span>{query.trim() ? 'Coba kata kunci lain, misalnya nama bulan atau tahun.' : 'Unggah file melalui Pengaturan Brand → Data & file, lalu buka lagi daftar ini.'}</span>
                </div>
              )}
              {years.map(([year, list]) => (
                <section key={year} className="lib-picker-year">
                  <h3>{year}</h3>
                  <div className="lib-picker-grid">
                    {list.map((m) => {
                      const selected = selectedMonth === m.month;
                      const channels = Object.entries(m.channels).filter(([, n]) => n > 0);
                      return (
                        <button
                          key={m.month}
                          type="button"
                          className={`lib-picker-month${selected ? ' is-selected' : ''}`}
                          aria-pressed={selected}
                          onClick={() => {
                            onPickLibrary(m);
                            onClose();
                          }}
                        >
                          <span className="lib-picker-month-top">
                            <strong>{m.label.replace(` ${year}`, '')}</strong>
                            {selected && <span className="lib-picker-current"><Check size={12} aria-hidden="true" /> Dipilih</span>}
                          </span>
                          <small className="lib-picker-range">{rangeText(m.start, m.end)}</small>
                          <span className="lib-picker-chips">
                            {channels.map(([ch, n]) => (
                              <span key={ch} className="lib-picker-chip">
                                {channelLabel(ch)}
                                {n > 1 && <b>×{n}</b>}
                              </span>
                            ))}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </>
          ) : (
            <>
              {archiveError && <InlineNotice title="Arsip laporan tidak bisa dimuat">{archiveError}</InlineNotice>}
              {!periods && !archiveError && (
                <div className="lib-picker-grid" aria-busy="true">
                  {[0, 1].map((i) => <span key={i} className="lib-picker-skeleton" />)}
                  <span className="sr-only">Memuat…</span>
                </div>
              )}
              {periods && !archiveError && runs.length === 0 && (
                <div className="lib-picker-empty">
                  <History size={22} aria-hidden="true" />
                  <strong>{query.trim() ? 'Tidak ada laporan yang cocok' : 'Belum ada laporan tersimpan'}</strong>
                  <span>
                    {query.trim()
                      ? 'Coba kata kunci lain, misalnya nama bulan pada label periode.'
                      : 'Setiap laporan yang selesai di-Generate tersimpan otomatis, lalu periodenya bisa dipakai lagi dari sini.'}
                  </span>
                </div>
              )}
              {runs.map((run) => (
                <section key={run.runId} className="src-run">
                  <div className="src-run-head">
                    <h3>{run.title}</h3>
                    <span>disimpan {formatSavedAt(run.savedAt)}</span>
                  </div>
                  <div className="src-run-sides">
                    {run.sides.map((p) => {
                      const selected = selectedRun?.runId === p.runId && selectedRun?.role === p.role;
                      return (
                        <button
                          key={`${p.runId}-${p.role}`}
                          type="button"
                          className={`src-side${selected ? ' is-selected' : ''}`}
                          aria-pressed={selected}
                          onClick={() => {
                            onPickArchive(p);
                            onClose();
                          }}
                        >
                          <span className="src-side-top">
                            <span className={`src-side-role role-${p.role}`}>{p.role === 'old' ? 'Periode Lalu' : 'Periode Ini'}</span>
                            {selected && <span className="lib-picker-current"><Check size={12} aria-hidden="true" /> Dipilih</span>}
                          </span>
                          <strong>{p.label || 'Tanpa label'}</strong>
                          <small className="lib-picker-range">{rangeText(p.start, p.end)}</small>
                          <span className="src-side-coverage">{formatChannelCoverage(p.channels)}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </>
          )}
        </div>

        <footer className="lib-picker-foot">
          {tab === 'library' ? <Database size={13} aria-hidden="true" /> : <Archive size={13} aria-hidden="true" />}
          <span>
            {tab === 'library'
              ? 'Hanya bulan yang punya file di Pengaturan Brand yang ditampilkan.'
              : 'Data diambil dari laporan yang sudah tersimpan — tidak perlu mengunggah ulang filenya.'}
          </span>
          <kbd>Esc</kbd>
        </footer>
      </div>
    </div>,
    getPortalContainer(),
  );
}
