import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import api from '../../../api/client.js';
import useSessionState from '../../../hooks/useSessionState.js';
import { DeltaPill } from '../../components/DeltaPill';
import { DownloadPdfButton } from '../../components/DownloadPdfButton';
import { GroupedBarChart, type BarSeries } from '../../components/GroupedBarChart';
import { InlineNotice } from '../../components/InlineNotice';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SetupBoard, SetupGrid, SetupRow } from '../../components/SetupBoard';
import { computeDelta, deltaClassForSentiment } from '../../lib/delta';
import { fmtBizDec, fmtBizNum, fmtBizRp, safeDiv, sumMaybe } from '../../lib/business';
import { MonthPicker, currentMonth, monthLabel, shiftMonth } from './MonthPicker';
import { RevenueWaterfallChart, type WaterfallStep } from './RevenueWaterfallChart';

interface BusinessOverviewTabProps {
  isActive: boolean;
  clientId: number | null;
}

interface SalesChannel { key: string; label: string }
interface SalesDay { revenue: number | null; transaksi: number | null; qtySold: number | null }
type SalesGrid = Record<string, Record<string, SalesDay>>;

interface Totals { revenue: number | null; transaksi: number | null; qty: number | null }
interface ChannelRow { key: string; label: string; old: Totals; cur: Totals }

// The table's columns after Channel/Periode: three summed from Daily Tracking,
// three derived from them.
const METRICS: { label: string; title?: string; value: (t: Totals) => number | null; fmt: (v: number | null) => string }[] = [
  { label: 'Revenue', value: (t) => t.revenue, fmt: fmtBizRp },
  { label: 'Transaksi', value: (t) => t.transaksi, fmt: fmtBizNum },
  { label: 'Qty Terjual', value: (t) => t.qty, fmt: fmtBizNum },
  { label: 'Average Order Value', title: 'Revenue ÷ Transaksi', value: (t) => safeDiv(t.revenue, t.transaksi), fmt: fmtBizRp },
  { label: 'Average Unit Retail', title: 'Revenue ÷ Qty Terjual', value: (t) => safeDiv(t.revenue, t.qty), fmt: fmtBizRp },
  { label: 'Average Basket Size', title: 'Qty Terjual ÷ Transaksi', value: (t) => safeDiv(t.qty, t.transaksi), fmt: fmtBizDec },
];

// One channel's month totals — a field is null when no day has a value, so an
// unfilled channel shows "—" rather than Rp0.
function channelTotals(grid: SalesGrid, key: string): Totals {
  const days = Object.values(grid[key] ?? {});
  return {
    revenue: sumMaybe(days.map((d) => d?.revenue)),
    transaksi: sumMaybe(days.map((d) => d?.transaksi)),
    qty: sumMaybe(days.map((d) => d?.qtySold)),
  };
}

function sumTotals(list: Totals[]): Totals {
  return {
    revenue: sumMaybe(list.map((t) => t.revenue)),
    transaksi: sumMaybe(list.map((t) => t.transaksi)),
    qty: sumMaybe(list.map((t) => t.qty)),
  };
}

const OLD_COLOR = '#a7b4cc';
const CUR_COLOR = '#0d9488'; // --biz

// Compact rupiah for chart axes and bar labels: Rp1,2 M / Rp350 jt / Rp12 rb.
function fmtRpShort(v: number): string {
  const abs = Math.abs(v);
  const num = (n: number, d: number) => n.toLocaleString('id-ID', { maximumFractionDigits: d });
  if (abs >= 1e9) return `Rp${num(v / 1e9, 2)} M`;
  if (abs >= 1e6) return `Rp${num(v / 1e6, 1)} jt`;
  if (abs >= 1e3) return `Rp${num(v / 1e3, 0)} rb`;
  return `Rp${num(v, 0)}`;
}

const isEmpty = (t: Totals) => t.revenue == null && t.transaksi == null && t.qty == null;

function errMessage(err: unknown): string {
  const res = (err as { response?: { status?: number; data?: { error?: string; message?: string } } })?.response;
  if (res?.status === 403) return 'Akun ini tidak punya akses ke modul Brand Tracking.';
  return res?.data?.error || res?.data?.message || 'Gagal memuat data Brand Tracking.';
}

