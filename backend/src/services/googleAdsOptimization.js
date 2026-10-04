import { AppError } from '../utils/errors.js';
import * as brandService from './brandService.js';
import * as library from './brandLibraryService.js';
import * as repo from '../repositories/googleAdsOptimizationRepository.js';
import * as gaRepo from '../repositories/googleAdsRepository.js';
import * as datasetsRepo from '../repositories/googleAdsDatasetsRepository.js';
import { withRatios, safeDiv, pctChange, classifyActions } from './googleAdsAnalytics.js';
import { diagnoseCampaigns, moneyFormatter } from './googleAdsDiagnostics.js';
import { requestGeminiJson, brandContextBlock, currentDirectionBlock, MODEL } from './aiSummaryService.js';
import { getReport } from './googleAdsService.js';

// Google Ads optimisation: the AI Optimization Center (recommendations),
// tasks in MOM, the experiment tracker and rule-based alerts. Nothing here
// changes a Google Ads account — every action is a proposal a person
// carries out by hand.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayJakarta = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5) + 1;
const text = (v, max = 600) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

async function assertBrand(brandId) {
  const brand = await brandService.getBrandById(brandId);
  if (!brand) throw new AppError('Client tidak ditemukan', 404);
  return brand;
}

// =====================================================================
// Recommendations
// =====================================================================
export const PRIORITIES = ['critical', 'high', 'medium', 'low'];
export const CONFIDENCES = ['high', 'medium', 'low'];
export const REC_STATUSES = ['new', 'reviewed', 'planned', 'in_progress', 'monitoring', 'completed', 'dismissed'];
export const ENTITY_TYPES = ['account', 'campaign', 'ad_group', 'keyword', 'search_term', 'ad', 'landing_page'];
export const CATEGORIES = ['tracking', 'budget', 'bidding', 'keywords', 'search_terms', 'ads', 'landing_page', 'targeting', 'schedule', 'device', 'structure', 'other'];
const DISMISS_QUIET_DAYS = 30;

const REC_SCHEMA = {
  type: 'OBJECT',
  properties: {
    recommendations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          entity_type: { type: 'STRING' },
          entity_id: { type: 'STRING' },
          entity_name: { type: 'STRING' },
          category: { type: 'STRING' },
          title: { type: 'STRING' },
          finding: { type: 'STRING' },
          evidence: { type: 'ARRAY', items: { type: 'STRING' } },
          possible_cause: { type: 'STRING' },
          recommended_action: { type: 'STRING' },
          expected_direction: { type: 'STRING' },
          priority: { type: 'STRING' },
          confidence: { type: 'STRING' },
          risk: { type: 'STRING' },
          success_metric: { type: 'STRING' },
          monitoring_period: { type: 'STRING' },
        },
        required: ['entity_type', 'category', 'title', 'finding', 'evidence', 'possible_cause', 'recommended_action', 'priority', 'confidence', 'risk', 'success_metric', 'monitoring_period'],
      },
    },
    data_limitations: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['recommendations', 'data_limitations'],
};

const REC_RULES = `Kamu adalah senior Google Ads specialist. Dari data terstruktur di atas — angka sudah dihitung backend ATLAS, jangan menghitung ulang atau mengarang angka — susun 3–10 rekomendasi optimasi yang spesifik dan bisa dijalankan manual di Google Ads.

Aturan yang mengikat:
1. Hanya gunakan angka yang ada di data. Jangan mengarang target CPA, margin, atau metrik yang tidak tersedia. Jika target bisnis tidak ada, katakan pembandingnya baseline historis.
2. Purchase dan Lead adalah tujuan berbeda: jangan menjumlahkan atau menyamakannya.
3. Korelasi bukan sebab-akibat. "finding" berisi fakta; "possible_cause" berisi hipotesis yang ditandai "kemungkinan" beserta cara memeriksanya.
4. Perhatikan volume: keyword/search term dengan data kecil berstatus belum konklusif — jangan sarankan menjeda karenanya.
5. Rekomendasi bidding harus sesuai strategi bidding campaign (Smart Bidding mengabaikan bid adjustment device/jadwal kecuali -100%).
6. Jangan menyarankan kenaikan budget hanya karena CPA rendah: periksa Lost IS (budget), volume konversi, kualitas konversi, dan target bisnis. Jika data itu tidak ada, jangan sarankan kenaikan budget.
7. Utamakan masalah tracking (konversi primer tidak ada/berhenti) di atas optimasi lain: optimasi tanpa tracking yang benar tidak bisa dievaluasi.
8. Jangan mengulang rekomendasi yang sudah ada di "Rekomendasi aktif" kecuali ada bukti baru; jika mengulang, pakai entity dan category yang sama.
9. ATLAS tidak mengubah akun: tulis tindakan sebagai langkah manual.

Isi setiap rekomendasi:
- entity_type: salah satu dari account, campaign, ad_group, keyword, search_term, ad, landing_page.
- entity_id: untuk campaign gunakan campaign_id dari data; selain itu kosongkan.
- entity_name: nama campaign/ad group/keyword/search term/URL.
- category: salah satu dari tracking, budget, bidding, keywords, search_terms, ads, landing_page, targeting, schedule, device, structure, other.
- title: maksimal 90 karakter.
- finding: fakta yang dibuktikan data.
- evidence: 1–4 angka pendukung, masing-masing satu kalimat pendek dengan angka dari data.
- possible_cause, recommended_action (langkah konkret), expected_direction (arah perubahan metrik yang diharapkan, bukan janji angka).
- priority: critical, high, medium, atau low (berdasarkan dampak × risiko).
- confidence: high, medium, atau low (berdasarkan volume data).
- risk: risiko bila dijalankan.
- success_metric: metrik dan cara mengukur keberhasilan.
- monitoring_period: mis. "14 hari setelah perubahan".
data_limitations: keterbatasan data yang membatasi rekomendasi (0–4 poin). Tulis dalam Bahasa Indonesia.`;

