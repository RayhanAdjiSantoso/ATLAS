import { div, lmdi, pctChange } from './math.js';
import { fitChannelModel } from './model.js';
import { analyzeThread } from './thread.js';

// ===========================================================================
// Atribusi & Kebocoran Channel — engine (pure)
// ===========================================================================
//
// Input: the day series from dataSource.js (or any source of the same shape).
// Output: one plain object the page renders and the AI narrative can read.
//
//   monthly         per calendar month: the shop's numbers, each channel's
//                   spend, what each platform claims, and the model's share
//   reconciliation  L1 — claims vs the shop's real revenue (over-claim)
//   bridges         L2 — month to month, revenue split into days × traffic
//                   × CR × AOV, into sales sources, and into channels
//   models          L3 — revenue / traffic / orders per Rupiah per channel
//   leaks           spend share vs contribution share, Rupiah not earning
//                   its keep at the target ROAS
//   levers          per goal (revenue, traffic, orders, ATC): which channel
//                   moves it most for the next Rupiah
//   diagnosis       L4 — each channel's funnel month to month, the stage
//                   that worsened most, and what to do
//
// Ratios across days are always Σ numerator ÷ Σ denominator, never an
// average of daily ratios. A value that cannot be computed is null.

export const CHANNELS = [
  { key: 'shopee_ads', label: 'Iklan Shopee', color: '#c93b1c' },
  { key: 'cpas', label: 'CPAS Shopee', color: '#0f766e' },
  { key: 'meta_boost', label: 'Meta Boost Post', color: '#2563eb' },
  { key: 'meta_nonboost', label: 'Meta Non-Boost', color: '#7c3aed' },
];
const LABEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label]));

// What the shop-side model cannot see for a channel. Non-Boost campaigns
// usually send people to the website or chat; this module reads Shopee
// revenue only, so a Non-Boost "0" means "no effect on Shopee", not "no
// effect at all".
export const SCOPE_NOTES = {
  shopee_ads: 'Spend GMV Max naik-turun mengikuti penjualan (mengejar target ROAS), jadi sebagian kontribusinya bisa terbaca terlalu besar — anggap sebagai batas atas.',
  meta_nonboost: 'Non-Boost umumnya mengarah ke website/chat. Model ini hanya membaca revenue Shopee — kontribusi ke website tidak terukur di sini.',
  meta_boost: 'Boost Post bertujuan awareness/traffic; efeknya ke Shopee dibaca dari pergerakan toko, bukan dari klaim pembelian.',
};

export const SOURCES = [
  { key: 'pp_toko', label: 'Halaman Toko' },
  { key: 'pp_pencarian', label: 'Pencarian' },
  { key: 'pp_rekomendasi', label: 'Rekomendasi' },
  { key: 'pp_keranjang', label: 'Keranjang' },
  { key: 'pp_chat', label: 'Chat' },
  { key: 'pp_promosi', label: 'Promosi' },
  { key: 'pp_pesanan', label: 'Pesanan Saya' },
  { key: 'pp_lainnya', label: 'Halaman Produk · Lainnya (termasuk traffic eksternal)' },
  { key: 'live', label: 'Live' },
  { key: 'video', label: 'Video' },
  { key: 'affiliate', label: 'Affiliate' },
];

const TARGETS = [
  { key: 'revenue', label: 'Revenue', unit: 'idr' },
  { key: 'visitors', label: 'Traffic (pengunjung)', unit: 'count' },
  { key: 'orders', label: 'Pesanan', unit: 'count' },
];

