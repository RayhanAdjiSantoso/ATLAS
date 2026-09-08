import {
  Gauge,
  TrendingUp,
  Filter,
  Repeat,
  CreditCard,
  ShoppingBasket,
  Package,
  ListTree,
} from 'lucide-react';
import { formatPercent } from '../../utils/format.js';

// The seven analytic domains of Business Overview, in the order an analyst
// works them: what happened, whether it moved, where it leaked, who came
// back, how they paid, what they bought together, which product carried it.
//
// This list is the single source for the rail, the module grid, and the
// fetcher. The old page kept the labels, the endpoints and the renderers in
// three separate objects, which is how "Upload Data" ended up a peer of
// "Retention Analysis" in one of them and not the others.

export const DOMAINS = [
  {
    key: 'Executive Snapshot',
    label: 'Executive Snapshot',
    short: 'Snapshot',
    Icon: Gauge,
    endpoint: '/dashboard/executive-snapshot',
    question: 'Bagaimana performa bisnis secara keseluruhan pada periode ini?',
  },
  {
    key: 'Business Growth',
    label: 'Business Growth',
    short: 'Growth',
    Icon: TrendingUp,
    endpoint: '/dashboard/business-growth',
    question: 'Apakah bisnis tumbuh atau menurun dibandingkan periode sebelumnya, dan apa pendorong utamanya?',
  },
  {
    key: 'Traffic & Funnel',
    label: 'Traffic & Funnel',
    short: 'Funnel',
    Icon: Filter,
    endpoint: '/dashboard/traffic-funnel',
    question: 'Di tahap mana pelanggan paling banyak drop-off sebelum menyelesaikan pembelian?',
  },
  {
    key: 'Retention Analysis',
    label: 'Retention Analysis',
    short: 'Retention',
    Icon: Repeat,
    endpoint: '/dashboard/rfm',
    question: 'Segmen pelanggan mana yang paling bernilai, dan mana yang berisiko churn?',
  },
  {
    key: 'Transaction Behavior',
    label: 'Transaction Behavior',
    short: 'Transaksi',
    Icon: CreditCard,
    endpoint: '/dashboard/transaction-behavior',
    question: 'Bagaimana pola pembayaran, pengiriman, dan pembatalan transaksi pelanggan?',
  },
  {
    key: 'Basket Analysis',
    label: 'Basket Analysis',
    short: 'Basket',
    Icon: ShoppingBasket,
    endpoint: '/dashboard/basket-analysis',
    question: 'Produk apa yang paling sering dibeli bersamaan, dan bagaimana pola repeat purchase pelanggan?',
  },
  {
    key: 'Product Performance',
    label: 'Product Performance',
    short: 'Produk',
    Icon: Package,
    endpoint: '/dashboard/product-performance',
    question: 'Produk mana yang menjadi pendorong pertumbuhan, dan mana yang mulai melemah?',
  },
  {
    // Root Cause Analysis is not a Data Mapping v1 domain — it's the v2
    // decomposition tree (GMV -> Orders/Traffic/CR/AOV). It renders full
    // width like a focused domain but drives its own period comparison
    // (per-node delta) instead of the side-by-side split the others use, and
    // it stays out of the idle prefetch (`prefetch: false`) since one open
    // costs 4 queries per period.
    key: 'Root Cause Analysis',
    label: 'Root Cause Analysis',
    short: 'Root Cause',
    Icon: ListTree,
    endpoint: '/dashboard/root-cause',
    question: 'Komponen mana dalam rantai GMV yang paling menggerakkan kenaikan/penurunan periode ini?',
    prefetch: false,
  },
];

export const DOMAIN_KEYS = DOMAINS.map((d) => d.key);
export const DOMAIN_BY_KEY = Object.fromEntries(DOMAINS.map((d) => [d.key, d]));

const idr = (v) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(Number(v));

const num = (v, decimals = 0) => new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
}).format(Number(v));

// Compact currency for a summary tile — a full "Rp1.284.930.000" wraps and
// stops being a glance. The focused panel still prints every rupiah.
const idrShort = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `Rp${num(n / 1e9, 2)} M`;
  if (abs >= 1e6) return `Rp${num(n / 1e6, 1)} jt`;
  if (abs >= 1e3) return `Rp${num(n / 1e3, 0)} rb`;
  return idr(n);
};

// A headline is `{ value, caption, delta, invert }`, where a `value` of null
// means the figure genuinely is not there. Callers render null as an em dash
// in the muted tier and a real 0 as "0" — the product rule is that absent and
// zero never look alike, so these extractors must return null rather than
// falling back to 0 anywhere.
const absent = (caption) => ({ value: null, caption, delta: null });