// What the model reads: the report's own findings, condensed. Built on the
// server from getReport, never from what a browser sends.
const round4 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);

export function buildRecommendationInput({ report, profile, brandName, active, experiments, oldStart, oldEnd, curStart, curEnd }) {
  const money = moneyFormatter(report.currency);
  const m = (r) => r && {
    cost: money(r.cost), clicks: r.clicks, conversions: Number(r.conversions?.toFixed?.(2) ?? r.conversions),
    cpa: r.cost_per_conv == null ? null : money(r.cost_per_conv), ctr: round4(r.ctr), cvr: round4(r.cvr), roas: round4(r.roas),
  };
  const settings = new Map((report.campaignSettings ?? []).map((s) => [`${s.customer_id}|${s.campaign_id}`, s]));
  const shares = new Map((report.cur.competitive?.campaigns ?? []).map((s) => [`${s.customer_id}|${s.campaign_id}`, s]));
  const goals = report.cur.goals;
  return {
    brand: brandName,
    currency: report.currency,
    periods: { previous: `${oldStart}..${oldEnd}`, current: `${curStart}..${curEnd}` },
    totals: { previous: m(report.old.totals), current: m(report.cur.totals) },
    goals: goals && Object.fromEntries(['purchase', 'lead', 'micro'].map((g) => [g, {
      primary_conversions: goals[g].conversions, all_conversions: goals[g].all_conversions,
      cost_per_result_all_spend: goals[g].blended_cost_per_result == null ? null : money(goals[g].blended_cost_per_result),
      cost_per_result_goal_campaigns: goals[g].focus_cost_per_result == null ? null : money(goals[g].focus_cost_per_result),
      unverified_actions: goals[g].unverified,
    }])),
    campaigns: report.cur.campaigns.map((c) => {
      const s = settings.get(`${c.customer_id}|${c.campaign_id}`);
      const sh = shares.get(`${c.customer_id}|${c.campaign_id}`);
      const prev = report.old.campaigns.find((o) => o.customer_id === c.customer_id && o.campaign_id === c.campaign_id);
      return {
        campaign_id: c.campaign_id, name: c.campaign_name, type: c.channel_type, status: s?.status ?? null,
        bidding: s?.bidding_strategy_type ?? null, target_cpa: s?.target_cpa ? money(s.target_cpa) : null, target_roas: s?.target_roas ?? null,
        daily_budget: s?.budget_amount ? money(s.budget_amount) : null, current: m(c), previous: m(prev),
        search_impression_share: sh?.search_impression_share ?? null, lost_is_budget: sh?.search_budget_lost_is ?? null, lost_is_rank: sh?.search_rank_lost_is ?? null,
        goal: report.cur.campaignGoals?.[`${c.customer_id}|${c.campaign_id}`]?.goal ?? null,
      };
    }),
    diagnostics: (report.diagnostics ?? []).slice(0, 15).map((x) => ({
      severity: x.severity, confidence: x.confidence, type: x.type, entity: x.entity_type === 'account' ? 'akun' : x.entity_name, facts: x.facts, possible_causes: x.possible_causes,
    })),
    keywords: {
      summary: report.cur.keywordSummary ?? null,
      notable: (report.cur.keywordDetail ?? []).filter((k) => k.classification !== 'insufficient_data').sort((a, b) => b.cost - a.cost).slice(0, 15)
        .map((k) => ({ keyword: k.keyword, match: k.match_type, campaign: k.campaign_name, class: k.classification, cost: money(k.cost), conversions: k.conversions, quality_score: k.quality_score, quality_flags: k.quality_flags })),
    },
    search_terms: report.cur.searchTermSummary && {
      observed_no_conversion_spend: money(report.cur.searchTermSummary.observed_no_conversion_spend),
      potentially_irrelevant_spend: money(report.cur.searchTermSummary.potentially_irrelevant_spend),
      coverage: report.cur.searchTermSummary.coverage,
      negative_candidates: report.cur.searchTermSummary.negative_candidates.slice(0, 10).map((n) => ({ term: n.text, class: n.classification, cost: money(n.cost) })),
      opportunities: (report.cur.searchTermDetail ?? []).filter((t) => t.classification === 'new_keyword_opportunity').slice(0, 8).map((t) => ({ term: t.search_term, conversions: t.conversions, cpa: t.cost_per_conv == null ? null : money(t.cost_per_conv) })),
    },
    ads: (report.cur.ads ?? []).filter((a) => a.flags?.length).slice(0, 8).map((a) => ({ ad_group: a.ad_group_name, headline: a.headlines?.[0]?.text ?? null, flags: a.flags, strength: a.ad_strength })),
    message_match: (report.cur.messageMatch ?? []).filter((x) => x.flag).slice(0, 6).map((x) => ({ ad_group: x.ad_group_name, flag: x.flag, missing_in_headlines: x.missing_in_headlines })),
    devices: report.cur.devices && { devices: report.cur.devices.devices.map((d) => ({ device: d.device, cost_share: d.cost_share, conversion_share: d.conversion_share, cpa: d.cost_per_conv == null ? null : money(d.cost_per_conv), flags: d.flags })), note: report.cur.devices.bid_adjustment_note },
    schedule: report.cur.schedule && { data_sufficient: report.cur.schedule.data_sufficient, underperforming_hours: report.cur.schedule.underperforming_hours.map((h) => h.hour), top_conversion_hours: report.cur.schedule.top_by_conversions },
    landing_pages: (report.cur.landingPages?.pages ?? []).filter((p) => p.flags.length).slice(0, 6).map((p) => ({ url: p.url, flags: p.flags })),
    anomalies: report.anomalies?.anomalies?.slice(0, 6) ?? [],
    changes_in_period: report.changeHistory.rows.length,
    setting_changes: (report.campaignSettingChanges ?? []).slice(0, 10).map((c) => ({ campaign: c.campaign_name, fields: c.changed_fields })),
    active_experiments: experiments.filter((e) => ['planned', 'running', 'evaluating'].includes(e.status)).map((e) => ({ campaign: e.campaign_name ?? 'akun', hypothesis: e.hypothesis, metric: e.success_metric })),
    active_recommendations: active.map((r) => ({ entity: r.entity_name ?? r.entity_type, category: r.category, title: r.title, status: r.status })),
    data_availability: Object.fromEntries(Object.entries(report.dataAvailability ?? {}).map(([k, v]) => [k, v.last_date ?? (v.fetched_at ? 'snapshot' : null)])),
    brand_context: profile ? { context: brandContextBlock(profile), direction: currentDirectionBlock(profile) } : null,
  };
}

