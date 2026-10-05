import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRecommendations, fingerprintOf, dedupeDecision, appendMomTask, experimentVerdict, computeAlertChanges, metricValue, validateAdCopy,
  checkRecommendation, softenWording,
} from '../src/services/googleAdsOptimization.js';
import { taskGroups } from '../src/utils/momTasks.js';

const campaigns = [{ customer_id: '1', campaign_id: '111', campaign_name: '[Search] Bouquets' }];
const rec = (o = {}) => ({
  entity_type: 'campaign', entity_id: '111', entity_name: '[Search] Bouquets', category: 'budget', title: 'Evaluasi budget Bouquets',
  finding: 'Lost IS (budget) 32%', evidence: ['Lost IS (budget) 32.0%'], possible_cause: 'Kemungkinan budget habis siang hari',
  recommended_action: 'Geser budget dari Dried Flowers', priority: 'high', confidence: 'medium', risk: 'CPA naik', success_metric: 'Konversi naik', monitoring_period: '14 hari', ...o,
});

// ── recommendations ──────────────────────────────────────────────────
test('recommendations: unknown enums are coerced, unknown campaigns fall back to account, empty evidence is dropped', () => {
  const { recommendations, data_limitations: lim } = validateRecommendations({
    recommendations: [
      rec(),
      rec({ priority: 'URGENT', confidence: 'very', category: 'magic', entity_type: 'universe' }),
      rec({ entity_id: '999', entity_name: 'Campaign yang tidak ada' }),
      rec({ entity_id: '', entity_name: '[search] bouquets' }),
      rec({ evidence: [] }),
      rec({ title: '   ' }),
    ],
    data_limitations: ['Auction insights belum diunggah', ''],
  }, { campaigns });
  assert.equal(recommendations.length, 4);
  assert.deepEqual([recommendations[0].entity_type, recommendations[0].entity_id, recommendations[0].customer_id], ['campaign', '111', '1']);
  assert.deepEqual([recommendations[1].priority, recommendations[1].confidence, recommendations[1].category, recommendations[1].entity_type], ['medium', 'low', 'other', 'account']);
  assert.deepEqual([recommendations[2].entity_type, recommendations[2].entity_name], ['account', null], 'campaign not in the report');
  assert.equal(recommendations[3].entity_id, '111', 'matched by name');
  assert.deepEqual(lim, ['Auction insights belum diunggah']);
});

test('one recommendation per entity and category; dismissed stays quiet for 30 days', () => {
  assert.equal(fingerprintOf({ customer_id: '1', entity_type: 'campaign', entity_id: '111', category: 'budget', action_type: 'increase_budget' }), '1|campaign|111|budget|increase_budget');
  assert.equal(fingerprintOf({ entity_type: 'account', entity_id: null, category: 'tracking', action_type: 'fix_tracking' }), '|account|account|tracking|fix_tracking');
  assert.equal(fingerprintOf({ entity_type: 'keyword', entity_id: null, entity_name: 'Florist KL', category: 'keywords' }), '|keyword|florist kl|keywords|other');
  assert.notEqual(fingerprintOf({ entity_type: 'campaign', entity_id: '1', category: 'budget', action_type: 'increase_budget' }), fingerprintOf({ entity_type: 'campaign', entity_id: '1', category: 'budget', action_type: 'reallocate_budget' }), 'different actions are different recommendations');
  const now = new Date('2026-10-05T00:00:00Z');
  assert.deepEqual(dedupeDecision(null, now), { action: 'insert' });
  assert.deepEqual(dedupeDecision({ id: 4, status: 'planned' }, now), { action: 'refresh', id: 4 });
  assert.deepEqual(dedupeDecision({ id: 4, status: 'dismissed', status_updated_at: '2026-09-20T00:00:00Z' }, now), { action: 'skip' });
  assert.deepEqual(dedupeDecision({ id: 4, status: 'dismissed', status_updated_at: '2026-08-01T00:00:00Z' }, now), { action: 'insert' });
  assert.deepEqual(dedupeDecision({ id: 4, status: 'completed' }, now), { action: 'insert' });
});

