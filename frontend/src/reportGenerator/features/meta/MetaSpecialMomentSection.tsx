import { useMemo, useState } from 'react';
import { DeltaPill } from '../../components/DeltaPill';
import { PieChartCanvas } from '../../components/PieChartCanvas';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SegmentedToggle } from '../../components/SegmentedToggle';
import { computeDelta, deltaClassForSentiment, formatDeltaID } from '../../lib/delta';
import { buildSpecialMoment, DEFAULT_PAYDAY, type MomentKind, type MomentOccurrence } from '../../lib/metaSpecialMoment';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { SheetRow } from '../../lib/types';

// Special Moment: the double dates (7/7, 8/8, 9/9) and paydays inside the
// upload, read as one comparison between the two periods being reported.
//
//   • Two pies — how the moment's revenue, and its spending, divide between
//     the previous period and this one. One glance says whether the moment
//     grew or shrank.
//   • Score cards beside them — the same two figures as numbers, each with
//     its change, plus what the moment took of the whole period.
//
// Occurrences are derived from the file's own dates, never typed in: every
// double date the upload covers is found automatically, and payday follows
// the window the brand actually uses (the 25th, or 25–27).

const KINDS = [
  { value: 'double-date' as const, label: 'Double Date' },
  { value: 'payday' as const, label: 'Payday' },
];

