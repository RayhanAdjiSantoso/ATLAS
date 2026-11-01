import { isBoostCampaign } from '../../config/metaAdsMetrics.js';

// ===========================================================================
// Atribusi & Kebocoran Channel — data source (READ-ONLY)
// ===========================================================================
//
// Reads what ATLAS already stores and shapes it into the day series the
// engine (engine.js) takes. No writes, no new tables:
//
//   store        shopee.daily_order_performance, stage "Pesanan Dibuat" —
//                the shop's own revenue, orders and visitors per day.
//   sources      shopee.daily_channel_performance — where the sales came
//                from (Halaman Produk per sub-source, Live, Video, Affiliate)
//                and, separately, what "Iklan Shopee" claims with its spend.
//                Iklan Shopee overlaps the other sources (an ad click lands
//                on a product page), so it is read as a claim, never added
//                to them.
//   meta         public.meta_ads_insights_daily — MAIN split into Boost /
//                Non-Boost by the account's Kata Kunci Boost Post (the
//                global rule in config/metaAdsMetrics.js), CPAS whole.
//   store ATC    shopee.product_performance_summary — Add to Cart per month.
//   sales        public.daily_channel_sales — revenue per sales channel
//                (Shopee, website, TikTok, offline…) from Brand Tracking.
//   other spend  public.daily_channel_spend — channels Meta and Shopee's own
//                tables do not cover (GMV Max, TTAM, Google Ads, CPAS
//                Tokopedia).
//   meta rows    the Meta rows again at campaign × age × gender, for the
//                campaign / audience drill-down (thread.js).
//
// A channel's day is null (unknown), not 0, when it falls outside the
// channel's stored range or the day's rows are missing — NULL ≠ 0.

const STAGE_CREATED = 2; // Pesanan Dibuat

// Halaman Produk sub-sources kept apart; Live / Video / Affiliate read whole.
const PRODUCT_PAGE_SUBS = {
  Toko: 'pp_toko',
  Pencarian: 'pp_pencarian',
  Rekomendasi: 'pp_rekomendasi',
  Keranjang: 'pp_keranjang',
  Chat: 'pp_chat',
  Promosi: 'pp_promosi',
  'Pesanan Saya': 'pp_pesanan',
  Lainnya: 'pp_lainnya',
};
const WHOLE_CHANNELS = { 'Live Penjual': 'live', 'Video Penjual': 'video', Affiliate: 'affiliate' };

const num = (v) => (v == null ? 0 : Number(v) || 0);

// Spend channels read from Brand Tracking only — the rest come from Meta's
// and Shopee's own daily tables, which are more complete.
const OTHER_SPEND_KEYS = ['gmv_max', 'ttam', 'google_ads', 'cpas_tokopedia'];