// ── MOM task ─────────────────────────────────────────────────────────
test('a task lands under its PIC heading with the key MOM itself computes', () => {
  const before = 'Rayhan:\n- Kirim report Agustus\n\nDina:\n- Update katalog';
  const { todo, key } = appendMomTask(before, 'rayhan', '[Google Ads] Evaluasi budget — geser budget');
  assert.equal(todo, 'Rayhan:\n- Kirim report Agustus\n- [Google Ads] Evaluasi budget — geser budget\n\nDina:\n- Update katalog');
  const keys = taskGroups(todo, 'mil').flatMap((g) => g.tasks.map((t) => t.key));
  assert.ok(keys.includes(key), 'ticking it in MOM is visible on the recommendation');
});

test('a new PIC gets a heading; a task ending in ":" is not mistaken for a heading', () => {
  const { todo, key } = appendMomTask('', 'Tim Ads', 'Cek tracking:');
  assert.equal(todo, 'Tim Ads:\n- Cek tracking.');
  assert.deepEqual(taskGroups(todo, 'mil')[0].tasks.map((t) => t.key), [key]);
  const appended = appendMomTask('Dina:\n- Update katalog', 'Rayhan', 'Tugas baru');
  assert.equal(appended.todo, 'Dina:\n- Update katalog\n\nRayhan:\n- Tugas baru');
  assert.deepEqual(taskGroups(appended.todo, 'mil').map((g) => g.name), ['Dina', 'Rayhan']);
});

// ── experiments ──────────────────────────────────────────────────────
const m = (o) => ({ cost: 1000, impressions: 20000, clicks: 500, conversions: 20, conversions_value: 4000, all_conversions: 20, ...o });

test('experiment: improvement in the expected direction with enough volume', () => {
  const v = experimentVerdict({ metric: 'cpa', direction: 'decrease', baseline: m({}), evaluation: m({ cost: 800 }), baselineDays: 14, evalDays: 14 });
  assert.equal(v.verdict, 'improved');
  assert.equal(v.change, -0.2);
  assert.match(v.limitations[0], /bukan uji terkontrol/);
});

test('experiment: low volume, small change and the wrong direction', () => {
  assert.equal(experimentVerdict({ metric: 'cpa', direction: 'decrease', baseline: m({ conversions: 4 }), evaluation: m({ cost: 500, conversions: 4 }), baselineDays: 14, evalDays: 14 }).verdict, 'inconclusive');
  assert.equal(experimentVerdict({ metric: 'cpa', direction: 'decrease', baseline: m({}), evaluation: m({ cost: 1050 }), baselineDays: 14, evalDays: 14 }).verdict, 'inconclusive', '5% is noise');
  assert.equal(experimentVerdict({ metric: 'cvr', direction: 'increase', baseline: m({}), evaluation: m({ conversions: 14 }), baselineDays: 14, evalDays: 14 }).verdict, 'declined');
});

test('experiment: volume metrics per day across unequal periods; other changes and overlaps are listed', () => {
  assert.equal(metricValue(m({}), 'conversions', 10), 2);
  const v = experimentVerdict({
    metric: 'conversions', direction: 'increase', baseline: m({ conversions: 20 }), evaluation: m({ conversions: 15 }), baselineDays: 20, evalDays: 10,
    otherChanges: [{ changed_at: '2026-09-12' }], overlapping: [{ hypothesis: 'Phrase match Dried Flowers' }],
  });
  assert.equal(v.verdict, 'inconclusive', 'other changes in the window: no single-change claim');
  assert.equal(v.quality, 'multiple_changes');
  assert.ok(v.limitations.some((l) => /Panjang periode berbeda/.test(l)));
  assert.ok(v.limitations.some((l) => /1 perubahan lain/.test(l)));
  assert.ok(v.limitations.some((l) => /Phrase match Dried Flowers/.test(l)));
});

