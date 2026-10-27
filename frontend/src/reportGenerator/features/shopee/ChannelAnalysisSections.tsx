import { useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, Tags } from 'lucide-react';
import { DeltaPill } from '../../components/DeltaPill';
import { ParetoChart } from '../../components/ParetoChart';
import { PotentialParetoChart } from '../../components/PotentialParetoChart';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SectionExcelButton } from '../../components/SectionExcelButton';
import { SegmentedToggle, type SegmentedOption } from '../../components/SegmentedToggle';
import { computeDelta, deltaClassForSentiment, formatDeltaID } from '../../lib/delta';
import { fmtPivotVal, type PivotFmt } from '../../lib/shopeeDeepDivePivot';
import type { ParetoRow } from '../../lib/shopeeProductAnalysis';
import { derived, type ItemSums, type PotentialItem, type ProductAdsSplit, type RoiBranch, type RoiRoot, type ShopPlusGroup, type UnadvertisedProduct } from '../../lib/shopeeChannelAnalysis';
import type { Sentiment } from '../../lib/types';
import { DataTable, type DataColumn } from './AnalysisSections';
import { UncategorizedPanel } from './DeepDiveSections';
import './shopeeChannels.css';

// ══════════════════════════════════════════════════════
// SHOPEE — sections of the channel tabs: the Overall ROI root, and each
// channel's Pareto and Potential. Traffic / Conversion reuse
// ProductRankingSection (AnalysisSections.tsx); the table + root cause pair
// reuses ChannelPivotSection.
// ══════════════════════════════════════════════════════

const RANK_TH: CSSProperties = { width: '2.75rem', textAlign: 'left', whiteSpace: 'nowrap' };
const RANK_TD: CSSProperties = { textAlign: 'left', fontVariantNumeric: 'tabular-nums' };
const NAME_TH: CSSProperties = { width: 'auto', textAlign: 'left' };
const NAME_TD: CSSProperties = { textAlign: 'left', minWidth: '11rem' };
const NUM_TH: CSSProperties = { width: '1%', whiteSpace: 'normal' };
const NUM_TD: CSSProperties = { whiteSpace: 'nowrap' };

function Shell({ title, badge, excel, children }: { title: string; badge: string; excel?: boolean; children: ReactNode }) {
  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        {title} <span className="sec-badge">{badge}</span>
        {excel && <SectionExcelButton />}
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '1rem 1.4rem 1.4rem' }}>{children}</div>
    </div>
  );
}

// ── Overall: ROI → Revenue & Spend → channels ────────────────────────────

const rp = (v: number) => fmtPivotVal(v, 'rp');
const roasTxt = (v: number | null) => (v === null ? '—' : fmtPivotVal(v, 'roas'));