export function buildRecommendationPrompt(input) {
  return `# Data Google Ads (dihitung backend ATLAS)\n${JSON.stringify(input)}\n\n${REC_RULES}`;
}

// Shape is locked by the schema, content is not: anything outside the
// enums is coerced to the safe value or dropped, campaigns must exist in
// the report, and a recommendation without evidence is not kept.
export function validateRecommendations(raw, { campaigns = [] } = {}) {
  const byId = new Map(campaigns.map((c) => [String(c.campaign_id), c]));
  const byName = new Map(campaigns.map((c) => [String(c.campaign_name).toLowerCase(), c]));
  const list = Array.isArray(raw?.recommendations) ? raw.recommendations : [];
  const out = [];
  for (const r of list.slice(0, 12)) {
    const evidence = (Array.isArray(r?.evidence) ? r.evidence : []).map((e) => text(e, 240)).filter(Boolean).slice(0, 4);
    const title = text(r?.title, 120);
    const finding = text(r?.finding, 800);
    const action = text(r?.recommended_action, 800);
    if (!title || !finding || !action || !evidence.length) continue;
    let entityType = ENTITY_TYPES.includes(r.entity_type) ? r.entity_type : 'account';
    let entityId = null;
    let entityName = text(r.entity_name, 200) || null;
    let customerId = null;
    if (entityType === 'campaign') {
      const c = byId.get(String(r.entity_id ?? '')) ?? byName.get(String(entityName ?? '').toLowerCase());
      if (c) { entityId = String(c.campaign_id); entityName = c.campaign_name; customerId = c.customer_id ?? null; } else { entityType = 'account'; entityName = null; }
    }
    if (entityType === 'account') entityName = null;
    out.push({
      entity_type: entityType, entity_id: entityId, entity_name: entityName, customer_id: customerId,
      category: CATEGORIES.includes(r.category) ? r.category : 'other',
      title, finding, evidence,
      possible_cause: text(r.possible_cause, 800) || null,
      recommended_action: action,
      expected_direction: text(r.expected_direction, 300) || null,
      priority: PRIORITIES.includes(r.priority) ? r.priority : 'medium',
      confidence: CONFIDENCES.includes(r.confidence) ? r.confidence : 'low',
      risk: text(r.risk, 500) || null,
      success_metric: text(r.success_metric, 300) || null,
      monitoring_period: text(r.monitoring_period, 120) || null,
    });
  }
  return { recommendations: out, data_limitations: (Array.isArray(raw?.data_limitations) ? raw.data_limitations : []).map((x) => text(x, 300)).filter(Boolean).slice(0, 4) };
}

