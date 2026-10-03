import { useMemo, useState, type CSSProperties } from 'react';
import { DeltaPill } from '../../components/DeltaPill';
import { PieChartCanvas } from '../../components/PieChartCanvas';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SegmentedToggle } from '../../components/SegmentedToggle';
import { computeDelta, deltaClassForSentiment, formatDeltaID } from '../../lib/delta';
import { parseMetaDayValue } from '../../lib/meta';
import { buildSpecialMoment, DEFAULT_PAYDAY, rowsBetween } from '../../lib/metaSpecialMoment';
import { metaRevenueTotal, metaSpendTotal } from '../../lib/metaFunnel';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { SheetRow } from '../../lib/types';

// Special Moment, as the architecture sheet asks for it:
//
//   • Pie (compare overall) — how much of the month's revenue and spending fell
//     on twin dates (7/7, 8/8 …) and on payday, against every other day; this
//     month, last month, or both side by side.
//   • Per moment (compare last period) — each moment's revenue, spending, ROAS
//     and its revenue against an ordinary day, this period against the last.
//
// Each figure is said once: amounts in the pie legend and the moment panels,
// shares in the compare table, the ordinary-day baseline in the footnote.
//
// It reads every Meta source the report has (Non-Boost, Boost, CPAS) — one
// combined reading by default, or one source at a time. Each source keeps its
// own two periods: CPAS spans its own months, the main account the ranges
// picked in the form; "previous" and "current" are matched by position.
// Occurrences come from the files' own dates, never typed in.

const rp = (v: number | null) => (v === null ? '—' : fmtPivotVal(v, 'rp'));
const fmtShare = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);

export interface MomentPeriod {
  label: string;
  start: Date;
  end: Date;
}

export interface MomentSource {
  key: string;
  label: string;
  rows: SheetRow[];
  dayCol: string | null;
  periods: MomentPeriod[];
}

type Bucket = 'twin' | 'payday' | 'rest';
interface Money {
  revenue: number | null;
  spending: number | null;
  // Distinct days with rows — for per-day figures (revenue a day, lift).
  days: Set<string>;
}
type PeriodSplit = Record<Bucket | 'total', Money>;

const add = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);

function inWindows(d: Date, windows: { start: Date; end: Date }[]) {
  return windows.some((w) => d >= w.start && d <= w.end);
}

