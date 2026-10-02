import { useMemo, useState } from 'react';
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
//   • Pie (compare overall) — how much of this period's revenue and spending
//     fell on twin dates (7/7, 8/8 …) and on payday, against every other day.
//   • Score cards (compare last period) — revenue and spending of each moment
//     this period, against the same moment last period.
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
  const money = (rs: SheetRow[]): Money => ({
    revenue: hasRevenue ? (metaRevenueTotal(rs) ?? 0) : null,
    spending: metaSpendTotal(rs) ?? 0,
  });
  return { twin: money(parts.twin), payday: money(parts.payday), rest: money(parts.rest), total: money(inMonth) };
}

function MomentCard({ title, cur, prev, curLabel, prevLabel, share, shareOf }: { title: string; cur: number | null; prev: number | null; curLabel: string; prevLabel: string; share: number | null; shareOf: string }) {
  const delta = cur !== null && prev !== null ? computeDelta(prev, cur) : null;
  return (
    <div className="sm-card is-focus">
      <div className="sm-card-title">
        {title}
        <span className="sm-latest">{curLabel}</span>
      </div>
      <div className="sm-card-figure">{rp(cur)}</div>
      <div className="sm-card-change">
        {delta ? (
          <>
            <DeltaPill cls={deltaClassForSentiment(delta.deltaNum, title.startsWith('Spending') ? 'neutral' : 'higher-better')}>{formatDeltaID(delta.deltaNum, delta.deltaStr)}</DeltaPill>
            <span>
              vs {prevLabel} ({rp(prev)})
            </span>
          </>
        ) : (
          <span className="sm-nodelta">tidak ada pembanding di file ini</span>
        )}
      </div>
      {share !== null && (
        <div className="sm-card-total">
          <b>{share.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</b> dari {shareOf} {curLabel}
        </div>
      )}
    </div>
  );
}

export function MetaSpecialMomentSection({ sources, heading }: { sources: MomentSource[]; heading: string }) {
  const [startDay, setStartDay] = useState(String(DEFAULT_PAYDAY.startDay));
  const [lengthDays, setLengthDays] = useState(String(DEFAULT_PAYDAY.lengthDays));
  const [pick, setPick] = useState('all');
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
    const occ: string[] = [];
    let hasRevenue = false;
    // [previous, current], summed over the chosen sources.
    const per: PeriodSplit[] = [0, 1].map(() => ({
      twin: { revenue: null, spending: null },
      payday: { revenue: null, spending: null },
      rest: { revenue: null, spending: null },
      total: { revenue: null, spending: null },
    }));
    for (const s of chosen) {
      const dayCol = s.dayCol as string;
      const revenueCol = metaRevenueTotal(s.rows) !== null;
      hasRevenue ||= revenueCol;
      const twin = buildSpecialMoment(s.rows, dayCol, 'double-date').occurrences;
      const pay = buildSpecialMoment(s.rows, dayCol, 'payday', payday).occurrences;
      for (const o of [...twin, ...pay]) if (!occ.includes(o.label)) occ.push(o.label);
      const pair = [s.periods[0], s.periods[s.periods.length - 1]];
      pair.forEach((p, i) => {
        const split = splitPeriod(s.rows, dayCol, p, twin, pay, revenueCol);
        for (const b of ['twin', 'payday', 'rest', 'total'] as const) {
          per[i][b] = { revenue: add(per[i][b].revenue, split[b].revenue), spending: add(per[i][b].spending, split[b].spending) };
        }
      });
    }
    const lead = chosen[0];
    return { per, hasRevenue, occ, prevLabel: lead.periods[0].label, curLabel: lead.periods[lead.periods.length - 1].label };
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
  const pieOf = (k: keyof Money) => {
    if (!cur) return null;
    const vals = [cur.twin[k], cur.payday[k], cur.rest[k]];
    if (vals.every((v) => v === null)) return null;
    return vals.map((v) => Math.max(0, v ?? 0));
  };
  const share = (part: number | null, whole: number | null) => (part !== null && whole ? (part / whole) * 100 : null);
  const revPie = reading?.hasRevenue ? pieOf('revenue') : null;
  const spendPie = pieOf('spending');
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
          (reading && cur && prev && (
            <>
              <h4 className="sm-subhead">Kontribusi special moment terhadap total 1 bulan · {reading.curLabel}</h4>
              <div className="sm-share-strip">
                {reading.hasRevenue && cur.total.revenue ? (
                  <span>
                    Special moment menyumbang <b>{fmtShare(share(add(cur.twin.revenue, cur.payday.revenue), cur.total.revenue))}</b> dari total revenue bulan ini (
                    {rp(add(cur.twin.revenue, cur.payday.revenue))} dari {rp(cur.total.revenue)})
                  </span>
                ) : null}
                {cur.total.spending ? (
                  <span>
                    dan <b>{fmtShare(share(add(cur.twin.spending, cur.payday.spending), cur.total.spending))}</b> dari total spending ({rp(add(cur.twin.spending, cur.payday.spending))} dari {rp(cur.total.spending)})
                  </span>
                ) : null}
              </div>
              <div className="sm-pies">
                <div className="sm-pie">
                  <h4>Revenue</h4>
                  {revPie ? (
                    <PieChartCanvas labels={['Twin Date', 'Payday', 'Di luar special moment']} values={revPie} format={(v) => rp(v)} centerTitle="Total revenue 1 bulan" legend />
                  ) : (
                    <div className="empty-note">
                      Sumber ini tidak memuat kolom <strong>Purchases conversion value</strong> — revenue hanya ada di campaign yang menjual (CPAS / Sales).
                    </div>
                  )}
                </div>
                <div className="sm-pie">
                  <h4>Spending</h4>
                  {spendPie ? (
                    <PieChartCanvas labels={['Twin Date', 'Payday', 'Di luar special moment']} values={spendPie} format={(v) => rp(v)} centerTitle="Total spending 1 bulan" legend />
                  ) : (
                    <div className="empty-note">Kolom Amount Spent tidak ditemukan.</div>
                  )}
                </div>
              </div>

              <h4 className="sm-subhead">Dibanding periode lalu · {reading.prevLabel} → {reading.curLabel}</h4>
              <div className="sm-scorecards sm-scorecards-grid">
                {reading.hasRevenue && (
                  <>
                    <MomentCard title="Revenue · Twin Date" cur={cur.twin.revenue} prev={prev.twin.revenue} curLabel={reading.curLabel} prevLabel={reading.prevLabel} share={share(cur.twin.revenue, cur.total.revenue)} shareOf="revenue 1 bulan" />
                    <MomentCard title="Revenue · Payday" cur={cur.payday.revenue} prev={prev.payday.revenue} curLabel={reading.curLabel} prevLabel={reading.prevLabel} share={share(cur.payday.revenue, cur.total.revenue)} shareOf="revenue 1 bulan" />
                  </>
                )}
                <MomentCard title="Spending · Twin Date" cur={cur.twin.spending} prev={prev.twin.spending} curLabel={reading.curLabel} prevLabel={reading.prevLabel} share={share(cur.twin.spending, cur.total.spending)} shareOf="spending 1 bulan" />
                <MomentCard title="Spending · Payday" cur={cur.payday.spending} prev={prev.payday.spending} curLabel={reading.curLabel} prevLabel={reading.prevLabel} share={share(cur.payday.spending, cur.total.spending)} shareOf="spending 1 bulan" />
              </div>
              <p className="chart-foot">
                Moment yang ditemukan di file: {reading.occ.length ? reading.occ.join(', ') : 'tidak ada'}. Hari yang sekaligus twin date dan payday dihitung sekali, sebagai
                twin date.
                {skipped.length > 0 && <> Tidak ikut dihitung (tanpa breakdown Day atau hanya satu periode): {skipped.map((s) => s.label).join(', ')}.</>}
              </p>
            </>
          ))}
      </div>
    </div>
  );
}