// The same recommendation, again: one per entity and category.
export const fingerprintOf = (r) => [r.entity_type, r.entity_type === 'account' ? 'account' : (r.entity_id ?? String(r.entity_name ?? '').toLowerCase()), r.category].join('|');

// insert | refresh (an open one exists) | skip (dismissed recently).
// A completed or long-dismissed one gets a fresh row: it is a new episode.
export function dedupeDecision(latest, now = new Date()) {
  if (!latest) return { action: 'insert' };
  if (!['completed', 'dismissed'].includes(latest.status)) return { action: 'refresh', id: latest.id };
  if (latest.status === 'dismissed') {
    const since = new Date(latest.status_updated_at ?? latest.last_seen_at);
    if (now - since < DISMISS_QUIET_DAYS * 864e5) return { action: 'skip' };
  }
  return { action: 'insert' };
}

export async function listRecommendations(brandId) {
  await assertBrand(brandId);
  return { recommendations: await repo.listRecommendations(brandId) };
}

export async function generateRecommendations({ brandId, oldStart, oldEnd, curStart, curEnd, userId }) {
  const brand = await assertBrand(brandId);
  const [report, profile, existing, experiments] = await Promise.all([
    getReport({ brandId, oldStart, oldEnd, curStart, curEnd }),
    library.getProfile(brandId).catch(() => null),
    repo.listRecommendations(brandId),
    repo.listExperiments(brandId),
  ]);
  if (!report.cur.totals.cost && !report.cur.totals.impressions) throw new AppError('Tidak ada data Google Ads pada periode ini untuk dianalisis', 400);
  const active = existing.filter((r) => !['completed', 'dismissed'].includes(r.status));
  const input = buildRecommendationInput({ report, profile, brandName: brand.brand_name, active, experiments, oldStart, oldEnd, curStart, curEnd });
  const raw = await requestGeminiJson(buildRecommendationPrompt(input), REC_SCHEMA);
  const { recommendations, data_limitations: limitations } = validateRecommendations(raw, { campaigns: report.cur.campaigns });

  const recs = recommendations.map((r) => ({ ...r, fingerprint: fingerprintOf(r), source: 'ai', model: MODEL, period_start: curStart, period_end: curEnd }));
  const latest = new Map((await repo.latestByFingerprint(brandId, recs.map((r) => r.fingerprint))).map((l) => [l.fingerprint, l]));
  const tally = { inserted: 0, refreshed: 0, skipped: 0 };
  for (const r of recs) {
    const d = dedupeDecision(latest.get(r.fingerprint));
    if (d.action === 'insert') { await repo.insertRecommendation(brandId, r, userId); tally.inserted += 1; }
    else if (d.action === 'refresh') { await repo.refreshRecommendation(d.id, r); tally.refreshed += 1; }
    else tally.skipped += 1;
  }
  return { ...tally, data_limitations: limitations, recommendations: await repo.listRecommendations(brandId) };
}

export async function updateRecommendation({ brandId, id, status, notes, userId }) {
  await assertBrand(brandId);
  if (status != null && !REC_STATUSES.includes(status)) throw new AppError('Status tidak dikenal', 400);
  const n = await repo.updateRecommendation(id, brandId, { status, notes: notes === undefined ? undefined : text(notes, 2000) || null, userId });
  if (!n) throw new AppError('Rekomendasi tidak ditemukan', 404);
  return repo.getRecommendation(id, brandId);
}

// ── MOM task ────────────────────────────────────────────────────────
// Appends one task to the MIL to-do of a MOM record, under the PIC's
// heading (taskGroups in utils/momTasks.js reads "Name:" lines as headings).
// The key is built the way taskGroups builds it, so ticking the task in
// MOM is visible on the recommendation.
export function appendMomTask(todoMil, pic, taskText) {
  const name = text(pic, 60).replace(/:+$/, '') || 'MIL';
  let line = text(taskText, 280).replace(/^[-•✓*]\s*/, '');
  if (/:$/.test(line)) line = `${line.slice(0, -1)}.`;
  const lines = String(todoMil ?? '').split('\n');
  const isHeading = (l) => /^[^:]{1,60}:$/.test(l.trim().replace(/^[-•✓*]\s*/, ''));
  const headingAt = lines.findIndex((l) => isHeading(l) && l.trim().replace(/^[-•✓*]\s*/, '').slice(0, -1).trim().toLowerCase() === name.toLowerCase());
  let groupName = name;
  if (headingAt >= 0) {
    groupName = lines[headingAt].trim().replace(/^[-•✓*]\s*/, '').slice(0, -1).trim();
    let end = headingAt + 1;
    while (end < lines.length && !isHeading(lines[end])) end += 1;
    while (end > headingAt + 1 && !lines[end - 1].trim()) end -= 1;
    lines.splice(end, 0, `- ${line}`);
  } else {
    const body = lines.join('\n').replace(/\s+$/, '');
    return { todo: `${body ? `${body}\n\n` : ''}${name}:\n- ${line}`, key: `mil|${name}|${line}`.toLowerCase() };
  }
  return { todo: lines.join('\n'), key: `mil|${groupName}|${line}`.toLowerCase() };
}

