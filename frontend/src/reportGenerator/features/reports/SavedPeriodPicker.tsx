import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { InlineNotice } from '../../components/InlineNotice';
import { getPortalContainer } from '../../utils/portalTarget';
import { getSavedPeriods } from './api';
import { formatChannelCoverage, formatSavedAt, PLATFORM_LABEL } from './savedPeriodLabels';
import type { Platform, SavedPeriod } from './types';

interface SavedPeriodPickerProps {
  clientId: number;
  platform: Platform;
  clientName?: string;
  // 'period'     — pick one period (TikTok / Shopee slots).
  // 'comparison' — pick a whole saved comparison (Meta): cards are grouped
  //                by report_run, and onPick hands back a representative
  //                SavedPeriod whose `runId` identifies the comparison.
  variant: 'period' | 'comparison';
  onClose: () => void;
  onPick: (period: SavedPeriod) => void;
}

interface PickerCard {
  key: string;
  title: string;
  sub: string;
  coverage: string;
  meta: string;
  period: SavedPeriod;
}

export function SavedPeriodPicker({ clientId, platform, clientName, variant, onClose, onPick }: SavedPeriodPickerProps) {
  const [periods, setPeriods] = useState<SavedPeriod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setPeriods(null);
    setError(null);
    getSavedPeriods(clientId, platform)
      .then((p) => {
        if (!cancelled) setPeriods(p);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
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

  const cards = useMemo<PickerCard[]>(() => {
    if (!periods) return [];
    let items: PickerCard[];
    if (variant === 'comparison') {
      const byRun = new Map<number, SavedPeriod[]>();
      for (const p of periods) {
        const arr = byRun.get(p.runId) ?? [];
        arr.push(p);
        byRun.set(p.runId, arr);
      }
      items = [...byRun.entries()].map(([runId, ps]) => {
        const rep = ps.find((p) => p.role === 'cur') ?? ps[0];
        const merged: Record<string, number> = {};
        for (const p of ps) {
          for (const [ch, n] of Object.entries(p.channels)) merged[ch] = (merged[ch] ?? 0) + n;
        }
        return {
          key: `run-${runId}`,
          title: rep.sourceComparison,
          sub: '',
          coverage: formatChannelCoverage(merged),
          meta: `disimpan ${formatSavedAt(rep.savedAt)}`,
          period: rep,
        };
      });
    } else {
      items = periods.map((p) => ({
        key: `${p.runId}-${p.role}`,
        title: p.label || 'Tanpa label',
        sub: p.start && p.end ? `${p.start} – ${p.end}` : '',
        coverage: formatChannelCoverage(p.channels),
        meta: `dari “${p.sourceComparison}” · disimpan ${formatSavedAt(p.savedAt)}`,
        period: p,
      }));
    }
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => `${it.title} ${it.sub} ${it.meta}`.toLowerCase().includes(needle));
  }, [periods, variant, query]);

  return createPortal(
    <div className="saved-modal-backdrop" onClick={onClose}>
      <div className="saved-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="saved-modal-head">
          <div>
            <div className="saved-modal-title">Data tersimpan{clientName ? ` — ${clientName}` : ''}</div>
            <div className="saved-modal-sub">
              {PLATFORM_LABEL[platform]} · {variant === 'comparison' ? 'pilih 1 perbandingan' : 'pilih 1 periode'}
            </div>
          </div>
          <button type="button" className="saved-modal-close" onClick={onClose} aria-label="Tutup">
            ✕
          </button>
        </div>

        <input
          className="saved-modal-search"
          placeholder="Cari label / bulan…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="saved-modal-body">
          {error && <InlineNotice title="Data tersimpan tidak bisa dimuat">{error}</InlineNotice>}
          {!periods && !error && <div className="empty-note">Memuat…</div>}
          {periods && !error && cards.length === 0 && (
            <div className="empty-note">
              {query.trim() ? 'Tidak ada yang cocok dengan pencarian.' : 'Belum ada data tersimpan untuk klien & platform ini.'}
            </div>
          )}
          {cards.map((it) => (
            <button
              key={it.key}
              type="button"
              className="saved-card"
              onClick={() => {
                onPick(it.period);
                onClose();
              }}
            >
              <div className="saved-card-title">{it.title}</div>
              {it.sub && <div className="saved-card-sub num">{it.sub}</div>}
              <div className="saved-card-coverage">{it.coverage}</div>
              <div className="saved-card-meta">{it.meta}</div>
            </button>
          ))}
        </div>
      </div>
    </div>,
    getPortalContainer(),
  );
}
