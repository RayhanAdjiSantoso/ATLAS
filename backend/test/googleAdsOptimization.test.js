import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRecommendations, fingerprintOf, dedupeDecision, appendMomTask, experimentVerdict, computeAlertChanges, metricValue, validateAdCopy,
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
  assert.equal(fingerprintOf({ entity_type: 'campaign', entity_id: '111', category: 'budget' }), 'campaign|111|budget');
  assert.equal(fingerprintOf({ entity_type: 'account', entity_id: null, category: 'tracking' }), 'account|account|tracking');
  assert.equal(fingerprintOf({ entity_type: 'keyword', entity_id: null, entity_name: 'Florist KL', category: 'keywords' }), 'keyword|florist kl|keywords');
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
  assert.equal(v.verdict, 'improved', '1.5/day vs 1/day');
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
  const ch = computeAlertChanges(existing, active, now, 3);
  assert.deepEqual(ch.open.map((x) => x.alert_key), ['d', 'e']);
  assert.deepEqual(ch.refresh.map((x) => x.alert_key), ['a']);
  assert.deepEqual(ch.resolve.map((x) => x.alert_key), ['b']);
  assert.equal(ch.resolve[0].cooldown_until, '2026-10-08T00:00:00.000Z');
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
  }, { existing: ['Florist KL Same Day'], keywords: ['dried flowers', 'florist kl'] });
  assert.deepEqual(out.headlines.map((h) => h.text), ['Dried Flowers Kuala Lumpur', 'Preserved Blooms That Last']);
  assert.deepEqual(out.headlines.map((h) => h.has_keyword), [true, false]);
  assert.equal(out.headlines[0].length, 26);
  assert.equal(out.headlines[1].rationale, null);
  assert.deepEqual(out.descriptions.map((d) => d.text), ['Handcrafted dried flower bouquets, delivered across Klang Valley.']);
  assert.deepEqual(out.dropped.map((d) => d.reason), ['lebih dari 30 karakter', 'headline tidak boleh memakai tanda seru', 'duplikat', 'duplikat', 'lebih dari satu tanda seru', 'lebih dari 90 karakter']);
  assert.deepEqual(out.notes, ['Ganti headline berlabel Low']);
});
