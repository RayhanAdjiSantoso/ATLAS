import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import api from '../../../api/client.js';
import { getLayoutRect, getLayoutViewport } from '../../../utils/uiScale.js';
import { getPortalContainer } from '../../utils/portalTarget';
import { formatAutoRange, type AutoRange } from './AutoRangePanel';

// "Rentang tanggal" as a field on the page, not a step inside a dialog: the
// period's range reads in its own cell, beside the other period's, and the
// calendar opens anchored under it — Shopee Seller Centre's picker: quick
// ranges on the left, two months on the right, click the first day, click
// the last day, apply. Days the Meta auto-fetch has no rows for cannot be
// picked, so a range can never land outside the stored data.

interface StoredDays {
  days: { MAIN: string[]; CPAS: string[] };
  maxRangeDays: number;
}

// One fetch per brand per page visit; both periods' fields share it.
const daysCache = new Map<number, Promise<StoredDays>>();
function loadDays(clientId: number): Promise<StoredDays> {
  if (!daysCache.has(clientId)) {
    daysCache.set(
      clientId,
      api.get('/meta-ads-insights/days', { params: { brandId: clientId } }).then((r: { data: StoredDays }) => r.data).catch((e: unknown) => {
        daysCache.delete(clientId);
        throw e;
      }),
    );
  }
  return daysCache.get(clientId)!;
}

const DAY_MS = 86400000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => toIso(toMs(iso) + n * DAY_MS);
const daysInclusive = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS) + 1;
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const WEEKDAYS = ['M', 'S', 'S', 'R', 'K', 'J', 'S'];

interface Month {
  y: number;
  m: number; // 0-based
}
const shiftMonth = ({ y, m }: Month, n: number): Month => {
  const t = y * 12 + m + n;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
};
const monthOf = (iso: string): Month => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) - 1 });
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function cells({ y, m }: Month): (string | null)[] {
  const lead = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => isoOf(y, m, i + 1))];
}

interface Props {
  clientId: number;
  role: 'old' | 'cur';
  value: { start: string; end: string } | null;
  // The other period's range — offered as "the same length, right before /
  // after it", the usual way a comparison is set up.
  other: { start: string; end: string } | null;
  autoOpen?: boolean;
  onApply: (range: AutoRange) => void;
}