const monthOf = (d) => d.slice(0, 7);
const daysInMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
};
const addSums = (a, b) => {
  for (const [k, v] of Object.entries(b)) if (typeof v === 'number') a[k] = (a[k] ?? 0) + v;
  return a;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const fmtMonth = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const fmtPct = (v) => `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
const fmtRp = (v) => `Rp${Math.round(v).toLocaleString('id-ID')}`;
const fmtJt = (v) => `Rp${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;

// ── Which channels this brand actually runs, and which days are usable ────
function activeChannels(days) {
  return CHANNELS.filter((c) => days.some((d) => d.ch[c.key] && d.ch[c.key].spend > 0)).map((c) => c.key);
}

// ── Monthly roll-up ───────────────────────────────────────────────────────
function buildMonthly(days, channels, storeAtc, models) {
  const byMonth = new Map();
  for (const d of days) {
    const m = monthOf(d.date);
    const row = byMonth.get(m) ?? {
      month: m,
      calendarDays: daysInMonth(m),
      storeDays: 0,
      store: { revenue: 0, orders: 0, visitors: 0, clicks: 0, buyers: 0, newBuyers: 0 },
      sources: {},
      channels: Object.fromEntries(channels.map((c) => [c, { days: 0, missingDays: 0, spend: 0 }])),
    };
    if (d.store) {
      row.storeDays += 1;
      addSums(row.store, d.store);
    }
    if (d.sources) for (const [k, v] of Object.entries(d.sources)) row.sources[k] = addSums(row.sources[k] ?? {}, v);
    for (const c of channels) {
      const v = d.ch[c];
      const slot = row.channels[c];
      if (!d.store) continue;
      if (v == null) slot.missingDays += 1;
      else {
        slot.days += 1;
        addSums(slot, v);
        if (v.bySub) for (const [sub, sv] of Object.entries(v.bySub)) {
          slot.bySub ??= {};
          slot.bySub[sub] = addSums(slot.bySub[sub] ?? {}, sv);
        }
      }
    }
    byMonth.set(m, row);
  }

  const modelByDate = Object.fromEntries(TARGETS.map((t) => [t.key, new Map((models[t.key]?.daily ?? []).map((r) => [r.date, r]))]));

  return [...byMonth.values()].filter((row) => row.storeDays > 0).map((row) => {
    const s = row.store;
    const spendTotal = channels.reduce((acc, c) => acc + row.channels[c].spend, 0);
    const complete = row.storeDays === row.calendarDays && channels.every((c) => row.channels[c].missingDays === 0);
    const claims = Object.fromEntries(channels.map((c) => [c, row.channels[c].days ? row.channels[c].revenue ?? row.channels[c].value ?? 0 : null]));
    const claimTotal = Object.values(claims).reduce((a, v) => a + (v ?? 0), 0);
    const atc = storeAtc[row.month] ?? null;

    // Model contributions summed over the month's modelled days.
    const model = {};
    for (const t of TARGETS) {
      const map = modelByDate[t.key];
      let modelled = 0;
      const acc = { actual: 0, baseline: 0, seasonal: 0, residual: 0, contrib: Object.fromEntries(channels.map((c) => [c, 0])) };
      for (const [date, r] of map) {
        if (monthOf(date) !== row.month) continue;
        modelled += 1;
        acc.actual += r.actual;
        acc.baseline += r.baseline;
        acc.seasonal += r.seasonal;
        acc.residual += r.residual;
        for (const c of channels) acc.contrib[c] += r.contrib[c] ?? 0;
      }
      model[t.key] = modelled ? { days: modelled, ...acc } : null;
    }

    return {
      month: row.month,
      calendarDays: row.calendarDays,
      storeDays: row.storeDays,
      complete,
      // Every running channel known on every day the shop reported — the
      // months whose claims can be held against the shop's revenue.
      channelsKnown: channels.every((c) => row.channels[c].missingDays === 0),
      store: {
        ...s,
        aov: div(s.revenue, s.orders),
        cr: div(s.orders, s.visitors),
        revenuePerDay: div(s.revenue, row.storeDays),
        atc: atc?.cartAdds ?? null,
        atcRate: atc ? div(atc.cartAdds, s.visitors) : null,
      },
      spend: { ...Object.fromEntries(channels.map((c) => [c, row.channels[c].days ? row.channels[c].spend : null])), total: spendTotal },
      mer: div(s.revenue, spendTotal),
      channels: row.channels,
      sources: row.sources,
      claims,
      claimTotal,
      overclaim: div(claimTotal, s.revenue),
      model,
    };
  });
}

// ── L1 Reconciliation ─────────────────────────────────────────────────────
function reconcile(allMonths, channels, models) {
  const revenueModel = models.revenue;
  const monthly = allMonths.filter((m) => m.channelsKnown);
  const totals = monthly.reduce(
    (acc, m) => {
      acc.revenue += m.store.revenue;
      acc.spend += m.spend.total;
      for (const c of channels) {
        acc.claims[c] += m.claims[c] ?? 0;
        acc.spendBy[c] += m.spend[c] ?? 0;
      }
      return acc;
    },
    { revenue: 0, spend: 0, claims: Object.fromEntries(channels.map((c) => [c, 0])), spendBy: Object.fromEntries(channels.map((c) => [c, 0])) },
  );
  const claimTotal = Object.values(totals.claims).reduce((a, v) => a + v, 0);
  const contribTotal = revenueModel?.ok ? revenueModel.channels.reduce((a, c) => a + c.contribution, 0) : null;
  return {
    months: monthly.map((m) => m.month),
    revenue: totals.revenue,
    spend: totals.spend,
    claimTotal,
    overclaim: div(claimTotal, totals.revenue),
    channels: channels.map((c) => {
      const mc = revenueModel?.ok ? revenueModel.channels.find((x) => x.channel === c) : null;
      return {
        channel: c,
        label: LABEL[c],
        spend: totals.spendBy[c],
        spendShare: div(totals.spendBy[c], totals.spend),
        claim: totals.claims[c],
        claimShareOfRevenue: div(totals.claims[c], totals.revenue),
        claimedRoas: div(totals.claims[c], totals.spendBy[c]),
        modelContribution: mc ? mc.contribution : null,
        modelShareOfRevenue: mc ? div(mc.contribution, totals.revenue) : null,
        // How many times the platform's claim exceeds what the shop's data supports.
        claimVsModel: mc && mc.contribution > 0 && totals.claims[c] > 0 ? div(totals.claims[c], mc.contribution) : null,
      };
    }),
    modelChannelsShare: contribTotal != null ? div(contribTotal, totals.revenue) : null,
  };
}

// ── L2 Bridges ────────────────────────────────────────────────────────────
function bridge(a, b, channels) {
  const drivers = (() => {
    const f = (m) => [m.storeDays, div(m.store.visitors, m.storeDays), div(m.store.orders, m.store.visitors), div(m.store.revenue, m.store.orders)];
    const parts = lmdi(f(a), f(b));
    if (!parts) return null;
    return [
      { key: 'days', label: 'Jumlah hari', value: parts[0], from: a.storeDays, to: b.storeDays, unit: 'count' },
      { key: 'traffic', label: 'Traffic per hari', value: parts[1], from: div(a.store.visitors, a.storeDays), to: div(b.store.visitors, b.storeDays), unit: 'count' },
      { key: 'cr', label: 'Conversion Rate', value: parts[2], from: a.store.cr, to: b.store.cr, unit: 'pct' },
      { key: 'aov', label: 'AOV', value: parts[3], from: a.store.aov, to: b.store.aov, unit: 'idr' },
    ];
  })();

  const sources = SOURCES.map((s) => {
    const r0 = a.sources[s.key]?.revenue ?? 0;
    const r1 = b.sources[s.key]?.revenue ?? 0;
    const v0 = a.sources[s.key]?.views ?? 0;
    const v1 = b.sources[s.key]?.views ?? 0;
    return { key: s.key, label: s.label, from: r0, to: r1, value: r1 - r0, viewsFrom: v0, viewsTo: v1 };
  }).filter((s) => s.from || s.to);

  // Channels, from the model: what each channel's estimated contribution
  // did, then everything else (baseline + seasonality + unexplained).
  const byTarget = {};
  for (const t of TARGETS) {
    const ma = a.model[t.key];
    const mb = b.model[t.key];
    if (!ma || !mb) {
      byTarget[t.key] = null;
      continue;
    }
    const items = channels.map((c) => ({ key: c, label: LABEL[c], value: mb.contrib[c] - ma.contrib[c], from: ma.contrib[c], to: mb.contrib[c] }));
    items.push({ key: 'baseline', label: 'Organik & tren', value: mb.baseline - ma.baseline, from: ma.baseline, to: mb.baseline });
    items.push({ key: 'seasonal', label: 'Kalender (hari, tanggal kembar, gajian)', value: mb.seasonal - ma.seasonal, from: ma.seasonal, to: mb.seasonal });
    items.push({ key: 'residual', label: 'Tidak terjelaskan model', value: mb.residual - ma.residual, from: ma.residual, to: mb.residual });
    byTarget[t.key] = { from: ma.actual, to: mb.actual, partial: ma.days !== a.storeDays || mb.days !== b.storeDays, items };
  }

  return {
    from: a.month,
    to: b.month,
    revenueFrom: a.store.revenue,
    revenueTo: b.store.revenue,
    change: b.store.revenue - a.store.revenue,
    drivers,
    sources,
    channels: byTarget,
  };
}

// ── L4 Funnel diagnosis ───────────────────────────────────────────────────
// Each stage: how to compute it from a month's channel sums, which way is
// good, and what to do when it worsens.
const STAGES = {
  spend: { label: 'Spend', calc: (x) => x.spend, unit: 'idr', sentiment: 'neutral' },
  cpm: { label: 'CPM', calc: (x) => div(x.spend * 1000, x.impressions), unit: 'idr', sentiment: 'lower', advice: 'Biaya tayang naik — lelang lebih ketat atau audience terlalu sempit. Perluas audience, cek frekuensi, geser jadwal dari jam ramai.' },
  ctr: { label: 'CTR', calc: (x) => div(x.clicks, x.impressions), unit: 'pct', sentiment: 'higher', advice: 'Daya tarik materi menurun (creative fatigue). Ganti hook/visual, uji format baru, rotasi materi tiap 2–3 minggu.' },
  cpc: { label: 'CPC', calc: (x) => div(x.spend, x.clicks), unit: 'idr', sentiment: 'lower', advice: 'Harga per klik naik — gabungan CPM naik dan/atau CTR turun.' },
  views: { label: 'Produk dilihat', calc: (x) => x.views, unit: 'count', sentiment: 'higher', advice: 'Jangkauan iklan Shopee menyusut. Cek target ROAS GMV Max (terlalu tinggi membatasi tayangan) dan budget harian.' },
  cpv: { label: 'Biaya per 1.000 tayang', calc: (x) => div(x.spend * 1000, x.views), unit: 'idr', sentiment: 'lower', advice: 'Tayangan iklan Shopee makin mahal — persaingan kata kunci/kategori naik. Cek bid dan target ROAS, fokuskan ke produk dengan konversi tertinggi.' },
  viewCr: { label: 'Pesanan per 1.000 tayang', calc: (x) => (div(x.orders, x.views) == null ? null : div(x.orders, x.views) * 1000), unit: 'ratio1', sentiment: 'higher', advice: 'Tayangan iklan Shopee makin jarang jadi pesanan — cek foto utama, harga vs kompetitor, voucher, dan rating produk yang diiklankan.' },
  cvRate: { label: 'Content View ÷ klik', calc: (x) => div(x.contentViews, x.clicks), unit: 'pct', sentiment: 'higher', advice: 'Klik tidak berlanjut ke halaman produk — cek link katalog/produk yang mati atau lambat.' },
  atcRate: { label: 'ATC rate', calc: (x) => div(x.atc, x.clicks), unit: 'pct', sentiment: 'higher', advice: 'Minat setelah klik melemah — cek harga, varian/stok, dan relevansi produk di katalog dengan audience.' },
  cpatc: { label: 'Cost per ATC', calc: (x) => div(x.spend, x.atc), unit: 'idr', sentiment: 'lower', advice: 'ATC makin mahal — fokuskan budget ke produk dengan ATC rate tertinggi.' },
  purchaseRate: { label: 'Purchase rate (dari ATC)', calc: (x) => div(x.purchases, x.atc), unit: 'pct', sentiment: 'higher', advice: 'Keranjang tidak jadi dibayar — cek voucher, ongkir, dan kirim reminder (retargeting ATC tanpa beli).' },
  cr: { label: 'Conversion rate', calc: (x) => div(x.orders ?? x.purchases, x.clicks), unit: 'pct', sentiment: 'higher', advice: 'Klik tidak menjadi pesanan — cek harga vs kompetitor, voucher, stok, dan ulasan produk.' },
  aov: { label: 'AOV', calc: (x) => div(x.revenue ?? x.value, x.orders ?? x.purchases), unit: 'idr', sentiment: 'higher', advice: 'Nilai per pesanan turun — dorong bundling, voucher minimum belanja, atau produk bernilai lebih tinggi di iklan.' },
  roas: { label: 'ROAS (klaim platform)', calc: (x) => div(x.revenue ?? x.value, x.spend), unit: 'ratio', sentiment: 'higher', advice: 'Return yang diklaim turun.' },
};
const FUNNELS = {
  // Shopee's ad rows carry views and orders but no clicks.
  shopee_ads: ['spend', 'views', 'cpv', 'viewCr', 'aov', 'roas'],
  cpas: ['spend', 'cpm', 'ctr', 'cpc', 'cvRate', 'atcRate', 'cpatc', 'purchaseRate', 'aov', 'roas'],
  meta_boost: ['spend', 'cpm', 'ctr', 'cpc'],
  meta_nonboost: ['spend', 'cpm', 'ctr', 'cpc', 'atcRate', 'cpatc', 'purchaseRate', 'aov', 'roas'],
};
const ADVERSE = 0.1; // a stage moving the wrong way by more than 10% is flagged

function diagnoseChannel(c, prev, cur) {
  const stages = FUNNELS[c].map((key) => {
    const def = STAGES[key];
    const from = prev ? def.calc(prev) : null;
    const to = cur ? def.calc(cur) : null;
    const change = pctChange(from, to);
    const adverse = change == null || def.sentiment === 'neutral' ? 0 : def.sentiment === 'higher' ? -change : change;
    return { key, label: def.label, unit: def.unit, from, to, change, adverse: adverse > ADVERSE ? adverse : 0, advice: def.advice ?? null };
  });
  const worst = stages.filter((s) => s.adverse > 0).sort((a, b) => b.adverse - a.adverse)[0] ?? null;
  const spendUp = (pctChange(prev?.spend, cur?.spend) ?? 0) > ADVERSE;
  const roasStage = stages.find((s) => s.key === 'roas');
  const saturating = spendUp && roasStage && (roasStage.change ?? 0) < -ADVERSE;
  return {
    channel: c,
    label: LABEL[c],
    missing: !cur ? 'cur' : !prev ? 'prev' : null,
    stages,
    worst: worst ? { key: worst.key, label: worst.label, change: worst.change, advice: worst.advice } : null,
    note: saturating ? 'Spend naik tapi ROAS turun — tanda saturasi. Tahan kenaikan budget sampai efisiensi pulih.' : null,
  };
}

function buildDiagnosis(monthly, channels) {
  return monthly.map((m, i) => ({
    month: m.month,
    previous: i > 0 ? monthly[i - 1].month : null,
    // A month with no data for a channel is unknown, not zero.
    channels: channels.map((c) => {
      const known = (x) => (x && x.channels[c].days > 0 ? x.channels[c] : null);
      return diagnoseChannel(c, i > 0 ? known(monthly[i - 1]) : null, known(m));
    }),
  }));
}

// ── Leak matrix ───────────────────────────────────────────────────────────
function buildLeaks(models, recon, targetRoas) {
  const m = models.revenue;
  if (!m?.ok) return null;
  const totalSpend = m.channels.reduce((s, c) => s + c.spend, 0);
  const totalContrib = m.channels.reduce((s, c) => s + Math.max(c.contribution, 0), 0);
  return {
    targetRoas,
    from: m.from,
    to: m.to,
    rows: m.channels.map((c) => {
      const claim = recon.channels.find((r) => r.channel === c.channel);
      const leak = c.spend > 0 ? Math.max(0, c.spend - c.contribution / targetRoas) : 0;
      return {
        channel: c.channel,
        label: LABEL[c.channel],
        spend: c.spend,
        spendShare: div(c.spend, totalSpend),
        contribution: c.contribution,
        contributionShare: div(Math.max(c.contribution, 0), totalContrib),
        claimedRoas: claim?.claimedRoas ?? null,
        iroas: c.average,
        mroas: c.marginal,
        interval: c.interval,
        detected: c.detected,
        confidence: confidenceOf(c),
        leak,
        leakShare: div(leak, c.spend),
        scopeNote: SCOPE_NOTES[c.channel] ?? null,
      };
    }),
  };
}

// How sure the model is about a channel: the bootstrap's low end against its
// own average. 'tinggi' when even the pessimistic end keeps most of the
// effect, 'rendah' when the low end is near zero.
function confidenceOf(c) {
  if (!c.detected || !c.interval || c.average == null || c.average <= 0) return null;
  const ratio = c.interval.low / c.average;
  return ratio >= 0.6 ? 'tinggi' : ratio >= 0.25 ? 'sedang' : 'rendah';
}

// ── Levers: which channel moves each goal most for the next Rupiah ────────
function buildLevers(models, monthly) {
  // Store ATC per visitor from the months that have both — turns the
  // traffic model into ATC per Rupiah (PROXY: assumes a channel's visitors
  // add to cart at the shop's average rate).
  const withAtc = monthly.filter((m) => m.store.atc != null && m.store.visitors > 0);
  const atcPerVisitor = withAtc.length ? div(withAtc.reduce((s, m) => s + m.store.atc, 0), withAtc.reduce((s, m) => s + m.store.visitors, 0)) : null;
  const goal = (key, label, model, scale = 1, proxy = false) => {
    if (!model?.ok) return { key, label, ok: false };
    const rows = model.channels
      .map((c) => ({
        channel: c.channel,
        label: LABEL[c.channel],
        perMillion: c.marginal != null ? c.marginal * 1e6 * scale : null,
        averagePerMillion: c.average != null ? c.average * 1e6 * scale : null,
        detected: c.detected,
        saturating: c.alpha < 1,
        recentSpend: c.recentSpend,
        confidence: confidenceOf(c),
      }))
      .sort((a, b) => (b.perMillion ?? -1) - (a.perMillion ?? -1));
    return { key, label, ok: true, proxy, grade: model.grade, rows };
  };
  return [
    goal('revenue', 'Revenue', models.revenue),
    goal('visitors', 'Traffic', models.visitors),
    goal('orders', 'Pesanan', models.orders),
    atcPerVisitor != null ? goal('atc', 'Add to Cart', models.visitors, atcPerVisitor, true) : { key: 'atc', label: 'Add to Cart', ok: false },
  ];
}

// ── Budget move suggestion from the response curves ─────────────────────
function buildReallocation(models) {
  const m = models.revenue;
  if (!m?.ok) return null;
  const live = m.channels.filter((c) => c.recentSpend > 0 && c.marginal != null);
  if (live.length < 2) return null;
  const best = [...live].sort((a, b) => b.marginal - a.marginal)[0];
  const worst = [...live].sort((a, b) => a.marginal - b.marginal)[0];
  if (best.channel === worst.channel) return null;
  const at = (c, m2) => {
    // Interpolate the curve for a multiplier.
    const pts = c.curve;
    for (let i = 1; i < pts.length; i += 1) {
      if (m2 <= pts[i].multiplier) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const t = (m2 - p0.multiplier) / (p1.multiplier - p0.multiplier);
        return p0.outcome + t * (p1.outcome - p0.outcome);
      }
    }
    return pts[pts.length - 1].outcome;
  };
  const shift = Math.min(worst.recentSpend * 0.2, best.recentSpend * 0.5);
  if (!(shift > 0)) return null;
  const gain = at(best, 1 + shift / best.recentSpend) - at(best, 1);
  const loss = at(worst, 1) - at(worst, 1 - shift / worst.recentSpend);
  return {
    from: worst.channel,
    fromLabel: LABEL[worst.channel],
    to: best.channel,
    toLabel: LABEL[best.channel],
    amount: shift,
    windowDays: 30,
    expectedChange: gain - loss,
  };
}

// ── Notable days (spikes and drops the model did not expect) ─────────────
function buildEvents(models, days, channels) {
  const m = models.revenue;
  if (!m?.ok) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  return m.daily
    .filter((r) => Math.abs(r.z) >= 2)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, 10)
    .map((r) => {
      const d = byDate.get(r.date);
      return {
        date: r.date,
        actual: r.actual,
        expected: r.fitted,
        gap: r.residual,
        direction: r.residual > 0 ? 'up' : 'down',
        spend: Object.fromEntries(channels.map((c) => [c, d?.ch[c]?.spend ?? null])),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Plain-language findings ───────────────────────────────────────────────
function buildFindings({ recon, bridges, models, leaks, levers, diagnosis, realloc, monthly }) {
  const out = [];
  if (recon.overclaim != null && recon.overclaim > 1) {
    const top = [...recon.channels].sort((a, b) => (b.claim ?? 0) - (a.claim ?? 0))[0];
    out.push({
      kind: 'reconciliation',
      tone: 'warn',
      text: `Klaim semua platform dijumlah = ${fmtPct(recon.overclaim)} dari revenue toko. ${top.label} sendiri mengklaim ${fmtPct(top.claimShareOfRevenue ?? 0)} — ROAS antar platform tidak bisa dijumlah.`,
    });
  }
  const last = [...bridges].reverse().find((b) => b.channels.revenue && !b.channels.revenue.partial) ?? bridges[bridges.length - 1];
  if (last) {
    const dir = last.change >= 0 ? 'naik' : 'turun';
    const drivers = (last.drivers ?? []).filter((d) => d.key !== 'days').sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const main = drivers[0];
    let text = `Revenue ${fmtMonth(last.from)} → ${fmtMonth(last.to)} ${dir} ${fmtRp(Math.abs(last.change))}.`;
    if (main) text += ` Penggerak terbesar: ${main.label} (${main.value >= 0 ? '+' : '−'}${fmtRp(Math.abs(main.value))}).`;
    const ch = last.channels.revenue?.items.filter((i) => !['baseline', 'seasonal', 'residual'].includes(i.key)).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
    if (ch && Math.abs(ch.value) > Math.abs(last.change) * 0.1) text += ` Dari sisi channel, ${ch.label} menyumbang ${ch.value >= 0 ? '+' : '−'}${fmtRp(Math.abs(ch.value))} (ESTIMASI).`;
    out.push({ kind: 'bridge', tone: last.change >= 0 ? 'good' : 'bad', text });
  }
  if (leaks) {
    const worst = [...leaks.rows].sort((a, b) => b.leak - a.leak)[0];
    if (worst && worst.leak > 0) {
      out.push({
        kind: 'leak',
        tone: 'bad',
        text: `Kebocoran terbesar ke revenue Shopee: ${worst.label} — ${fmtRp(worst.leak)} spend (${fmtPct(worst.leakShare ?? 0)}) tidak ditebus revenue inkremental pada ROAS target ${leaks.targetRoas}x. Share spend ${fmtPct(worst.spendShare ?? 0)} vs share kontribusi ${fmtPct(worst.contributionShare ?? 0)} (ESTIMASI).${worst.scopeNote ? ` Catatan: ${worst.scopeNote}` : ''}`,
      });
    }
    const overclaimed = recon.channels.filter((c) => c.claimVsModel != null && c.claimVsModel > 1.2);
    for (const c of overclaimed) {
      out.push({ kind: 'reconciliation', tone: 'warn', text: `${c.label} mengklaim ${fmtRp(c.claim)}, sedangkan data toko hanya mendukung ±${fmtRp(c.modelContribution)} — klaim ${c.claimVsModel.toLocaleString('id-ID', { maximumFractionDigits: 1 })}× lebih besar (ESTIMASI). Sisanya kemungkinan penjualan yang tetap terjadi tanpa iklan.` });
    }
  }
  for (const g of levers.filter((l) => l.ok)) {
    const top = g.rows.find((r) => r.perMillion != null && r.perMillion > 0);
    if (!top) continue;
    const unit = g.key === 'revenue' ? fmtRp(top.perMillion) : `${top.perMillion.toLocaleString('id-ID', { maximumFractionDigits: 0 })} ${g.key === 'visitors' ? 'pengunjung' : g.key === 'orders' ? 'pesanan' : 'ATC'}`;
    const sure = top.confidence ? `, keyakinan ${top.confidence}` : '';
    out.push({ kind: 'lever', tone: 'good', text: `Untuk menaikkan ${g.label}: ${top.label} paling efektif — tiap tambahan Rp1 jt ≈ ${unit}${g.proxy ? ' (PROXY)' : ''} (ESTIMASI${sure}${top.saturating ? ', mulai jenuh' : ''}).` });
  }
  if (realloc && realloc.expectedChange > 0) {
    out.push({
      kind: 'realloc',
      tone: 'good',
      text: `Geser ${fmtJt(realloc.amount)} per 30 hari dari ${realloc.fromLabel} ke ${realloc.toLabel}: perkiraan revenue +${fmtRp(realloc.expectedChange)} dengan total spend tetap (ESTIMASI).`,
    });
  }
  const lastDiag = diagnosis[diagnosis.length - 1];
  if (lastDiag) {
    for (const d of lastDiag.channels.filter((x) => x.worst)) {
      out.push({ kind: 'funnel', tone: 'warn', text: `${d.label} ${fmtMonth(lastDiag.month)}: tahap paling memburuk ${d.worst.label} (${d.worst.change >= 0 ? '+' : ''}${fmtPct(d.worst.change)}). ${d.worst.advice}` });
    }
  }
  const m = models.revenue;
  if (m?.ok && m.grade === 'lemah') out.push({ kind: 'quality', tone: 'warn', text: `Model revenue masih lemah (R² ${m.r2?.toFixed(2)}, ${m.n} hari) — baca angka ESTIMASI sebagai arah, bukan angka pasti.` });
  const incomplete = monthly.filter((x) => !x.complete).map((x) => x.month);
  if (incomplete.length) out.push({ kind: 'quality', tone: 'muted', text: `Bulan dengan data belum lengkap: ${incomplete.map(fmtMonth).join(', ')}. Hari yang datanya kosong tidak ikut model, dan rekonsiliasi klaim hanya memakai bulan yang semua channelnya lengkap.` });
  return out;
}

// ── Entry point ───────────────────────────────────────────────────────────
export function analyzeAttribution(data, { targetRoas = 3, compareFrom = null, compareTo = null } = {}) {
  const { days, storeAtc = {} } = data;
  const channels = activeChannels(days);

  // Model rows: days where the shop and every running channel are known.
  const modelRows = days
    .filter((d) => d.store && channels.every((c) => d.ch[c] != null))
    .map((d) => ({
      date: d.date,
      y: { revenue: d.store.revenue, visitors: d.store.visitors, orders: d.store.orders },
      spend: Object.fromEntries(channels.map((c) => [c, d.ch[c].spend])),
    }));
  // Adstock needs an unbroken timeline: keep the longest consecutive run.
  const runs = [];
  for (const r of modelRows) {
    const last = runs[runs.length - 1];
    const prevDate = last ? last[last.length - 1].date : null;
    const next = prevDate ? new Date(Date.parse(`${prevDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : null;
    if (last && next === r.date) last.push(r);
    else runs.push([r]);
  }
  const series = runs.sort((a, b) => b.length - a.length)[0] ?? [];

  const models = Object.fromEntries(TARGETS.map((t) => [t.key, fitChannelModel(series, channels, t.key)]));
  const monthly = buildMonthly(days, channels, storeAtc, models);
  const recon = reconcile(monthly, channels, models);
  const bridges = monthly.slice(1).map((m, i) => bridge(monthly[i], m, channels));
  const diagnosis = buildDiagnosis(monthly, channels);
  const leaks = buildLeaks(models, recon, targetRoas);
  const levers = buildLevers(models, monthly);
  const realloc = buildReallocation(models);
  const events = buildEvents(models, days, channels);

  const expectedByDate = new Map((models.revenue?.ok ? models.revenue.daily : []).map((r) => [r.date, r.fitted]));
  const coverage = CHANNELS.map((c) => {
    const known = days.filter((d) => d.ch[c.key] != null);
    return {
      channel: c.key,
      label: c.label,
      active: channels.includes(c.key),
      first: known[0]?.date ?? null,
      last: known[known.length - 1]?.date ?? null,
      days: known.length,
      missingDays: days.filter((d) => d.store && d.ch[c.key] == null).length,
    };
  });

  const thread = analyzeThread(data, { monthly, channels }, { from: compareFrom, to: compareTo });

  return {
    brand: data.brand,
    from: data.from,
    to: data.to,
    thread,
    channels: CHANNELS.filter((c) => channels.includes(c.key)).map((c) => ({ ...c, scopeNote: SCOPE_NOTES[c.key] ?? null })),
    sources: SOURCES,
    targets: TARGETS,
    coverage,
    storeDays: days.filter((d) => d.store).length,
    monthly,
    reconciliation: recon,
    bridges,
    models: Object.fromEntries(Object.entries(models).map(([k, m]) => [k, m.ok ? { ...m, daily: undefined } : m])),
    daily: days.map((d) => ({
      date: d.date,
      revenue: d.store?.revenue ?? null,
      visitors: d.store?.visitors ?? null,
      spend: Object.fromEntries(channels.map((c) => [c, d.ch[c]?.spend ?? null])),
      expected: expectedByDate.get(d.date) ?? null,
    })),
    leaks,
    levers,
    reallocation: realloc,
    diagnosis,
    events,
    findings: buildFindings({ recon, bridges, models, leaks, levers, diagnosis, realloc, monthly }),
  };
}
