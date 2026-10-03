import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SectionExcelButton } from '../../components/SectionExcelButton';
import { computeDelta, deltaClassForSentiment } from '../../lib/delta';
import type { SummaryKpi } from '../../lib/summary';
import type { Sentiment } from '../../lib/types';
import { GoogleAdsTable, type GadsColumn } from './GoogleAdsTable';
import { channelLabel, matchTypeLabel, type Formatter, type GadsAuctionPeriod, type GadsAuctionRow, type GadsChange, type GadsReport, type GadsShare } from './googleAds';

// The two Data & file datasets the report reads besides the daily rows —
// Auction Insights and Change History — and the brief handed to the AI
// Consultant. Kept apart from GoogleAdsTab so the tab stays about layout.

const TABLE_ROWS = 10;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

const shareText = (s: GadsShare | undefined) => (!s ? '—' : s.value != null ? `${(s.value * 100).toFixed(2)}%` : s.text ?? '—');

function heading(title: string, badge?: string) {
  return (
    <div className="sec-heading google-heading">
      {title} {badge && <span className="sec-badge">{badge}</span>}
      <SectionExcelButton />
      <SectionDownloadButton />
    </div>
  );
}

function EmptyCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sec-block">
      <div className="sec-heading google-heading">{title}</div>
      <div className="empty-note" style={{ margin: '1.1rem 1.4rem 1.4rem' }}>{children}</div>
    </div>
  );
}

/* ── Auction Insights ───────────────────────────────────────────────── */

const AUCTION_COLS: { key: keyof GadsAuctionRow; label: string }[] = [
  { key: 'overlap_rate', label: 'Overlap rate' },
  { key: 'position_above_rate', label: 'Position above rate' },
  { key: 'top_of_page_rate', label: 'Top of page rate' },
  { key: 'abs_top_of_page_rate', label: 'Abs. top of page rate' },
  { key: 'outranking_share', label: 'Outranking share' },
];

type AuctionView = GadsAuctionRow & { oldShare: GadsShare | null };

export function AuctionInsightsSection({ data, p1, p2 }: { data: { old: GadsAuctionPeriod; cur: GadsAuctionPeriod }; p1: string; p2: string }) {
  const { old, cur } = data;
  if (!cur.rows.length) {
    return (
      <EmptyCard title="Auction Insights">
        Belum ada file Auction insights untuk {p2}. Unduh dari Google Ads › Insights &amp; reports › Auction insights (rentang satu bulan), lalu unggah di
        Data Brand › Data &amp; file › Google Ads.
      </EmptyCard>
    );
  }
  const oldByDomain = new Map(old.rows.map((r) => [r.domain.toLowerCase(), r]));
  const rows: AuctionView[] = cur.rows.map((r) => ({ ...r, oldShare: oldByDomain.get(r.domain.toLowerCase())?.impression_share ?? null }));
  const columns: GadsColumn<AuctionView>[] = [
    { key: 'domain', label: 'Display URL domain', align: 'left', value: (r) => (r.isYou ? '\u0000' : r.domain), render: (r) => (r.isYou ? <strong>Anda ({r.domain})</strong> : r.domain) },
    { key: 'impression_share', label: `Impr. share · ${p2}`, value: (r) => r.impression_share.value, render: (r) => shareText(r.impression_share) },
    {
      key: 'is_change', label: `vs ${p1}`,
      value: (r) => (r.impression_share.value != null && r.oldShare?.value != null ? r.impression_share.value - r.oldShare.value : null),
      render: (r) => {
        if (r.impression_share.value == null || r.oldShare?.value == null) return r.oldShare ? shareText(r.oldShare) : '—';
        const pp = (r.impression_share.value - r.oldShare.value) * 100;
        return `${pp >= 0 ? '+' : ''}${pp.toFixed(1)} pp`;
      },
    },
    ...AUCTION_COLS.map(({ key, label }) => ({
      key, label,
      value: (r: AuctionView) => (r[key] as GadsShare).value,
      render: (r: AuctionView) => shareText(r[key] as GadsShare),
    })),
  ];
  const span = cur.months.length > 1 ? `rata-rata ${cur.months.map(monthName).join(', ')}` : monthName(cur.months[0]);
  return (
    <div className="sec-block">
      {heading('Auction Insights', `${span} · file Data & file`)}
      <GoogleAdsTable columns={columns} rows={rows} sortKey="impression_share" limit={TABLE_ROWS} />
      <p className="gads-footnote">
        "Anda" adalah akun brand ini. Kolom "vs {p1}" adalah selisih impression share dalam poin persentase{old.rows.length ? '' : ' — belum ada file Auction insights untuk periode pembanding'}.
        {cur.months.length > 1 && ' Periode ini mencakup beberapa bulan, jadi setiap angka adalah rata-rata file bulanannya.'}
      </p>
    </div>
  );
}

/* ── Change History ─────────────────────────────────────────────────── */