function eachDate(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const emptyMeta = () => ({ spend: 0, impressions: 0, reach: 0, clicks: 0, atc: 0, purchases: 0, value: 0, contentViews: 0 });

export async function loadAttributionData(db, brandId, { from, to }) {
  const q = (sql, params) => db.query(sql, params).then((r) => r.rows);

  const [brandRows, storeRows, sourceRows, metaRows, metaRange, accounts, atcRows, salesRows, otherSpendRows] = await Promise.all([
    q('SELECT brand_id, brand_name FROM public.brands WHERE brand_id = $1', [brandId]),
    q(
      `SELECT to_char(report_date, 'YYYY-MM-DD') AS d, total_sales_idr, total_orders, total_visitors, products_clicked,
              total_buyers, new_buyers
         FROM shopee.daily_order_performance
        WHERE brand_id = $1 AND stage_id = $2 AND report_date BETWEEN $3 AND $4`,
      [brandId, STAGE_CREATED, from, to],
    ),
    q(
      `SELECT to_char(p.report_date, 'YYYY-MM-DD') AS d, tc.channel_name AS ch, ss.sub_source_name AS sub,
              p.sales_idr, p.total_orders, p.products_viewed, p.products_clicked, p.ad_spend_idr
         FROM shopee.daily_channel_performance p
         JOIN shopee.traffic_channels tc ON tc.channel_id = p.channel_id
         JOIN shopee.traffic_sub_sources ss ON ss.sub_source_id = p.sub_source_id
        WHERE p.brand_id = $1 AND p.stage_id = $2 AND p.report_date BETWEEN $3 AND $4`,
      [brandId, STAGE_CREATED, from, to],
    ),
    q(
      `SELECT to_char(entry_date, 'YYYY-MM-DD') AS d, account_type, ad_account_id, campaign_name, objective, age, gender,
              SUM(amount_spent) AS spend, SUM(impressions) AS impressions, SUM(reach) AS reach,
              SUM(link_clicks) AS clicks, SUM(purchases) AS purchases, SUM(purchase_value) AS value,
              SUM((metrics->>'adds_to_cart')::numeric) AS atc,
              SUM((metrics->>'content_views')::numeric) AS cv,
              SUM((metrics->>'shared_adds_to_cart')::numeric) AS s_atc,
              SUM((metrics->>'shared_purchases')::numeric) AS s_purchases,
              SUM((metrics->>'shared_purchase_value')::numeric) AS s_value,
              SUM((metrics->>'shared_content_views')::numeric) AS s_cv
         FROM public.meta_ads_insights_daily
        WHERE brand_id = $1 AND entry_date BETWEEN $2 AND $3
        GROUP BY 1, 2, 3, 4, 5, 6, 7`,
      [brandId, from, to],
    ),
    q(
      `SELECT account_type, to_char(MIN(entry_date), 'YYYY-MM-DD') AS first, to_char(MAX(entry_date), 'YYYY-MM-DD') AS last
         FROM public.meta_ads_insights_daily WHERE brand_id = $1 GROUP BY 1`,
      [brandId],
    ),
    q('SELECT ad_account_id, account_type, boost_keyword FROM public.brand_ad_accounts WHERE brand_id = $1', [brandId]),
    q(
      `SELECT to_char(rp.period_start, 'YYYY-MM') AS m, to_char(rp.period_start, 'YYYY-MM-DD') AS a, to_char(rp.period_end, 'YYYY-MM-DD') AS z,
              SUM(s.cart_adds) AS cart_adds, SUM(s.cart_visitors) AS cart_visitors, SUM(s.product_page_visitors) AS pp_visitors
         FROM shopee.product_performance_summary s
         JOIN shopee.report_periods rp ON rp.period_id = s.period_id
        WHERE s.brand_id = $1 AND rp.period_start >= $2::date - INTERVAL '1 month' AND rp.period_end <= $3::date + INTERVAL '1 month'
        GROUP BY 1, 2, 3`,
      [brandId, from, to],
    ),
    q(
      `SELECT to_char(entry_date, 'YYYY-MM-DD') AS d, channel_key, revenue, transaksi
         FROM public.daily_channel_sales WHERE brand_id = $1 AND entry_date BETWEEN $2 AND $3`,
      [brandId, from, to],
    ),
    q(
      `SELECT to_char(entry_date, 'YYYY-MM-DD') AS d, channel_key, amount_spent
         FROM public.daily_channel_spend
        WHERE brand_id = $1 AND entry_date BETWEEN $2 AND $3 AND channel_key = ANY($4)`,
      [brandId, from, to, OTHER_SPEND_KEYS],
    ),
  ]);

  const dates = eachDate(from, to);
  const days = new Map(dates.map((d) => [d, { date: d, store: null, sources: null, ch: { shopee_ads: null, meta_boost: null, meta_nonboost: null, cpas: null } }]));

  for (const r of storeRows) {
    const day = days.get(r.d);
    if (!day) continue;
    day.store = {
      revenue: num(r.total_sales_idr),
      orders: num(r.total_orders),
      visitors: num(r.total_visitors),
      clicks: num(r.products_clicked),
      buyers: num(r.total_buyers),
      newBuyers: num(r.new_buyers),
    };
  }

  for (const r of sourceRows) {
    const day = days.get(r.d);
    if (!day) continue;
    const row = { revenue: num(r.sales_idr), orders: num(r.total_orders), views: num(r.products_viewed), clicks: num(r.products_clicked) };
    if (r.ch === 'Iklan Shopee') {
      const ads = (day.ch.shopee_ads ??= { spend: 0, revenue: 0, orders: 0, views: 0, clicks: 0, bySub: {} });
      const spend = num(r.ad_spend_idr);
      ads.spend += spend;
      ads.revenue += row.revenue;
      ads.orders += row.orders;
      ads.views += row.views;
      ads.clicks += row.clicks;
      const sub = (ads.bySub[r.sub] ??= { spend: 0, revenue: 0, orders: 0, views: 0, clicks: 0 });
      sub.spend += spend;
      sub.revenue += row.revenue;
      sub.orders += row.orders;
      sub.views += row.views;
      sub.clicks += row.clicks;
      continue;
    }
    const key = r.ch === 'Halaman Produk' ? PRODUCT_PAGE_SUBS[r.sub] : r.sub === 'Semua' ? WHOLE_CHANNELS[r.ch] : null;
    if (!key) continue;
    day.sources ??= {};
    day.sources[key] = row;
  }

  // Meta: a day inside the account type's stored range with no rows had no
  // delivery (0); outside the range it is unknown (null).
  const rangeOf = Object.fromEntries(metaRange.map((r) => [r.account_type, r]));
  const keywordOf = new Map(accounts.filter((a) => a.account_type === 'MAIN').map((a) => [a.ad_account_id, a.boost_keyword]));
  for (const d of dates) {
    const day = days.get(d);
    const main = rangeOf.MAIN;
    if (main && d >= main.first && d <= main.last) {
      day.ch.meta_boost = emptyMeta();
      day.ch.meta_nonboost = emptyMeta();
    }
    const cpas = rangeOf.CPAS;
    if (cpas && d >= cpas.first && d <= cpas.last) day.ch.cpas = emptyMeta();
  }
  const metaDetail = [];
  for (const r of metaRows) {
    const day = days.get(r.d);
    if (!day) continue;
    const isCpas = r.account_type === 'CPAS';
    const key = isCpas ? 'cpas' : isBoostCampaign(r.campaign_name, keywordOf.get(r.ad_account_id)) ? 'meta_boost' : 'meta_nonboost';
    metaDetail.push({
      d: r.d,
      channel: key,
      campaign: r.campaign_name ?? '',
      objective: r.objective ?? '',
      age: r.age || 'Unknown',
      gender: r.gender || 'unknown',
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      atc: isCpas ? num(r.s_atc) : num(r.atc),
      purchases: isCpas ? num(r.s_purchases) : num(r.purchases),
      value: isCpas ? num(r.s_value) : num(r.value),
      contentViews: isCpas ? num(r.s_cv) : num(r.cv),
    });
    const m = (day.ch[key] ??= emptyMeta());
    m.spend += num(r.spend);
    m.impressions += num(r.impressions);
    m.reach += num(r.reach);
    m.clicks += num(r.clicks);
    // CPAS reports the Shopee catalog's events as "shared_*".
    m.atc += isCpas ? num(r.s_atc) : num(r.atc);
    m.purchases += isCpas ? num(r.s_purchases) : num(r.purchases);
    m.value += isCpas ? num(r.s_value) : num(r.value);
    m.contentViews += isCpas ? num(r.s_cv) : num(r.cv);
  }

  // Store ATC per calendar month (only whole-month Product Performance files).
  const storeAtc = {};
  for (const r of atcRows) {
    const [y, mo] = r.m.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (r.a !== `${r.m}-01` || r.z !== `${r.m}-${String(lastDay).padStart(2, '0')}`) continue;
    storeAtc[r.m] = { cartAdds: num(r.cart_adds), cartVisitors: num(r.cart_visitors), productPageVisitors: num(r.pp_visitors) };
  }

  // Revenue per sales channel per day (Brand Tracking).
  const sales = {};
  for (const r of salesRows) {
    if (!days.has(r.d)) continue;
    (sales[r.channel_key] ??= {})[r.d] = { revenue: num(r.revenue), transactions: num(r.transaksi) };
  }
  const otherSpend = {};
  for (const r of otherSpendRows) {
    if (!days.has(r.d)) continue;
    (otherSpend[r.channel_key] ??= {})[r.d] = num(r.amount_spent);
  }

  return {
    sales,
    otherSpend,
    metaDetail,
    brand: brandRows[0] ? { id: brandRows[0].brand_id, name: brandRows[0].brand_name } : null,
    from,
    to,
    days: [...days.values()],
    storeAtc,
    metaAccounts: { main: Boolean(rangeOf.MAIN), cpas: Boolean(rangeOf.CPAS), boostKeyword: [...keywordOf.values()].some(Boolean) },
  };
}
