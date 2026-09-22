import {
  Gauge,
  TrendingUp,
  Filter,
  Repeat,
  CreditCard,
  ShoppingBasket,
  Package,
  ListTree,
  Megaphone,
  ShoppingBag,
  Video,
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

// ── Channels & views ────────────────────────────────────────────────────
// Business Overview is read channel-first: pick Meta / Shopee / TikTok, then a
// domain inside it. Only Shopee has fact tables today (the shopee.* importer),
// so the other two carry the same domain shape with no endpoint — their tabs
// say "belum ada data" rather than pretending to be empty reports.
export const CHANNELS = [
  {
    id: 'meta',
    label: 'Meta Ads',
    hint: 'Boost, Non-Boost & CPAS',
    accent: '#1e3eb8',
    Icon: Megaphone,
    ready: false,
    note: 'Data Meta belum diimpor ke tabel fakta — file-nya masih berupa arsip di Pengaturan Brand.',
  },
  {
    id: 'shopee',
    label: 'Shopee',
    hint: 'Penjualan, funnel & produk',
    accent: '#ee4d2d',
    Icon: ShoppingBag,
    ready: true,
    note: 'Dibaca dari data Shopee yang sudah diimpor lewat Pengaturan Brand.',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    hint: 'GMV Max & Shop',
    accent: '#0a0a0a',
    Icon: Video,
    ready: false,
    note: 'Data TikTok belum diimpor ke tabel fakta — file-nya masih berupa arsip di Pengaturan Brand.',
  },
];

export const CHANNEL_BY_ID = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));

// The seven analytic domains belong to whichever channel can answer them.
// Today that is Shopee for all of them; Meta and TikTok list the same domains
// so the shape of the page is stable once their importers exist.
export const CHANNEL_DOMAINS = Object.fromEntries(
  CHANNELS.map((channel) => [
    channel.id,
    DOMAINS.filter((d) => d.key !== 'Executive Snapshot')
      .map((d) => (channel.ready ? d : { ...d, endpoint: null, prefetch: false })),
  ]),
);

// The page's top navigation. Executive Snapshot is not a channel — it is the
// sum of them — but choosing it is the same kind of act as choosing a channel,
// so it belongs in the same bar rather than floating above it as a permanent
// header that repeated itself over every channel. It sits leftmost because it
// is where a reading starts, and it is the only view carrying the Minutes of
// Meeting workspace.
export const EXECUTIVE_VIEW = {
  id: 'snapshot',
  label: 'Executive Snapshot',
  hint: 'Ringkasan lintas channel & MOM',
  accent: '#1e3eb8',
  Icon: Gauge,
  ready: true,
  question: 'Bagaimana performa seluruh channel pada periode ini, dan apa yang disepakati di meeting terakhir?',
};

export const VIEWS = [EXECUTIVE_VIEW, ...CHANNELS];
export const VIEW_BY_ID = Object.fromEntries(VIEWS.map((v) => [v.id, v]));

export const DOMAIN_KEYS = DOMAINS.map((d) => d.key);
export const DOMAIN_BY_KEY = Object.fromEntries(DOMAINS.map((d) => [d.key, d]));

const idr = (v) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(Number(v));

