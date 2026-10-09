import { safeDiv, withRatios, pctChange } from './googleAdsAnalytics.js';
import { RULES, CONFIDENCE, RULESET_VERSION, volumeTier } from './googleAdsRules.js';

// Rule-based reading of the Google Ads numbers: keyword and search term
// classification, campaign diagnostics, daily anomalies, and the device,
// hour, landing page and ad views. Pure functions over report rows, shared
// by the report, the exports and (later) the AI Consultant — the AI gets
// these findings, it does not recompute them.
//
// What every rule here respects:
//   - too little data gives "insufficient data" / "monitoring", never a
//     verdict (3 clicks without a conversion is not a bad keyword);
//   - without a client target, the comparison point is a historical
//     baseline (the campaign's own CPA), labelled as such — it is not a
//     profitability threshold;
//   - a finding separates what the numbers show (facts) from what might
//     explain them (possible causes), and a change made in the same period
//     is listed as context, never as proof of cause.

// Thresholds live in googleAdsRules.js (versioned, with a calibration log).
export { RULES } from './googleAdsRules.js';

const SMART_BIDDING = new Set(['MAXIMIZE_CONVERSIONS', 'TARGET_CPA', 'MAXIMIZE_CONVERSION_VALUE', 'TARGET_ROAS']);
const CONVERSION_BIDDING = SMART_BIDDING;
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const ckey = (r) => `${r.customer_id}|${r.campaign_id}`;
// Small rates keep two decimals so 0.47% → 0.33% does not read as 0.5% → 0.3%.
const pct = (v) => (v == null ? 'N/A' : `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 2 : 1)}%`);