const RESOURCE_LABELS: Record<string, string> = {
  CAMPAIGN: 'Campaign', CAMPAIGN_BUDGET: 'Budget', AD_GROUP: 'Ad group', AD_GROUP_AD: 'Iklan', AD_GROUP_CRITERION: 'Keyword/target',
  CAMPAIGN_CRITERION: 'Target campaign', AD_GROUP_BID_MODIFIER: 'Bid modifier', ASSET: 'Aset', CAMPAIGN_ASSET: 'Aset campaign',
};
const OPERATION_LABELS: Record<string, string> = { CREATE: 'dibuat', UPDATE: 'diubah', REMOVE: 'dihapus' };
const itemLabel = (c: GadsChange) => [c.resource_type ? RESOURCE_LABELS[c.resource_type] ?? channelLabel(c.resource_type) : '', c.operation ? OPERATION_LABELS[c.operation] ?? c.operation.toLowerCase() : '']
  .filter(Boolean).join(' ');

export function ChangeHistorySection({ data, p2 }: { data: GadsReport['changeHistory']; p2: string }) {
  if (!data.rows.length) {
    return (
      <EmptyCard title="Change History">
        Tidak ada perubahan tercatat untuk {p2}. Google Ads Script hanya bisa menarik 30 hari terakhir — untuk bulan yang lebih lama, unduh dari Google
        Ads › Change history lalu unggah di Data Brand › Data &amp; file › Google Ads.
      </EmptyCard>
    );
  }
  const columns: GadsColumn<GadsChange>[] = [
    { key: 'changed_at', label: 'Waktu', align: 'left', value: (r) => r.changed_at },
    { key: 'user_email', label: 'Oleh', align: 'left', value: (r) => r.user_email || r.client_type || '—' },
    { key: 'item', label: 'Item', align: 'left', value: (r) => itemLabel(r) || '—' },
    { key: 'campaign_name', label: 'Campaign', align: 'left', value: (r) => r.campaign_name || '—' },
    { key: 'ad_group_name', label: 'Ad group', align: 'left', value: (r) => r.ad_group_name || '—' },
    { key: 'changes', label: 'Perubahan', align: 'left', value: (r) => r.changes || '—', render: (r) => <span className="gads-change-text">{r.changes || '—'}</span> },
  ];
  const fromUpload = data.rows.some((r) => r.source === 'upload');
  return (
    <div className="sec-block">
      {heading('Change History', `${data.rows.length} perubahan · ${p2}`)}
      <GoogleAdsTable columns={columns} rows={data.rows} sortKey="changed_at" limit={TABLE_ROWS} />
      {fromUpload && <p className="gads-footnote">Sebagian perubahan berasal dari file yang diunggah di Data &amp; file ({data.uploadedFiles.join(', ')}).</p>}
    </div>
  );
}

/* ── AI Consultant Brief ────────────────────────────────────────────── */

const AI_KPIS: { key: keyof GadsReport['cur']['totals']; label: string; kind: 'money' | 'int' | 'dec' | 'pct' | 'x'; sentiment: Sentiment }[] = [
  { key: 'cost', label: 'Cost', kind: 'money', sentiment: 'neutral' },
  { key: 'impressions', label: 'Impressions', kind: 'int', sentiment: 'higher-better' },
  { key: 'clicks', label: 'Clicks', kind: 'int', sentiment: 'higher-better' },
  { key: 'ctr', label: 'CTR', kind: 'pct', sentiment: 'higher-better' },
  { key: 'avg_cpc', label: 'Avg. CPC', kind: 'money', sentiment: 'lower-better' },
  { key: 'avg_cpm', label: 'Avg. CPM', kind: 'money', sentiment: 'lower-better' },
  { key: 'conversions', label: 'Conversions', kind: 'dec', sentiment: 'higher-better' },
  { key: 'cvr', label: 'Conv. rate', kind: 'pct', sentiment: 'higher-better' },
  { key: 'cost_per_conv', label: 'Cost / conv.', kind: 'money', sentiment: 'lower-better' },
  { key: 'conversions_value', label: 'Conv. value', kind: 'money', sentiment: 'higher-better' },
  { key: 'roas', label: 'Conv. value / cost', kind: 'x', sentiment: 'higher-better' },
];

function fmt(f: Formatter, kind: string, v: number | null) {
  if (kind === 'money') return f.money(v);
  if (kind === 'int') return f.int(v);
  if (kind === 'pct') return f.pct(v);
  if (kind === 'x') return v == null ? '—' : `${f.dec(v)}x`;
  return f.dec(v);
}

export function aiKpis(report: GadsReport, f: Formatter): SummaryKpi[] {
  return AI_KPIS.map((m) => {
    const vOld = report.old.totals[m.key] as number | null;
    const vCur = report.cur.totals[m.key] as number | null;
    const d = computeDelta(vOld, vCur);
    return { key: m.key, label: m.label, old: fmt(f, m.kind, vOld), cur: fmt(f, m.kind, vCur), delta: d.deltaStr, deltaNum: d.deltaNum, cls: deltaClassForSentiment(d.deltaNum, m.sentiment) };
  });
}