export function RangeCalendar({ clientId, role, value, other, autoOpen = false, onApply }: Props) {
  const [stored, setStored] = useState<StoredDays | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(value?.start ?? null);
  const [end, setEnd] = useState<string | null>(value?.end ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<Month | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setStored(null);
    setError(null);
    loadDays(clientId)
      .then((d) => alive && setStored(d))
      .catch((e: { response?: { data?: { message?: string } }; message?: string }) => alive && setError(e.response?.data?.message || e.message || 'Data harian tidak bisa dimuat.'));
    return () => {
      alive = false;
    };
  }, [clientId]);

  const main = useMemo(() => stored?.days.MAIN ?? [], [stored]);
  const cpas = useMemo(() => stored?.days.CPAS ?? [], [stored]);
  const mainSet = useMemo(() => new Set(main), [main]);
  const first = main[0] ?? null;
  const last = main[main.length - 1] ?? null;

  function openPicker() {
    setStart(value?.start ?? null);
    setEnd(value?.end ?? null);
    setHover(null);
    const anchor = value?.end ?? last;
    setView(anchor ? shiftMonth(monthOf(anchor), -1) : null);
    // Bring the field into view first, so the calendar opens next to it
    // rather than floating over another part of the page.
    const t = triggerRef.current;
    if (t) {
      const r = t.getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight - 120) t.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (autoOpen && stored && last) openPicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, stored]);

  // Anchored under the field; above it when there is no room below; one
  // month only on a narrow screen.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const t = triggerRef.current;
      if (!t) return;
      const r = getLayoutRect(t);
      const vp = getLayoutViewport();
      const width = Math.min(vp.width - 24, vp.width < 820 ? 380 : 780);
      const height = popRef.current?.offsetHeight ?? 470;
      const below = r.bottom + 8;
      const top = below + height > vp.height - 12 && r.top - height - 8 > 12 ? r.top - height - 8 : Math.max(12, Math.min(below, vp.height - height - 12));
      const left = Math.max(12, Math.min(r.left, vp.width - width - 12));
      setPos({ top, left, width });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!popRef.current?.contains(n) && !triggerRef.current?.contains(n)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const clamp = (a: string, b: string): [string, string] | null => {
    if (!first || !last) return null;
    const s = a < first ? first : a;
    const e = b > last ? last : b;
    return s <= e ? [s, e] : null;
  };
  const presets = useMemo(() => {
    if (!first || !last) return [];
    const list: { label: string; range: [string, string] | null }[] = [
      { label: '7 hari terakhir', range: clamp(addDays(last, -6), last) },
      { label: '14 hari terakhir', range: clamp(addDays(last, -13), last) },
      { label: '30 hari terakhir', range: clamp(addDays(last, -29), last) },
    ];
    const lm = monthOf(last);
    list.push({ label: `${MONTHS[lm.m]} ${lm.y} (s.d. data terakhir)`, range: clamp(isoOf(lm.y, lm.m, 1), last) });
    const pm = shiftMonth(lm, -1);
    list.push({ label: `${MONTHS[pm.m]} ${pm.y} penuh`, range: clamp(isoOf(pm.y, pm.m, 1), isoOf(pm.y, pm.m, new Date(Date.UTC(pm.y, pm.m + 1, 0)).getUTCDate())) });
    if (other) {
      const n = daysInclusive(other.start, other.end);
      list.unshift(
        role === 'old'
          ? { label: `${n} hari sebelum Periode Ini`, range: clamp(addDays(other.start, -n), addDays(other.start, -1)) }
          : { label: `${n} hari setelah Periode Lalu`, range: clamp(addDays(other.end, 1), addDays(other.end, n)) },
      );
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, last, other, role]);

  function pickDay(iso: string) {
    if (!start || end) {
      setStart(iso);
      setEnd(null);
    } else if (iso < start) {
      setEnd(start);
      setStart(iso);
    } else {
      setEnd(iso);
    }
  }

  const effEnd = end ?? (start && hover && hover >= start ? hover : null);
  type Check = { hint: string } | { error: string } | { length: number; mainDays: number; cpasDays: number };
  const check = useMemo((): Check | null => {
    if (!stored || !start) return null;
    if (!end) return { hint: 'Klik tanggal akhir.' };
    const length = daysInclusive(start, end);
    if (length > stored.maxRangeDays) return { error: `Rentang maksimal ${stored.maxRangeDays} hari (sekarang ${length} hari).` };
    const mainDays = main.filter((d) => d >= start && d <= end).length;
    if (!mainDays) return { error: 'Belum ada data Meta Ads tersimpan pada rentang ini.' };
    return { length, mainDays, cpasDays: cpas.filter((d) => d >= start && d <= end).length };
  }, [stored, start, end, main, cpas]);
  const ok = check && 'mainDays' in check ? check : null;

  function apply() {
    if (!ok || !start || !end) return;
    onApply({ start, end, label: formatAutoRange(start, end), channels: { meta: ok.mainDays, ...(ok.cpasDays ? { cpas: ok.cpasDays } : {}) } });
    setOpen(false);
  }

  const narrow = (pos?.width ?? 780) < 600;
  const months = view ? (narrow ? [shiftMonth(view, 1)] : [view, shiftMonth(view, 1)]) : [];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`rc-trigger${value ? ' is-set' : ''}${open ? ' is-open' : ''}`}
        disabled={!stored || !last}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <span className="rc-trigger-ico" aria-hidden="true">
          <CalendarDays size={19} />
        </span>
        <span className="rc-trigger-copy">
          <strong>{value ? formatAutoRange(value.start, value.end) : 'Pilih rentang tanggal'}</strong>
          <small>
            {error
              ? error
              : !stored
                ? 'Memuat data harian…'
                : !last
                  ? 'Belum ada data harian — aktifkan tarik otomatis di Pengaturan Brand'
                  : value
                    ? `${daysInclusive(value.start, value.end)} hari · data tersedia ${formatAutoRange(first!, last)}`
                    : `Data harian tersedia ${formatAutoRange(first!, last)}`}
          </small>
        </span>
        <ChevronRight size={17} className="rc-trigger-go" aria-hidden="true" />
      </button>

      {open &&
        view &&
        createPortal(
          <div
            ref={popRef}
            className="rc-pop"
            role="dialog"
            aria-label={`Rentang tanggal ${role === 'old' ? 'Periode Lalu' : 'Periode Ini'}`}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0, width: pos?.width }}
          >
            <div className="rc-body">
              <ul className="rc-presets" aria-label="Rentang cepat">
                {presets.map((p) => (
                  <li key={p.label}>
                    <button
                      type="button"
                      disabled={!p.range}
                      className={p.range && start === p.range[0] && end === p.range[1] ? 'is-on' : undefined}
                      onClick={() => {
                        if (!p.range) return;
                        setStart(p.range[0]);
                        setEnd(p.range[1]);
                        setView(narrow ? shiftMonth(monthOf(p.range[1]), -1) : shiftMonth(monthOf(p.range[1]), -1));
                      }}
                    >
                      {p.label}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="rc-months">
                {months.map((mo, i) => (
                  <div key={`${mo.y}-${mo.m}`} className="rc-month">
                    <div className="rc-month-head">
                      {i === 0 ? (
                        <span className="rc-nav">
                          <button type="button" aria-label="Tahun sebelumnya" onClick={() => setView((v) => v && shiftMonth(v, -12))}>
                            <ChevronsLeft size={16} />
                          </button>
                          <button type="button" aria-label="Bulan sebelumnya" onClick={() => setView((v) => v && shiftMonth(v, -1))}>
                            <ChevronLeft size={16} />
                          </button>
                        </span>
                      ) : (
                        <span className="rc-nav" />
                      )}
                      <strong>
                        {MONTHS[mo.m]} {mo.y}
                      </strong>
                      {i === months.length - 1 ? (
                        <span className="rc-nav">
                          <button type="button" aria-label="Bulan berikutnya" onClick={() => setView((v) => v && shiftMonth(v, 1))}>
                            <ChevronRight size={16} />
                          </button>
                          <button type="button" aria-label="Tahun berikutnya" onClick={() => setView((v) => v && shiftMonth(v, 12))}>
                            <ChevronsRight size={16} />
                          </button>
                        </span>
                      ) : (
                        <span className="rc-nav" />
                      )}
                    </div>
                    <div className="rc-grid" role="grid">
                      {WEEKDAYS.map((w, k) => (
                        <span key={k} className="rc-wd">
                          {w}
                        </span>
                      ))}
                      {cells(mo).map((iso, k) => {
                        if (!iso) return <span key={k} />;
                        const out = !first || !last || iso < first || iso > last;
                        const edgeS = iso === start;
                        const edgeE = iso === effEnd;
                        const inside = start && effEnd && iso > start && iso < effEnd;
                        const cls = [
                          'rc-day',
                          out ? 'is-out' : !mainSet.has(iso) ? 'is-empty' : '',
                          inside ? 'is-in' : '',
                          edgeS ? 'is-start' : '',
                          edgeE ? 'is-end' : '',
                          edgeS && edgeE ? 'is-single' : '',
                        ]
                          .filter(Boolean)
                          .join(' ');
                        return (
                          <button
                            key={k}
                            type="button"
                            className={cls}
                            disabled={out}
                            aria-pressed={Boolean(edgeS || edgeE || inside)}
                            aria-label={`${Number(iso.slice(8))} ${MONTHS[mo.m]} ${mo.y}${out ? ' — tidak ada data' : ''}`}
                            onMouseEnter={() => setHover(iso)}
                            onClick={() => pickDay(iso)}
                          >
                            {Number(iso.slice(8))}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rc-foot">
              <span className={`rc-status${check && 'error' in check ? ' is-error' : ''}`} role="status">
                {!start
                  ? 'Klik tanggal awal, lalu tanggal akhir.'
                  : check && 'hint' in check
                    ? `Mulai ${formatAutoRange(start, start)} — klik tanggal akhir.`
                    : check && 'error' in check
                      ? check.error
                      : ok
                        ? `${formatAutoRange(start, end!)} · ${ok.length} hari · Meta Ads ${ok.mainDays} hari${ok.mainDays < ok.length ? ` (${ok.length - ok.mainDays} kosong)` : ''}${cpas.length ? ` · CPAS ${ok.cpasDays} hari` : ''}`
                        : ''}
              </span>
              <span className="rc-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                  Batal
                </button>
                <button type="button" className="btn btn-primary" disabled={!ok} onClick={apply}>
                  <Check size={15} aria-hidden="true" /> Terapkan
                </button>
              </span>
            </div>
          </div>,
          getPortalContainer(),
        )}
    </>
  );
}