export async function recommendationToTask({ brandId, id, pic, userId }) {
  await assertBrand(brandId);
  const rec = await repo.getRecommendation(id, brandId);
  if (!rec) throw new AppError('Rekomendasi tidak ditemukan', 404);
  if (rec.task_key) throw new AppError('Rekomendasi ini sudah menjadi tugas', 409);
  const minute = await repo.latestMinute(brandId);
  if (!minute) throw new AppError('Brand ini belum punya catatan MOM. Buat MOM dulu di Pengaturan Brand › MOM, lalu jadikan tugas.', 409);
  const where = rec.entity_name ? ` (${rec.entity_name})` : '';
  const { todo, key } = appendMomTask(minute.todo_mil, pic, `[Google Ads] ${rec.title}${where} — ${rec.recommended_action}`);
  await repo.setMinuteTodoMil(minute.id, todo, userId);
  await repo.linkTask(id, { minuteId: minute.id, taskKey: key, userId });
  return repo.getRecommendation(id, brandId);
}

// =====================================================================
// Experiments
// =====================================================================
export const EXPERIMENT_METRICS = ['cpa', 'conversions', 'cvr', 'ctr', 'cpc', 'roas', 'cost', 'conversions_value', 'impressions', 'clicks'];
const VOLUME_METRICS = new Set(['conversions', 'cost', 'conversions_value', 'impressions', 'clicks']);
const METRIC_FIELD = { cpa: 'cost_per_conv', cvr: 'cvr', ctr: 'ctr', cpc: 'avg_cpc', roas: 'roas', conversions: 'conversions', cost: 'cost', conversions_value: 'conversions_value', impressions: 'impressions', clicks: 'clicks' };
export const EXPERIMENT_RULES = { minChange: 0.1, minConversions: 10, minClicks: 100, minImpressions: 1000 };

export function metricValue(metrics, metric, days) {
  const r = withRatios(metrics ?? {});
  const v = r[METRIC_FIELD[metric]];
  return VOLUME_METRICS.has(metric) ? safeDiv(v, days) : v;
}

// Before vs after, with the reasons the answer may not be the change's
// doing. Volume metrics are compared per day so periods of different
// length stay comparable.
export function experimentVerdict({ metric, direction, baseline, evaluation, baselineDays, evalDays, otherChanges = [], overlapping = [] }, rules = EXPERIMENT_RULES) {
  const b = metricValue(baseline, metric, baselineDays);
  const e = metricValue(evaluation, metric, evalDays);
  const change = pctChange(b, e).value;
  const limitations = ['Perbandingan sebelum–sesudah, bukan uji terkontrol: musim, kompetitor, dan permintaan juga bisa berubah.'];
  const convMetric = ['cpa', 'conversions', 'cvr', 'roas', 'conversions_value'].includes(metric);
  const clickMetric = ['ctr', 'cpc', 'clicks'].includes(metric);
  const enough = convMetric
    ? (baseline?.conversions ?? 0) >= rules.minConversions && (evaluation?.conversions ?? 0) >= rules.minConversions
    : clickMetric
      ? (baseline?.clicks ?? 0) >= rules.minClicks && (evaluation?.clicks ?? 0) >= rules.minClicks
      : (baseline?.impressions ?? 0) >= rules.minImpressions && (evaluation?.impressions ?? 0) >= rules.minImpressions;
  if (!enough) limitations.push(`Volume belum cukup (butuh ≥ ${convMetric ? `${rules.minConversions} konversi` : clickMetric ? `${rules.minClicks} klik` : `${rules.minImpressions} impresi`} di kedua periode).`);
  if (baselineDays !== evalDays) limitations.push(`Panjang periode berbeda (${baselineDays} vs ${evalDays} hari)${VOLUME_METRICS.has(metric) ? '; dibandingkan per hari' : ''}.`);
  if (otherChanges.length) limitations.push(`${otherChanges.length} perubahan lain tercatat di Change History selama periode evaluasi — hasil tidak bisa diatribusikan ke satu perubahan saja.`);
  if (overlapping.length) limitations.push(`Eksperimen lain berjalan bersamaan pada entity yang sama: ${overlapping.map((o) => o.hypothesis).join('; ').slice(0, 200)}.`);
  let verdict = 'inconclusive';
  if (enough && change != null && Math.abs(change) >= rules.minChange) {
    const good = direction === 'increase' ? change > 0 : change < 0;
    verdict = good ? 'improved' : 'declined';
  }
  return { metric, baseline_value: b, evaluation_value: e, change, verdict, limitations };
}