// ── alerts ───────────────────────────────────────────────────────────
test('alerts: open new, refresh firing, resolve stopped, no reopening inside the cooldown', () => {
  const now = new Date('2026-10-05T00:00:00Z');
  const existing = [
    { alert_key: 'a', status: 'open' },
    { alert_key: 'b', status: 'acknowledged' },
    { alert_key: 'c', status: 'resolved', cooldown_until: '2026-10-06T00:00:00Z' },
    { alert_key: 'd', status: 'resolved', cooldown_until: '2026-10-01T00:00:00Z' },
  ];
  const active = ['a', 'c', 'd', 'e'].map((k) => ({ alert_key: k }));
  const ch = computeAlertChanges(existing, active, now, () => 3);
  assert.deepEqual(ch.open.map((x) => x.alert_key), ['d', 'e']);
  assert.deepEqual(ch.refresh.map((x) => x.alert_key), ['a']);
  assert.deepEqual(ch.resolve.map((x) => x.alert_key), ['b']);
  assert.equal(ch.resolve[0].cooldown_until, '2026-10-08T00:00:00.000Z');
});

test('alerts: sticky tracking alerts reopen inside the cooldown; cooldown depends on the type', () => {
  const now = new Date('2026-10-05T00:00:00Z');
  const existing = [
    { alert_key: 'tracking_no_primary_conversion|account|account', type: 'tracking_no_primary_conversion', status: 'resolved', cooldown_until: '2026-10-09T00:00:00Z' },
    { alert_key: 'cpa_increase|campaign|1', type: 'cpa_increase', status: 'open' },
    { alert_key: 'sync_failed|1', type: 'sync_failed', status: 'open' },
  ];
  const active = [{ alert_key: 'tracking_no_primary_conversion|account|account', type: 'tracking_no_primary_conversion' }];
  const ch = computeAlertChanges(existing, active, now);
  assert.deepEqual(ch.open.map((x) => x.type), ['tracking_no_primary_conversion'], 'marking it done does not hide a live tracking problem');
  const byKey = Object.fromEntries(ch.resolve.map((r) => [r.alert_key, r.cooldown_until]));
  assert.equal(byKey['cpa_increase|campaign|1'], '2026-10-12T00:00:00.000Z', 'CPA alerts stay quiet 7 days');
  assert.equal(byKey['sync_failed|1'], null, 'a sync failure may alert again at once');
});

// ── ad copy ──────────────────────────────────────────────────────────
test('ad copy: Google limits are enforced by dropping, never by trimming', () => {
  const out = validateAdCopy({
    headlines: [
      { text: 'Dried Flowers Kuala Lumpur', rationale: 'keyword utama' },
      { text: 'Dried Flower Bouquets Delivered Same Day KL', rationale: 'terlalu panjang' },
      { text: 'Order Dried Flowers Now!', rationale: 'tanda seru' },
      { text: 'Florist KL Same Day', rationale: 'sudah ada' },
      { text: '  dried flowers kuala lumpur ', rationale: 'duplikat beda kapital' },
      { text: 'Preserved Blooms That Last', rationale: '' },
    ],
    descriptions: [
      { text: 'Handcrafted dried flower bouquets, delivered across Klang Valley.', rationale: 'pengiriman' },
      { text: 'Order now! Same day! Free card!', rationale: 'tiga tanda seru' },
      { text: 'x'.repeat(91), rationale: 'panjang' },
    ],
    notes: ['Ganti headline berlabel Low'],
  }, { existing: ['Florist KL Same Day'], keywords: ['dried flowers', 'florist kl'], context: 'Florist KL Same Day · delivered across Klang Valley' });
  assert.deepEqual(out.headlines.map((h) => h.text), ['Dried Flowers Kuala Lumpur', 'Preserved Blooms That Last']);
  assert.deepEqual(out.headlines.map((h) => h.has_keyword), [true, false]);
  assert.equal(out.headlines[0].length, 26);
  assert.equal(out.headlines[1].rationale, null);
  assert.deepEqual(out.descriptions.map((d) => d.text), ['Handcrafted dried flower bouquets, delivered across Klang Valley.']);
  assert.deepEqual(out.dropped.map((d) => d.reason), ['lebih dari 30 karakter', 'headline tidak boleh memakai tanda seru', 'duplikat', 'duplikat', 'lebih dari satu tanda seru', 'lebih dari 90 karakter']);
  assert.deepEqual(out.notes, ['Ganti headline berlabel Low']);
});