// Business Overview: the brand's revenue per sales channel, Periode Lalu vs
// Periode Ini (one month each), read straight from Daily Tracking › Revenue
// Data, plus the three per-channel ratios.
export function BusinessOverviewTab({ isActive, clientId }: BusinessOverviewTabProps) {
  const [curMonth, setCurMonth] = useSessionState('generator:business-cur', currentMonth());
  const [oldMonth, setOldMonth] = useSessionState('generator:business-old', shiftMonth(currentMonth(), -1));
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId || !isActive) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    const entries = (month: string) => api.get('/daily-tracking/entries', { params: { brandId: clientId, month } }).then((r: { data: { sales?: SalesGrid } }) => r.data.sales ?? {});
    Promise.all([api.get('/daily-tracking/channels', { params: { brandId: clientId } }), entries(oldMonth), entries(curMonth)])
      .then(([chRes, oldGrid, curGrid]) => {
        if (cancelled) return;
        const channels: SalesChannel[] = chRes.data.sales ?? [];
        setRows(channels.map((c) => ({ key: c.key, label: c.label, old: channelTotals(oldGrid, c.key), cur: channelTotals(curGrid, c.key) })));
      })
      .catch((err) => !cancelled && setError(errMessage(err)));
    return () => { cancelled = true; };
  }, [clientId, isActive, oldMonth, curMonth]);

  const p1 = monthLabel(oldMonth, false);
  const p2 = monthLabel(curMonth, false);
  const total: ChannelRow | null = rows && { key: '__total__', label: 'Total', old: sumTotals(rows.map((r) => r.old)), cur: sumTotals(rows.map((r) => r.cur)) };
  const hasData = !!total && (!isEmpty(total.old) || !isEmpty(total.cur));

  // Charts only carry channels with revenue in at least one period.
  const charted = useMemo(() => (rows ?? []).filter((r) => r.old.revenue != null || r.cur.revenue != null), [rows]);
  const barLabels = useMemo(() => charted.map((r) => r.label), [charted]);
  const barSeries = useMemo<BarSeries[]>(() => [
    { label: p1, values: charted.map((r) => r.old.revenue), color: OLD_COLOR },
    { label: p2, values: charted.map((r) => r.cur.revenue), color: CUR_COLOR },
  ], [charted, p1, p2]);
  // Biggest gain first, biggest loss last, so the bridge reads up then down.
  const steps = useMemo<WaterfallStep[]>(
    () => charted.map((r) => ({ label: r.label, delta: (r.cur.revenue ?? 0) - (r.old.revenue ?? 0) })).sort((a, b) => b.delta - a.delta),
    [charted],
  );
  const totalDelta = (total?.cur.revenue ?? 0) - (total?.old.revenue ?? 0);
  const topMover = steps.length ? (totalDelta >= 0 ? steps[0] : steps[steps.length - 1]) : null;

  // Each channel is three rows — Periode Lalu, Periode Ini, Perubahan — with
  // the channel name on the first only (no rowSpan: html2canvas mangles it in
  // the PNG/PDF export).
  const channelBlock = (r: ChannelRow, isTotal = false) => (
    <Fragment key={r.key}>
      <tr className={`biz-ov-first${isTotal ? ' biz-ov-total' : ''}`}>
        <td>{r.label}</td>
        <td className="biz-ov-period">{p1}</td>
        {METRICS.map((m) => <td key={m.label}>{m.fmt(m.value(r.old))}</td>)}
      </tr>
      <tr className={isTotal ? 'biz-ov-total' : undefined}>
        <td />
        <td className="biz-ov-period">{p2}</td>
        {METRICS.map((m) => <td key={m.label}>{m.fmt(m.value(r.cur))}</td>)}
      </tr>
      <tr className={`biz-ov-delta${isTotal ? ' biz-ov-total' : ''}`}>
        <td />
        <td className="biz-ov-period">Perubahan</td>
        {METRICS.map((m) => {
          const { deltaNum, deltaStr } = computeDelta(m.value(r.old), m.value(r.cur));
          return (
            <td key={m.label}>
              <DeltaPill cls={deltaClassForSentiment(deltaNum, 'higher-better')} size="sm">{deltaStr}</DeltaPill>
            </td>
          );
        })}
      </tr>
    </Fragment>
  );

  return (
    <div className={`panel${isActive ? ' active' : ''}`}>
      {!clientId ? (
        <InlineNotice title="Pilih brand terlebih dahulu" tone="info">Business Overview disusun dari data Brand Tracking brand yang dipilih di atas.</InlineNotice>
      ) : (
        <>
          <SetupBoard title="Periode" note={<>Data diambil dari <Link to="/brand-tracking">Brand Tracking › Revenue Data</Link> untuk bulan yang dipilih.</>}>
            <SetupGrid>
              <SetupRow
                label="Bulan"
                req
                old={<MonthPicker label="Periode Lalu" value={oldMonth} onChange={setOldMonth} hint="Periode pembanding" />}
                cur={<MonthPicker label="Periode Ini" value={curMonth} onChange={setCurMonth} hint="Periode yang dilaporkan" />}
              />
            </SetupGrid>
          </SetupBoard>

          {error ? (
            <InlineNotice title="Data Brand Tracking tidak dapat dimuat">{error}</InlineNotice>
          ) : !rows || !total ? (
            <div className="empty-note"><Loader2 size={13} className="rg-spin" aria-hidden /> Memuat data Brand Tracking…</div>
          ) : (
            <>
              <div id="business-overview-container">
                <div className="report-top">
                  <div className="report-title">Business Overview</div>
                  <div className="report-period">Revenue per Channel — {monthLabel(oldMonth)} vs {monthLabel(curMonth)}</div>
                </div>
                {charted.length > 0 && (
                  <>
                    <div className="sec-block">
                      <div className="sec-heading business-heading">
                        Revenue per Channel — {p1} vs {p2}
                        <SectionDownloadButton />
                      </div>
                      <div style={{ padding: '1.2rem 1.4rem 1.4rem' }}>
                        <GroupedBarChart
                          labels={barLabels}
                          series={barSeries}
                          formatValue={(v) => fmtRpShort(v)}
                          height={320}
                          ariaLabel={`Revenue per channel, ${p1} dibanding ${p2}`}
                        />
                        <p className="chart-foot">Revenue per channel dari Brand Tracking. Channel tanpa data revenue di kedua periode tidak ditampilkan.</p>
                      </div>
                    </div>
                    <div className="sec-block">
                      <div className="sec-heading business-heading">
                        Sumber Perubahan Revenue
                        <SectionDownloadButton />
                      </div>
                      <div style={{ padding: '1.2rem 1.4rem 1.4rem' }}>
                        <p className="chart-caption">
                          Total revenue {totalDelta >= 0 ? 'naik' : 'turun'} <strong>{fmtBizRp(Math.abs(totalDelta))}</strong> dari {p1} ke {p2}
                          {topMover && topMover.delta !== 0 && (
                            <>; penyumbang {totalDelta >= 0 ? 'kenaikan' : 'penurunan'} terbesar adalah <strong>{topMover.label}</strong> ({topMover.delta >= 0 ? '+' : '−'}{fmtBizRp(Math.abs(topMover.delta))})</>
                          )}.
                        </p>
                        <RevenueWaterfallChart
                          startLabel={p1}
                          startValue={total?.old.revenue ?? 0}
                          endLabel={p2}
                          steps={steps}
                          formatValue={fmtBizRp}
                          formatShort={fmtRpShort}
                          ariaLabel={`Perubahan revenue per channel dari ${p1} ke ${p2}`}
                        />
                        <p className="chart-foot">Batang hijau menambah revenue, merah mengurangi; diurutkan dari kenaikan terbesar ke penurunan terbesar.</p>
                      </div>
                    </div>
                  </>
                )}
                <div className="sec-block">
                  <div className="sec-heading business-heading">
                    Revenue per Channel
                    <SectionDownloadButton />
                  </div>
                  <div style={{ padding: '0 1.4rem 1.4rem' }}>
                    {!hasData && <div className="empty-note">Belum ada data Revenue di Brand Tracking untuk {monthLabel(oldMonth)} maupun {monthLabel(curMonth)}.</div>}
                    <div className="tbl-scroll">
                      <table className="kpi-table biz-overview-table">
                        <thead>
                          <tr>
                            <th>Channel</th>
                            <th>Periode</th>
                            {METRICS.map((m) => <th key={m.label} title={m.title}>{m.label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => channelBlock(r))}
                          {channelBlock(total, true)}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
              <div className="action-row" style={{ marginTop: '1rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                <DownloadPdfButton targetId="business-overview-container" filename={`Business Overview ${p1} vs ${p2}.pdf`} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
