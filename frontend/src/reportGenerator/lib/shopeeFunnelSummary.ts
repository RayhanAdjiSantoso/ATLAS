import type { FunnelMetrics } from './shopeeFunnel';

// ══════════════════════════════════════════════════════
// SHOPEE ADS — SYMPTOM ANALYSIS, plain-language read.
//
// Walks the funnel identity GMV ≈ Transaksi × AOV ; Transaksi ≈ Trafik × CVR ;
// Trafik ≈ Impresi × CTR ; CVR ≈ (Klik→Keranjang) × (Keranjang→Beli) and turns
// the biggest movers into a short narrative + a one-line verdict — the kind of
// read an ads strategist would write under the table ("trafik bagus tapi ATC
// turun → tugas iklan sudah oke, minat closing yang kurang").
// ══════════════════════════════════════════════════════

export interface SymptomSummary {
  gmvDir: 'up' | 'down' | 'flat';
  gmvPct: number | null;
  headline: string;
  points: string[];
  verdict: string;
}

type Dir = 'up' | 'down' | 'flat';

const pctChange = (o: number, c: number): number | null => (o > 0 ? ((c - o) / o) * 100 : null);
const idNum = (v: number) => v.toFixed(1).replace('.', ',');
const absId = (v: number | null) => (v === null ? '—' : `${idNum(Math.abs(v))}%`);
const signId = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${idNum(Math.abs(v))}%`);
const dirOf = (v: number | null, eps = 2): Dir => (v === null ? 'flat' : v > eps ? 'up' : v < -eps ? 'down' : 'flat');
const WORD: Record<Dir, string> = { up: 'naik', down: 'turun', flat: 'relatif stabil' };
// "naik 12,5%" / "turun 6,9%" / "relatif stabil" (no number when it barely moved)
const move = (v: number | null): string => {
  const d = dirOf(v);
  return d === 'flat' ? 'relatif stabil' : `${WORD[d]} ${absId(v)}`;
};

export function buildSymptomSummary(o: FunnelMetrics, c: FunnelMetrics): SymptomSummary {
  const gmv = pctChange(o.gmvAds, c.gmvAds);
  const tx = pctChange(o.purchases, c.purchases);
  const aov = pctChange(o.aov, c.aov);
  const clicks = pctChange(o.clicks, c.clicks);
  const cvr = pctChange(o.cvr, c.cvr);
  const impr = pctChange(o.impressions, c.impressions);
  const ctr = pctChange(o.ctr, c.ctr);
  const spend = pctChange(o.spend, c.spend);
  const cpm = pctChange(o.cpm, c.cpm);
  const atc1 = pctChange(o.clicksToAtcRate, c.clicksToAtcRate); // klik → keranjang
  const atc2 = pctChange(o.atcToPurchaseRate, c.atcToPurchaseRate); // keranjang → beli
  const cpp = pctChange(o.cpp, c.cpp);
  const roas = pctChange(o.roas, c.roas);

  const gd = dirOf(gmv);
  const points: string[] = [];

  // 1 — Transaksi vs AOV: which side of GMV = Transaksi × AOV moved more.
  const driver = Math.abs(tx ?? 0) >= Math.abs(aov ?? 0) ? 'jumlah transaksi' : 'nilai per order (AOV)';
  points.push(`Transaksi ${move(tx)}, AOV ${move(aov)} — pergerakan GMV terutama dari ${driver}.`);

  // 2 — Transaksi = Trafik × CVR.
  const cd = dirOf(clicks);
  const vd = dirOf(cvr);
  if (cd === 'up' && vd === 'down') {
    points.push(`Trafik naik (klik ${absId(clicks)}) tapi conversion rate turun ${absId(cvr)} — iklan berhasil memperluas jangkauan, tetapi minat closing berkurang.`);
  } else if (cd === 'down' && vd === 'up') {
    points.push(`Trafik turun ${absId(clicks)} tapi conversion rate naik ${absId(cvr)} — audiens yang tersisa lebih tertarget; ada ruang menaikkan budget/impresi.`);
  } else if (cd === 'up' && vd === 'up') {
    points.push(`Trafik (klik ${absId(clicks)}) dan conversion rate (${absId(cvr)}) sama-sama membaik.`);
  } else if (cd === 'down' && vd === 'down') {
    points.push(`Trafik (klik ${absId(clicks)}) dan conversion rate (${absId(cvr)}) sama-sama turun — perlu evaluasi menyeluruh.`);
  } else {
    points.push(`Trafik ${move(clicks)}, conversion rate ${move(cvr)}.`);
  }

  // 3 — Trafik = Impresi × CTR, plus how it was bought (Spend / CPM).
  if (dirOf(impr) !== 'flat' || dirOf(ctr) !== 'flat' || dirOf(spend) !== 'flat') {
    const budget =
      dirOf(spend) === 'up'
        ? `dari kenaikan budget (spend ${signId(spend)}, CPM ${move(cpm)})`
        : dirOf(spend) === 'down'
          ? `walau budget turun ${absId(spend)}`
          : `dengan budget relatif tetap`;
    points.push(`Impresi ${move(impr)} ${budget}; CTR ${move(ctr)}.`);
  }

  // 4 — CVR = (Klik→Keranjang) × (Keranjang→Beli): which stage leaked.
  if (vd !== 'flat' && (atc1 !== null || atc2 !== null)) {
    const stage =
      Math.abs(atc2 ?? 0) >= Math.abs(atc1 ?? 0) ? `tahap keranjang → pembelian (${signId(atc2)})` : `tahap klik → tambah keranjang (${signId(atc1)})`;
    points.push(
      vd === 'down'
        ? `Penurunan konversi paling terasa di ${stage} — cek harga, ongkir, stok, ulasan, atau kejelasan halaman produk.`
        : `Perbaikan konversi datang dari ${stage}.`,
    );
  }

  // 5 — Cost efficiency.
  if (dirOf(cpp) !== 'flat' || dirOf(roas) !== 'flat') {
    points.push(`Efisiensi biaya: Cost per Purchase ${move(cpp)}, ROAS ${move(roas)}.`);
  }

  const headline = gd === 'flat' ? `GMV Ads relatif stabil (${signId(gmv)}).` : `GMV Ads ${WORD[gd]} ${absId(gmv)} — digerakkan terutama oleh ${driver}.`;

  const trafficGood = cd === 'up' || dirOf(impr) === 'up';
  let verdict: string;
  if (trafficGood && vd === 'down') {
    verdict = 'Tugas iklan (penyebaran & trafik) sudah berjalan baik. Bottleneck ada di konversi akhir — perbaikan bukan di media buying, tapi di penawaran & halaman produk.';
  } else if (!trafficGood && vd === 'up') {
    verdict = 'Konversi membaik tapi trafik menyusut. Iklan aman untuk di-scale — naikkan impresi/budget selama CPM & CPC terkendali.';
  } else if (gd === 'up') {
    verdict = 'Pertumbuhan sehat: trafik dan konversi bergerak searah. Pertahankan pola belanja iklan saat ini.';
  } else if (gd === 'down') {
    verdict = 'Penurunan datang dari sisi trafik sekaligus konversi — audit targeting, kreatif, dan penawaran sebelum menambah budget.';
  } else {
    verdict = 'Performa mendatar. Uji perubahan pada satu variabel (targeting / kreatif / bid) untuk memecah plateau.';
  }

  return { gmvDir: gd, gmvPct: gmv, headline, points, verdict };
}
