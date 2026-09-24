import { useMemo, useState } from 'react';
import { DeltaPill } from '../../components/DeltaPill';
import { PieChartCanvas } from '../../components/PieChartCanvas';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { computeDelta, deltaClassForSentiment, formatDeltaID } from '../../lib/delta';
import { buildSpecialMoment, DEFAULT_PAYDAY, type MomentKind, type MomentOccurrence } from '../../lib/metaSpecialMoment';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { SheetRow } from '../../lib/types';

// Special Moment: the twin dates (7/7, 8/8, 9/9) and paydays inside the
// upload, both kinds in one card — no tab to flip, because the question is
// "how did our moments do", not "how did one kind of moment do".
//
//   • Two pies — revenue on twin dates, and revenue on paydays, each split
//     between the previous period and this one.
//   • Two score cards beside them — what was spent on each kind this period,
//     with the change against the previous one.
//
// Occurrences are derived from the file's own dates, never typed in: every
// twin date the upload covers is found automatically, and payday follows the
// window the brand actually uses (the 25th, or 25–27).

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

interface KindTotals {
  key: MomentKind;
  label: string;
  word: string;
  periods: PeriodTotals[];
  occurrences: MomentOccurrence[];
}

// Two slices, one per period.
function KindPie({ kind }: { kind: KindTotals }) {
  const values = kind.periods.map((p) => p.revenue);
  return (
    <div className="sm-pie">
      <h4>Revenue · {kind.label}</h4>
      {!kind.occurrences.length ? (
        <div className="empty-note">Tidak ada {kind.word} di dalam rentang tanggal file ini.</div>
      ) : (
        <>
          <PieChartCanvas labels={kind.periods.map((p) => p.label)} values={values.map((v) => v || 0)} />
          <p className="chart-foot">{kind.periods.map((p, i) => `${p.label}: ${rp(values[i])}`).join(' · ')}</p>
        </>
      )}
    </div>
  );
}

