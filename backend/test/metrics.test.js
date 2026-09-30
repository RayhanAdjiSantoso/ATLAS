import test from 'node:test';
import assert from 'node:assert/strict';
import { adMetrics, adRowObj } from '../src/services/internalDashboardService.js';

test('aggregate ROAS = SUM(revenue) / SUM(spend), not the mean of monthly ROAS', () => {
  const months = [{ rev: 100, spend: 10 }, { rev: 300, spend: 100 }];
  const rev = months.reduce((s, m) => s + m.rev, 0);
  const ad = adRowObj({ spend: months.reduce((s, m) => s + m.spend, 0) });
  assert.equal(adMetrics(rev, ad).blended_roas, 400 / 110);
  assert.notEqual(adMetrics(rev, ad).blended_roas, (10 + 3) / 2);
});

test('CPM over two platforms is recomputed from summed raw, not averaged', () => {
  const ad = adRowObj({ spend: 100 + 100, impressions: 1000 + 4000, link_clicks: 10 + 10 });
  assert.equal(adMetrics(null, ad).cpm, (200 / 5000) * 1000); // 40
  assert.notEqual(adMetrics(null, ad).cpm, (100 + 25) / 2); // mean of per-platform CPMs = 62.5
});

test('missing raw values stay null, never 0', () => {
  const ad = adRowObj({ spend: 100, impressions: null, link_clicks: null, purchase: null });
  const m = adMetrics(null, ad);
  assert.equal(m.cpm, null);
  assert.equal(m.cpc, null);
  assert.equal(m.cpp, null);
  assert.equal(m.blended_roas, null, 'no revenue -> no ROAS');
});
