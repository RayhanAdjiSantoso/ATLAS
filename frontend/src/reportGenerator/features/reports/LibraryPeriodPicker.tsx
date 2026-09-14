import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPortalContainer } from '../../utils/portalTarget';
import { InlineNotice } from '../../components/InlineNotice';
import api from '../../../api/client.js';
import { formatMonth, type LibraryFile } from './LibraryFileSlot';
import { formatChannelCoverage } from './savedPeriodLabels';

// One calendar month in the brand's library, regardless of whether it was
// ever run through Generate — "Pilih Periode" (Shopee) uses this instead of
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
  onClose: () => void;
  onPick: (month: LibraryMonth) => void;
}

export function LibraryPeriodPicker({ clientId, platform, periodChannels, clientName, onClose, onPick }: LibraryPeriodPickerProps) {
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

  return createPortal(
    <div className="saved-modal-backdrop" onClick={onClose}>
      <div className="saved-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="saved-modal-head">
          <div>
            <div className="saved-modal-title">Perpustakaan Brand{clientName ? ` — ${clientName}` : ''}</div>
            <div className="saved-modal-sub">Pilih bulan — mengisi setiap channel yang tersedia untuk bulan itu sekaligus</div>
          </div>
          <button type="button" className="saved-modal-close" onClick={onClose} aria-label="Tutup">
            ✕
          </button>
        </div>

        <input className="saved-modal-search" placeholder="Cari bulan…" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />

        <div className="saved-modal-body">
          {error && <InlineNotice title="Perpustakaan tidak bisa dimuat">{error}</InlineNotice>}
          {!months && !error && <div className="empty-note">Memuat…</div>}
          {months && !error && shown.length === 0 && (
            <div className="empty-note">{query.trim() ? 'Tidak ada bulan yang cocok.' : 'Belum ada file di Pengaturan Brand untuk platform ini.'}</div>
          )}
          {shown.map((m) => (
            <button
              key={m.month}
              type="button"
              className="saved-card"
              onClick={() => {
                onPick(m);
                onClose();
              }}
            >
              <div className="saved-card-title">{m.label}</div>
              <div className="saved-card-coverage">{formatChannelCoverage(m.channels)}</div>
            </button>
          ))}
        </div>
      </div>
    </div>,
    getPortalContainer(),
  );
}
