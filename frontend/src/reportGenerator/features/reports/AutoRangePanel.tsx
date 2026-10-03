import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check } from 'lucide-react';
import api from '../../../api/client.js';
import { InlineNotice } from '../../components/InlineNotice';

// Third source of the Meta period picker: the daily rows the Meta auto-fetch
// stores (Pengaturan Brand › Data & file › Meta Ads › Tarik otomatis). The
// library only holds whole months; these rows can be cut at any day, so a
// side can be e.g. 15 Agu – 14 Sep.

export interface AutoRange {
  start: string; // 'YYYY-MM-DD'
  end: string;
  label: string;
  // Stored days inside the range, per library channel ('meta' | 'cpas').
  channels: Record<string, number>;
}

interface StoredDays {
  days: { MAIN: string[]; CPAS: string[] };
  maxRangeDays: number;
}

const DAY_MS = 86400000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysInclusive = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS) + 1;
const DAY_FMT = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const SHORT_FMT = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function formatAutoRange(start: string, end: string): string {
  if (start === end) return DAY_FMT.format(new Date(toMs(start)));
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${(sameYear ? SHORT_FMT : DAY_FMT).format(new Date(toMs(start)))} – ${DAY_FMT.format(new Date(toMs(end)))}`;
}

const countIn = (list: string[], start: string, end: string) => list.filter((d) => d >= start && d <= end).length;

interface Props {
  clientId: number;
  selected?: { start: string; end: string } | null;
  onPick: (range: AutoRange) => void;
}

export function AutoRangePanel({ clientId, selected, onPick }: Props) {
  const [stored, setStored] = useState<StoredDays | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState(selected?.start ?? '');
  const [end, setEnd] = useState(selected?.end ?? '');

  useEffect(() => {
    let cancelled = false;
    setStored(null);
    setError(null);
    api
      .get('/meta-ads-insights/days', { params: { brandId: clientId } })
      .then(({ data }) => {
        if (cancelled) return;
        const s = data as StoredDays;
        setStored(s);
        // Default: the latest 7 stored days of the main account.
        const main = s.days.MAIN;
        if (main.length && !selected) {
          const last = main[main.length - 1];
          const first = toIso(Math.max(toMs(main[0]), toMs(last) - 6 * DAY_MS));
          setStart(first);
          setEnd(last);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.response?.data?.message || e.response?.data?.error || (e as Error).message || 'Data tarikan otomatis tidak bisa dimuat.');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const main = stored?.days.MAIN ?? [];
  const cpas = stored?.days.CPAS ?? [];
  const first = main[0] ?? null;
  const last = main[main.length - 1] ?? null;

  const check = useMemo(() => {
    if (!stored || !start || !end) return null;
    if (start > end) return { error: 'Tanggal mulai harus sebelum tanggal akhir.' };
    const length = daysInclusive(start, end);
    if (length > stored.maxRangeDays) return { error: `Rentang maksimal ${stored.maxRangeDays} hari (sekarang ${length} hari).` };
    const mainDays = countIn(main, start, end);
    if (!mainDays) return { error: 'Belum ada data Meta Ads tersimpan pada rentang ini.' };
    return { length, mainDays, cpasDays: countIn(cpas, start, end) };
  }, [stored, start, end, main, cpas]);

  function preset(days: number) {
    if (!first || !last) return;
    setEnd(last);
    setStart(toIso(Math.max(toMs(first), toMs(last) - (days - 1) * DAY_MS)));
  }

  if (error) return <InlineNotice title="Data tarikan otomatis tidak bisa dimuat">{error}</InlineNotice>;
  if (!stored) {
    return (
      <div className="lib-picker-grid" aria-busy="true">
        <span className="lib-picker-skeleton" />
        <span className="sr-only">Memuat…</span>
      </div>
    );
  }
  if (!first || !last) {
    return (
      <div className="lib-picker-empty">
        <CalendarDays size={22} aria-hidden="true" />
        <strong>Belum ada data harian</strong>
        <span>Aktifkan tarik otomatis di Data Brand → Data &amp; file → Meta Ads, lalu buka lagi daftar ini.</span>
      </div>
    );
  }

  return (
    <div className="auto-range">
      <div className="auto-range-coverage">
        <span>
          <strong>Meta Ads</strong> {formatAutoRange(first, last)} · {main.length} hari
        </span>
        {cpas.length > 0 && (
          <span>
            <strong>CPAS</strong> {formatAutoRange(cpas[0], cpas[cpas.length - 1])} · {cpas.length} hari
          </span>
        )}
      </div>

      <div className="auto-range-presets" role="group" aria-label="Rentang cepat">
        {[7, 14, 30].map((n) => (
          <button key={n} type="button" onClick={() => preset(n)}>{n} hari terakhir</button>
        ))}
      </div>

      <div className="auto-range-inputs">
        <label>
          <span>Dari</span>
          <input type="date" value={start} min={first} max={last} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span>Sampai</span>
          <input type="date" value={end} min={first} max={last} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      {check && 'error' in check && <p className="auto-range-error" role="alert">{check.error}</p>}
      {check && !('error' in check) && (
        <p className="auto-range-summary">
          {check.length} hari dipilih · Meta Ads {check.mainDays} hari tersedia
          {check.mainDays < check.length ? ` (${check.length - check.mainDays} hari kosong)` : ''}
          {cpas.length > 0 ? ` · CPAS ${check.cpasDays} hari` : ''}
        </p>
      )}

      <div className="auto-range-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!check || 'error' in check}
          onClick={() => {
            if (!check || 'error' in check) return;
            onPick({
              start,
              end,
              label: formatAutoRange(start, end),
              channels: { meta: check.mainDays, ...(check.cpasDays ? { cpas: check.cpasDays } : {}) },
            });
          }}
        >
          <Check size={15} aria-hidden="true" /> Gunakan rentang
        </button>
      </div>
    </div>
  );
}