// ── recommendation validator (production QA cases) ───────────────────
const ctxOf = (o = {}) => ({
  campaigns: [
    { customer_id: '1', campaign_id: 'kl1', campaign_name: '[Search] Bouquets', conversions: 20, cost: 900, bidding: 'MAXIMIZE_CONVERSIONS', lost_budget: 0.32, utilization: 0.9, tracking_ok: true },
    { customer_id: '1', campaign_id: 'kl2', campaign_name: '[Search] Dried', conversions: 20, cost: 400, bidding: 'MAXIMIZE_CONVERSIONS', lost_budget: 0.02, utilization: 0.4, tracking_ok: true },
  ],
  keywords: new Map([
    ['bunga murah', [{ keyword: 'bunga murah', clicks: 3, conversions: 0, classification: 'insufficient_data' }]],
    ['bouquet delivery', [{ keyword: 'bouquet delivery', clicks: 120, conversions: 0, classification: 'no_conversion' }]],
  ]),
  terms: new Map([
    ['flowers', { search_term: 'flowers', clicks: 2, conversions: 0, classification: 'monitoring' }],
    ['cara merangkai bunga', { search_term: 'cara merangkai bunga', clicks: 40, conversions: 0, classification: 'informational' }],
    ['birthday bouquet', { search_term: 'birthday bouquet', clicks: 30, conversions: 3, classification: 'high_intent' }],
  ]),
  accountTrackingOk: true, conversionIssue: null, anyTarget: false, smartOnly: true, profileHasMargin: false, ...o,
});
const rec2 = (o) => ({ entity_type: 'campaign', entity_id: 'kl1', entity_name: '[Search] Bouquets', category: 'budget', action_type: 'increase_budget', title: 't', finding: 'f', evidence: ['e'], recommended_action: 'Naikkan budget 20%', priority: 'high', confidence: 'high', ...o });

test('Case 1 (JKT): no budget recommendation while there is no primary conversion', () => {
  const ctx = ctxOf({ accountTrackingOk: false, campaigns: ctxOf().campaigns.map((c) => ({ ...c, tracking_ok: false, conversions: 0 })) });
  assert.equal(checkRecommendation(rec2({}), ctx).ok, false);
  const fix = checkRecommendation(rec2({ category: 'tracking', action_type: 'fix_tracking', entity_type: 'account', entity_id: null, recommended_action: 'Jadikan Purchase primary' }), ctx);
  assert.equal(fix.ok, true, 'fixing tracking is always allowed');
});

test('Case 4/5: budget opportunity needs lost IS budget; lost IS rank alone is not a budget case', () => {
  assert.equal(checkRecommendation(rec2({}), ctxOf()).ok, true, 'Lost IS budget 32%, 20 conversions, tracking fine');
  const rank = checkRecommendation(rec2({ entity_id: 'kl2', entity_name: '[Search] Dried' }), ctxOf());
  assert.equal(rank.ok, false);
  assert.match(rank.reason, /tanpa bukti budget membatasi/);
});

test('Case 3/6: low-volume keywords and search terms are not paused or negated', () => {
  assert.equal(checkRecommendation(rec2({ entity_type: 'keyword', entity_id: null, entity_name: 'bunga murah', category: 'keywords', action_type: 'pause_keyword' }), ctxOf()).ok, false);
  assert.equal(checkRecommendation(rec2({ entity_type: 'keyword', entity_id: null, entity_name: 'bouquet delivery', category: 'keywords', action_type: 'pause_keyword' }), ctxOf()).ok, true);
  assert.equal(checkRecommendation(rec2({ entity_type: 'search_term', entity_id: null, entity_name: 'flowers', category: 'search_terms', action_type: 'add_negative_keyword' }), ctxOf()).ok, false, '2 clicks: requires review, not a negative');
  assert.equal(checkRecommendation(rec2({ entity_type: 'search_term', entity_id: null, entity_name: 'birthday bouquet', category: 'search_terms', action_type: 'add_negative_keyword' }), ctxOf()).ok, false, 'converting term');
  assert.equal(checkRecommendation(rec2({ entity_type: 'search_term', entity_id: null, entity_name: 'cara merangkai bunga', category: 'search_terms', action_type: 'add_negative_keyword' }), ctxOf()).ok, true, 'Case 7: clearly irrelevant, enough spend');
});