function Branch({ kind, branch, p1, p2 }: { kind: 'revenue' | 'spend'; branch: RoiBranch; p1: string; p2: string }) {
  const max = Math.max(1, ...branch.rows.map((r) => Math.max(r.old, r.cur)));
  return (
    <section className={`sch-branch is-${kind}`} aria-label={kind === 'revenue' ? 'Revenue iklan' : 'Spend iklan'}>
      <header className="sch-branch-head">
        <span className="sch-eyebrow">{kind === 'revenue' ? 'Revenue · Omzet dari iklan' : 'Spend · Biaya iklan'}</span>
        <div className="sch-figure">
          <strong>{rp(branch.cur)}</strong>
          <DeltaPill cls={branch.cls}>{branch.delta}</DeltaPill>
        </div>
        <span className="sch-prev">
          {p1} <b>{rp(branch.old)}</b>
        </span>
      </header>
      {/* Both periods get a column of their own, under a header that names
          them: last period is a figure to read, not a footnote. */}
      <div className="sch-tbl" role="table" aria-label={kind === 'revenue' ? 'Revenue per channel' : 'Spend per channel'}>
        <div className="sch-tbl-head" role="row">
          <span role="columnheader">Channel</span>
          <span role="columnheader">{p1}</span>
          <span role="columnheader">{p2}</span>
          <span role="columnheader">Perubahan</span>
        </div>
        {branch.rows.map((r) => (
          <div key={r.key} role="row" className={`sch-tbl-row${r.hasData ? '' : ' is-empty'}`}>
            <span className="sch-row-name" role="cell">
              <i style={{ background: r.color }} aria-hidden="true" />
              <span>
                {r.label}
                {r.hasData && <small>{r.share.toLocaleString('id-ID', { maximumFractionDigits: 1 })}% dari total</small>}
              </span>
            </span>
            {r.hasData ? (
              <>
                <span className="sch-old num" role="cell">{rp(r.old)}</span>
                <span className="sch-cur num" role="cell">{rp(r.cur)}</span>
                <span role="cell">
                  <DeltaPill cls={r.cls}>{r.delta}</DeltaPill>
                </span>
                <span className="sch-row-bars" aria-hidden="true">
                  <span className="sch-bar is-old" style={{ transform: `scaleX(${r.old / max})` }} />
                  <span className="sch-bar is-cur" style={{ transform: `scaleX(${r.cur / max})`, background: r.color }} />
                </span>
              </>
            ) : (
              <span className="sch-row-none" role="cell">{r.key === 'banner' ? 'Belum ada data di Data Collection Hub' : `Tidak ada data di ${p1} maupun ${p2}`}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function RoiRootSection({ root, p1, p2 }: { root: RoiRoot; p1: string; p2: string }) {
  const channelRoas = root.revenue.rows.filter((r) => r.hasData);
  return (
    <Shell title="ROI Root Analysis" badge={`ROI = Revenue ÷ Spend · ${p1} → ${p2}`}>
      <div className="sch-root" data-feature="shopee-roi-root">
        <div className="sch-roi">
          <span className="sch-eyebrow">ROI iklan (ROAS)</span>
          <div className="sch-roi-figure">
            <strong>{roasTxt(root.roi.cur)}</strong>
            <DeltaPill cls={root.roi.cls}>{root.roi.delta}</DeltaPill>
          </div>
          <small>
            {p1}: {roasTxt(root.roi.old)} · setiap Rp1 biaya iklan menghasilkan {root.roi.cur ? `Rp${root.roi.cur.toLocaleString('id-ID', { maximumFractionDigits: 2 })}` : '—'} omzet
          </small>
          {channelRoas.length > 0 && (
            <div className="sch-roi-chips">
              {channelRoas.map((r) => (
                <span key={r.key}>
                  <i style={{ background: r.color }} aria-hidden="true" />
                  {r.label} <b>{roasTxt(r.roasCur)}</b>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="sch-connector" aria-hidden="true">
          <span />
        </div>
        <div className="sch-branches">
          <Branch kind="revenue" branch={root.revenue} p1={p1} p2={p2} />
          <span className="sch-divide" aria-hidden="true">÷</span>
          <Branch kind="spend" branch={root.spend} p1={p1} p2={p2} />
        </div>
      </div>
      <p className="chart-foot">
        Revenue adalah <strong>Omzet Penjualan</strong> yang diatribusikan iklan, Spend adalah <strong>Biaya</strong> di tiap ekspor iklan (Product Ads = Data Keseluruhan
        Iklan + Iklan Produk Otomatis, Shop+ Ads = Shop+ Ads Overall Data, Live Ads = Data Semua Iklan Live). Batang abu-abu = {p1}, batang berwarna = {p2}.
      </p>
    </Shell>
  );
}

// ── Shop+: the ad groups compared ────────────────────────────────────────
// Which group the budget went to, which one the revenue came from, and how
// each did against last period. Groups change month to month, so one that ran
// in only one of the two periods is kept and labelled, not dropped.

const GROUP_COLORS = ['#0f766e', '#0284c7', '#7c3aed', '#d97706', '#db2777', '#65a30d', '#475569', '#0891b2'];
const shortPeriod = (p: string) => p.replace(/^(\p{L}{3})\p{L}*/u, '$1');

interface GroupMetricDef {
  id: string;
  label: string;
  fmt: PivotFmt;
  sentiment: Sentiment;
  get: (s: ItemSums) => number | null;
}
const GROUP_METRICS: readonly GroupMetricDef[] = [
  { id: 'spend', label: 'Biaya', fmt: 'rp', sentiment: 'neutral', get: (s) => s.spend },
  { id: 'gmv', label: 'Omzet', fmt: 'rp', sentiment: 'higher-better', get: (s) => s.gmv },
  { id: 'roas', label: 'ROAS', fmt: 'roas', sentiment: 'higher-better', get: derived.roas },
  { id: 'clicks', label: 'Klik', fmt: 'num', sentiment: 'higher-better', get: (s) => s.clicks },
  { id: 'ctr', label: 'CTR', fmt: 'pct', sentiment: 'higher-better', get: derived.ctr },
  { id: 'orders', label: 'Konversi', fmt: 'num', sentiment: 'higher-better', get: (s) => s.orders },
  { id: 'cr', label: 'CVR', fmt: 'pct', sentiment: 'higher-better', get: derived.cr },
];

// Every metric cell is two lines on the same grid as the Periode column —
// last period above, this period below — so a row reads straight across.
function GroupCell({ def, g }: { def: GroupMetricDef; g: ShopPlusGroup }) {
  const cur = g.cur ? def.get(g.cur) : null;
  const old = g.old ? def.get(g.old) : null;
  const { deltaNum, deltaStr } = cur !== null && old !== null ? computeDelta(old, cur) : { deltaNum: null, deltaStr: '' };
  return (
    <span className="sch-cell">
      <span className={old === null ? 'is-none' : 'is-old'}>{old === null ? '—' : fmtPivotVal(old, def.fmt)}</span>
      <span className={cur === null ? 'is-none' : 'is-cur'}>{cur === null ? '—' : fmtPivotVal(cur, def.fmt)}</span>
      {cur !== null && old !== null && <DeltaPill cls={deltaClassForSentiment(deltaNum, def.sentiment)}>{formatDeltaID(deltaNum, deltaStr)}</DeltaPill>}
    </span>
  );
}

function MixStrip({ label, groups, field, period, colorOf }: { label: string; groups: ShopPlusGroup[]; field: 'spend' | 'gmv'; period: 'old' | 'cur'; colorOf: (key: string) => string }) {
  const parts = groups.map((g) => ({ g, v: g[period]?.[field] ?? 0 })).filter((x) => x.v > 0);
  const total = parts.reduce((s, x) => s + x.v, 0);
  return (
    <div className="sch-mix-row">
      <span className="sch-mix-label">{label}</span>
      <span className="sch-mix-bar">
        {total > 0 ? (
          parts.map(({ g, v }) => {
            const pct = (v / total) * 100;
            return (
              <span key={g.key} style={{ flexGrow: v, background: colorOf(g.key) }} title={`${g.name}: ${fmtPivotVal(v, 'rp')} (${pct.toFixed(1).replace('.', ',')}%)`}>
                {pct >= 9 && `${Math.round(pct)}%`}
              </span>
            );
          })
        ) : (
          <em>Tidak ada</em>
        )}
      </span>
      <span className="sch-mix-total num">{fmtPivotVal(total, 'rp')}</span>
    </div>
  );
}

export function ShopPlusGroupsSection({ groups, p1, p2 }: { groups: ShopPlusGroup[]; p1: string; p2: string }) {
  const colorOf = (key: string) => GROUP_COLORS[groups.findIndex((g) => g.key === key) % GROUP_COLORS.length];
  const curCount = groups.filter((g) => g.cur).length;
  const oldCount = groups.filter((g) => g.old).length;
  const columns: DataColumn<ShopPlusGroup>[] = [
    {
      id: 'name', label: 'Grup Iklan', thStyle: NAME_TH, tdStyle: { ...NAME_TD, minWidth: '11rem', verticalAlign: 'top' }, sortValue: (g) => g.name,
      render: (g) => (
        <span className="sch-group">
          <span className="sch-group-name">
            <i style={{ background: colorOf(g.key) }} aria-hidden="true" />
            {g.name}
          </span>
          <span className="sch-group-meta">
            {g.status && <span className={`sch-chip is-${/berjalan|aktif/i.test(g.status) ? 'live' : 'off'}`}>{g.status}</span>}
            {g.presence !== 'both' && <span className="sch-chip is-presence">{g.presence === 'new' ? `Baru di ${p2}` : `Hanya ${p1}`}</span>}
            <span>
              Tampilan {g.display || '—'} · Bidding {g.bidding || '—'}
            </span>
            {g.start && (
              <span>
                {g.start} – {g.end || '—'}
              </span>
            )}
          </span>
        </span>
      ),
    },
    {
      id: 'period', label: 'Periode', thStyle: { ...NUM_TH, textAlign: 'left' }, tdStyle: { verticalAlign: 'top', textAlign: 'left' },
      render: () => (
        <span className="sch-periods">
          <span>{shortPeriod(p1)}</span>
          <span>{shortPeriod(p2)}</span>
        </span>
      ),
    },
    ...GROUP_METRICS.map<DataColumn<ShopPlusGroup>>((def) => ({
      id: def.id,
      label: def.label,
      thStyle: NUM_TH,
      tdStyle: { verticalAlign: 'top' },
      sortValue: (g) => (g.cur ? def.get(g.cur) : null),
      render: (g) => <GroupCell def={def} g={g} />,
    })),
  ];
  return (
    <Shell title="Perbandingan Grup Iklan" badge={`Shop+ Ads Overall Data · ${p1} → ${p2}`} excel>
      {!groups.length ? (
        <div className="empty-note">Belum ada grup iklan Shop+ di kedua periode.</div>
      ) : (
        <>
          <p className="chart-caption">
            <strong>{curCount}</strong> grup iklan berjalan di {p2}, <strong>{oldCount}</strong> di {p1}. Porsi tiap grup terhadap biaya dan omzet Shop+ — grup yang porsi omzetnya
            lebih besar dari porsi biayanya bekerja lebih efisien dari rata-rata.
          </p>
          <div className="sch-mix">
            {(['old', 'cur'] as const).map((period) => (
              <div key={period} className="sch-mix-period">
                <span className="sch-mix-title">{period === 'old' ? p1 : p2}</span>
                <MixStrip label="Biaya" groups={groups} field="spend" period={period} colorOf={colorOf} />
                <MixStrip label="Omzet" groups={groups} field="gmv" period={period} colorOf={colorOf} />
              </div>
            ))}
          </div>
          <DataTable columns={columns} rows={groups} rowKey={(g) => g.key} maxHeight={640} />
          <p className="chart-foot">
            Tiap sel: baris atas {p1}, baris bawah (tebal) {p2}, lalu perubahannya bila grup berjalan di kedua periode. Grup yang hanya berjalan di salah satu periode
            ditandai, tidak dihilangkan; klik judul kolom untuk mengurutkan menurut {p2}.
          </p>
        </>
      )}
    </Shell>
  );
}

// ── Product Ads: individual ads vs the auto campaign ─────────────────────

interface SplitRow {
  id: string;
  label: string;
  fmt: PivotFmt;
  sentiment: Sentiment;
  get: (s: ItemSums, total: ItemSums) => number | null;
}
const SPLIT_ROWS: readonly SplitRow[] = [
  { id: 'spend', label: 'Amount Spend', fmt: 'rp', sentiment: 'neutral', get: (s) => s.spend },
  { id: 'gmv', label: 'GMV (Ads)', fmt: 'rp', sentiment: 'higher-better', get: (s) => s.gmv },
  { id: 'roas', label: 'ROAS', fmt: 'roas', sentiment: 'higher-better', get: derived.roas },
  { id: 'clicks', label: 'Clicks', fmt: 'num', sentiment: 'higher-better', get: (s) => s.clicks },
  { id: 'orders', label: 'Purchases', fmt: 'num', sentiment: 'higher-better', get: (s) => s.orders },
  { id: 'cr', label: 'Conversion Rate', fmt: 'pct', sentiment: 'higher-better', get: derived.cr },
  { id: 'spendShare', label: 'Porsi Spend Product Ads', fmt: 'pct', sentiment: 'neutral', get: (s, t) => (t.spend > 0 ? (s.spend / t.spend) * 100 : null) },
  { id: 'gmvShare', label: 'Porsi GMV Product Ads', fmt: 'pct', sentiment: 'neutral', get: (s, t) => (t.gmv > 0 ? (s.gmv / t.gmv) * 100 : null) },
];
const sumOf = (a: ItemSums, b: ItemSums): ItemSums => ({
  impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, atc: a.atc + b.atc, orders: a.orders + b.orders, sold: a.sold + b.sold,
  gmv: a.gmv + b.gmv, spend: a.spend + b.spend, viewers: a.viewers + b.viewers, ordersDirect: a.ordersDirect + b.ordersDirect,
  gmvDirect: a.gmvDirect + b.gmvDirect, productViews: a.productViews + b.productViews, productClicks: a.productClicks + b.productClicks,
});

export function ProductAdsSplitSection({ split, p1, p2 }: { split: ProductAdsSplit; p1: string; p2: string }) {
  const total = { old: sumOf(split.individual.old, split.auto.old), cur: sumOf(split.individual.cur, split.auto.cur) };
  const value = (side: 'individual' | 'auto', period: 'old' | 'cur', row: SplitRow) => row.get(split[side][period], total[period]);
  const hasAuto = split.auto.old.spend + split.auto.cur.spend + split.auto.old.gmv + split.auto.cur.gmv > 0;
  const fmt = (v: number | null, row: SplitRow) => (v === null ? '—' : fmtPivotVal(v, row.fmt));
  const deltaCell = (side: 'individual' | 'auto', row: SplitRow) => {
    const o = value(side, 'old', row);
    const c = value(side, 'cur', row);
    if (o === null || c === null) return '—';
    const { deltaNum, deltaStr } = computeDelta(o, c);
    return <DeltaPill cls={deltaClassForSentiment(deltaNum, row.sentiment)}>{formatDeltaID(deltaNum, deltaStr)}</DeltaPill>;
  };
  const sideCols = (side: 'individual' | 'auto', group: string): DataColumn<SplitRow>[] => [
    { id: `${side}-old`, label: p1, group, thStyle: NUM_TH, tdStyle: { ...NUM_TD, color: '#475569' }, render: (r) => fmt(value(side, 'old', r), r) },
    { id: `${side}-cur`, label: p2, group, thStyle: NUM_TH, tdStyle: { ...NUM_TD, fontWeight: 750 }, render: (r) => fmt(value(side, 'cur', r), r) },
    { id: `${side}-delta`, label: '%Chg', group, thStyle: NUM_TH, tdStyle: NUM_TD, render: (r) => deltaCell(side, r) },
  ];
  const columns: DataColumn<SplitRow>[] = [
    { id: 'metric', label: 'Metrik', thStyle: NAME_TH, tdStyle: { textAlign: 'left', fontWeight: 650 }, render: (r) => r.label },
    ...sideCols('individual', 'Iklan Individu'),
    ...sideCols('auto', 'Iklan Produk Otomatis'),
  ];
  const roasInd = derived.roas(split.individual.cur);
  const roasAuto = derived.roas(split.auto.cur);
  return (
    <Shell title="Individu vs Otomatis" badge={`Product Ads · ${p1} → ${p2}`} excel>
      {!hasAuto ? (
        <div className="empty-note">Tidak ada Iklan Produk Otomatis di kedua periode — seluruh Product Ads berasal dari iklan individu.</div>
      ) : (
        <>
          <p className="chart-caption">
            Product Ads = iklan individu + Iklan Produk Otomatis (Shopee menggolongkan keduanya sebagai Iklan Produk).
            {roasInd !== null && roasAuto !== null && (
              <>
                {' '}
                ROAS {p2}: individu <strong>{fmtPivotVal(roasInd, 'roas')}</strong>, otomatis <strong>{fmtPivotVal(roasAuto, 'roas')}</strong>.
              </>
            )}
          </p>
          <DataTable columns={columns} rows={[...SPLIT_ROWS]} rowKey={(r) => r.id} maxHeight={560} />
        </>
      )}
    </Shell>
  );
}

// ── Pareto per channel ───────────────────────────────────────────────────

export function ChannelParetoSection({ rows, itemLabel, channelLabel, periodLabel }: { rows: ParetoRow[]; itemLabel: string; channelLabel: string; periodLabel: string }) {
  const columns: DataColumn<ParetoRow>[] = [
    { id: 'rank', label: '#', thStyle: RANK_TH, tdStyle: RANK_TD, sortValue: (_r, i) => i, render: (_r, i) => i + 1 },
    { id: 'name', label: itemLabel, thStyle: NAME_TH, tdStyle: NAME_TD, sortValue: (r) => r.produk, render: (r) => r.produk },
    { id: 'gmv', label: 'Omzet Iklan', renamable: true, thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.sales, render: (r) => rp(r.sales) },
    { id: 'contribution', label: 'Kontribusi', renamable: true, thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.contribution, render: (r) => fmtPivotVal(r.contribution, 'pct') },
    { id: 'cumulative', label: 'Kumulatif', renamable: true, thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.cumulative, render: (r) => fmtPivotVal(r.cumulative, 'pct') },
  ];
  const head = rows.filter((r) => r.cumulative <= 80).length + (rows.some((r) => r.cumulative > 80) ? 1 : 0);
  return (
    <Shell title="Pareto Analysis" badge={`${channelLabel} · omzet iklan per ${itemLabel.toLowerCase()} · ${periodLabel}`} excel>
      {!rows.length ? (
        <div className="empty-note">Belum ada {itemLabel.toLowerCase()} dengan omzet iklan pada periode ini.</div>
      ) : (
        <>
          <p className="chart-caption">
            <strong>{head}</strong> dari {rows.length} {itemLabel.toLowerCase()} menghasilkan ±80% omzet {channelLabel} periode ini.
          </p>
          <ParetoChart rows={rows} />
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} rowStyle={(r) => (r.cumulative <= 80 ? { fontWeight: 600 } : undefined)} />
        </>
      )}
    </Shell>
  );
}

// ── Potential: products selling without an individual ad ─────────────────

type PotentialScope = 'all' | 'none' | 'auto';
const POTENTIAL_SCOPES: readonly SegmentedOption<PotentialScope>[] = [
  { value: 'all', label: 'Semua' },
  { value: 'none', label: 'Belum diiklankan sama sekali' },
  { value: 'auto', label: 'Hanya Iklan Otomatis' },
];
const POTENTIAL_SHOWN = 12;

export function UnadvertisedProductsSection({
  data,
  hasData,
  periodLabel,
}: {
  data: { products: UnadvertisedProduct[]; advertisedCount: number; totalProducts: number };
  hasData: boolean;
  periodLabel: string;
}) {
  const [scope, setScope] = useState<PotentialScope>('all');
  const counts = { all: data.products.length, none: data.products.filter((p) => p.status === 'none').length, auto: data.products.filter((p) => p.status === 'auto').length };
  const products = data.products.filter((p) => scope === 'all' || p.status === scope).slice(0, POTENTIAL_SHOWN);
  const columns: DataColumn<UnadvertisedProduct>[] = [
    { id: 'rank', label: '#', thStyle: RANK_TH, tdStyle: RANK_TD, sortValue: (_r, i) => i, render: (_r, i) => i + 1 },
    {
      id: 'produk', label: 'Produk', thStyle: NAME_TH, tdStyle: NAME_TD, sortValue: (r) => r.produk,
      render: (r) => (
        <span className="sch-prod">
          {r.produk}
          {r.merged > 1 && <small> · {r.merged} listing nama sama digabung</small>}
        </span>
      ),
    },
    { id: 'revenue', label: 'Penjualan Toko', renamable: true, thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.revenue, render: (r) => rp(r.revenue) },
    { id: 'share', label: 'Porsi Toko', thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.share, render: (r) => fmtPivotVal(r.share, 'pct') },
    { id: 'cr', label: 'Conversion Rate', thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.conversionRate, render: (r) => fmtPivotVal(r.conversionRate, 'pct') },
    {
      id: 'status', label: 'Status Iklan', thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.status,
      render: (r) => <span className={`sch-status is-${r.status}`}>{r.status === 'auto' ? 'Hanya Iklan Otomatis' : 'Belum diiklankan'}</span>,
    },
  ];
  return (
    <Shell title="Potential Product Analysis" badge={`Laku di toko, belum diiklankan · ${periodLabel}`} excel>
      {!hasData ? (
        <div className="empty-note">Upload file Product Performance periode ini (Data Collection Hub › Shopee) untuk melihat produk potensial.</div>
      ) : !data.products.length ? (
        <div className="empty-note">Semua produk yang terjual periode ini sudah punya iklan produk sendiri — tidak ada produk potensial yang terlewat.</div>
      ) : (
        <>
          <div className="sch-potential-bar">
            <SegmentedToggle
              label="Tampilkan"
              options={POTENTIAL_SCOPES.map((o) => ({ ...o, label: `${o.label} (${counts[o.value]})` }))}
              value={scope}
              onChange={setScope}
            />
          </div>
          <p className="chart-caption">
            {data.products.length} produk laku di toko tanpa <strong>Iklan Produk sendiri</strong> (dicek terhadap {data.advertisedCount} produk yang sudah diiklankan dari{' '}
            {data.totalProducts} produk terjual): {counts.none} belum diiklankan sama sekali, {counts.auto} hanya tersentuh Iklan Produk Otomatis. Ditampilkan{' '}
            {products.length} teratas menurut penjualan toko.
          </p>
          {!products.length ? (
            <div className="empty-note">Tidak ada produk pada pilihan ini.</div>
          ) : (
            <>
          <PotentialParetoChart products={products} />
          <DataTable columns={columns} rows={products} rowKey={(r) => r.key} />
            </>
          )}
          <p className="chart-foot">
            Penjualan dari <strong>Product Performance</strong> (Pesanan Siap Dikirim), dicocokkan dengan iklan di <strong>Data Keseluruhan Iklan</strong> lewat Kode
            Produk, lalu nama produk. Iklan yang sama dengan akhiran [2], [3]… atau nama produk yang sama dihitung sebagai satu produk.
          </p>
        </>
      )}
    </Shell>
  );
}

// ── Potential: Shop+ keywords / Live sessions worth more budget ──────────

export function PotentialItemsSection({ items, itemLabel, channelLabel, periodLabel }: { items: PotentialItem[]; itemLabel: string; channelLabel: string; periodLabel: string }) {
  const columns: DataColumn<PotentialItem>[] = [
    { id: 'rank', label: '#', thStyle: RANK_TH, tdStyle: RANK_TD, sortValue: (_r, i) => i, render: (_r, i) => i + 1 },
    { id: 'name', label: itemLabel, thStyle: NAME_TH, tdStyle: NAME_TD, sortValue: (r) => r.name, render: (r) => r.name },
    { id: 'roas', label: 'ROAS', thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.roas, render: (r) => <b>{fmtPivotVal(r.roas, 'roas')}</b> },
    { id: 'gmv', label: 'Omzet', thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.gmv, render: (r) => rp(r.gmv) },
    { id: 'spend', label: 'Biaya', thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.spend, render: (r) => rp(r.spend) },
    { id: 'share', label: 'Porsi Biaya', thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.spendShare, render: (r) => fmtPivotVal(r.spendShare, 'pct') },
    { id: 'orders', label: 'Pesanan', thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.orders, render: (r) => fmtPivotVal(r.orders, 'num') },
    { id: 'note', label: 'Saran', thStyle: { textAlign: 'left' }, tdStyle: { textAlign: 'left' }, render: (r) => <span className="sch-note">{r.note}</span> },
  ];
  return (
    <Shell title={`Potential ${itemLabel}`} badge={`${channelLabel} · ROAS di atas rata-rata channel · ${periodLabel}`} excel>
      {!items.length ? (
        <div className="empty-note">Belum ada {itemLabel.toLowerCase()} dengan pesanan dan ROAS di atas rata-rata {channelLabel} periode ini.</div>
      ) : (
        <>
          <p className="chart-caption">
            {itemLabel} yang ROAS-nya di atas rata-rata {channelLabel}, diurutkan dari ROAS tertinggi — kandidat untuk menambah budget atau bid.
          </p>
          <DataTable columns={columns} rows={items} rowKey={(r) => r.key} />
        </>
      )}
    </Shell>
  );
}

// ── Ad names without a category ──────────────────────────────────────────
// A mapping chore, not a finding: category and series only feed the Category
// / Series columns of Analisis Per Item, never a total, a tree or a ranking.
// So it waits folded under the analysis instead of standing above it, and it
// never reaches a client's export.
export function UncategorizedNote({ names, onSave }: { alwaysOpen: true; names: string[]; onSave: (name: string, category: string, series: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!names.length) return null;
  return (
    <div className={`sch-chore${open ? ' is-open' : ''}`}>
      <button type="button" className="sch-chore-bar" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="sch-chore-icon" aria-hidden="true">
          <Tags size={16} strokeWidth={2.2} />
        </span>
        <span className="sch-chore-text">
          <strong>{names.length} nama iklan belum punya kategori</strong>
          <small>Hanya mengisi kolom Category &amp; Series di Analisis Per Item — angka dan analisis lain tidak berubah.</small>
        </span>
        <span className="sch-chore-action">
          {open ? 'Tutup' : 'Lengkapi'}
          <ChevronDown size={15} strokeWidth={2.4} aria-hidden="true" />
        </span>
      </button>
      {open && <UncategorizedPanel names={names} onSave={onSave} />}
    </div>
  );
}

// ── A channel with nothing to read ───────────────────────────────────────

export function ChannelEmptySection({ label, source, banner = false }: { label: string; source: string; banner?: boolean }) {
  return (
    <Shell title={label} badge={banner ? 'Belum tersedia' : 'Tidak ada data'}>
      <div className="sch-empty">
        <strong>{banner ? `${label} belum punya data di Data Collection Hub.` : `Belum ada data ${label} untuk kedua periode.`}</strong>
        <p>
          {banner
            ? 'Data Collection Hub belum punya slot dataset Banner Ads, jadi tab ini belum bisa diisi. Begitu file ekspor Banner Ads ditambahkan ke hub (atau tersambung lewat API Shopee), analisisnya muncul di sini seperti channel lain.'
            : <>Pilih periode yang punya file <strong>{source}</strong> di Data Collection Hub › Shopee, lalu Generate ulang.</>}
        </p>
      </div>
    </Shell>
  );
}