const num = (v, decimals = 0) => new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
}).format(Number(v));

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
      value: idr(gmv.value),
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
    const clicks = d?.kpis?.clicks;
    if (clicks?.value == null) return absent('Data trafik bulanan belum tersedia untuk bulan ini.');
    return {
      value: num(clicks.value),
      caption: d?.insights?.funnelBottleneck?.label || `Total klik produk ${d?.period?.label || 'bulan ini'}.`,
      delta: clicks.growth ?? null,
    };
  },

  'Retention Analysis': (d) => {
    const rate = d?.historicalRetention;
    if (rate?.rate == null) return absent('Data pelanggan belum tersedia untuk periode ini.');
    return {
      value: formatPercent(rate.rate),
      caption: `${num(rate.retainedCount)} dari ${num(rate.cohortCount)} pelanggan sebelumnya kembali pada periode ini.`,
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
      caption: `Rata-rata item per transaksi, dengan ATV ${idr(stats.atv || 0)}.`,
      delta: null,
    };
  },

  'Product Performance': (d) => {
    const top = (d?.topByRevenue || [])[0];
    if (!top) return absent('Laporan produk belum tersedia untuk periode ini.');
    return {
      value: idr(top.revenue),
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
      value: idr(gmv),
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
const SHOP_STATS = "file Performance Overview Shopee (shop-stats) yang di-upload di Pengaturan Brand";
const ORDER_FILE = 'file Order (Pesanan) Shopee yang di-upload di Pengaturan Brand';

export const STRIP_METRICS = [
  {
    key: 'gmv', label: 'GMV', kind: 'currency', spark: true, net: true,
    note: `Sumber: ${SHOP_STATS}, sheet "Pesanan Dibayar", kolom "Total Penjualan (IDR)", dijumlah per hari selama periode terpilih.\nSama dengan "Penjualan" di Seller Centre > Performa Toko (Status Pesanan: Pesanan Dibayar).\n\nBaris Net = Total Penjualan − Penjualan Dibatalkan − Penjualan Dikembalikan (kolom di sheet yang sama).`,
  },
  {
    key: 'transactions', label: 'Transaksi', kind: 'number', net: true,
    note: `Sumber: ${SHOP_STATS}, sheet "Pesanan Dibayar", kolom "Total Pesanan".\nSama dengan "Pesanan" di Performa Toko.\n\nBaris Net = Total Pesanan − Pesanan Dibatalkan − Pesanan Dikembalikan.`,
  },
  {
    key: 'unitsSold', label: 'Produk Terjual', kind: 'number', absent: 'Butuh file Order (Pesanan) Shopee. Upload di Pengaturan Brand > Data untuk periode ini.',
    note: `Sumber: ${ORDER_FILE}. Jumlah kolom "Jumlah" untuk pesanan yang dibuat pada periode ini, kecuali pesanan berstatus Batal.`,
  },
  {
    key: 'aov', label: 'AOV', kind: 'currency',
    note: 'GMV ÷ Transaksi (keduanya gross).\nSama dengan "Penjualan per Pesanan" di Performa Toko.',
  },
  {
    key: 'uniqueCustomers', label: 'Pelanggan Unik', kind: 'number', absent: 'Butuh file Order (Pesanan) Shopee. Upload di Pengaturan Brand > Data untuk periode ini.',
    note: `Sumber: ${ORDER_FILE}. Jumlah pembeli (username) yang berbeda dari pesanan berstatus Selesai dan diselesaikan pada periode ini. Satu pembeli dihitung sekali walau belanja berkali-kali.`,
  },
  {
    key: 'cvr', label: 'CVR Pesanan', kind: 'pct',
    note: `Sumber: ${SHOP_STATS}, sheet "Pesanan Dibayar", kolom "Tingkat Konversi Pesanan".\nJika periode = 1 bulan penuh, dipakai angka bulanan Shopee (sama dengan Performa Toko "Per Bulan"). Untuk rentang lain, dipakai rata-rata angka harian.\nBerbeda dari "CVR Funnel" di domain Traffic & Funnel.`,
  },
  {
    key: 'cancellationRate', label: 'Tingkat Pembatalan', kind: 'pct', invert: true,
    note: `Pesanan Dibatalkan ÷ Total Pesanan, dari ${SHOP_STATS}, sheet "Pesanan Dibayar".\nKenaikan ditandai merah karena merupakan sinyal negatif.`,
  },
  {
    key: 'totalDiscount', label: 'Total Diskon', kind: 'currency', absent: 'Butuh file Order (Pesanan) Shopee. Upload di Pengaturan Brand > Data untuk periode ini.',
    note: `Sumber: ${ORDER_FILE}. Voucher Penjual + Voucher Shopee + Diskon Kartu Kredit + Paket Diskon (Penjual & Shopee) + Diskon Produk (Penjual & Shopee), untuk pesanan berstatus Selesai pada periode ini.`,
  },
];

export function formatStripValue(value, kind) {
  if (value == null) return null;
  if (kind === 'currency') return idr(value);
  if (kind === 'pct') return formatPercent(Number(value) * 100, 2);
  return num(value);
}