test('guardrails: invented targets, profit claims, delivery addresses, Smart Bidding bid adjustments', () => {
  assert.match(checkRecommendation(rec2({ category: 'bidding', action_type: 'adjust_target', recommended_action: 'Set target CPA RM45' }), ctxOf()).reason, /target/i);
  assert.match(checkRecommendation(rec2({ category: 'other', action_type: 'monitor', finding: 'CPA rendah sehingga campaign ini menguntungkan' }), ctxOf()).reason, /profit\/margin/);
  assert.match(checkRecommendation(rec2({ category: 'targeting', action_type: 'adjust_targeting', finding: 'Klik dari Penang berarti alamat pengiriman di luar area' }), ctxOf()).reason, /alamat pengiriman/);
  assert.match(checkRecommendation(rec2({ category: 'device', action_type: 'adjust_device', recommended_action: 'Tambahkan bid adjustment -20% untuk desktop' }), ctxOf()).reason, /Smart Bidding/);
});

test('wording is hedged, and confidence follows tracking health', () => {
  assert.equal(softenWording('Keyword ini harus di-pause karena CPA pasti naik, disebabkan oleh landing page'), 'Keyword ini disarankan dievaluasi untuk dijeda karena CPA kemungkinan besar naik, kemungkinan berkaitan dengan landing page');
  const r = checkRecommendation(rec2({ category: 'ads', action_type: 'improve_ad_copy', entity_id: 'kl1' }), ctxOf({ accountTrackingOk: false }));
  assert.equal(r.ok, true);
  assert.equal(r.rec.confidence, 'low');
});

test('ad copy: claims the brand does not already make are rejected, as is stuffing and shouting', () => {
  const out = validateAdCopy({
    headlines: [
      { text: 'Diskon 20% Bouquet KL' }, { text: 'Florist Terbaik di KL' }, { text: 'Same Day Bouquet KL' },
      { text: 'Bunga Bunga Bunga Segar' }, { text: 'FRESH Flowers Today' }, { text: 'Bouquets Delivered KL..' },
      { text: 'Fresh Bouquets in KL' },
    ],
    descriptions: [{ text: 'Garansi bunga segar 7 hari untuk setiap pesanan.' }],
    notes: [],
  }, { context: 'Florist KL Same Day · Handcrafted bouquets · same day delivery Klang Valley' });
  assert.deepEqual(out.headlines.map((h) => h.text), ['Same Day Bouquet KL', 'Fresh Bouquets in KL'], 'same day is in the context');
  const reasons = out.dropped.map((d) => d.reason);
  assert.ok(reasons.includes('klaim promo/diskon tidak ada di iklan, profil, atau data brand'));
  assert.ok(reasons.includes('klaim superlatif tidak ada di iklan, profil, atau data brand'));
  assert.ok(reasons.some((r) => /keyword stuffing/.test(r)));
  assert.ok(reasons.includes('huruf kapital berlebihan'));
  assert.ok(reasons.includes('tanda baca/simbol berlebihan'));
  assert.ok(reasons.includes('klaim garansi tidak ada di iklan, profil, atau data brand'));
});

test('Case 8 and experiment quality labels', () => {
  const base = { metric: 'cpa', direction: 'decrease', baseline: m({}), evaluation: m({ cost: 800 }), baselineDays: 14, evalDays: 14 };
  assert.deepEqual([experimentVerdict(base).verdict, experimentVerdict(base).quality], ['improved', 'clean_test']);
  assert.equal(experimentVerdict({ ...base, otherChanges: [{ changes: 'budget 90 → 120' }, { changes: 'lokasi' }] }).quality, 'multiple_changes');
  assert.equal(experimentVerdict({ ...base, evalDays: 7, baselineDays: 7 }).quality, 'short_duration');
  assert.equal(experimentVerdict({ ...base, baseline: m({ conversions: 4 }) }).quality, 'low_volume');
  const tracking = experimentVerdict({ ...base, evaluation: m({ conversions: 0, all_conversions: 40 }) });
  assert.deepEqual([tracking.verdict, tracking.quality], ['inconclusive', 'tracking_issue']);
  assert.equal(experimentVerdict({ ...base, evaluation: m({ cost: 980 }) }).quality, 'inconclusive', '2% change');
});
