import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArrowRight, CalendarDays, Check, Database, History, Library, Loader2, PenLine, X } from 'lucide-react';
import { getPortalContainer } from '../../utils/portalTarget';
import { InlineNotice } from '../../components/InlineNotice';
import api from '../../../api/client.js';
import SearchField from '../../../components/common/SearchField.jsx';
import { formatMonth, type LibraryFile } from './LibraryFileSlot';
import { channelLabel, formatSavedAt } from './savedPeriodLabels';
import { getSavedPeriods, renameReport } from './api';
import { AutoRangePanel, type AutoRange } from './AutoRangePanel';
import { breaksOrder, orderReason, type PeriodBound } from './periodOrder';
import type { PeriodRole, Platform, SavedPeriod } from './types';
import './librarySource.css';
import './periodSourcePicker.css';

// Picking stored data has honest answers that are not the same thing:
//
//   • Perpustakaan Brand — the monthly files uploaded in Data Collection Hub.
//     Whole months, available the moment they are uploaded, whether or not a
//     report was ever built from them.
//   • Arsip Laporan — reports that were already generated and saved. A card
//     is one analysis: picking it fills both sides at once, so a past
//     analysis is rebuilt exactly. Either side alone can still be taken for
//     the slot being filled, so last month's "current" becomes this month's
//     "previous" without touching a file. Cards can carry the user's own
//     name ("Week 2 report").
//   • Rentang tanggal (Meta) — any day range of the auto-fetched rows.
//
// One dialog with the sources down the side, because the question a user
// asks is "which stored data do I want", not "which storage mechanism".
//
// A caller whose period has more than one dataset (Meta: Meta Ads and CPAS)
// passes `scope`, and the dialog asks which of them the pick should fill;
// months and reports without any of the chosen data cannot be picked.

export interface LibraryMonth {
  month: string; // 'YYYY-MM'
  label: string;
  channels: Record<string, number>;
  start: string | null; // earliest period_start among this month's files
  end: string | null; // latest period_end
}

export type PeriodSourceTab = 'library' | 'archive' | 'range';
type Tab = PeriodSourceTab;

export interface PickScopeOption {
  key: string;
  label: string;
  hint?: string;
  // Which library channels / archived channels carry this dataset.
  libraryChannels: readonly string[];
  archiveChannels: readonly string[];
}

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
  onPickLibrary: (month: LibraryMonth, include: string[]) => void;
  onPickArchive: (period: SavedPeriod, include: string[]) => void;
  // A whole archived analysis: both sides at once.
  onPickArchiveRun: (old: SavedPeriod, cur: SavedPeriod, include: string[]) => void;
  // Meta only: any day range from the auto-fetched daily rows. When given,
  // a third source "Rentang tanggal" appears.
  selectedRange?: { start: string; end: string } | null;
  onPickRange?: (range: AutoRange) => void;
  // Which source the dialog opens on (the page's source switch names it).
  initialTab?: PeriodSourceTab;
  // Datasets the pick may fill, and which are ticked when the dialog opens.
  scope?: { options: PickScopeOption[]; initial: string[] };
  // Shown in the header eyebrow, e.g. "Meta Ads".
  platformLabel?: string;
  // The other side's period: months and report periods that would put
  // Periode Ini before Periode Lalu cannot be picked.
  bound?: PeriodBound | null;
}