const rp = (v: number | null) => (v === null ? '—' : fmtPivotVal(v, 'rp'));
const pct = (v: number) => `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;

export interface MomentPeriod {
  label: string;
  start: Date;
  end: Date;
}

interface PeriodTotals {
  label: string;
  revenue: number | null;
  spending: number | null;
  occurrences: MomentOccurrence[];
}

// Two slices, one per period. Absent when neither side has the column.
function PeriodPie({ title, totals, valueOf }: { title: string; totals: PeriodTotals[]; valueOf: (t: PeriodTotals) => number | null }) {
  const values = totals.map(valueOf);
  const usable = values.every((v) => v !== null) && values.some((v) => (v as number) > 0);
  return (
    <div className="sm-pie">
      <h4>{title}</h4>
      {!usable ? (
        <div className="empty-note">Kolom {title.toLowerCase()} tidak ada di file ini, jadi perbandingannya belum bisa digambar.</div>
      ) : (
        <>
          <PieChartCanvas labels={totals.map((t) => t.label)} values={values.map((v) => v as number)} />
          <p className="chart-foot">
            {totals.map((t, i) => `${t.label}: ${rp(values[i])}`).join(' · ')}
          </p>
        </>
      )}
    </div>
  );
}

// One figure, its change against the previous period, and what it took of
// that period as a whole.
function MomentCard({
  title,
  cur,
  prev,
  curLabel,
  prevLabel,
  shareOfPeriod,
  shareNote,
}: {
  title: string;
  cur: number | null;
  prev: number | null;
  curLabel: string;
  prevLabel: string;
  shareOfPeriod: number | null;
  shareNote: string;
}) {
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
            <DeltaPill cls={deltaClassForSentiment(delta.deltaNum, 'higher-better')}>{formatDeltaID(delta.deltaNum, delta.deltaStr)}</DeltaPill>
            <span>
              vs {prevLabel} ({rp(prev)})
            </span>
          </>
        ) : (
          <span className="sm-nodelta">tidak ada pembanding di file ini</span>
        )}
      </div>
      {shareOfPeriod !== null && (
        <div className="sm-card-total">
          <b>{pct(shareOfPeriod)}</b> {shareNote}
        </div>
      )}
    </div>
  );
}

export function MetaSpecialMomentSection({
  rows,
  dayCol,
  heading,
  periods,
}: {
  rows: SheetRow[];
  dayCol: string | null;
  heading: string;
  periods: MomentPeriod[];
}) {
  const [kind, setKind] = useState<MomentKind>('double-date');
  const [startDay, setStartDay] = useState(String(DEFAULT_PAYDAY.startDay));
  const [lengthDays, setLengthDays] = useState(String(DEFAULT_PAYDAY.lengthDays));

  const paydayStart = Math.min(28, Math.max(1, Number(startDay) || DEFAULT_PAYDAY.startDay));
  const paydayLength = Math.min(31, Math.max(1, Number(lengthDays) || DEFAULT_PAYDAY.lengthDays));

  const { hasDayBreakdown, totals } = useMemo(() => {
    const result = buildSpecialMoment(rows, dayCol, kind, { startDay: paydayStart, lengthDays: paydayLength });
    const sum = (list: MomentOccurrence[], pick: (o: MomentOccurrence) => number | null) => {
      const usable = list.map(pick).filter((v): v is number => v !== null);
      return usable.length ? usable.reduce((a, b) => a + b, 0) : null;
    };
    // An occurrence belongs to the period whose date range contains its start.
    const perPeriod: PeriodTotals[] = periods.map((p) => {
      const occ = result.occurrences.filter((o) => o.start >= p.start && o.start <= p.end);
      return { label: p.label, revenue: sum(occ, (o) => o.revenue), spending: sum(occ, (o) => o.spending), occurrences: occ };
    });
    return { hasDayBreakdown: result.hasDayBreakdown, totals: perPeriod };
  }, [rows, dayCol, kind, paydayStart, paydayLength, periods]);

  const kindWord = kind === 'payday' ? 'payday' : 'double date';
  const prev = totals[0] ?? null;
  const cur = totals[totals.length - 1] ?? null;
  const shareOf = (part: number | null, whole: number | null) =>
    part !== null && whole !== null && whole > 0 ? (part / whole) * 100 : null;

  const blocked = !rows.length ? (
    <div className="empty-note">Belum ada data untuk bagian ini.</div>
  ) : !hasDayBreakdown ? (
    <div className="empty-note">
      Special Moment butuh breakdown <strong>Day</strong>. File yang diunggah dipecah per bulan, jadi tanggal seperti 9/9 tidak bisa dipisahkan. Export ulang dari Meta
      Ads Reporting dengan breakdown Day untuk mengisi bagian ini.
    </div>
  ) : periods.length < 2 ? (
    <div className="empty-note">Butuh dua periode untuk dibandingkan — unggah file Periode Lalu dan Periode Ini.</div>
  ) : !cur?.occurrences.length && !prev?.occurrences.length ? (
    <div className="empty-note">
      Tidak ada {kindWord} di dalam rentang tanggal file ini{kind === 'payday' ? ' — coba ubah tanggal mulainya.' : '.'}
    </div>
  ) : null;

  return (
    <div className="sec-block">
      <div className="sec-heading">
        {heading}
        <span className="sec-badge">{kindWord} · {periods.map((p) => p.label).join(' vs ')}</span>
        <SectionDownloadButton />
      </div>

      <div className="chart-controls" style={{ padding: '1.1rem 1.4rem 0' }}>
        <SegmentedToggle label="Jenis moment" options={KINDS} value={kind} onChange={setKind} accent="var(--acc)" />
        {kind === 'payday' && (
          <div className="sm-payday">
            <label>
              Mulai tanggal
              <input type="number" min={1} max={28} value={startDay} onChange={(e) => setStartDay(e.target.value)} />
            </label>
            <label>
              Panjang (hari)
              <input type="number" min={1} max={31} value={lengthDays} onChange={(e) => setLengthDays(e.target.value)} />
            </label>
            <span className="sm-hint">Umumnya tanggal 25 saja; sebagian brand membaca 25–27 — ubah panjangnya jadi 3.</span>
          </div>
        )}
      </div>

      <div style={{ padding: '1.1rem 1.4rem 1.4rem' }}>
        {blocked ?? (
          <>
            <div className="sm-split">
              <div className="sm-pies">
                <PeriodPie title="Revenue" totals={totals} valueOf={(t) => t.revenue} />
                <PeriodPie title="Spending" totals={totals} valueOf={(t) => t.spending} />
              </div>
              <div className="sm-scorecards sm-scorecards-side">
                <MomentCard
                  title={`Revenue ${kindWord}`}
                  cur={cur?.revenue ?? null}
                  prev={prev?.revenue ?? null}
                  curLabel={cur?.label ?? ''}
                  prevLabel={prev?.label ?? ''}
                  shareOfPeriod={shareOf(cur?.revenue ?? null, (cur?.revenue ?? 0) + (prev?.revenue ?? 0) || null)}
                  shareNote={`dari revenue ${kindWord} kedua periode`}
                />
                <MomentCard
                  title={`Spending ${kindWord}`}
                  cur={cur?.spending ?? null}
                  prev={prev?.spending ?? null}
                  curLabel={cur?.label ?? ''}
                  prevLabel={prev?.label ?? ''}
                  shareOfPeriod={shareOf(cur?.spending ?? null, (cur?.spending ?? 0) + (prev?.spending ?? 0) || null)}
                  shareNote={`dari spending ${kindWord} kedua periode`}
                />
              </div>
            </div>
            <p className="chart-foot">
              Yang dihitung hanya hari {kindWord} di dalam tiap periode
              {cur?.occurrences.length || prev?.occurrences.length
                ? ` (${[...(prev?.occurrences ?? []), ...(cur?.occurrences ?? [])].map((o) => o.label).join(', ')})`
                : ''}
              , bukan seluruh bulan — sehingga perbandingannya benar-benar moment lawan moment.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
