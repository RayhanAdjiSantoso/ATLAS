import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarRange, Check, Database, Search, X } from 'lucide-react';
import { getPortalContainer } from '../../utils/portalTarget';
import { InlineNotice } from '../../components/InlineNotice';
import api from '../../../api/client.js';
import { formatMonth, type LibraryFile } from './LibraryFileSlot';
import { channelLabel } from './savedPeriodLabels';
import './librarySource.css';

// One calendar month in the brand's library, regardless of whether it was
// ever run through Generate — "Pilih Periode" uses this instead of
// SavedPeriodPicker's report_runs-backed list so a month can be reused the
// moment its files are uploaded to Pengaturan Brand, not only after a first
// Generate. `channels` counts files per channel (not rows) — enough to tell
// two months apart, cheap to compute without downloading anything yet.
export interface LibraryMonth {
  month: string; // 'YYYY-MM'
  label: string;
  channels: Record<string, number>;
  start: string | null; // earliest period_start among this month's files
  end: string | null; // latest period_end
}

interface LibraryPeriodPickerProps {
  clientId: number;
  platform: string;
  // Which library channels count toward "this month has data" — callers
  // pass only the channels they actually know how to apply.
  periodChannels: readonly string[];
  clientName?: string;
  // Display only: which comparison side is being filled, and the month that
  // side already holds (marked in the grid). Callers that omit them get the
  // same dialog without those two hints.
  sideLabel?: string;
  selectedMonth?: string | null;
  onClose: () => void;
  onPick: (month: LibraryMonth) => void;
}

const SHORT_MONTH = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function rangeText(start: string | null, end: string | null): string {
  if (!start || !end) return 'Rentang tanggal belum terbaca';
  const a = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${end.slice(0, 10)}T00:00:00Z`);
  return `${SHORT_MONTH.format(a)} – ${SHORT_MONTH.format(b)}`;
}

export function LibraryPeriodPicker({ clientId, platform, periodChannels, clientName, sideLabel, selectedMonth, onClose, onPick }: LibraryPeriodPickerProps) {
  const [months, setMonths] = useState<LibraryMonth[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setMonths(null);
    setError(null);
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
        if (!cancelled) setError(e.response?.data?.error || (e as Error).message || 'Perpustakaan tidak bisa dimuat.');
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, platform, periodChannels]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    if (!months) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return months;
    return months.filter((m) => m.label.toLowerCase().includes(needle));
  }, [months, query]);

  // Grouped by year so a long library reads as a calendar, not a feed.
  const years = useMemo(() => {
    const groups = new Map<string, LibraryMonth[]>();
    for (const m of shown) {
      const year = m.month.slice(0, 4);
      groups.set(year, [...(groups.get(year) ?? []), m]);
    }
    return [...groups.entries()];
  }, [shown]);

  const subtitle = [sideLabel ? `Untuk ${sideLabel}` : null, clientName ?? null].filter(Boolean).join(' · ');

  return createPortal(
    <div className="lib-picker-backdrop" onClick={onClose}>
      <div className="lib-picker" role="dialog" aria-modal="true" aria-labelledby="lib-picker-title" onClick={(e) => e.stopPropagation()}>
        <header className="lib-picker-head">
          <span className="lib-picker-icon" aria-hidden="true"><CalendarRange size={18} /></span>
          <div className="lib-picker-heading">
            <h2 id="lib-picker-title">Pilih bulan dari perpustakaan</h2>
            <p>{subtitle ? `${subtitle} — ` : ''}setiap channel yang tersedia di bulan itu terisi sekaligus.</p>
          </div>
          <button type="button" className="lib-picker-close" onClick={onClose} aria-label="Tutup">
            <X size={16} />
          </button>
        </header>

        <div className="lib-picker-tools">
          <label className="lib-picker-search">
            <Search size={15} aria-hidden="true" />
            <input placeholder="Cari bulan atau tahun…" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} aria-label="Cari bulan" />
          </label>
          {months && !error && <span className="lib-picker-count">{shown.length} bulan</span>}
        </div>

        <div className="lib-picker-body">
          {error && <InlineNotice title="Perpustakaan tidak bisa dimuat">{error}</InlineNotice>}
          {!months && !error && (
            <div className="lib-picker-grid" aria-busy="true">
              {[0, 1, 2, 3].map((i) => <span key={i} className="lib-picker-skeleton" />)}
              <span className="sr-only">Memuat…</span>
            </div>
          )}
          {months && !error && shown.length === 0 && (
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
                        onPick(m);
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
        </div>

        <footer className="lib-picker-foot">
          <Database size={13} aria-hidden="true" />
          <span>Hanya bulan yang punya file di Pengaturan Brand yang ditampilkan.</span>
          <kbd>Esc</kbd>
        </footer>
      </div>
    </div>,
    getPortalContainer(),
  );
}