// Money in a finding's text, in the report's own currency (the same prefix
// and locale the report UI uses). Without a single currency, a bare number.
const CURRENCY = { MYR: ['RM', 'en-MY', 2], IDR: ['Rp', 'id-ID', 0], SGD: ['S$', 'en-SG', 2], USD: ['$', 'en-US', 2] };
export function moneyFormatter(currency) {
  const [prefix, locale, digits] = CURRENCY[currency] ?? [currency ? `${currency} ` : '', 'id-ID', 2];
  return (v) => (v == null ? 'N/A' : `${prefix}${Number(v).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);
}
const fmt = (v, d = 2) => (v == null ? 'N/A' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }));

// ── baselines ───────────────────────────────────────────────────────
// What a campaign's keywords and search terms are compared with: the
// campaign's target CPA when it has one, else its own CPA over the period
// (a historical baseline), else the account's.
export function campaignBaselines(campaigns, settings = []) {
  const targets = new Map(settings.filter((s) => s.target_cpa).map((s) => [ckey(s), s.target_cpa]));
  const totals = campaigns.reduce((a, c) => ({ cost: a.cost + c.cost, conv: a.conv + c.conversions, clicks: a.clicks + c.clicks }), { cost: 0, conv: 0, clicks: 0 });
  const account = { cpa: safeDiv(totals.cost, totals.conv), cvr: safeDiv(totals.conv, totals.clicks), source: 'account_average' };
  const byKey = new Map();
  const byName = new Map();
  for (const c of campaigns) {
    const target = targets.get(ckey(c));
    const own = safeDiv(c.cost, c.conversions);
    const b = {
      cpa: target ?? (c.conversions >= 1 ? own : account.cpa),
      cvr: c.clicks >= 50 && c.conversions > 0 ? safeDiv(c.conversions, c.clicks) : account.cvr,
      source: target ? 'target_cpa' : c.conversions >= 1 ? 'campaign_average' : 'account_average',
    };
    byKey.set(ckey(c), b);
    byName.set(String(c.campaign_name).toLowerCase(), b);
  }
  return { account, byKey, byName, of: (row) => byKey.get(ckey(row)) ?? byName.get(String(row.campaign_name ?? '').toLowerCase()) ?? account };
}

export const BASELINE_LABEL = {
  target_cpa: 'Target CPA campaign',
  campaign_average: 'CPA rata-rata campaign periode ini (baseline historis, bukan batas profitabilitas)',
  account_average: 'CPA rata-rata akun periode ini (baseline historis, bukan batas profitabilitas)',
};

// ── keywords ────────────────────────────────────────────────────────
export const KEYWORD_CLASSES = ['performing', 'high_potential', 'underperforming', 'no_conversion', 'insufficient_data'];

export function classifyKeyword(k, baseline, rules = RULES.keyword) {
  const r = withRatios(k);
  const reasons = [];
  const expected = baseline?.cvr != null ? r.clicks * baseline.cvr : null;
  let status;
  if (r.conversions === 0) {
    const tooLittle = r.clicks < rules.minClicks
      || (expected != null && expected < rules.minExpectedConversions)
      || (baseline?.cpa != null && r.cost < baseline.cpa);
    if (tooLittle) {
      status = 'insufficient_data';
      reasons.push(`${fmt(r.clicks, 0)} klik tanpa konversi — belum cukup untuk disimpulkan${expected != null ? ` (perkiraan ${fmt(expected, 1)} konversi pada CVR baseline)` : ''}`);
    } else {
      status = 'no_conversion';
      reasons.push(`${fmt(r.clicks, 0)} klik dan biaya ≥ 1× CPA baseline tanpa konversi`);
    }
  } else if (baseline?.cpa == null) {
    status = r.conversions >= rules.minConversions ? 'performing' : 'insufficient_data';
    reasons.push('Belum ada baseline CPA pembanding');
  } else {
    const ratio = r.cost_per_conv / baseline.cpa;
    if (ratio <= rules.goodCpaRatio) {
      if (r.conversions < rules.minConversions) {
        status = 'high_potential';
        reasons.push(`CPA ${fmt(ratio, 2)}× baseline dengan volume masih kecil (${fmt(r.conversions)} konversi)`);
      } else if ((r.search_lost_top_is_rank ?? 0) >= rules.roomLostRankIs) {
        status = 'high_potential';
        reasons.push(`CPA efisien (${fmt(ratio, 2)}× baseline) dan kehilangan ${pct(r.search_lost_top_is_rank)} top IS karena rank`);
      } else {
        status = 'performing';
        reasons.push(`CPA ${fmt(ratio, 2)}× baseline dengan ${fmt(r.conversions)} konversi`);
      }
    } else if (ratio > rules.poorCpaRatio && r.clicks >= rules.minClicks) {
      status = 'underperforming';
      reasons.push(`CPA ${fmt(ratio, 2)}× baseline`);
    } else {
      status = 'performing';
      reasons.push(`CPA ${fmt(ratio, 2)}× baseline — masih dalam toleransi`);
    }
  }
  const quality = [];
  if (k.quality_score != null && k.quality_score <= rules.lowQualityScore) quality.push(`Quality Score ${k.quality_score}`);
  if (k.ad_relevance === 'BELOW_AVERAGE') quality.push('Ad relevance di bawah rata-rata');
  if (k.landing_page_experience === 'BELOW_AVERAGE') quality.push('Landing page experience di bawah rata-rata');
  if (k.expected_ctr === 'BELOW_AVERAGE') quality.push('Expected CTR di bawah rata-rata');
  return { ...r, classification: status, reasons, quality_flags: quality, suggested_action: keywordAction(status, k, quality) };
}

function keywordAction(status, k, quality) {
  const fixes = [];
  if (k.ad_relevance === 'BELOW_AVERAGE') fixes.push('masukkan keyword ke headline iklan ad group ini');
  if (k.landing_page_experience === 'BELOW_AVERAGE') fixes.push('periksa kecocokan dan kecepatan landing page');
  if (k.expected_ctr === 'BELOW_AVERAGE') fixes.push('uji headline yang lebih spesifik');
  const fix = fixes.length ? ` Prioritas perbaikan: ${fixes.join('; ')}.` : '';
  switch (status) {
    case 'performing': return `Pertahankan dan pantau CPA.${fix}`;
    case 'high_potential':
      return (k.search_lost_top_is_rank ?? 0) >= RULES.keyword.roomLostRankIs
        ? `Evaluasi bid atau kualitas iklan untuk merebut impresi yang hilang karena rank — sesuaikan dengan strategi bidding campaign.${fix}`
        : `Biarkan berjalan untuk mengumpulkan data; jangan dijeda.${fix}`;
    case 'underperforming':
      return k.match_type === 'BROAD'
        ? `Tinjau search term yang dipicu; pertimbangkan phrase/exact atau negative keyword.${fix}`
        : `Tinjau relevansi iklan dan landing page sebelum menurunkan prioritas.${fix}${quality.length ? '' : ' Quality Score bukan satu-satunya dasar keputusan.'}`;
    case 'no_conversion': return `Tinjau search term yang dipicu dan landing page sebelum menjeda.${fix}`;
    default: return 'Data belum cukup — pantau, jangan disimpulkan.';
  }
}

// ── search terms ────────────────────────────────────────────────────
export const SEARCH_TERM_CLASSES = [
  'high_intent', 'new_keyword_opportunity', 'potential_negative', 'informational', 'competitor', 'location_mismatch', 'requires_review', 'monitoring',
];

const INFORMATIONAL = /\b(cara|how to|what is|apa itu|arti|meaning|tutorial|diy|gambar|wallpaper|gratis|free|lowongan|loker|kerja|jobs?|kursus|course|resep|definisi|sejarah|history)\b/i;
const tokens = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9À-ɏ]+/).filter((t) => t.length >= 3);
const STOP = new Set(['the', 'and', 'for', 'dan', 'yang', 'untuk', 'dengan', 'near', 'terdekat', 'online', 'com', 'www', 'https', 'http']);

// Competitors from Auction Insights domains: "bloomthis.co" -> "bloomthis".
export function competitorTokens(domains = [], ownTokens = []) {
  const own = new Set(ownTokens);
  return [...new Set(domains
    .map((d) => String(d).toLowerCase().replace(/^www\./, '').split('.')[0])
    .filter((t) => t.length >= 4 && !own.has(t)))];
}

// ctx: { baselines, keywords: Set(lowercase keyword text), competitors: [token],
//        ownTokens: [token], locationsByCampaign: Map(name → [lowercase location]),
//        knownLocations: [lowercase name] }
export function classifySearchTerm(t, ctx, rules = RULES.searchTerm) {
  const r = withRatios(t);
  const term = String(t.search_term ?? '').toLowerCase();
  const baseline = ctx.baselines.of(t);
  const reasons = [];
  let cls;
  const own = ctx.ownTokens?.some((o) => term.includes(o));
  const competitor = !own && ctx.competitors?.find((c) => term.includes(c));
  const included = ctx.locationsByCampaign?.get(String(t.campaign_name ?? '').toLowerCase()) ?? [];
  const mentioned = (ctx.knownLocations ?? []).find((loc) => loc.length >= 4 && new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(term));
  const locationMismatch = mentioned && included.length && !included.some((inc) => inc.includes(mentioned) || mentioned.includes(inc));

  if (INFORMATIONAL.test(term)) {
    cls = 'informational';
    reasons.push('Pola pencarian informasional');
  } else if (competitor) {
    cls = 'competitor';
    reasons.push(`Memuat nama kompetitor dari Auction Insights ("${competitor}")`);
  } else if (locationMismatch) {
    cls = 'location_mismatch';
    reasons.push(`Menyebut "${mentioned}", di luar lokasi target campaign (${included.join(', ')})`);
  } else if (r.conversions > 0) {
    const efficient = baseline.cpa != null && r.cost_per_conv <= baseline.cpa * rules.opportunityMaxCpaRatio;
    const isKeyword = ctx.keywords?.has(term);
    if (efficient && !isKeyword && !['EXACT', 'NEAR_EXACT'].includes(t.match_type)) {
      cls = 'new_keyword_opportunity';
      reasons.push(`Konversi dengan CPA ≤ baseline dan belum menjadi keyword sendiri`);
    } else {
      cls = 'high_intent';
      reasons.push(`${fmt(r.conversions)} konversi`);
    }
  } else if (own) {
    cls = 'monitoring';
    reasons.push('Pencarian brand sendiri — jangan dijadikan negative');
  } else if (r.clicks >= rules.minClicks && baseline.cpa != null && r.cost >= baseline.cpa * rules.negativeMinCostVsCpa) {
    cls = 'potential_negative';
    reasons.push(`${fmt(r.clicks, 0)} klik dan biaya ≥ 1× CPA baseline tanpa konversi`);
  } else if (r.clicks >= rules.minClicks / 2) {
    cls = 'requires_review';
    reasons.push('Belum ada konversi; volume mulai berarti');
  } else {
    cls = 'monitoring';
    reasons.push('Data belum cukup');
  }
  if (r.conversions > 0 && ['informational', 'competitor', 'location_mismatch'].includes(cls)) {
    reasons.push(`Tetap menghasilkan ${fmt(r.conversions)} konversi — jangan dijadikan negative tanpa review`);
  }
  return { ...r, classification: cls, reasons, suggested_action: termAction(cls, r) };
}

function termAction(cls, r) {
  const converting = r.conversions > 0;
  switch (cls) {
    case 'new_keyword_opportunity': return 'Tambahkan sebagai keyword (phrase/exact) di ad group yang relevan.';
    case 'high_intent': return 'Pertahankan.';
    case 'potential_negative': return 'Review konteks; jika tidak relevan dengan produk/layanan, tambahkan sebagai negative keyword.';
    case 'informational': return converting ? 'Pantau; jangan dinegatifkan karena masih berkonversi.' : 'Pertimbangkan negative keyword setelah review.';
    case 'competitor': return converting ? 'Pantau biaya; pencarian kompetitor masih berkonversi.' : 'Putuskan kebijakan bidding nama kompetitor; pertimbangkan negative.';
    case 'location_mismatch': return 'Periksa apakah lokasi ini dilayani; jika tidak, tambahkan negative atau perbaiki target lokasi.';
    case 'requires_review': return 'Review relevansi.';
    default: return 'Pantau.';
  }
}

// Spend labels, each exactly what it says: observed (no conversion seen),
// potentially irrelevant (rules flag it), confirmed (a person said so —
// none until the review flow exists, so null, not 0).
export function searchTermSummary(classified, searchCampaignCost, rules = RULES.searchTerm) {
  const termCost = classified.reduce((a, t) => a + t.cost, 0);
  const noConv = classified.filter((t) => t.conversions === 0);
  const flagged = new Set(['potential_negative', 'informational', 'competitor', 'location_mismatch']);
  const coverage = safeDiv(termCost, searchCampaignCost);
  const byClass = Object.fromEntries(SEARCH_TERM_CLASSES.map((c) => [c, { terms: 0, cost: 0, conversions: 0 }]));
  for (const t of classified) {
    byClass[t.classification].terms += 1;
    byClass[t.classification].cost += t.cost;
    byClass[t.classification].conversions += t.conversions;
  }
  return {
    observed_no_conversion_spend: noConv.reduce((a, t) => a + t.cost, 0),
    potentially_irrelevant_spend: noConv.filter((t) => flagged.has(t.classification)).reduce((a, t) => a + t.cost, 0),
    confirmed_irrelevant_spend: null,
    search_term_cost: termCost,
    search_campaign_cost: searchCampaignCost,
    coverage,
    coverage_warning: coverage != null && coverage < rules.coverageWarn
      ? `Search term hanya menjelaskan ${pct(coverage)} biaya campaign Search/Shopping — Google menyembunyikan pencarian bervolume kecil demi privasi.`
      : null,
    by_class: byClass,
    negative_candidates: classified
      .filter((t) => t.conversions === 0 && flagged.has(t.classification))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, RULES.report.maxNegativeCandidates)
      .map((t) => ({ text: t.search_term, classification: t.classification, cost: t.cost, campaign_name: t.campaign_name ?? '' })),
  };
}

// ── confidence ──────────────────────────────────────────────────────
const TIER_LABEL = { low: 'rendah', medium: 'sedang', high: 'tinggi' };
const clickTier = (clicks) => (clicks < 300 ? 'low' : clicks < 1000 ? 'medium' : 'high');

// How strongly the data supports a finding, 0–100, with the reasons. Starts
// from the volume of the smaller of the two periods (conversions for
// conversion findings, clicks otherwise), then each weakness subtracts:
// a dataset that is partial or inconsistent, unhealthy conversion tracking,
// a campaign too young to judge, other changes made in the same period.
export function scoreConfidence({
  conversions = 0, clicks = 0, conversionBased = true, supporting = 0, dataQualityIssue = null, trackingUnhealthy = false,
  newCampaignDays = null, overlappingChanges = 0,
}, cfg = CONFIDENCE) {
  const tier = conversionBased ? volumeTier(conversions) : clickTier(clicks);
  let score = cfg.volume[tier];
  const reasons = [conversionBased ? `Volume ${TIER_LABEL[tier]}: ${fmt(conversions)} konversi` : `Volume ${TIER_LABEL[tier]}: ${fmt(clicks, 0)} klik`];
  if (supporting > 0) { score += Math.min(2, supporting) * cfg.bonusSupportingMetric; reasons.push(`${supporting} metrik lain menunjukkan arah yang sama`); }
  if (dataQualityIssue) { score -= cfg.penaltyDataQuality; reasons.push(dataQualityIssue); }
  if (trackingUnhealthy && conversionBased) { score -= cfg.penaltyTracking; reasons.push('Tracking konversi bermasalah — angka konversi belum dapat dipercaya penuh'); }
  if (newCampaignDays != null) { score -= cfg.penaltyNewCampaign; reasons.push(`Campaign baru berjalan ${newCampaignDays} hari`); }
  if (overlappingChanges > 0) { score -= cfg.penaltyOverlappingChanges; reasons.push(`${overlappingChanges} perubahan akun di periode yang sama`); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= cfg.levels.high ? 'high' : score >= cfg.levels.medium ? 'medium' : 'low';
  return { score, level, tier, reasons };
}

// ── campaign diagnostics ────────────────────────────────────────────
const perDay = (v, days) => (days ? v / days : null);
const daysSince = (from, to) => (from && to ? Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 864e5) + 1 : null);

// input: { old, cur } each { campaigns: [...withRatios rows], totals, days },
//        settings, competitive (period shares), changes, settingChanges,
//        trackingHealth: Map(campaign key | 'account' → { healthy, score }),
//        dataQuality: { conversionIssue?: string, partial?: string[] },
//        curEnd: 'YYYY-MM-DD' (campaign age), currency.
//
// Every rule has its own minimum sample in both periods (googleAdsRules
// RULES.campaign); a finding whose confidence comes out low is returned as
// status 'monitoring' — "data masih terbatas, pantau sebelum bertindak" —
// except tracking problems, which are configuration facts, not trends.
export function diagnoseCampaigns(input, rules = RULES.campaign) {
  const { old, cur } = input;
  const settings = new Map((input.settings ?? []).map((s) => [ckey(s), s]));
  const shares = new Map((input.competitive ?? []).map((s) => [ckey(s), s]));
  const oldBy = new Map(old.campaigns.map((c) => [ckey(c), c]));
  const tracking = input.trackingHealth ?? new Map();
  const quality = input.dataQuality ?? {};
  const changesBy = new Map();
  for (const ch of input.changes ?? []) {
    const k = String(ch.campaign_name ?? '').toLowerCase();
    if (!k) continue;
    if (!changesBy.has(k)) changesBy.set(k, []);
    changesBy.get(k).push(String(ch.changed_at).slice(0, 10));
  }
  for (const ch of input.settingChanges ?? []) {
    const k = String(ch.campaign_name ?? '').toLowerCase();
    if (!changesBy.has(k)) changesBy.set(k, []);
    changesBy.get(k).push(`${new Date(ch.valid_from).toISOString().slice(0, 10)} (setting: ${(ch.changed_fields ?? []).map((f) => f.field).join(', ')})`);
  }
  const allChanges = [...changesBy.values()].flat();
  const accountCpa = safeDiv(cur.totals.cost, cur.totals.conversions);
  const money = moneyFormatter(input.currency);
  const findings = [];

  const evaluate = (entity, o, c, s, share) => {
    const changes = entity.type === 'account' ? allChanges : changesBy.get(String(entity.name).toLowerCase()) ?? [];
    const th = tracking.get(entity.key);
    const trackingUnhealthy = th ? !th.healthy : false;
    const age = s?.start_date ? daysSince(s.start_date, input.curEnd) : null;
    const newCampaignDays = age != null && age < rules.newCampaignDays ? age : null;
    const activeDays = c.active_days ?? cur.days;

    const add = (type, severity, facts, causes, steps, metrics = {}, { conversionBased = true, supporting = 0, sticky = false, dataset = null } = {}) => {
      const conf = scoreConfidence({
        conversions: Math.min(o?.conversions ?? c.conversions, c.conversions),
        clicks: Math.min(o?.clicks ?? c.clicks, c.clicks),
        conversionBased, supporting, trackingUnhealthy: trackingUnhealthy && type !== 'tracking_no_primary_conversion',
        dataQualityIssue: (conversionBased && quality.conversionIssue) || (dataset && quality.partial?.includes(dataset) ? `Dataset ${dataset} belum lengkap untuk periode ini` : null),
        newCampaignDays, overlappingChanges: new Set(changes).size,
      });
      const monitoring = !sticky && conf.level === 'low';
      findings.push({
        id: `${type}:${entity.key}`,
        entity_type: entity.type, entity_id: entity.id, entity_name: entity.name, customer_id: entity.customer_id ?? null,
        type, severity: monitoring && severity !== 'critical' ? 'low' : severity,
        status: monitoring ? 'monitoring' : 'diagnosis',
        confidence: conf.level, confidence_score: conf.score, confidence_reasons: conf.reasons, volume_tier: conf.tier,
        ruleset_version: RULESET_VERSION,
        period: { old: input.oldLabel ?? null, cur: input.curLabel ?? null },
        metrics,
        facts: monitoring ? [...facts, 'Data masih terbatas — pantau sebelum mengambil tindakan'] : facts,
        possible_causes: changes.length
          ? [...causes, `Ada perubahan di akun pada ${[...new Set(changes)].slice(0, 5).join(', ')} — bisa berkaitan, tetapi bukan bukti sebab-akibat`]
          : causes,
        next_steps: monitoring ? ['Pantau sampai volume data cukup; belum disarankan mengubah setting berdasarkan temuan ini'] : steps,
      });
    };
    const m = (name, a, b) => ({ [name]: { old: a ?? null, cur: b ?? null, change: pctChange(a, b).value } });

    // Tracking: bidding on conversions with none counted. A configuration
    // fact — stays critical whatever the volume.
    const strategy = s?.bidding_strategy_type;
    if (c.cost > 0 && c.conversions === 0 && c.all_conversions > 0 && (!s || CONVERSION_BIDDING.has(strategy))) {
      add('tracking_no_primary_conversion', 'critical',
        [`Conversions 0 sementara All conv. ${fmt(c.all_conversions)} dengan biaya ${money(c.cost)}`, ...(strategy ? [`Strategi bidding: ${strategy} — Smart Bidding tidak memiliki primary conversion yang valid untuk dioptimalkan`] : [])],
        ['Conversion action penjualan/lead berstatus secondary atau dihapus', 'Campaign goal tidak memuat action yang dihitung'],
        ['Periksa Goals › Conversions: jadikan action utama (mis. Purchase) primary bila itu event bisnisnya', 'Pastikan campaign memakai goal yang memuat action tersebut', 'Tunda optimasi budget/bidding sampai tracking diperbaiki'],
        m('conversions', o?.conversions, c.conversions), { sticky: true });
    }
    const stop = rules.conversions_stopped;
    if (o && o.conversions >= stop.minPrevConversions && (o.active_days ?? old.days) >= stop.minPrevDays && c.conversions === 0 && c.clicks >= stop.minClicks) {
      add('conversions_stopped', 'critical',
        [`Konversi turun dari ${fmt(o.conversions)} ke 0 dengan ${fmt(c.clicks, 0)} klik`],
        ['Tag konversi rusak atau berubah', 'Perubahan landing page atau checkout', 'Perubahan goal/primary action'],
        ['Cek status tag di Goals › Conversions dan uji alur checkout/lead'],
        m('conversions', o.conversions, c.conversions), { sticky: true });
    }
    if (!o) return;

    const days = { o: old.days, c: cur.days };
    const enough = (r, { conv = 0, clicks = 0, impr = 0 } = {}) => activeDays >= (r.minDays ?? 0)
      && Math.min(o.conversions, c.conversions) >= conv && Math.min(o.clicks, c.clicks) >= clicks && Math.min(o.impressions, c.impressions) >= impr;
    const cpcCh = pctChange(o.avg_cpc, c.avg_cpc).value;
    const cvrCh = pctChange(o.cvr, c.cvr).value;

    let r = rules.cpa_increase;
    if (enough(r, { conv: r.minConversions })) {
      const ch = pctChange(o.cost_per_conv, c.cost_per_conv).value;
      if (ch != null && ch >= r.change) {
        add('cpa_increase', ch >= r.high ? 'high' : 'medium',
          [`CPA naik ${pct(ch)} (${money(o.cost_per_conv)} → ${money(c.cost_per_conv)})`],
          [...(cpcCh != null && cpcCh > 0.1 ? [`Kemungkinan dipengaruhi CPC yang naik ${pct(cpcCh)}`] : []), ...(cvrCh != null && cvrCh < -0.1 ? [`Kemungkinan dipengaruhi CVR yang turun ${pct(-cvrCh)}`] : []), 'Perlu diperiksa: pergeseran search term ke intent yang lebih rendah'],
          ['Bandingkan CPC dan CVR untuk melihat pendorongnya', 'Tinjau search term baru periode ini'],
          { ...m('cost_per_conv', o.cost_per_conv, c.cost_per_conv), ...m('avg_cpc', o.avg_cpc, c.avg_cpc), ...m('cvr', o.cvr, c.cvr) },
          { supporting: (cpcCh > 0.1 ? 1 : 0) + (cvrCh < -0.1 ? 1 : 0) });
      }
    }
    r = rules.conversion_volume_drop;
    if (activeDays >= r.minDays && o.conversions >= r.minConversions) {
      const ch = pctChange(perDay(o.conversions, days.o), perDay(c.conversions, days.c)).value;
      if (ch != null && ch <= -r.change && c.conversions > 0) {
        add('conversion_volume_drop', ch <= -r.high ? 'high' : 'medium',
          [`Konversi per hari turun ${pct(-ch)} (${fmt(perDay(o.conversions, days.o))} → ${fmt(perDay(c.conversions, days.c))})`],
          ['Kemungkinan volume pencarian atau impresi turun', 'Kemungkinan CVR turun', 'Perlu diperiksa: budget atau target yang membatasi'],
          ['Periksa impresi, impression share, dan CVR periode yang sama'],
          m('conversions_per_day', perDay(o.conversions, days.o), perDay(c.conversions, days.c)));
      }
    }
    r = rules.cvr_drop;
    if (enough(r, { conv: r.minConversions, clicks: r.minClicks }) && cvrCh != null && cvrCh <= -r.change) {
      add('cvr_drop', cvrCh <= -r.high ? 'high' : 'medium',
        [`CVR turun ${pct(-cvrCh)} (${pct(o.cvr)} → ${pct(c.cvr)})`],
        ['Kemungkinan kualitas traffic/search term berubah', 'Perlu diperiksa: landing page atau checkout', 'Perlu diperiksa: perubahan harga/stok'],
        ['Tinjau search term dan landing page; uji alur konversi'], m('cvr', o.cvr, c.cvr));
    }
    r = rules.cpc_increase;
    if (enough(r, { clicks: r.minClicks }) && cpcCh != null && cpcCh >= r.change) {
      add('cpc_increase', cpcCh >= r.high ? 'high' : 'medium',
        [`Avg. CPC naik ${pct(cpcCh)} (${money(o.avg_cpc)} → ${money(c.avg_cpc)})`],
        ['Kemungkinan persaingan lelang meningkat', 'Perlu diperiksa: target bidding berubah', 'Perlu diperiksa: Quality Score turun'],
        ['Periksa Auction Insights dan Change History', 'Cek Quality Score keyword utama'], m('avg_cpc', o.avg_cpc, c.avg_cpc), { conversionBased: false });
    }
    r = rules.ctr_drop;
    if (enough(r, { impr: r.minImpressions })) {
      const ctr = pctChange(o.ctr, c.ctr).value;
      if (ctr != null && ctr <= -r.change) {
        add('ctr_drop', 'medium',
          [`CTR turun ${pct(-ctr)} (${pct(o.ctr)} → ${pct(c.ctr)})`],
          ['Kemungkinan iklan kurang relevan dengan pencarian baru', 'Kemungkinan posisi iklan turun', 'Kemungkinan kompetitor lebih agresif'],
          ['Tinjau headline dan relevansi keyword; cek impression share top'], m('ctr', o.ctr, c.ctr), { conversionBased: false });
      }
    }
    r = rules.cost_up_without_results;
    const costDay = pctChange(perDay(o.cost, days.o), perDay(c.cost, days.c)).value;
    const convDay = pctChange(perDay(o.conversions, days.o), perDay(c.conversions, days.c)).value;
    if (activeDays >= r.minDays && o.conversions >= r.minConversions && costDay != null && costDay >= r.change && (convDay ?? 0) <= 0) {
      add('cost_up_without_results', 'high',
        [`Biaya per hari naik ${pct(costDay)} sementara konversi per hari ${convDay == null ? 'tidak terukur' : `berubah ${pct(convDay)}`}`],
        ['Kemungkinan budget dinaikkan tanpa ruang pencarian berkualitas', 'Kemungkinan CPC naik'],
        ['Tinjau perubahan budget/bidding dan search term baru'],
        { ...m('cost_per_day', perDay(o.cost, days.o), perDay(c.cost, days.c)), ...m('conversions_per_day', perDay(o.conversions, days.o), perDay(c.conversions, days.c)) });
    }

    // Impression share and budget (campaign level only).
    if (entity.type !== 'campaign') return;
    const efficient = accountCpa != null && c.cost_per_conv != null && c.cost_per_conv <= accountCpa;
    const solid = volumeTier(Math.min(o.conversions, c.conversions)) !== 'low' && !trackingUnhealthy;
    if (share?.search_budget_lost_is != null && share.search_budget_lost_is >= rules.lost_is_budget.share) {
      const opportunity = efficient && solid;
      add('lost_is_budget', opportunity ? 'high' : 'medium',
        [`Kehilangan ${pct(share.search_budget_lost_is)} impresi karena budget`, `Impression share ${pct(share.search_impression_share)}`, ...(share.granularity === 'daily_estimate' ? ['Nilai IS adalah estimasi dari data harian'] : [])],
        ['Budget harian habis sebelum akhir hari'],
        [trackingUnhealthy ? 'Perbaiki tracking konversi dulu — menambah budget tanpa konversi yang terukur tidak bisa dievaluasi'
          : opportunity ? 'Peluang budget: pertimbangkan menambah budget bertahap — setelah memastikan kualitas konversi dan target bisnis, bukan hanya karena CPA rendah'
            : 'Evaluasi alokasi budget antar-campaign sebelum menambah budget'],
        // The fact is an impression-share figure: its confidence comes from
        // clicks; the tracking state shapes the advice above instead.
        { search_budget_lost_is: { old: null, cur: share.search_budget_lost_is, change: null } }, { dataset: 'competitive', conversionBased: false });
    }
    if (share?.search_rank_lost_is != null && share.search_rank_lost_is >= rules.lost_is_rank.share) {
      add('lost_is_rank', 'medium',
        [`Kehilangan ${pct(share.search_rank_lost_is)} impresi karena Ad Rank`],
        ['Kemungkinan Quality Score atau relevansi iklan rendah', 'Kemungkinan bid/target terlalu rendah untuk persaingan'],
        [SMART_BIDDING.has(strategy) ? 'Tinjau Ad Rank: perbaiki relevansi iklan dan landing page; tinjau target bidding bila ada. Menambah budget tidak mengatasi kehilangan karena rank' : 'Tinjau Ad Rank: perbaiki relevansi iklan; evaluasi bid. Menambah budget tidak mengatasi kehilangan karena rank'],
        { search_rank_lost_is: { old: null, cur: share.search_rank_lost_is, change: null } }, { conversionBased: false, dataset: 'competitive' });
    }
    const budget = s?.budget_amount;
    if (budget && s?.status === 'ENABLED' && c.active_days >= rules.budget_underused.minDays) {
      const util = safeDiv(c.cost / c.active_days, budget);
      if (util != null && util < rules.budget_underused.ratio) {
        const restrictive = (s.target_cpa || s.target_roas) && (share?.search_rank_lost_is ?? 0) >= rules.lost_is_rank.share;
        add(restrictive ? 'restrictive_target' : 'budget_underused', restrictive ? 'medium' : 'low',
          [`Rata-rata belanja ${money(c.cost / c.active_days)}/hari dari budget ${money(budget)} (${pct(util)})`, ...(restrictive ? [`Target ${s.target_cpa ? `CPA ${money(s.target_cpa)}` : `ROAS ${fmt(s.target_roas)}`} dengan Lost IS (rank) ${pct(share.search_rank_lost_is)}`] : [])],
          restrictive ? ['Kemungkinan target bidding terlalu ketat sehingga lelang banyak dilewati'] : ['Kemungkinan volume pencarian terbatas', 'Kemungkinan Ad Rank rendah', 'Perlu diperiksa: target lokasi/jadwal sempit'],
          [restrictive ? 'Uji pelonggaran target bertahap dan pantau CPA' : 'Tinjau keyword/target lokasi untuk menambah jangkauan, atau alokasikan budget ke campaign lain'],
          { budget_utilization: { old: null, cur: util, change: null } }, { conversionBased: false });
      } else if (util != null && util >= rules.budget_limited.ratio && share?.search_budget_lost_is == null) {
        add('budget_limited', 'low',
          [`Belanja rata-rata ${pct(util)} dari budget harian`], ['Kemungkinan budget membatasi penayangan'],
          ['Cek Lost IS (budget) setelah data impression share tersedia'], { budget_utilization: { old: null, cur: util, change: null } }, { conversionBased: false });
      }
    }
  };

  evaluate({ type: 'account', key: 'account', id: null, name: 'Akun' }, old.totals, cur.totals, null, null);
  for (const c of cur.campaigns) {
    evaluate({ type: 'campaign', key: ckey(c), id: c.campaign_id, name: c.campaign_name, customer_id: c.customer_id },
      oldBy.get(ckey(c)), c, settings.get(ckey(c)), shares.get(ckey(c)));
  }
  return findings.sort((a, b) => (a.status === b.status ? 0 : a.status === 'diagnosis' ? -1 : 1)
    || SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.confidence_score - a.confidence_score);
}

// A Quality Score component that is below average across most of the
// keyword spend points at something shared (the site, the ad copy) rather
// than at single keywords. Weighted by cost; keywords without a score are
// left out and counted.
const COMPONENTS = [
  ['landing_page_experience', 'Landing page experience', ['Kecepatan atau tampilan mobile situs', 'Isi halaman tujuan kurang sesuai dengan keyword', 'Navigasi/checkout menyulitkan'], 'Uji kecepatan halaman berbiaya terbesar di PageSpeed Insights (Google tidak lagi mengirim speed score ke ATLAS) dan periksa kecocokan isinya dengan keyword'],
  ['ad_relevance', 'Ad relevance', ['Headline tidak memuat keyword', 'Ad group terlalu luas sehingga satu iklan melayani banyak tema'], 'Pecah ad group per tema dan masukkan keyword utama ke headline'],
  ['expected_ctr', 'Expected CTR', ['Iklan kurang menonjol dibanding kompetitor', 'Penawaran/pesan kurang spesifik'], 'Uji headline dengan penawaran dan pembeda yang jelas'],
];

export function qualityPatterns(keywords, rules = RULES.quality) {
  const scored = keywords.filter((k) => k.quality_score != null);
  if (scored.length < rules.minScoredKeywords) return [];
  const cost = scored.reduce((a, k) => a + (k.cost || 0), 0);
  const out = [];
  for (const [field, label, causes, step] of COMPONENTS) {
    const below = scored.filter((k) => k[field] === 'BELOW_AVERAGE');
    const share = cost ? safeDiv(below.reduce((a, k) => a + (k.cost || 0), 0), cost) : safeDiv(below.length, scored.length);
    if (share == null || share < rules.belowShare) continue;
    out.push({
      id: `quality_${field}:account`, entity_type: 'account', entity_id: null, entity_name: 'Akun', customer_id: null,
      type: `quality_${field}`, severity: share >= 0.6 ? 'high' : 'medium', status: 'diagnosis',
      confidence: scored.length >= 25 ? 'high' : 'medium', confidence_score: scored.length >= 25 ? 75 : 55,
      confidence_reasons: [`${scored.length} keyword ber-Quality Score`, 'Penilaian Google saat ini, bukan tren periode'], volume_tier: null,
      ruleset_version: RULESET_VERSION,
      period: null, metrics: { below_average_cost_share: { old: null, cur: share, change: null } }, baseline: null,
      facts: [
        `${label} di bawah rata-rata pada ${below.length} dari ${scored.length} keyword ber-Quality Score (${pct(share)} biayanya)`,
        `${keywords.length - scored.length} keyword belum punya Quality Score (traffic kecil)`,
        `Quality Score adalah penilaian Google per ${scored[0]?.quality_date ?? 'snapshot terbaru'}, bukan rata-rata periode`,
      ],
      possible_causes: causes,
      next_steps: [step, 'Quality Score adalah diagnosis, bukan dasar tunggal untuk menjeda atau menaikkan keyword'],
    });
  }
  return out;
}

// ── anomalies ───────────────────────────────────────────────────────
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
};
const addDays = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

// Days in [start, end] whose cost, clicks, conversions or CPA sit far from
// their own baseline: the same weekday over the previous four weeks when
// there are three or more, else the previous fourteen days. Robust spread
// (median absolute deviation) so one odd day does not hide the next, and a
// floor of 10% of the median so a flat history does not make every wobble
// an anomaly. Metrics whose baseline is too small are skipped.
export function detectAnomalies(series, start, end, rules = RULES.anomaly) {
  const byDate = new Map(series.map((d) => [d.date, d]));
  const first = series.length ? series.reduce((a, d) => (d.date < a ? d.date : a), series[0].date) : null;
  const value = (date, metric) => {
    if (!first || date < first) return null;
    const d = byDate.get(date);
    if (metric === 'cpa') return d && d.conversions > 0 ? d.cost / d.conversions : null;
    return d ? Number(d[metric]) || 0 : 0;
  };
  const out = [];
  const lowVolume = new Set();
  let monitoring = false;
  for (let date = start; date <= end; date = addDays(date, 1)) {
    for (const metric of ['cost', 'clicks', 'conversions', 'cpa']) {
      const weekly = [7, 14, 21, 28].map((n) => value(addDays(date, -n), metric)).filter((v) => v != null);
      const base = weekly.length >= 3 ? weekly : Array.from({ length: 14 }, (_, i) => value(addDays(date, -(i + 1)), metric)).filter((v) => v != null);
      if (base.length < (weekly.length >= 3 ? 3 : rules.minBaselineDays)) { monitoring = true; continue; }
      const med = median(base);
      const minMed = metric === 'cpa' ? null : rules.minMedian[metric];
      // Too little volume to call a day unusual: "monitoring", not an anomaly.
      if (metric === 'cpa') {
        const convMed = median([7, 14, 21, 28].map((n) => value(addDays(date, -n), 'conversions')).filter((v) => v != null));
        if (convMed == null || convMed < rules.minMedian.conversions) { lowVolume.add(metric); continue; }
      } else if (med < minMed) { lowVolume.add(metric); continue; }
      const x = value(date, metric);
      if (x == null) continue;
      const mad = median(base.map((v) => Math.abs(v - med)));
      // A naturally noisy series needs a bigger deviation before it counts.
      const highVariance = med > 0 && (1.4826 * mad) / med > rules.highVarianceCv;
      const k = highVariance ? rules.kHighVariance : rules.k;
      const scale = Math.max(1.4826 * mad, Math.abs(med) * 0.1, 1e-9);
      const z = (x - med) / scale;
      if (Math.abs(z) >= k) {
        out.push({ date, metric, value: x, expected: med, z: Math.round(z * 10) / 10, direction: z > 0 ? 'up' : 'down', baseline_days: base.length, baseline: weekly.length >= 3 ? 'same_weekday_4w' : 'previous_14d', threshold: k, high_variance: highVariance });
      }
    }
  }
  return {
    anomalies: out,
    status: out.length ? 'anomaly' : monitoring || lowVolume.size ? 'monitoring' : 'normal',
    monitoring_metrics: [...lowVolume],
    ruleset_version: RULESET_VERSION,
  };
}

// ── devices ─────────────────────────────────────────────────────────
export function deviceInsights(rows, settings = [], rules = RULES.device) {
  const byDevice = new Map();
  for (const r of rows) {
    const acc = byDevice.get(r.device) ?? { device: r.device, cost: 0, impressions: 0, clicks: 0, conversions: 0, conversions_value: 0, all_conversions: 0 };
    for (const k of ['cost', 'impressions', 'clicks', 'conversions', 'conversions_value', 'all_conversions']) acc[k] += Number(r[k]) || 0;
    byDevice.set(r.device, acc);
  }
  const devices = [...byDevice.values()].map(withRatios);
  const total = devices.reduce((a, d) => ({ cost: a.cost + d.cost, conv: a.conv + d.conversions }), { cost: 0, conv: 0 });
  const accountCpa = safeDiv(total.cost, total.conv);
  const strategies = new Set(settings.filter((s) => s.status === 'ENABLED').map((s) => s.bidding_strategy_type).filter(Boolean));
  const allSmart = strategies.size > 0 && [...strategies].every((s) => SMART_BIDDING.has(s));
  for (const d of devices) {
    d.cost_share = safeDiv(d.cost, total.cost);
    d.conversion_share = safeDiv(d.conversions, total.conv);
    d.flags = [];
    if (d.clicks >= rules.minClicks && (d.cost_share ?? 0) >= rules.minCostShare) {
      if (d.conversions === 0) d.flags.push('Biaya berarti tanpa konversi');
      else if (accountCpa && d.cost_per_conv > accountCpa * rules.poorCpaRatio) d.flags.push(`CPA ${fmt(d.cost_per_conv / accountCpa, 2)}× rata-rata akun`);
    }
  }
  return {
    devices: devices.sort((a, b) => b.cost - a.cost),
    bid_adjustment_note: allSmart
      ? 'Semua campaign aktif memakai Smart Bidding: penyesuaian bid per device diabaikan Google (kecuali -100%). Perbaikan dilakukan lewat landing page/iklan mobile, bukan bid adjustment.'
      : null,
  };
}

// ── day × hour ──────────────────────────────────────────────────────
export function scheduleInsights(grid, periodDays, rules = RULES.schedule) {
  const cells = grid.map(withRatios);
  const byHour = new Map();
  for (const c of cells) {
    const acc = byHour.get(c.hour) ?? { hour: c.hour, cost: 0, impressions: 0, clicks: 0, conversions: 0, conversions_value: 0 };
    for (const k of ['cost', 'impressions', 'clicks', 'conversions', 'conversions_value']) acc[k] += c[k];
    byHour.set(c.hour, acc);
  }
  const hours = [...byHour.values()].map(withRatios).sort((a, b) => a.hour - b.hour);
  const total = hours.reduce((a, h) => ({ cost: a.cost + h.cost, conv: a.conv + h.conversions, clicks: a.clicks + h.clicks }), { cost: 0, conv: 0, clicks: 0 });
  const accountCpa = safeDiv(total.cost, total.conv);
  const sufficient = total.conv >= rules.minConversions && periodDays >= rules.minDays;
  const under = hours.filter((h) => h.clicks >= rules.minCellClicks && safeDiv(h.cost, total.cost) >= rules.minCostShare
    && (h.conversions === 0 || (accountCpa && h.cost_per_conv >= accountCpa * rules.poorCpaRatio)));
  return {
    grid: cells,
    hours,
    top_by_clicks: [...hours].sort((a, b) => b.clicks - a.clicks).slice(0, 5).map((h) => h.hour),
    top_by_conversions: [...hours].filter((h) => h.conversions > 0).sort((a, b) => b.conversions - a.conversions).slice(0, 5).map((h) => h.hour),
    underperforming_hours: under.map((h) => ({ hour: h.hour, cost: h.cost, clicks: h.clicks, conversions: h.conversions, cost_per_conv: h.cost_per_conv })),
    data_sufficient: sufficient,
    note: sufficient
      ? null
      : `Belum cukup data untuk saran jadwal iklan (butuh ≥ ${rules.minConversions} konversi dan ≥ ${rules.minDays} hari; tersedia ${fmt(total.conv)} konversi dalam ${periodDays} hari).`,
    support: { conversions: total.conv, clicks: total.clicks, days: periodDays },
  };
}

// ── landing pages ───────────────────────────────────────────────────
// The most-clicked pages in full; the long tail (one page per product in
// Shopping / Performance Max) is summed into `others`, so totals still add up.
export function landingPageInsights(rows, rules = RULES.landingPage) {
  const conversionsKnown = rows.some((r) => r.conversions != null);
  const sorted = [...rows].sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0));
  const sum = (list, k) => (list.some((r) => r[k] != null) ? list.reduce((a, r) => a + (r[k] ?? 0), 0) : null);
  const rest = sorted.slice(rules.maxPages);
  const totalsOf = (list) => ({
    pages: list.length, clicks: sum(list, 'clicks'), impressions: sum(list, 'impressions'), cost: sum(list, 'cost'),
    conversions: sum(list, 'conversions'), conversions_value: sum(list, 'conversions_value'),
  });
  return {
    conversions_available: conversionsKnown,
    speed_available: rows.some((r) => r.speed_score != null),
    note: conversionsKnown ? null : 'Google tidak mengizinkan metrik konversi pada laporan landing page untuk akun ini — hanya traffic yang ditampilkan.',
    totals: totalsOf(sorted),
    others: rest.length ? totalsOf(rest) : null,
    pages: sorted.slice(0, rules.maxPages).map((r) => {
      const flags = [];
      if (conversionsKnown && (r.clicks ?? 0) >= rules.minClicks && r.conversions === 0) flags.push('Traffic tinggi tanpa konversi');
      if (r.speed_score != null && r.speed_score <= rules.lowSpeedScore) flags.push(`Speed score mobile ${r.speed_score}/10`);
      return {
        ...r,
        ctr: safeDiv(r.clicks, r.impressions),
        avg_cpc: r.cost == null ? null : safeDiv(r.cost, r.clicks),
        cvr: r.conversions == null ? null : safeDiv(r.conversions, r.clicks),
        cost_per_conv: r.conversions == null || r.cost == null ? null : safeDiv(r.cost, r.conversions),
        flags,
      };
    }),
  };
}

// ── message match: keyword ↔ headline ↔ final URL ─────────────────────
// Per ad group, the share of keyword spend whose words appear in the ad
// group's headlines and in its final URL path. Text only: ATLAS does not
// read the landing page itself, so a low URL score is a prompt to check the
// page, not a verdict on it.
const meaningful = (s) => tokens(s).filter((t) => !STOP.has(t));
const covers = (pool, word) => pool.some((p) => p === word || (word.length >= 5 && (p.startsWith(word.slice(0, -1)) || word.startsWith(p.slice(0, -1)))));

export function messageMatch(keywords, ads, { minCostShare = 0.05 } = {}) {
  const groups = new Map();
  const totalCost = keywords.reduce((a, k) => a + (k.cost || 0), 0);
  for (const k of keywords) {
    const key = `${k.customer_id}|${k.ad_group_id}`;
    if (!groups.has(key)) groups.set(key, { ad_group_id: k.ad_group_id, ad_group_name: k.ad_group_name, campaign_name: k.campaign_name, keywords: [], headlines: [], urls: [] });
    groups.get(key).keywords.push(k);
  }
  for (const a of ads) {
    const g = groups.get(`${a.customer_id}|${a.ad_group_id}`);
    if (!g) continue;
    g.headlines.push(...(a.headlines ?? []).map((h) => h.text));
    g.urls.push(...(a.final_urls ?? []));
  }
  return [...groups.values()].filter((g) => g.headlines.length).map((g) => {
    const headWords = g.headlines.flatMap(meaningful);
    const urlWords = g.urls.flatMap((u) => { try { return meaningful(new URL(u).pathname); } catch { return meaningful(u); } });
    let cost = 0;
    let inHead = 0;
    let inUrl = 0;
    const missing = [];
    for (const k of g.keywords) {
      const words = meaningful(k.keyword);
      if (!words.length) continue;
      const w = k.cost || 0;
      cost += w;
      const h = words.every((x) => covers(headWords, x));
      if (h) inHead += w; else missing.push(k.keyword);
      if (words.some((x) => covers(urlWords, x))) inUrl += w;
    }
    const headlineMatch = safeDiv(inHead, cost);
    const urlMatch = safeDiv(inUrl, cost);
    const material = safeDiv(cost, totalCost) >= minCostShare;
    return {
      ad_group_id: g.ad_group_id, ad_group_name: g.ad_group_name, campaign_name: g.campaign_name, cost,
      headline_match: headlineMatch, url_match: urlMatch,
      missing_in_headlines: [...new Set(missing)].slice(0, 5),
      flag: material && headlineMatch != null && headlineMatch < 0.5
        ? 'Sebagian besar biaya keyword ad group ini tidak muncul di headline iklan'
        : material && urlMatch != null && urlMatch < 0.3 ? 'Keyword utama tidak tercermin di URL landing page — periksa kecocokan halaman' : null,
    };
  }).sort((a, b) => b.cost - a.cost);
}

// ── ads within an ad group ──────────────────────────────────────────
export function adInsights(ads, { minClicks = 30, poorCpaRatio = 1.5, minShare = 0.3 } = {}) {
  const groups = new Map();
  for (const a of ads) {
    const key = `${a.customer_id}|${a.ad_group_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const out = [];
  for (const list of groups.values()) {
    const g = list.reduce((acc, a) => ({ cost: acc.cost + a.cost, conv: acc.conv + a.conversions, clicks: acc.clicks + a.clicks }), { cost: 0, conv: 0, clicks: 0 });
    const groupCpa = safeDiv(g.cost, g.conv);
    const comparable = list.filter((a) => a.clicks >= minClicks);
    const bestCtr = comparable.length > 1 ? comparable.reduce((b, a) => (a.ctr > b.ctr ? a : b)) : null;
    const bestCvr = comparable.length > 1 ? comparable.reduce((b, a) => ((a.cvr ?? 0) > (b.cvr ?? 0) ? a : b)) : null;
    for (const a of list) {
      const flags = [];
      const share = safeDiv(a.cost, g.cost);
      if (a.clicks >= minClicks && share >= minShare) {
        if (a.conversions === 0 && g.conv > 0) flags.push('Biaya besar tanpa konversi dibanding iklan lain di ad group');
        else if (groupCpa && a.cost_per_conv > groupCpa * poorCpaRatio) flags.push(`CPA ${fmt(a.cost_per_conv / groupCpa, 2)}× rata-rata ad group`);
      }
      if (bestCtr && a === bestCtr) flags.push('CTR tertinggi di ad group');
      if (bestCvr && a === bestCvr && (a.cvr ?? 0) > 0) flags.push('CVR tertinggi di ad group');
      if (['POOR', 'AVERAGE'].includes(a.ad_strength)) flags.push(`Ad strength ${a.ad_strength}`);
      out.push({ customer_id: a.customer_id, ad_group_id: a.ad_group_id, ad_id: a.ad_id, cost_share_in_group: share, flags });
    }
  }
  return out;
}

// ── landing page experience by final URL ─────────────────────────────
// Google's Landing Page Experience rating of the keywords, grouped by the
// final URL their ad group's ads point to (query string and trailing slash
// dropped). Google's rating, not a technical audit of the page: the wording
// says "menurut Google Ads".
const pageOf = (u) => String(u ?? '').split('#')[0].split('?')[0].replace(/\/+$/, '');

export function landingPageQuality(keywords, ads) {
  const urlOfGroup = new Map();
  for (const a of ads ?? []) {
    const key = `${a.customer_id}|${a.ad_group_id}`;
    const url = pageOf((a.final_urls ?? [])[0]);
    if (url && !urlOfGroup.has(key)) urlOfGroup.set(key, url);
  }
  const scored = keywords.filter((k) => k.landing_page_experience);
  const count = (list, v) => list.filter((k) => k.landing_page_experience === v).length;
  const pages = new Map();
  for (const k of scored) {
    const url = urlOfGroup.get(`${k.customer_id}|${k.ad_group_id}`) ?? '(final URL tidak diketahui)';
    if (!pages.has(url)) pages.set(url, []);
    pages.get(url).push(k);
  }
  return {
    summary: { scored: scored.length, unscored: keywords.length - scored.length, below: count(scored, 'BELOW_AVERAGE'), average: count(scored, 'AVERAGE'), above: count(scored, 'ABOVE_AVERAGE') },
    pages: [...pages.entries()].map(([url, list]) => ({
      url, keywords: list.length, below: count(list, 'BELOW_AVERAGE'), average: count(list, 'AVERAGE'), above: count(list, 'ABOVE_AVERAGE'),
      cost: list.reduce((a, k) => a + (k.cost || 0), 0),
      opportunity: count(list, 'BELOW_AVERAGE') / list.length >= 0.5 && list.length >= 3,
      examples: list.filter((k) => k.landing_page_experience === 'BELOW_AVERAGE').sort((a, b) => b.cost - a.cost).slice(0, 5).map((k) => k.keyword),
    })).sort((a, b) => b.below - a.below || b.cost - a.cost),
  };
}