// One source, one period: the whole calendar month(s) the period sits in —
// the pie's "overall" is the month's total revenue, not just the days picked —
// split into twin date / payday (inside the period) and everything else.
// A day that is both (a long payday window over 9/9) counts once, as a twin
// date, so the three slices always add up to the month.
function splitPeriod(rows: SheetRow[], dayCol: string, p: MomentPeriod, twin: { start: Date; end: Date }[], pay: { start: Date; end: Date }[], hasRevenue: boolean): PeriodSplit {
  const monthStart = new Date(p.start.getFullYear(), p.start.getMonth(), 1);
  const monthEnd = new Date(p.end.getFullYear(), p.end.getMonth() + 1, 0);
  const inMonth = rowsBetween(rows, dayCol, monthStart, monthEnd);
  const parts: Record<Bucket, SheetRow[]> = { twin: [], payday: [], rest: [] };
  for (const r of inMonth) {
    const d = parseMetaDayValue(r[dayCol]);
    if (!d) continue;
    const inPeriod = d >= p.start && d <= p.end;
    parts[inPeriod && inWindows(d, twin) ? 'twin' : inPeriod && inWindows(d, pay) ? 'payday' : 'rest'].push(r);
  }
  const money = (rs: SheetRow[]): Money => {
    const days = new Set<string>();
    for (const r of rs) {
      const d = parseMetaDayValue(r[dayCol]);
      if (d) days.add(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    }
    return { revenue: hasRevenue ? (metaRevenueTotal(rs) ?? 0) : null, spending: metaSpendTotal(rs) ?? 0, days };
  };
  return { twin: money(parts.twin), payday: money(parts.payday), rest: money(parts.rest), total: money(inMonth) };
}

// Moments in vivid warm hues, the rest of the month in ATLAS blue: the ring
// reads as one living object, and the two warm slices still pop against it.
const MOMENT_COLORS = ['#F0643C', '#F6B12B', '#5B86F5'];
const BUCKETS: Bucket[] = ['twin', 'payday', 'rest'];
const BUCKET_LABELS = ['Twin Date', 'Payday', 'Di luar special moment'];
const pctOf = (part: number | null, whole: number | null) => (part !== null && whole ? (part / whole) * 100 : null);
const perDay = (m: Money, k: 'revenue' | 'spending') => (m[k] !== null && m.days.size ? (m[k] as number) / m.days.size : null);
const roasOf = (m: Money) => (m.revenue !== null && m.spending ? m.revenue / m.spending : null);
const times = (v: number | null, digits = 1) => (v === null ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: digits, minimumFractionDigits: digits })}×`);
// A moment day against an ordinary day of the same month: 5,2× reads at a glance.
const liftOf = (split: PeriodSplit, b: Bucket) => {
  const base = perDay(split.rest, 'revenue');
  const v = perDay(split[b], 'revenue');
  return v === null || !base ? null : v / base;
};

// The one line that matters: what share of the month's revenue the moments
// brought, for what share of its spending.
function Headline({ split, other, otherLabel, hasRevenue }: { split: PeriodSplit; other: PeriodSplit | null; otherLabel: string; hasRevenue: boolean }) {
  const rev = (s: PeriodSplit) => pctOf(add(s.twin.revenue, s.payday.revenue), s.total.revenue);
  const sp = (s: PeriodSplit) => pctOf(add(s.twin.spending, s.payday.spending), s.total.spending);
  return (
    <p className="sm-headline">
      Special moment membawa {hasRevenue && <><b>{fmtShare(rev(split))}</b> revenue dari </>}
      <b>{fmtShare(sp(split))}</b> spending bulan ini
      {other && hasRevenue && rev(other) !== null && <span className="sm-headline-was"> · {otherLabel}: {fmtShare(rev(other))} revenue dari {fmtShare(sp(other))} spending</span>}
    </p>
  );
}

// Both months' rings side by side, and how each slice's share moved — shares
// only; the amounts live in the moment panels below.
function ComparePies({ metric, prev, cur, prevLabel, curLabel }: { metric: 'revenue' | 'spending'; prev: PeriodSplit; cur: PeriodSplit; prevLabel: string; curLabel: string }) {
  return (
    <section className="sm-compare-card">
      <h4>{metric === 'revenue' ? 'Revenue' : 'Spending'}</h4>
      <div className="sm-compare-rings">
        {([
          [prevLabel, prev],
          [curLabel, cur],
        ] as const).map(([label, split]) => (
          <PieChartCanvas
            key={label}
            size={210}
            colors={MOMENT_COLORS}
            labels={BUCKET_LABELS}
            values={BUCKETS.map((b) => Math.max(0, split[b][metric] ?? 0))}
            format={(v) => rp(v)}
            centerTitle={label}
          />
        ))}
      </div>
      <table className="sm-compare-table">
        <thead>
          <tr>
            <th scope="col">Porsi</th>
            <th scope="col">{prevLabel}</th>
            <th scope="col">{curLabel}</th>
            <th scope="col">Perubahan</th>
          </tr>
        </thead>
        <tbody>
          {BUCKETS.map((b, i) => {
            const a = pctOf(prev[b][metric], prev.total[metric]);
            const c = pctOf(cur[b][metric], cur.total[metric]);
            const pp = a !== null && c !== null ? c - a : null;
            const tone = metric !== 'revenue' || b === 'rest' || pp === null || Math.abs(pp) < 0.05 ? '' : pp > 0 ? 'is-up' : 'is-down';
            return (
              <tr key={b}>
                <th scope="row">
                  <span className="sm-dot" style={{ background: MOMENT_COLORS[i] }} aria-hidden="true" />
                  {BUCKET_LABELS[i]}
                </th>
                <td>{fmtShare(a)}</td>
                <td>{fmtShare(c)}</td>
                <td className={tone}>{pp === null ? '—' : `${pp > 0 ? '+' : ''}${pp.toLocaleString('id-ID', { maximumFractionDigits: 1 })} pp`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// One moment, this period against the last: what it earned, what it cost,
// how hard the money worked (ROAS) and how it compares with an ordinary day.
function MomentPanel({ bucket, color, name, dates, prev, cur, prevLabel, hasRevenue }: { bucket: Bucket; color: string; name: string; dates: string[]; prev: PeriodSplit; cur: PeriodSplit; prevLabel: string; hasRevenue: boolean }) {
  // Amounts carry their change as a pill; ratios just name last month's value.
  const metric = (label: string, c: number | null, p: number | null, fmt: (v: number | null) => string, sentiment: 'higher-better' | 'neutral', pill = true) => {
    const d = pill && c !== null && p !== null ? computeDelta(p, c) : null;
    return (
      <div className="sm-metric">
        <span className="sm-metric-label">{label}</span>
        <strong>{fmt(c)}</strong>
        <span className="sm-metric-was">
          {d && <DeltaPill cls={deltaClassForSentiment(d.deltaNum, sentiment)}>{formatDeltaID(d.deltaNum, d.deltaStr)}</DeltaPill>}
          <small>
            {prevLabel} {fmt(p)}
          </small>
        </span>
      </div>
    );
  };
  return (
    <section className="sm-moment" style={{ '--sm-c': color } as CSSProperties}>
      <header>
        <h4>{name}</h4>
        <span>{dates.length ? dates.join(', ') : 'tidak ada di periode ini'}</span>
      </header>
      <div className="sm-metrics">
        {hasRevenue && metric('Revenue', cur[bucket].revenue, prev[bucket].revenue, rp, 'higher-better')}
        {metric('Spending', cur[bucket].spending, prev[bucket].spending, rp, 'neutral')}
        {hasRevenue && metric('ROAS', roasOf(cur[bucket]), roasOf(prev[bucket]), (v) => times(v, 2).replace('×', 'x'), 'higher-better', false)}
        {hasRevenue && metric('vs hari biasa', liftOf(cur, bucket), liftOf(prev, bucket), (v) => times(v), 'higher-better', false)}
      </div>
    </section>
  );
}

export function MetaSpecialMomentSection({ sources, heading }: { sources: MomentSource[]; heading: string }) {
  const [startDay, setStartDay] = useState(String(DEFAULT_PAYDAY.startDay));
  const [lengthDays, setLengthDays] = useState(String(DEFAULT_PAYDAY.lengthDays));
  const [pick, setPick] = useState('all');
  // Which month the pies read: this period, the previous one, or both side by side.
  const [view, setView] = useState<'cur' | 'prev' | 'compare'>('cur');
  const paydayStart = Math.min(28, Math.max(1, Number(startDay) || DEFAULT_PAYDAY.startDay));
  const paydayLength = Math.min(31, Math.max(1, Number(lengthDays) || DEFAULT_PAYDAY.lengthDays));

  // Sources that can answer at all: rows, a Day column, two periods.
  const usable = useMemo(
    () => sources.filter((s) => s.rows.length && s.dayCol && s.periods.length >= 2 && buildSpecialMoment(s.rows, s.dayCol, 'double-date').hasDayBreakdown),
    [sources],
  );
  const skipped = sources.filter((s) => s.rows.length && !usable.includes(s));

  const reading = useMemo(() => {
    const payday = { startDay: paydayStart, lengthDays: paydayLength };
    const chosen = pick === 'all' ? usable : usable.filter((s) => s.key === pick);
    if (!chosen.length) return null;
    let hasRevenue = false;
    // [previous, current], summed over the chosen sources; with the dates of
    // each moment that fell inside each period.
    const empty = (): Money => ({ revenue: null, spending: null, days: new Set() });
    const per: PeriodSplit[] = [0, 1].map(() => ({ twin: empty(), payday: empty(), rest: empty(), total: empty() }));
    const dates: Record<'twin' | 'payday', string[]>[] = [0, 1].map(() => ({ twin: [], payday: [] }));
    for (const s of chosen) {
      const dayCol = s.dayCol as string;
      const revenueCol = metaRevenueTotal(s.rows) !== null;
      hasRevenue ||= revenueCol;
      const twin = buildSpecialMoment(s.rows, dayCol, 'double-date').occurrences;
      const pay = buildSpecialMoment(s.rows, dayCol, 'payday', payday).occurrences;
      const pair = [s.periods[0], s.periods[s.periods.length - 1]];
      pair.forEach((p, i) => {
        for (const [k, list] of [['twin', twin], ['payday', pay]] as const) {
          for (const o of list) {
            const label = k === 'payday' ? `${o.start.getDate()}${paydayLength > 1 ? `–${o.end.getDate()}` : ''}/${o.start.getMonth() + 1}` : o.label;
            if (o.start >= p.start && o.start <= p.end && !dates[i][k].includes(label)) dates[i][k].push(label);
          }
        }
        const split = splitPeriod(s.rows, dayCol, p, twin, pay, revenueCol);
        for (const b of ['twin', 'payday', 'rest', 'total'] as const) {
          per[i][b] = {
            revenue: add(per[i][b].revenue, split[b].revenue),
            spending: add(per[i][b].spending, split[b].spending),
            days: new Set([...per[i][b].days, ...split[b].days]),
          };
        }
      });
    }
    const lead = chosen[0];
    return { per, dates, hasRevenue, prevLabel: lead.periods[0].label, curLabel: lead.periods[lead.periods.length - 1].label };
  }, [usable, pick, paydayStart, paydayLength]);

  const blocked = !sources.some((s) => s.rows.length) ? (
    <div className="empty-note">Belum ada data untuk bagian ini.</div>
  ) : !usable.length ? (
    <div className="empty-note">
      Special Moment butuh breakdown <strong>Day</strong> dan dua periode. File yang diunggah dipecah per bulan, jadi tanggal seperti 9/9 tidak bisa dipisahkan. Export
      ulang dari Meta Ads Reporting dengan breakdown Day untuk mengisi bagian ini.
    </div>
  ) : null;

  const cur = reading?.per[1];
  const prev = reading?.per[0];
  const shown = view === 'prev' ? prev : cur;
  const shownLabel = reading ? (view === 'prev' ? reading.prevLabel : reading.curLabel) : '';
  const sourceOptions = [{ value: 'all', label: 'Semua Meta' }, ...usable.map((s) => ({ value: s.key, label: s.label }))];

  return (
    <div className="sec-block">
      <div className="sec-heading">
        {heading}
        <span className="sec-badge">twin date &amp; payday · {reading ? `${reading.prevLabel} vs ${reading.curLabel}` : 'butuh breakdown Day'}</span>
        <SectionDownloadButton />
      </div>

      {!blocked && (
        <div className="chart-controls" style={{ padding: '1.1rem 1.4rem 0' }}>
          {usable.length > 1 && <SegmentedToggle label="Sumber" options={sourceOptions} value={pick} onChange={setPick} accent="var(--acc)" />}
          <div className="sm-payday">
            <label>
              Payday mulai tanggal
              <input type="number" min={1} max={28} value={startDay} onChange={(e) => setStartDay(e.target.value)} />
            </label>
            <label>
              Panjang (hari)
              <input type="number" min={1} max={31} value={lengthDays} onChange={(e) => setLengthDays(e.target.value)} />
            </label>
            <span className="sm-hint">Twin date (7/7, 8/8, …) terdeteksi otomatis. Payday umumnya tanggal 25; ubah panjangnya jadi 3 untuk membaca 25–27.</span>
          </div>
        </div>
      )}

      <div style={{ padding: '1.1rem 1.4rem 1.4rem' }}>
        {blocked ??
          (reading && cur && prev && shown && (
            <>
              <div className="sm-contrib-head">
                <h4 className="sm-subhead">Kontribusi terhadap total 1 bulan · {view === 'compare' ? `${reading.prevLabel} vs ${reading.curLabel}` : shownLabel}</h4>
                <SegmentedToggle
                  label="Tampilkan"
                  options={[
                    { value: 'cur', label: reading.curLabel },
                    { value: 'prev', label: reading.prevLabel },
                    { value: 'compare', label: 'Bandingkan' },
                  ]}
                  value={view}
                  onChange={(v) => setView(v as 'cur' | 'prev' | 'compare')}
                  accent="var(--acc)"
                />
              </div>

              <Headline
                split={view === 'prev' ? prev : cur}
                other={view === 'compare' ? prev : null}
                otherLabel={reading.prevLabel}
                hasRevenue={reading.hasRevenue}
              />

              {view !== 'compare' ? (
                <div className="sm-pies">
                  {(['revenue', 'spending'] as const).map((k) => (
                    <div className="sm-pie" key={k}>
                      <h4>{k === 'revenue' ? 'Revenue' : 'Spending'}</h4>
                      {k === 'revenue' && !reading.hasRevenue ? (
                        <div className="empty-note">
                          Sumber ini tidak memuat kolom <strong>Purchases conversion value</strong> — revenue hanya ada di campaign yang menjual (CPAS / Sales).
                        </div>
                      ) : (
                        <PieChartCanvas
                          colors={MOMENT_COLORS}
                          labels={BUCKET_LABELS}
                          values={BUCKETS.map((b) => Math.max(0, shown[b][k] ?? 0))}
                          format={(v) => rp(v)}
                          centerTitle={`Total ${k} ${shownLabel}`}
                          legend
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sm-compare">
                  {(['revenue', 'spending'] as const)
                    .filter((k) => k === 'spending' || reading.hasRevenue)
                    .map((k) => (
                      <ComparePies key={k} metric={k} prev={prev} cur={cur} prevLabel={reading.prevLabel} curLabel={reading.curLabel} />
                    ))}
                </div>
              )}

              <h4 className="sm-subhead">
                Per moment · {reading.curLabel} dibanding {reading.prevLabel}
              </h4>
              <div className="sm-moments">
                <MomentPanel bucket="twin" color={MOMENT_COLORS[0]} name="Twin Date" dates={reading.dates[1].twin} prev={prev} cur={cur} prevLabel={reading.prevLabel} hasRevenue={reading.hasRevenue} />
                <MomentPanel bucket="payday" color={MOMENT_COLORS[1]} name="Payday" dates={reading.dates[1].payday} prev={prev} cur={cur} prevLabel={reading.prevLabel} hasRevenue={reading.hasRevenue} />
              </div>
              <p className="chart-foot">
                Hari biasa {reading.curLabel}
                {reading.hasRevenue ? <> rata-rata {rp(perDay(cur.rest, 'revenue'))} revenue/hari, ROAS {times(roasOf(cur.rest), 2).replace('×', 'x')}</> : <> rata-rata {rp(perDay(cur.rest, 'spending'))} spending/hari</>}{' '}
                — acuan "vs hari biasa". Hari yang sekaligus twin date dan payday dihitung sekali, sebagai twin date.
                {skipped.length > 0 && <> Tidak ikut dihitung (tanpa breakdown Day atau hanya satu periode): {skipped.map((s) => s.label).join(', ')}.</>}
              </p>
            </>
          ))}
      </div>
    </div>
  );
}