function validateExperiment(input, { partial = false } = {}) {
  const out = {};
  const dates = ['start_date', 'evaluation_date', 'baseline_start', 'baseline_end', 'eval_start', 'eval_end'];
  for (const d of dates) {
    if (input[d] === undefined) continue;
    if (input[d] !== null && !ISO_DATE.test(input[d])) throw new AppError(`${d} harus format YYYY-MM-DD`, 400);
    out[d] = input[d];
  }
  for (const f of ['hypothesis', 'planned_action', 'actual_change', 'pic', 'notes', 'campaign_id', 'campaign_name', 'customer_id']) {
    if (input[f] !== undefined) out[f] = input[f] == null ? null : text(input[f], f === 'notes' ? 4000 : 1000) || null;
  }
  if (input.success_metric !== undefined) {
    if (!EXPERIMENT_METRICS.includes(input.success_metric)) throw new AppError('Success metric tidak dikenal', 400);
    out.success_metric = input.success_metric;
  }
  if (input.expected_direction !== undefined) {
    if (!['increase', 'decrease'].includes(input.expected_direction)) throw new AppError('Arah perubahan harus increase atau decrease', 400);
    out.expected_direction = input.expected_direction;
  }
  if (input.status !== undefined) {
    if (!['planned', 'running', 'evaluating', 'completed', 'cancelled'].includes(input.status)) throw new AppError('Status tidak dikenal', 400);
    out.status = input.status;
  }
  if (input.recommendation_id !== undefined) out.recommendation_id = input.recommendation_id ? Number(input.recommendation_id) : null;
  if (!partial) {
    for (const f of ['hypothesis', 'start_date', 'baseline_start', 'baseline_end', 'eval_start', 'eval_end', 'success_metric', 'expected_direction']) {
      if (!out[f]) throw new AppError(`${f} wajib diisi`, 400);
    }
  }
  if (out.baseline_start && out.baseline_end && out.baseline_start > out.baseline_end) throw new AppError('Periode baseline tidak valid', 400);
  if (out.eval_start && out.eval_end && out.eval_start > out.eval_end) throw new AppError('Periode evaluasi tidak valid', 400);
  return out;
}

async function campaignOf(brandId, exp) {
  if (!exp.campaign_id) return null;
  const accounts = await gaRepo.listAccounts(brandId);
  if (exp.customer_id && !accounts.some((a) => a.customer_id === exp.customer_id)) throw new AppError('Akun Google Ads tidak ditemukan di brand ini', 404);
  return { campaign_id: exp.campaign_id, customer_id: exp.customer_id ?? accounts[0]?.customer_id ?? null };
}

export async function listExperiments(brandId) {
  await assertBrand(brandId);
  return { experiments: await repo.listExperiments(brandId) };
}

export async function createExperiment({ brandId, input, userId }) {
  await assertBrand(brandId);
  const exp = validateExperiment(input);
  exp.status = exp.status ?? 'planned';
  const campaign = await campaignOf(brandId, exp);
  if (campaign) exp.customer_id = campaign.customer_id;
  // The baseline as it stood when the experiment was recorded: later
  // re-fetches may move it (late conversions), and the result says so.
  const base = await repo.campaignMetrics(brandId, campaign, exp.baseline_start, exp.baseline_end);
  exp.baseline_snapshot = { captured_at: new Date().toISOString(), ...withRatios(base), days_with_data: base.days_with_data };
  const id = await repo.insertExperiment(brandId, exp, userId);
  return repo.getExperiment(id, brandId);
}

export async function updateExperiment({ brandId, id, input }) {
  await assertBrand(brandId);
  const patch = validateExperiment(input, { partial: true });
  const n = await repo.updateExperiment(id, brandId, patch);
  if (!n && Object.keys(patch).length) throw new AppError('Eksperimen tidak ditemukan', 404);
  return repo.getExperiment(id, brandId);
}

export async function deleteExperiment({ brandId, id }) {
  await assertBrand(brandId);
  if (!(await repo.deleteExperiment(id, brandId))) throw new AppError('Eksperimen tidak ditemukan', 404);
  return { ok: true };
}

