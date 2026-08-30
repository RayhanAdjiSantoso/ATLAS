import { DeltaPill } from '../../components/DeltaPill';
import { DownloadPdfButton } from '../../components/DownloadPdfButton';
import { KpiTable, type KpiRowDisplay } from '../../components/KpiTable';
import { PeriodCompareChip } from '../../components/PeriodCompareChip';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { buildCostPerRevenueRow } from '../business/businessRows';
import { bizCostPerRevenue, type BizState } from '../../lib/business';
import { computeDelta } from '../../lib/delta';
import { PLATFORM_CONFIG, SUMMARY_HEADLINE_KEYS, computeSummaryInsights, computeTotalAmountSpentItems, type PlatformStateMap, type SummaryInsightKpi } from '../../lib/summary';

interface SummaryTabProps {
  isActive: boolean;
  platformState: PlatformStateMap;
  bizState: BizState;
}

function fmtRp(v: number | null | undefined): string {
  return v == null || isNaN(v) ? '—' : 'Rp' + Math.round(v).toLocaleString('id-ID');
}

function formatGeneratedDate(): string {
  return new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function CostPerRevenueCard({ bizState, spendItems }: { bizState: BizState; spendItems: { old: number | null; cur: number | null }[] }) {
  const cprOld = bizCostPerRevenue(bizState, spendItems, 'old');
  const cprCur = bizCostPerRevenue(bizState, spendItems, 'cur');
  const row = buildCostPerRevenueRow(cprOld, cprCur);
  return (
    <div className="sec-block">
      <div className="sec-heading summary-heading">
        Cost per Revenue Overview
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '1rem 1.4rem 1.4rem' }}>
        <KpiTable rows={[row]} p1="Periode Lalu" p2="Periode Ini" />
        <div className="empty-note" style={{ paddingTop: '.6rem' }}>
          Cost per Revenue = Total Amount Spent ÷ Total Revenue (seluruh channel). Total Revenue diambil dari tab Business Overview.
        </div>
      </div>
    </div>
  );
}

function TotalAmountSpentCard({ platformState }: { platformState: PlatformStateMap }) {
  const items = computeTotalAmountSpentItems(platformState);
  if (!items.length) return null;
  const rows: KpiRowDisplay[] = items.map((i) => {
    const hasOld = i.old != null && !isNaN(i.old);
    const { deltaStr } = hasOld ? computeDelta(i.old, i.cur) : { deltaStr: '—' };
    return { label: i.label, old: fmtRp(i.old), cur: fmtRp(i.cur), delta: deltaStr, cls: 'delta-neutral' };
  });
  const totalOld = items.reduce((s, i) => s + (i.old || 0), 0);
  const totalCur = items.reduce((s, i) => s + (i.cur || 0), 0);
  const anyOld = items.some((i) => i.old != null && !isNaN(i.old));
  const { deltaStr: totalDelta } = anyOld ? computeDelta(totalOld, totalCur) : { deltaStr: '—' };
  rows.push({ label: 'Total', old: fmtRp(totalOld), cur: fmtRp(totalCur), delta: totalDelta, cls: 'delta-neutral', isTotal: true });
  return (
    <div className="sec-block">
      <div className="sec-heading summary-heading">
        Total Amount Spent
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '0 1.4rem 1.4rem' }}>
        <KpiTable rows={rows} p1="Periode Lalu" p2="Periode Ini" />
      </div>
    </div>
  );
}

function PlatformCard({ pConf, platformState }: { pConf: (typeof PLATFORM_CONFIG)[number]; platformState: PlatformStateMap }) {
  const st = platformState[pConf.key];
  if (!st || !st.done || !st.data) {
    const label = st && st.error ? '✕ Gagal — ' + st.error : '⏳ Belum diproses';
    const color = st && st.error ? 'var(--bad)' : 'var(--muted)';
    return (
      <div className="summary-plat-card">
        <div className="summary-plat-title" style={{ color: pConf.color }}>
          {pConf.label}
        </div>
        <div className="empty-note" style={{ color, fontStyle: 'normal' }}>
          {label}
        </div>
      </div>
    );
  }
  const d = st.data;
  const keys = SUMMARY_HEADLINE_KEYS[pConf.key];
  let kpis = d.kpis || [];
  // CPAS gets its own dedicated card, so Meta's own card stays focused on
  // Boost/Non-Boost Post and doesn't get crowded out.
  if (pConf.key === 'meta') kpis = kpis.filter((k) => !k.label.startsWith('CPAS Marketplace'));
  if (keys) {
    const filtered = kpis.filter((k) => k.key && keys.includes(k.key));
    if (filtered.length) kpis = filtered;
  }
  kpis = kpis.slice(0, 6);
  return (
    <div className="summary-plat-card">
      <div className="summary-plat-title" style={{ color: pConf.color }}>
        {pConf.label}
      </div>
      <div className="summary-plat-period">
        <PeriodCompareChip old={d.period?.old || ''} cur={d.period?.cur || ''} accent={pConf.color} />
      </div>
      {kpis.length ? (
        kpis.map((k, i) => (
          <div className="summary-plat-kpi" key={i}>
            <span>{k.label}</span>
            <span className="summary-plat-kpi-val">
              <span className={`num ${k.cls}`}>{k.cur}</span>
              <DeltaPill cls={k.cls} size="sm">
                ({k.delta})
              </DeltaPill>
            </span>
          </div>
        ))
      ) : (
        <div className="empty-note">Tidak ada KPI.</div>
      )}
    </div>
  );
}