// What the tables show, condensed to lines the model can reason over. The
// AI sees the same numbers as the reader — never a recomputation.
export function aiNotes(report: GadsReport, f: Formatter): string[] {
  const { cur } = report;
  const notes: string[] = [];
  const byCost = <T extends { cost: number }>(rows: T[]) => [...rows].sort((a, b) => b.cost - a.cost);

  notes.push(`Mata uang: ${report.currency ?? 'campuran'}. Akun: ${report.accounts.map((a) => a.name || a.customerId).join(', ')}.`);
  const camps = byCost(cur.campaigns).slice(0, 6);
  if (camps.length) {
    notes.push(`Campaign periode utama (urut cost): ${camps.map((c) => `${c.campaign_name} [${channelLabel(c.channel_type)}] cost ${f.money(c.cost)}, klik ${f.int(c.clicks)}, CTR ${f.pct(c.ctr)}, konversi ${f.dec(c.conversions)}, CPA ${f.money(c.cost_per_conv)}, budget/hari ${f.money(c.budget)}`).join(' | ')}`);
  }
  const terms = byCost(cur.searchTerms).slice(0, 8);
  if (terms.length) {
    notes.push(`Top search term (urut cost): ${terms.map((t) => `"${t.search_term}" (${matchTypeLabel(t.match_type)}) cost ${f.money(t.cost)}, klik ${f.int(t.clicks)}, konversi ${f.dec(t.conversions)}`).join(' | ')}`);
    const wasted = byCost(cur.searchTerms.filter((t) => t.conversions === 0 && t.cost > 0));
    const wastedCost = wasted.reduce((a, t) => a + t.cost, 0);
    notes.push(`Wasted spend search term (cost tanpa konversi): total ${f.money(wastedCost)} dari ${wasted.length} term (${cur.totals.cost ? ((wastedCost / cur.totals.cost) * 100).toFixed(1) : '0'}% cost). Terbesar: ${wasted.slice(0, 6).map((t) => `"${t.search_term}" ${f.money(t.cost)}`).join(', ') || '—'}`);
  } else {
    notes.push('Search term: tidak ada data pada periode utama.');
  }
  const kw = [...cur.keywords].sort((a, b) => b.conversions - a.conversions).slice(0, 6);
  if (kw.length) {
    notes.push(`Keyword terbaik (urut konversi): ${kw.map((k) => `"${k.keyword}" konversi ${f.dec(k.conversions)}, CPA ${f.money(k.cost_per_conv)}, CPC ${f.money(k.avg_cpc)}, abs. top ${f.pct(k.abs_top_impression_pct)}, lost top IS (rank) ${f.pct(k.search_lost_top_is_rank)}`).join(' | ')}`);
  }
  const cities = [...cur.cities].sort((a, b) => b.conversions - a.conversions).slice(0, 6);
  if (cities.length) notes.push(`Kota (Search, urut konversi): ${cities.map((c) => `${c.city} konversi ${f.dec(c.conversions)}, cost ${f.money(c.cost)}, CPA ${f.money(c.cost_per_conv)}`).join(' | ')}`);

  const ai = report.auctionInsights;
  if (ai.cur.rows.length) {
    const old = new Map(ai.old.rows.map((r) => [r.domain.toLowerCase(), r]));
    const line = (r: GadsAuctionRow) => {
      const prev = old.get(r.domain.toLowerCase());
      return `${r.isYou ? 'BRAND INI' : r.domain}: impr. share ${shareText(r.impression_share)}${prev ? ` (periode pembanding ${shareText(prev.impression_share)})` : ''}, overlap ${shareText(r.overlap_rate)}, position above ${shareText(r.position_above_rate)}, top of page ${shareText(r.top_of_page_rate)}, outranking ${shareText(r.outranking_share)}`;
    };
    const rows = [...ai.cur.rows].sort((a, b) => Number(b.isYou) - Number(a.isYou) || (b.impression_share.value ?? 0) - (a.impression_share.value ?? 0)).slice(0, 8);
    notes.push(`Auction insights (${ai.cur.months.map(monthName).join(', ')}): ${rows.map(line).join(' | ')}`);
  } else {
    notes.push('Auction insights: belum diunggah untuk periode utama, jadi posisi terhadap kompetitor tidak dapat dinilai.');
  }

  const changes = report.changeHistory.rows;
  if (changes.length) {
    notes.push(`Change history periode utama: ${changes.length} perubahan tercatat di akun. Gunakan untuk menjelaskan pergeseran angka (perubahan budget, bid, status, keyword, iklan) — kaitkan tanggal perubahan dengan tren, tetapi tetap sebagai hipotesis.`);
    changes.slice(0, 30).forEach((c) => notes.push(`Perubahan ${c.changed_at}${c.user_email ? ` oleh ${c.user_email}` : ''}: ${[itemLabel(c), c.campaign_name, c.ad_group_name].filter(Boolean).join(' · ')} — ${(c.changes ?? '').slice(0, 200)}`));
    if (changes.length > 30) notes.push(`(${changes.length - 30} perubahan lain tidak dicantumkan.)`);
  } else {
    notes.push('Change history: tidak ada perubahan tercatat untuk periode utama (atau belum diunggah untuk bulan di luar 30 hari terakhir).');
  }
  return notes;
}