const SHORT_MONTH = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function rangeText(start: string | null, end: string | null): string {
  if (!start || !end) return 'Rentang tanggal belum terbaca';
  const a = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${end.slice(0, 10)}T00:00:00Z`);
  return `${SHORT_MONTH.format(a)} – ${SHORT_MONTH.format(b)}`;
}

const has = (channels: Record<string, number>, keys: readonly string[]) => keys.some((k) => (channels[k] ?? 0) > 0);

// The dialog wears its platform's colour, like the report it fills.
const ACCENT: Record<Platform, { acc: string; soft: string }> = {
  meta: { acc: '#1e3eb8', soft: '#eef1fc' },
  shopee: { acc: '#c93b1c', soft: '#fff3ef' },
  tiktok: { acc: '#111827', soft: '#f1f3f6' },
  google: { acc: '#1a73e8', soft: '#e8f0fe' },
};

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
  onPickArchiveRun,
  selectedRange,
  onPickRange,
  initialTab = 'library',
  scope,
  platformLabel,
  bound,
}: PeriodSourcePickerProps) {
  const [tab, setTab] = useState<Tab>(initialTab === 'range' && !onPickRange ? 'library' : initialTab);
  const [months, setMonths] = useState<LibraryMonth[] | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [periods, setPeriods] = useState<SavedPeriod[] | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [include, setInclude] = useState<string[]>(scope?.initial ?? []);
  const [naming, setNaming] = useState<{ runId: number; draft: string; saving: boolean; error: string | null } | null>(null);
  // Esc while a name is being edited cancels the name, not the dialog —
  // wherever focus is (a disabled Simpan drops it to the page).
  const namingRef = useRef(naming);
  namingRef.current = naming;

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
      if (e.key !== 'Escape') return;
      if (namingRef.current) setNaming(null);
      else onClose();
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
      ? periods.filter((p) => `${p.runName ?? ''} ${p.label ?? ''} ${p.sourceComparison} ${p.start ?? ''} ${p.end ?? ''}`.toLowerCase().includes(needle))
      : periods;
    const byRun = new Map<number, SavedPeriod[]>();
    for (const p of matched) byRun.set(p.runId, [...(byRun.get(p.runId) ?? []), p]);
    return [...byRun.entries()]
      .map(([runId, list]) => ({
        runId,
        title: list[0].sourceComparison,
        name: list[0].runName ?? null,
        savedAt: list[0].savedAt,
        old: list.find((p) => p.role === 'old') ?? null,
        cur: list.find((p) => p.role === 'cur') ?? null,
      }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }, [periods, query]);

  const chosen = scope ? scope.options.filter((o) => include.includes(o.key)) : [];
  const monthUsable = (m: LibraryMonth) => !scope || chosen.some((o) => has(m.channels, o.libraryChannels));
  const runUsable = (p: SavedPeriod) => !scope || chosen.some((o) => has(p.channels, o.archiveChannels));
  const reason = bound ? orderReason(bound) : null;
  const missingText = (channels: Record<string, number>, kind: 'libraryChannels' | 'archiveChannels') => {
    const missing = chosen.filter((o) => !has(channels, o[kind])).map((o) => o.label);
    return missing.length ? `Tanpa ${missing.join(' & ')}` : null;
  };

  async function saveName() {
    if (!naming || naming.saving) return;
    const { runId, draft } = naming;
    setNaming({ ...naming, saving: true, error: null });
    try {
      const name = await renameReport(runId, draft);
      setPeriods((prev) => prev?.map((p) => (p.runId === runId ? { ...p, runName: name } : p)) ?? prev);
      setNaming(null);
    } catch (e) {
      setNaming((n) => (n && n.runId === runId ? { ...n, saving: false, error: (e as Error).message } : n));
    }
  }

  function toggle(key: string) {
    setInclude((prev) => (prev.includes(key) ? (prev.length > 1 ? prev.filter((k) => k !== key) : prev) : [...prev, key]));
  }

  const libCount = months?.length ?? null;
  const archiveCount = periods?.length ?? null;
  const NAV: { id: Tab; label: string; desc: string; Icon: typeof Library; count: number | null }[] = [
    { id: 'library', label: 'Perpustakaan Brand', desc: 'File bulanan Data Collection Hub', Icon: Library, count: libCount },
    { id: 'archive', label: 'Arsip Laporan', desc: 'Periode laporan yang pernah dibuat', Icon: Archive, count: archiveCount },
    ...(onPickRange ? [{ id: 'range' as Tab, label: 'Rentang tanggal', desc: 'Data harian tarikan otomatis', Icon: CalendarDays, count: null }] : []),
  ];

  // The month card lists what the month holds, dataset by dataset: with a
  // scope, one line per dataset (ticked ones first-class, the rest faded);
  // without, one chip per library channel.
  function monthContents(m: LibraryMonth) {
    if (scope) {
      return (
        <ul className="sp-sets">
          {scope.options.map((o) => {
            const parts = o.libraryChannels.filter((c) => (m.channels[c] ?? 0) > 0);
            const on = include.includes(o.key);
            return (
              <li key={o.key} className={`${parts.length ? 'is-have' : 'is-none'}${on ? '' : ' is-off'}`}>
                <i aria-hidden="true" />
                <span>{o.label}</span>
                <small>{parts.length ? parts.map((c) => `${channelLabel(c)}${m.channels[c] > 1 ? ` ×${m.channels[c]}` : ''}`).join(' · ') : 'tidak ada'}</small>
              </li>
            );
          })}
        </ul>
      );
    }
    return (
      <span className="sp-chips">
        {Object.entries(m.channels).filter(([, n]) => n > 0).map(([ch, n]) => (
          <span key={ch} className="sp-chip">{channelLabel(ch)}{n > 1 && <b>×{n}</b>}</span>
        ))}
      </span>
    );
  }

  const coverage = (channels: Record<string, number>) => Object.entries(channels).filter(([, n]) => n > 0)
    .map(([ch, n]) => (
      <span key={ch} className="sp-chip">{channelLabel(ch)} <b>{n.toLocaleString('id-ID')}</b></span>
    ));

  return createPortal(
    <div className="lib-picker-backdrop" onClick={onClose}>
      <div
        className={`lib-picker sp sp-${platform}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sp-title"
        style={{ '--acc': ACCENT[platform].acc, '--acc-100': ACCENT[platform].soft } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sp-head">
          <div className="sp-heading">
            <span className="sp-eyebrow">Ambil data tersimpan{platformLabel ? ` · ${platformLabel}` : ''}</span>
            <h2 id="sp-title">{sideLabel ? `Isi ${sideLabel}` : 'Pilih periode'}</h2>
            <p>{clientName ? `${clientName} · ` : ''}Pilih satu bulan, laporan, atau rentang — slot terisi tanpa upload ulang.</p>
          </div>
          <button type="button" className="sp-close" onClick={onClose} aria-label="Tutup">
            <X size={16} />
          </button>
        </header>

        {scope && (
          <div className="sp-scope" role="group" aria-label="Isi ke slot">
            <span className="sp-scope-label">Isi ke slot</span>
            {scope.options.map((o) => {
              const on = include.includes(o.key);
              return (
                <button key={o.key} type="button" role="checkbox" aria-checked={on} className={`sp-toggle${on ? ' is-on' : ''}`} onClick={() => toggle(o.key)}>
                  <span className="sp-toggle-box" aria-hidden="true">{on && <Check size={12} strokeWidth={3} />}</span>
                  <span className="sp-toggle-text"><strong>{o.label}</strong>{o.hint && <small>{o.hint}</small>}</span>
                </button>
              );
            })}
            <span className="sp-scope-note">Slot yang tidak dicentang tidak diubah.</span>
          </div>
        )}

        <div className="sp-main">
          <nav className="sp-nav" role="tablist" aria-label="Sumber data tersimpan" aria-orientation="vertical">
            {NAV.map(({ id, label, desc, Icon, count }) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`sp-nav-item${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>
                <span className="sp-nav-ico" aria-hidden="true"><Icon size={16} /></span>
                <span className="sp-nav-text"><strong>{label}</strong><small>{desc}</small></span>
                {count !== null && <span className="sp-nav-count">{count}</span>}
              </button>
            ))}
          </nav>

          <section className="sp-pane">
            {tab !== 'range' && (
              <div className="sp-tools">
                <SearchField
                  className="lib-picker-search"
                  placeholder={tab === 'library' ? 'Cari bulan atau tahun…' : 'Cari label, bulan, atau laporan…'}
                  value={query}
                  autoFocus
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Cari"
                />
                {tab === 'library' && months && !libError && <span className="sp-count">{shownMonths.length} bulan</span>}
                {tab === 'archive' && periods && !archiveError && <span className="sp-count">{runs.length} laporan</span>}
              </div>
            )}

            <div className="sp-body">
              {bound && tab === 'library' && (
                <InlineNotice tone="info" title={reason!}>
                  {bound.role === 'cur' ? 'Periode yang dimulai sebelumnya' : 'Periode yang dimulai sesudahnya'} tidak bisa dipilih.
                </InlineNotice>
              )}
              {tab === 'range' && onPickRange ? (
                <AutoRangePanel
                  clientId={clientId}
                  selected={selectedRange}
                  onPick={(range) => {
                    onPickRange(range);
                    onClose();
                  }}
                />
              ) : tab === 'library' ? (
                <>
                  {libError && <InlineNotice title="Perpustakaan tidak bisa dimuat">{libError}</InlineNotice>}
                  {!months && !libError && (
                    <div className="sp-grid" aria-busy="true">
                      {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="lib-picker-skeleton" />)}
                      <span className="sr-only">Memuat…</span>
                    </div>
                  )}
                  {months && !libError && shownMonths.length === 0 && (
                    <div className="lib-picker-empty">
                      <Database size={22} aria-hidden="true" />
                      <strong>{query.trim() ? 'Tidak ada bulan yang cocok' : 'Belum ada file untuk platform ini'}</strong>
                      <span>{query.trim() ? 'Coba kata kunci lain, misalnya nama bulan atau tahun.' : 'Unggah file melalui Data Collection Hub → Performance Database, lalu buka lagi daftar ini.'}</span>
                    </div>
                  )}
                  {years.map(([year, list]) => (
                    <section key={year} className="sp-year">
                      <h3><span>{year}</span><i aria-hidden="true" /></h3>
                      <div className="sp-grid">
                        {list.map((m) => {
                          const selected = selectedMonth === m.month;
                          const outOfOrder = breaksOrder(bound, m.month);
                          const usable = monthUsable(m) && !outOfOrder;
                          const missing = scope ? missingText(m.channels, 'libraryChannels') : null;
                          return (
                            <button
                              key={m.month}
                              type="button"
                              className={`sp-month${selected ? ' is-selected' : ''}`}
                              aria-pressed={selected}
                              disabled={!usable}
                              title={outOfOrder ? reason! : !usable ? `Bulan ini tidak punya ${chosen.map((o) => o.label).join(' atau ')}` : undefined}
                              onClick={() => {
                                onPickLibrary(m, include);
                                onClose();
                              }}
                            >
                              <span className="sp-month-top">
                                <strong>{m.label.replace(` ${year}`, '')}</strong>
                                {selected ? <span className="sp-current"><Check size={11} aria-hidden="true" /> Dipilih</span> : <ArrowRight size={15} className="sp-go" aria-hidden="true" />}
                              </span>
                              <small className="sp-range">{rangeText(m.start, m.end)}</small>
                              {monthContents(m)}
                              {usable && missing && <span className="sp-warn">{missing}</span>}
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
                    <div className="sp-runs" aria-busy="true">
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
                  <div className="sp-runs">
                    {runs.map((run) => {
                      const sides = [run.old, run.cur].filter((p): p is SavedPeriod => !!p);
                      const whole = !!(run.old && run.cur) && sides.every(runUsable);
                      const inUse = selectedRun?.runId === run.runId;
                      const editing = naming?.runId === run.runId ? naming : null;
                      const pickWhole = () => {
                        if (!whole || editing) return;
                        onPickArchiveRun(run.old!, run.cur!, include);
                        onClose();
                      };
                      return (
                        <article
                          key={run.runId}
                          className={`sp-run${whole ? ' is-whole' : ''}${inUse ? ' is-selected' : ''}`}
                          onClick={pickWhole}
                        >
                          <header className="sp-run-head">
                            <div className="sp-run-title" onClick={(e) => e.stopPropagation()}>
                              {editing ? (
                                <form
                                  className="sp-run-name-form"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    saveName();
                                  }}
                                >
                                  <input
                                    autoFocus
                                    maxLength={80}
                                    value={editing.draft}
                                    placeholder="Mis. Week 2 report"
                                    aria-label="Nama analisa"
                                    onChange={(e) => setNaming({ ...editing, draft: e.target.value, error: null })}
                                  />
                                  <button type="submit" className="sp-run-name-save" disabled={editing.saving}>
                                    {editing.saving ? <Loader2 size={13} className="rg-spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
                                    Simpan
                                  </button>
                                  <button type="button" className="sp-run-name-cancel" onClick={() => setNaming(null)}>Batal</button>
                                  {editing.error && <span className="sp-run-name-error">{editing.error}</span>}
                                </form>
                              ) : (
                                <>
                                  <h3>{run.name || run.title}</h3>
                                  <button
                                    type="button"
                                    className={`sp-run-rename${run.name ? '' : ' is-empty'}`}
                                    onClick={() => setNaming({ runId: run.runId, draft: run.name ?? '', saving: false, error: null })}
                                  >
                                    <PenLine size={12} aria-hidden="true" />
                                    {run.name ? 'Ubah nama' : 'Beri nama'}
                                  </button>
                                </>
                              )}
                            </div>
                            <span className="sp-run-meta">
                              {run.name && <>{run.title} · </>}disimpan {formatSavedAt(run.savedAt)}
                            </span>
                          </header>

                          <div className="sp-run-flow">
                            {(['old', 'cur'] as const).map((role, idx) => {
                              const p = run[role];
                              return (
                                <div key={role} className="sp-run-flow-cell">
                                  {idx === 1 && <ArrowRight size={16} className="sp-run-arrow" aria-hidden="true" />}
                                  <div className={`sp-run-side role-${role}${p ? '' : ' is-missing'}`}>
                                    <span className={`sp-role role-${role}`}>{role === 'old' ? 'Periode lalu' : 'Periode ini'}</span>
                                    <strong>{p ? p.label || 'Tanpa label' : 'Tidak tersimpan'}</strong>
                                    {p && <small className="sp-range">{rangeText(p.start, p.end)}</small>}
                                    {p && <span className="sp-chips">{coverage(p.channels)}</span>}
                                    {p && scope && whole && missingText(p.channels, 'archiveChannels') && <span className="sp-warn">{missingText(p.channels, 'archiveChannels')}</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <footer className="sp-run-foot" onClick={(e) => e.stopPropagation()}>
                            <span className="sp-run-one">
                              <span>Atau isi {sideLabel ?? 'slot ini'} saja dengan:</span>
                              {sides.map((p) => {
                                const outOfOrder = breaksOrder(bound, p.start);
                                const usable = runUsable(p) && !outOfOrder;
                                const selected = selectedRun?.runId === p.runId && selectedRun?.role === p.role;
                                return (
                                  <button
                                    key={p.role}
                                    type="button"
                                    className={`sp-run-one-btn${selected ? ' is-selected' : ''}`}
                                    disabled={!usable}
                                    title={outOfOrder ? reason! : !usable ? `Tidak punya ${chosen.map((o) => o.label).join(' atau ')}` : undefined}
                                    onClick={() => {
                                      onPickArchive(p, include);
                                      onClose();
                                    }}
                                  >
                                    {selected && <Check size={11} aria-hidden="true" />}
                                    {p.label || (p.role === 'old' ? 'Periode lalu' : 'Periode ini')}
                                  </button>
                                );
                              })}
                            </span>
                            {whole ? (
                              <button type="button" className="sp-run-use" onClick={pickWhole}>
                                {inUse ? 'Pakai lagi' : 'Pakai analisa ini'}
                                <ArrowRight size={14} aria-hidden="true" />
                              </button>
                            ) : (
                              <span className="sp-run-note">{run.old && run.cur ? 'Data tidak lengkap untuk pilihan ini' : 'Hanya satu sisi tersimpan'}</span>
                            )}
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        <footer className="sp-foot">
          {tab === 'library' ? <Database size={13} aria-hidden="true" /> : tab === 'range' ? <CalendarDays size={13} aria-hidden="true" /> : <Archive size={13} aria-hidden="true" />}
          <span>
            {tab === 'library'
              ? 'Hanya bulan yang punya file di Data Collection Hub yang ditampilkan.'
              : tab === 'range'
                ? 'Rentang bebas, tidak harus satu bulan — dari data yang ditarik otomatis tiap hari.'
                : 'Klik kartu untuk membuka lagi analisa itu — Periode Lalu dan Periode Ini terisi sekaligus, tanpa mengunggah ulang file.'}
          </span>
          <kbd>Esc</kbd>
        </footer>
      </div>
    </div>,
    getPortalContainer(),
  );
}