export const HEADLINES = {
  'Executive Snapshot': (d) => {
    const gmv = d?.kpis?.gmv;
    if (gmv?.value == null) return absent('GMV belum tersedia untuk periode ini.');
    return {
      value: idrShort(gmv.value),
      caption: 'GMV periode berjalan.',
      delta: gmv.growth ?? null,
    };
  },

  'Business Growth': (d) => {
    const growth = d?.summary?.gmv?.growth;
    if (growth == null) {
      return absent('Aktifkan "Bandingkan Periode" untuk mengukur pertumbuhan.');
    }
    return {
      value: `${growth > 0 ? '+' : ''}${formatPercent(growth)}`,
      caption: 'Perubahan GMV terhadap periode pembanding.',
      delta: growth,
    };
  },

  'Traffic & Funnel': (d) => {
    const total = d?.trafficOverview?.total;
    if (total?.value == null) return absent('Data trafik belum tersedia untuk periode ini.');
    return {
      value: num(total.value),
      caption: d?.insights?.funnelBottleneck?.label || 'Total klik masuk ke halaman produk.',
      delta: total.growth ?? null,
    };
  },

  'Retention Analysis': (d) => {
    const rate = d?.repeatCustomerRate;
    if (rate?.retentionRatePct == null) return absent('Data pelanggan belum tersedia untuk periode ini.');
    return {
      value: formatPercent(rate.retentionRatePct),
      caption: `Pelanggan dengan lebih dari satu transaksi, dari ${num(rate.totalCustomers || 0)} pelanggan.`,
      delta: null,
    };
  },

  'Transaction Behavior': (d) => {
    const payments = d?.payments || [];
    if (payments.length === 0) return absent('Data transaksi belum tersedia untuk periode ini.');
    const total = payments.reduce((sum, p) => sum + Number(p.sales || 0), 0);
    const top = payments.reduce((a, b) => (Number(b.sales || 0) > Number(a.sales || 0) ? b : a));
    if (total <= 0) return absent('Nilai transaksi pada periode ini nol.');
    return {
      value: formatPercent((Number(top.sales || 0) / total) * 100),
      caption: `Pangsa metode pembayaran teratas: ${top.name}.`,
      delta: null,
    };
  },

  'Basket Analysis': (d) => {
    const stats = d?.stats;
    if (stats?.avgItemsPerTransaction == null) return absent('Data keranjang belum tersedia untuk periode ini.');
    return {
      value: num(stats.avgItemsPerTransaction, 2),
      caption: `Rata-rata item per transaksi, dengan ATV ${idrShort(stats.atv || 0)}.`,
      delta: null,
    };
  },

  'Product Performance': (d) => {
    const top = (d?.topByRevenue || [])[0];
    if (!top) return absent('Laporan produk belum tersedia untuk periode ini.');
    return {
      value: idrShort(top.revenue),
      caption: `Kontributor revenue teratas: ${top.label}.`,
      delta: null,
    };
  },

  'Root Cause Analysis': (d) => {
    const gmv = d?.tree?.value;
    if (gmv == null) return absent('Data GMV belum tersedia untuk periode ini.');
    const prev = d?.compare?.tree?.value;
    const delta = prev != null && prev !== 0 ? ((gmv - prev) / Math.abs(prev)) * 100 : null;
    return {
      value: idrShort(gmv),
      caption: 'Akar analisis: dekomposisi GMV → Orders, Traffic, Conversion Rate, AOV.',
      delta,
    };
  },
};

// The Executive Snapshot KPI row, lifted out of that panel and pinned above
// every domain. It is not a summary of the snapshot — it IS the snapshot's
// figures, which is why renderExecutiveSnapshot stops drawing them when this
// strip is on duty (see `stripOwnsKpis` in DashboardTab). Read from the
// snapshot payload the console always holds, so the strip costs no extra
// request whichever domain is focused.
//
// `pct` marks the 0..1 fractions the API returns for rate metrics; `invert`
// marks the one where a rise is bad news. `note` carries the explanations the
// old KpiCards held, so nothing a user could hover for was lost in the move.
export const STRIP_METRICS = [
  { key: 'gmv', label: 'GMV', kind: 'currency', spark: true, note: 'Penjualan kotor periode berjalan. Tren harian lengkap ada di domain Business Growth.' },
  { key: 'transactions', label: 'Transaksi', kind: 'number' },
  { key: 'unitsSold', label: 'Produk Terjual', kind: 'number' },
  { key: 'aov', label: 'AOV', kind: 'currency', note: 'Rata-rata nilai per order: GMV dibagi jumlah transaksi.' },
  { key: 'uniqueCustomers', label: 'Pelanggan Unik', kind: 'number' },
  { key: 'cvr', label: 'CVR Pesanan', kind: 'pct', note: "Rata-rata harian 'Tingkat Konversi Pesanan' yang dilaporkan Shopee langsung (Pesanan Dibayar / Pengunjung). Berbeda basis hitung dari 'CVR Funnel' di domain Traffic & Funnel." },
  { key: 'cancellationRate', label: 'Tingkat Pembatalan', kind: 'pct', invert: true, note: 'Kenaikan tingkat pembatalan adalah sinyal negatif, sehingga ditandai merah meskipun nilainya naik.' },
  { key: 'totalDiscount', label: 'Total Diskon', kind: 'currency' },
];

export function formatStripValue(value, kind) {
  if (value == null) return null;
  if (kind === 'currency') return idrShort(value);
  if (kind === 'pct') return formatPercent(Number(value) * 100, 2);
  return num(value);
}