export async function evaluateExperiment({ brandId, id, userId }) {
  await assertBrand(brandId);
  const exp = await repo.getExperiment(id, brandId);
  if (!exp) throw new AppError('Eksperimen tidak ditemukan', 404);
  const campaign = exp.campaign_id ? { campaign_id: exp.campaign_id, customer_id: exp.customer_id } : null;
  const [baseline, evaluation, changes, all] = await Promise.all([
    repo.campaignMetrics(brandId, campaign, exp.baseline_start, exp.baseline_end),
    repo.campaignMetrics(brandId, campaign, exp.eval_start, exp.eval_end),
    repo.changesBetween(brandId, exp.campaign_name, addDays(exp.start_date, 1), exp.eval_end),
    repo.listExperiments(brandId),
  ]);
  if (!evaluation.days_with_data) throw new AppError('Belum ada data Google Ads untuk periode evaluasi', 400);
  const overlapping = all.filter((o) => o.id !== exp.id && o.status !== 'cancelled' && (o.campaign_id ?? null) === (exp.campaign_id ?? null)
    && o.start_date <= exp.eval_end && o.eval_end >= exp.eval_start);
  const v = experimentVerdict({
    metric: exp.success_metric, direction: exp.expected_direction, baseline, evaluation,
    baselineDays: daysBetween(exp.baseline_start, exp.baseline_end), evalDays: daysBetween(exp.eval_start, exp.eval_end),
    otherChanges: changes, overlapping,
  });
  if (exp.baseline_snapshot && exp.baseline_snapshot.conversions != null && Math.abs((baseline.conversions ?? 0) - exp.baseline_snapshot.conversions) >= 1) {
    v.limitations.push(`Konversi baseline bergeser sejak dicatat (${exp.baseline_snapshot.conversions} → ${baseline.conversions}) karena konversi tertunda; evaluasi memakai angka terbaru.`);
  }
  if (exp.eval_end > addDays(todayJakarta(), -3)) v.limitations.push('Periode evaluasi belum lewat 3 hari: konversi tertunda mungkin belum masuk.');
  await repo.insertExperimentResult(id, {
    metric: exp.success_metric, baseline: { ...withRatios(baseline), days_with_data: baseline.days_with_data },
    evaluation: { ...withRatios(evaluation), days_with_data: evaluation.days_with_data }, change: v.change, verdict: v.verdict, limitations: v.limitations,
  }, userId);
  await repo.updateExperiment(id, brandId, {
    result: v.verdict, evaluation_date: todayJakarta(),
    status: exp.status === 'cancelled' ? 'cancelled' : exp.eval_end < todayJakarta() ? 'completed' : 'evaluating',
  });
  return { experiment: await repo.getExperiment(id, brandId), related_changes: changes.slice(0, 30) };
}

// =====================================================================
// Alerts
// =====================================================================
const ALERT_COOLDOWN_DAYS = 3;
const SYNC_STALE_HOURS = 48;
const ALERT_FINDINGS = {
  tracking_no_primary_conversion: 'Tidak ada konversi primer yang dihitung',
  conversions_stopped: 'Konversi berhenti',
  cpa_increase: 'CPA naik signifikan',
  cost_up_without_results: 'Biaya naik tanpa hasil sepadan',
  conversion_volume_drop: 'Volume konversi turun',
};

// What to open, refresh and resolve, given what is firing now. A key that
// was resolved stays resolved during its cooldown even if it fires again,
// so one borderline metric does not flap the alert open and shut.
export function computeAlertChanges(existing, active, now = new Date(), cooldownDays = ALERT_COOLDOWN_DAYS) {
  const byKey = new Map(existing.map((e) => [e.alert_key, e]));
  const activeKeys = new Set(active.map((a) => a.alert_key));
  const open = [];
  const refresh = [];
  for (const a of active) {
    const e = byKey.get(a.alert_key);
    if (!e) open.push(a);
    else if (e.status === 'resolved') {
      if (!e.cooldown_until || new Date(e.cooldown_until) <= now) open.push(a);
    } else refresh.push(a);
  }
  const until = new Date(now.getTime() + cooldownDays * 864e5).toISOString();
  const resolve = existing.filter((e) => e.status !== 'resolved' && !activeKeys.has(e.alert_key)).map((e) => ({ alert_key: e.alert_key, cooldown_until: until }));
  return { open, refresh, resolve };
}

