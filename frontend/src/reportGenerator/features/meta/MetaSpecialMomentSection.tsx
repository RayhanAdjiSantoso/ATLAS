import { useMemo, useState } from 'react';
import { DeltaPill } from '../../components/DeltaPill';
import { PieChartCanvas } from '../../components/PieChartCanvas';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SegmentedToggle } from '../../components/SegmentedToggle';
import { computeDelta, deltaClassForSentiment, formatDeltaID } from '../../lib/delta';
import { buildSpecialMoment, DEFAULT_PAYDAY, type MomentKind, type MomentOccurrence } from '../../lib/metaSpecialMoment';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { SheetRow } from '../../lib/types';

// Special Moment: double dates (9/9) and payday windows, compared against
// THEIR OWN previous occurrences — 9/9 against 8/8 and 7/7, this month's
// payday against the last few. Not against the month around them: a moment is
// judged by whether it beat the last one of its kind, and a share-of-month
// figure cannot answer that.
//
// Two readings, two sections, matching the architecture sheet:
//   • Pie — how the moment's revenue and spending are distributed across the
//     occurrences the file covers.
//   • Score cards — every occurrence in order, each measured against the one
//     before it.
//
// Occurrences are derived, never typed in: pick the kind, and every 7/7, 8/8,
// 9/9 the uploaded file covers is found for you. Making people look those
// dates up by hand is how the comparison stops getting made.

const KINDS = [
  { value: 'double-date' as const, label: 'Double Date' },
  { value: 'payday' as const, label: 'Payday' },
];

const rp = (v: number | null) => (v === null ? '—' : fmtPivotVal(v, 'rp'));
const pct = (v: number) => `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;

function OccurrencePie({ title, occurrences, valueOf }: { title: string; occurrences: MomentOccurrence[]; valueOf: (o: MomentOccurrence) => number | null }) {
  const usable = occurrences.filter((o) => (valueOf(o) ?? 0) > 0);
  if (usable.length < 2) {
    return (
      <div className="sm-pie">
        <h4>{title}</h4>
        <div className="empty-note">
          {usable.length === 0
            ? `Kolom ${title.toLowerCase()} tidak ada di file ini.`
            : 'Baru satu kemunculan yang punya angka — perbandingan butuh minimal dua.'}
        </div>
      </div>
    );
  }
  const total = usable.reduce((s, o) => s + (valueOf(o) as number), 0);
  const latest = usable[usable.length - 1];
  const best = usable.reduce((a, b) => ((valueOf(b) as number) > (valueOf(a) as number) ? b : a));
  return (
    <div className="sm-pie">
      <h4>{title}</h4>
      <PieChartCanvas labels={usable.map((o) => o.label)} values={usable.map((o) => valueOf(o) as number)} />
      <p className="chart-foot">
        Dari seluruh {title.toLowerCase()} yang terkumpul di {usable.length} kemunculan, <strong>{best.label}</strong> paling besar ({pct(((valueOf(best) as number) / total) * 100)}).
        {best.key !== latest.key && <> Yang terbaru, <strong>{latest.label}</strong>, menyumbang {pct(((valueOf(latest) as number) / total) * 100)}.</>}
      </p>
    </div>
  );
}

function Delta({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur === null || prev === null) return <span className="sm-nodelta">kemunculan pertama</span>;
  const { deltaNum, deltaStr } = computeDelta(prev, cur);
  return <DeltaPill cls={deltaClassForSentiment(deltaNum, 'higher-better')}>{formatDeltaID(deltaNum, deltaStr)}</DeltaPill>;
}

export function MetaSpecialMomentSection({ rows, dayCol }: { rows: SheetRow[]; dayCol: string | null }) {
  const [kind, setKind] = useState<MomentKind>('double-date');
  const [startDay, setStartDay] = useState(String(DEFAULT_PAYDAY.startDay));
  const [lengthDays, setLengthDays] = useState(String(DEFAULT_PAYDAY.lengthDays));

  const result = useMemo(
    () =>
      buildSpecialMoment(rows, dayCol, kind, {
        startDay: Math.min(28, Math.max(1, Number(startDay) || DEFAULT_PAYDAY.startDay)),
        lengthDays: Math.min(31, Math.max(1, Number(lengthDays) || DEFAULT_PAYDAY.lengthDays)),
      }),
    [rows, dayCol, kind, startDay, lengthDays],
  );

  const occ = result.occurrences;
  const kindWord = kind === 'payday' ? 'payday' : 'double date';

  const controls = (
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
  );

  const blocked = !result.hasDayBreakdown ? (
    <div className="empty-note">
      Special Moment butuh breakdown <strong>Day</strong>. File yang diunggah dipecah per bulan, jadi tanggal seperti 9/9 tidak bisa dipisahkan. Export ulang dari Meta
      Ads Reporting dengan breakdown Day untuk mengisi bagian ini.
    </div>
  ) : !occ.length ? (
    <div className="empty-note">
      Tidak ada {kindWord} di dalam rentang tanggal file ini{kind === 'payday' ? ' — coba ubah tanggal mulainya.' : '.'}
    </div>
  ) : null;

  return (
    <>
      <div className="sec-block">
        <div className="sec-heading">
          Kontribusi Special Moment
          <span className="sec-badge">{kindWord} · perbandingan antar kemunculan</span>
          <SectionDownloadButton />
        </div>
        {controls}
        <div style={{ padding: '1.1rem 1.4rem 1.4rem' }}>
          {blocked ?? (
            <div className="sm-pies">
              <OccurrencePie title="Revenue" occurrences={occ} valueOf={(o) => o.revenue} />
              <OccurrencePie title="Spending" occurrences={occ} valueOf={(o) => o.spending} />
            </div>
          )}
        </div>
      </div>

      <div className="sec-block">
        <div className="sec-heading">
          Perbandingan Special Moment
          <span className="sec-badge">{kindWord} · vs kemunculan sebelumnya</span>
          <SectionDownloadButton />
        </div>
        <div style={{ padding: '1.1rem 1.4rem 1.4rem' }}>
          {blocked ?? (
            <>
              <div className="sm-scorecards">
                {occ.map((o, i) => {
                  const prev = i > 0 ? occ[i - 1] : null;
                  return (
                    <div key={o.key} className={`sm-card${i === occ.length - 1 ? ' is-focus' : ''}`}>
                      <div className="sm-card-title">
                        {o.label}
                        {i === occ.length - 1 && <span className="sm-latest">terbaru</span>}
                      </div>
                      <dl>
                        <dt>Revenue</dt>
                        <dd>
                          <b>{rp(o.revenue)}</b>
                          <Delta cur={o.revenue} prev={prev?.revenue ?? null} />
                        </dd>
                        <dt>Spending</dt>
                        <dd>
                          <b>{rp(o.spending)}</b>
                          <Delta cur={o.spending} prev={prev?.spending ?? null} />
                        </dd>
                      </dl>
                    </div>
                  );
                })}
              </div>
              <p className="chart-foot">
                Tiap kartu diukur terhadap kemunculan {kindWord} sebelumnya — 9/9 dibandingkan dengan 8/8, bukan dengan seluruh Agustus.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