// Spending on this kind in the current period, against the previous one.
function KindSpendCard({ kind }: { kind: KindTotals }) {
  const prev = kind.periods[0] ?? null;
  const cur = kind.periods[kind.periods.length - 1] ?? null;
  const curVal = cur?.spending ?? null;
  const prevVal = prev?.spending ?? null;
  const delta = curVal !== null && prevVal !== null ? computeDelta(prevVal, curVal) : null;
  const both = (curVal ?? 0) + (prevVal ?? 0);
  return (
    <div className="sm-card is-focus">
      <div className="sm-card-title">
        Spending · {kind.label}
        {cur && <span className="sm-latest">{cur.label}</span>}
      </div>
      {!kind.occurrences.length ? (
        <div className="empty-note" style={{ margin: 0 }}>
          Tidak ada {kind.word} di dalam rentang tanggal file ini.
        </div>
      ) : (
        <>
          <div className="sm-card-figure">{rp(curVal)}</div>
          <div className="sm-card-change">
            {delta ? (
              <>
                <DeltaPill cls={deltaClassForSentiment(delta.deltaNum, 'higher-better')}>{formatDeltaID(delta.deltaNum, delta.deltaStr)}</DeltaPill>
                <span>
                  vs {prev?.label} ({rp(prevVal)})
                </span>
              </>
            ) : (
              <span className="sm-nodelta">tidak ada pembanding di file ini</span>
            )}
          </div>
          {curVal !== null && both > 0 && (
            <div className="sm-card-total">
              <b>{pct((curVal / both) * 100)}</b> dari spending {kind.word} kedua periode
            </div>
          )}
        </>
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
  const [startDay, setStartDay] = useState(String(DEFAULT_PAYDAY.startDay));
  const [lengthDays, setLengthDays] = useState(String(DEFAULT_PAYDAY.lengthDays));

  const paydayStart = Math.min(28, Math.max(1, Number(startDay) || DEFAULT_PAYDAY.startDay));
  const paydayLength = Math.min(31, Math.max(1, Number(lengthDays) || DEFAULT_PAYDAY.lengthDays));

  const { hasDayBreakdown, kinds } = useMemo(() => {
    const payday = { startDay: paydayStart, lengthDays: paydayLength };
    const sum = (list: MomentOccurrence[], pick: (o: MomentOccurrence) => number | null) => {
      const usable = list.map(pick).filter((v): v is number => v !== null);
      return usable.length ? usable.reduce((a, b) => a + b, 0) : null;
    };
    const build = (key: MomentKind, label: string, word: string) => {
      const result = buildSpecialMoment(rows, dayCol, key, payday);
      // An occurrence belongs to the period whose date range contains its start.
      const perPeriod: PeriodTotals[] = periods.map((p) => {
        const occ = result.occurrences.filter((o) => o.start >= p.start && o.start <= p.end);
        return { label: p.label, revenue: sum(occ, (o) => o.revenue), spending: sum(occ, (o) => o.spending), occurrences: occ };
      });
      return { result, kind: { key, label, word, periods: perPeriod, occurrences: result.occurrences } as KindTotals };
    };
    const twin = build('double-date', 'Twin Date', 'twin date');
    const pay = build('payday', 'Payday', 'payday');
    return { hasDayBreakdown: twin.result.hasDayBreakdown, kinds: [twin.kind, pay.kind] };
  }, [rows, dayCol, paydayStart, paydayLength, periods]);

  // A Meta export carries revenue only for a Sales/Conversion objective; an
  // Awareness or Traffic report has no such column at all, so the pies are
  // dropped rather than drawn empty and the reason is said once.
  const hasRevenue = kinds.some((k) => k.periods.some((p) => p.revenue !== null));

  const blocked = !rows.length ? (
    <div className="empty-note">Belum ada data untuk bagian ini.</div>
  ) : !hasDayBreakdown ? (
    <div className="empty-note">
      Special Moment butuh breakdown <strong>Day</strong>. File yang diunggah dipecah per bulan, jadi tanggal seperti 9/9 tidak bisa dipisahkan. Export ulang dari Meta
      Ads Reporting dengan breakdown Day untuk mengisi bagian ini.
    </div>
  ) : periods.length < 2 ? (
    <div className="empty-note">Butuh dua periode untuk dibandingkan — unggah file Periode Lalu dan Periode Ini.</div>
  ) : null;

  return (
    <div className="sec-block">
      <div className="sec-heading">
        {heading}
        <span className="sec-badge">twin date &amp; payday · {periods.map((p) => p.label).join(' vs ')}</span>
        <SectionDownloadButton />
      </div>

      {!blocked && (
        <div className="chart-controls" style={{ padding: '1.1rem 1.4rem 0' }}>
          <div className="sm-payday">
            <label>
              Payday mulai tanggal
              <input type="number" min={1} max={28} value={startDay} onChange={(e) => setStartDay(e.target.value)} />
            </label>
            <label>
              Panjang (hari)
              <input type="number" min={1} max={31} value={lengthDays} onChange={(e) => setLengthDays(e.target.value)} />
            </label>
            <span className="sm-hint">Umumnya tanggal 25 saja; sebagian brand membaca 25–27 — ubah panjangnya jadi 3. Twin date (7/7, 8/8, …) terdeteksi otomatis.</span>
          </div>
        </div>
      )}

      <div style={{ padding: '1.1rem 1.4rem 1.4rem' }}>
        {blocked ?? (
          <>
            <div className="sm-split">
              {hasRevenue ? (
                <div className="sm-pies">
                  {kinds.map((k) => (
                    <KindPie key={k.key} kind={k} />
                  ))}
                </div>
              ) : (
                <div className="empty-note" style={{ margin: 0 }}>
                  Pie revenue belum bisa digambar: file ini tidak memuat kolom revenue (mis. &quot;Purchases conversion value&quot;). Kolom itu hanya ada pada export Meta
                  untuk objective Sales/Conversion, bukan Awareness atau Traffic.
                </div>
              )}
              <div className="sm-scorecards sm-scorecards-side">
                {kinds.map((k) => (
                  <KindSpendCard key={k.key} kind={k} />
                ))}
              </div>
            </div>
            <p className="chart-foot">
              Yang dihitung hanya hari moment di dalam tiap periode
              {kinds.some((k) => k.occurrences.length)
                ? ` (${kinds.flatMap((k) => k.occurrences.map((o) => o.label)).join(', ')})`
                : ''}
              , bukan seluruh bulan — sehingga perbandingannya benar-benar moment lawan moment.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