// CPAS runs inside the Meta tab (not its own PLATFORM_CONFIG entry), so it
// doesn't get an automatic card from PlatformCard — this adds one explicitly,
// only when CPAS data actually exists.
function CpasCard({ platformState }: { platformState: PlatformStateMap }) {
  const st = platformState.meta;
  if (!st || !st.done || !st.data || !st.data.cpasKpis || !st.data.cpasKpis.length) return null;
  const kpis = st.data.cpasKpis.slice(0, 6);
  const d = st.data;
  return (
    <div className="summary-plat-card">
      <div className="summary-plat-title" style={{ color: 'var(--sum)' }}>
        CPAS Marketplace
      </div>
      <div className="summary-plat-period">
        <PeriodCompareChip old={d.period?.old || ''} cur={d.period?.cur || ''} accent="var(--sum)" />
      </div>
      {kpis.map((k, i) => (
        <div className="summary-plat-kpi" key={i}>
          <span>{k.label}</span>
          <span className="summary-plat-kpi-val">
            <span className={`num ${k.cls}`}>{k.cur}</span>
            <DeltaPill cls={k.cls} size="sm">
              ({k.delta})
            </DeltaPill>
          </span>
        </div>
      ))}
    </div>
  );
}

function InsightSentence({ k }: { k: SummaryInsightKpi }) {
  const dir = (k.deltaNum as number) >= 0 ? 'naik' : 'turun';
  return (
    <div>
      <strong>{k.platform}</strong> — {k.label} {dir} <strong>{Math.abs(k.deltaNum as number).toFixed(1)}%</strong> ({k.cur}) dibanding periode lalu.
    </div>
  );
}

function InsightList({ items, emptyText }: { items: SummaryInsightKpi[]; emptyText: string }) {
  return (
    <ul className="insight-list">
      {items.length ? (
        items.map((k, i) => (
          <li className="insight-item" key={i}>
            <div className="insight-dot" />
            <InsightSentence k={k} />
          </li>
        ))
      ) : (
        <li className="insight-item">
          <div className="insight-dot" />
          <div>{emptyText}</div>
        </li>
      )}
    </ul>
  );
}