// Rolling windows: the last 7 days with data against the 28 before. A week
// keeps one quiet or noisy day from raising an alert; the diagnostics rules
// add their own volume minimums on top.
export async function evaluateAlerts(brandId) {
  const accounts = await gaRepo.listAccounts(brandId);
  const active = [];
  const today = todayJakarta();
  const runs = await gaRepo.listRecentRuns(brandId, 50);
  for (const a of accounts.filter((x) => x.is_active)) {
    const own = runs.filter((r) => r.customerId === a.customer_id && r.status !== 'running');
    const last = own[0];
    const lastOk = own.find((r) => r.status === 'success');
    const label = a.account_name || a.customer_id;
    if (last?.status === 'failed') {
      active.push({ alert_key: `sync_failed|${a.customer_id}`, customer_id: a.customer_id, type: 'sync_failed', severity: 'high', title: 'Sinkronisasi Google Ads gagal', message: `Penarikan terakhir ${label} gagal: ${text(last.note, 200) || 'tanpa keterangan'}.`, data: { run: last.runId } });
    }
    if (!lastOk || Date.now() - new Date(lastOk.startedAt).getTime() > SYNC_STALE_HOURS * 36e5) {
      active.push({ alert_key: `sync_stale|${a.customer_id}`, customer_id: a.customer_id, type: 'sync_stale', severity: 'high', title: 'Data Google Ads tidak diperbarui', message: `Belum ada penarikan berhasil untuk ${label} dalam ${SYNC_STALE_HOURS} jam terakhir. Periksa Google Ads Script di akun klien.`, data: { last_success: lastOk?.startedAt ?? null } });
    }
  }

  const coverage = await gaRepo.coverage(brandId);
  const lastDate = coverage.map((c) => c.last_date).sort().at(-1);
  if (lastDate && lastDate < addDays(today, -3)) {
    active.push({ alert_key: 'data_stale', type: 'data_stale', severity: 'medium', title: 'Data harian tertinggal', message: `Data Google Ads terakhir tanggal ${lastDate}.`, data: { last_date: lastDate } });
  }

  if (lastDate) {
    const curStart = addDays(lastDate, -6);
    const oldStart = addDays(lastDate, -34);
    const oldEnd = addDays(lastDate, -7);
    const [cur, old, curTotals, oldTotals, settings, settingChanges, convRows, meta, map] = await Promise.all([
      gaRepo.reportCampaigns(brandId, curStart, lastDate), gaRepo.reportCampaigns(brandId, oldStart, oldEnd),
      gaRepo.reportTotals(brandId, curStart, lastDate), gaRepo.reportTotals(brandId, oldStart, oldEnd),
      datasetsRepo.latestCampaignSettings(brandId), datasetsRepo.campaignSettingChanges(brandId, addDays(today, -7), today),
      datasetsRepo.conversionsByCampaignAction(brandId, addDays(lastDate, -27), lastDate),
      datasetsRepo.listConversionActions(brandId), datasetsRepo.listGoalMap(brandId),
    ]);
    const currency = [...new Set(accounts.map((a) => a.currency_code).filter(Boolean))];
    const findings = diagnoseCampaigns({
      old: { campaigns: old.map(withRatios), totals: withRatios(oldTotals), days: 28 },
      cur: { campaigns: cur.map(withRatios), totals: withRatios(curTotals), days: 7 },
      settings, currency: currency.length === 1 ? currency[0] : null,
    });
    for (const f of findings.filter((x) => ALERT_FINDINGS[x.type] && x.severity !== 'low')) {
      active.push({
        alert_key: `${f.type}|${f.entity_type}|${f.entity_id ?? 'account'}`, customer_id: f.customer_id, type: f.type, severity: f.severity,
        title: ALERT_FINDINGS[f.type], message: `${f.entity_type === 'account' ? 'Seluruh akun' : f.entity_name}: ${f.facts[0]} (7 hari terakhir vs 28 hari sebelumnya).`,
        data: { facts: f.facts, window: `${curStart}..${lastDate}` },
      });
    }
    const IMPORTANT = new Set(['status', 'budget_amount', 'bidding_strategy_type', 'target_cpa', 'target_roas', 'target_impression_share', 'conversion_goals']);
    for (const ch of settingChanges) {
      const fields = (ch.changed_fields ?? []).filter((f) => IMPORTANT.has(f.field));
      if (!fields.length) continue;
      active.push({
        alert_key: `settings_changed|${ch.customer_id}|${ch.campaign_id}|${new Date(ch.valid_from).toISOString().slice(0, 10)}`, customer_id: ch.customer_id,
        type: 'settings_changed', severity: 'low', title: 'Budget atau bidding berubah',
        message: `${ch.campaign_name}: ${fields.map((f) => `${f.field.replace(/_/g, ' ')} ${JSON.stringify(f.from)} → ${JSON.stringify(f.to)}`).join('; ')}.`,
        data: { fields },
      });
    }
    const unverified = new Map();
    for (const a of classifyActions(convRows, meta, map)) {
      if (a.goal_source !== 'manual' && Number(a.all_conversions) > 0) unverified.set(`${a.customer_id}|${a.conversion_action_id}`, a.name);
    }
    if (unverified.size) {
      active.push({ alert_key: 'unverified_conversion_actions', type: 'unverified_conversion_actions', severity: 'low', title: 'Conversion action belum diklasifikasikan', message: `${unverified.size} conversion action aktif memakai tujuan bawaan: ${[...unverified.values()].slice(0, 5).join(', ')}. Verifikasi di Data Brand › Google Ads.`, data: { count: unverified.size } });
    }
  }

  const changes = computeAlertChanges(await repo.alertRows(brandId), active);
  await repo.applyAlertChanges(brandId, changes);
  return changes;
}

export async function listAlerts({ brandId, includeResolved = false, evaluate = true }) {
  await assertBrand(brandId);
  if (evaluate) await evaluateAlerts(brandId);
  return { alerts: await repo.listAlerts(brandId, { includeResolved }) };
}

export async function setAlertStatus({ brandId, id, status, userId }) {
  await assertBrand(brandId);
  if (!['acknowledged', 'resolved', 'open'].includes(status)) throw new AppError('Status tidak dikenal', 400);
  const until = status === 'resolved' ? new Date(Date.now() + ALERT_COOLDOWN_DAYS * 864e5).toISOString() : null;
  if (!(await repo.setAlertStatus(id, brandId, status, userId, until))) throw new AppError('Alert tidak ditemukan', 404);
  return { alerts: await repo.listAlerts(brandId) };
}