function SummaryPending({ platformState }: { platformState: PlatformStateMap }) {
  return (
    <div className="sec-block">
      <div className="sec-inner" style={{ padding: '1.6rem' }}>
        <div style={{ fontSize: '.92rem', fontWeight: 700, marginBottom: '.35rem', color: 'var(--text)' }}>
          Ringkasan performa ads &amp; rekomendasi akan tersedia setelah minimal satu laporan platform berhasil dibuat.
        </div>
        <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: '1.1rem', lineHeight: 1.5 }}>
          Buka salah satu tab (Meta Ads, Shopee Ads, atau TikTok GMV Max), lengkapi data, lalu klik <strong>Generate Laporan</strong>. Summary akan langsung menampilkan hasil dari platform yang sudah "Selesai"; platform lain bisa ditambahkan kapan saja. Tab <strong>Business Overview</strong> tetap bisa diisi kapan saja, terlepas dari status ini.
        </div>
        <table className="kpi-table">
          <tbody>
            {PLATFORM_CONFIG.map((p) => {
              const st = platformState[p.key];
              let label: string;
              let cls: string;
              if (st.done) {
                label = '✓ Selesai';
                cls = 'delta-good';
              } else if (st.error) {
                label = '✕ Gagal — ' + st.error;
                cls = 'delta-bad';
              } else {
                label = '⏳ Belum diproses';
                cls = 'delta-neutral';
              }
              return (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  <td className={cls}>{label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SummaryTab({ isActive, platformState, bizState }: SummaryTabProps) {
  const anyDone = PLATFORM_CONFIG.some((p) => platformState[p.key].done);
  const spendItems = computeTotalAmountSpentItems(platformState);
  const periodMeta = PLATFORM_CONFIG.filter((p) => platformState[p.key].done && platformState[p.key].data)
    .map((p) => {
      const d = platformState[p.key].data!;
      return `${p.label}: ${d.period?.old || '—'} → ${d.period?.cur || '—'}`;
    })
    .join(' · ');

  const ins = anyDone ? computeSummaryInsights(platformState) : null;

  return (
    <div className={`panel${isActive ? ' active' : ''}`}>
     <div id="summary-container">
      <div className="report-top">
        <div className="report-title">Summary Overview</div>
        <div className="report-period">Ringkasan Eksekutif — Seluruh Channel</div>
        <div className="report-meta">{periodMeta || 'Business Overview & ringkasan performa lintas channel'} · Generated {formatGeneratedDate()}</div>
      </div>

      <CostPerRevenueCard bizState={bizState} spendItems={spendItems} />

      {!anyDone && <SummaryPending platformState={platformState} />}

      {anyDone && ins && (
        <>
          <TotalAmountSpentCard platformState={platformState} />

          <div className="sec-block">
            <div className="sec-heading summary-heading">
              Ringkasan Performa per Platform
              <SectionDownloadButton />
            </div>
            <div className="summary-platform-grid">
              {PLATFORM_CONFIG.map((p) => (
                <PlatformCard key={p.key} pConf={p} platformState={platformState} />
              ))}
              <CpasCard platformState={platformState} />
            </div>
          </div>

          <div className="sec-block">
            <div className="sec-heading summary-heading">
              Insight Paling Penting
              <SectionDownloadButton />
            </div>
            <InsightList items={ins.topInsights} emptyText="Tidak ada perubahan yang cukup signifikan untuk di-highlight periode ini." />
          </div>

          <div className="sec-block">
            <div className="sec-heading summary-heading">
              Perubahan Signifikan vs Periode Lalu
              <SectionDownloadButton />
            </div>
            <InsightList items={ins.significant} emptyText="Tidak ada metrik yang berubah ≥15% dibanding periode lalu." />
          </div>

          <div className="sec-block">
            <div className="sec-heading summary-heading">
              Highlight Performa
              <SectionDownloadButton />
            </div>
            <div className="summary-highlight-grid">
              {ins.best ? (
                <div className="summary-highlight-card best">
                  <div className="summary-highlight-label">Performa Terbaik</div>
                  <div className="summary-highlight-metric">{ins.best.label}</div>
                  <div className="summary-highlight-plat">{ins.best.platform}</div>
                  <div className="summary-highlight-delta">
                    <DeltaPill cls="delta-good">{ins.best.delta}</DeltaPill>
                  </div>
                </div>
              ) : (
                <div className="summary-highlight-card best">
                  <div className="summary-highlight-label">Performa Terbaik</div>
                  <div className="empty-note">Belum ada data.</div>
                </div>
              )}
              {ins.worst ? (
                <div className="summary-highlight-card worst">
                  <div className="summary-highlight-label">Perlu Perhatian</div>
                  <div className="summary-highlight-metric">{ins.worst.label}</div>
                  <div className="summary-highlight-plat">{ins.worst.platform}</div>
                  <div className="summary-highlight-delta">
                    <DeltaPill cls="delta-bad">{ins.worst.delta}</DeltaPill>
                  </div>
                </div>
              ) : (
                <div className="summary-highlight-card worst">
                  <div className="summary-highlight-label">Perlu Perhatian</div>
                  <div className="empty-note">Belum ada data.</div>
                </div>
              )}
            </div>
          </div>

          <div className="sec-block">
            <div className="sec-heading summary-heading">
              Peluang Optimasi Paling Berdampak
              <SectionDownloadButton />
            </div>
            <InsightList items={ins.opportunities} emptyText="Tidak ada peluang optimasi mendesak terdeteksi periode ini." />
          </div>

          <div className="sec-block">
            <div className="sec-heading summary-heading">
              Rekomendasi Tindakan (Diprioritaskan)
              <SectionDownloadButton />
            </div>
            <div className="reco-list" style={{ padding: '1rem 1.4rem 1.4rem' }}>
              {ins.recommendations.length ? (
                ins.recommendations.map((r, i) => (
                  <div className="reco-item" key={i}>
                    <span className={`reco-priority ${r.priority === 'Tinggi' ? 'high' : r.priority === 'Sedang' ? 'medium' : 'low'}`}>{r.priority}</span>
                    <span className="reco-text">{r.text}</span>
                  </div>
                ))
              ) : (
                <div className="empty-note">Tidak ada rekomendasi tindakan mendesak periode ini.</div>
              )}
            </div>
          </div>
        </>
      )}
     </div>
     {anyDone && ins && (
       <div className="action-row" style={{ marginTop: '1rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
         <DownloadPdfButton targetId="summary-container" filename="Performance Report.pdf" />
       </div>
     )}
    </div>
  );
}
