import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../src/services/reportRowsets.js';

const { pack, unpack, groupRows } = __test;

test('groupRows keeps each set in saved order and records where it began', () => {
  const rows = [
    { periodRole: 'old', channel: 'boost', extra: { a: 1 } },
    { periodRole: 'old', channel: 'boost', extra: { a: 2 } },
    { periodRole: 'old', channel: 'nonboost', extra: { a: 3 } },
    { periodRole: 'cur', channel: 'boost', extra: { a: 4 } },
    { periodRole: 'old', channel: 'boost', extra: null },
  ];
  const groups = groupRows('meta', rows);
  assert.deepEqual(groups.map((g) => [g.role, g.channel, g.seq, g.extras.length]), [
    ['old', 'boost', 0, 3], ['old', 'nonboost', 2, 1], ['cur', 'boost', 3, 1],
  ]);
  assert.deepEqual(groups[0].extras, [{ a: 1 }, { a: 2 }, null]);
});

test('TikTok rows (no channel) are filed under one set per period', () => {
  const groups = groupRows('tiktok', [{ periodRole: 'old', extra: {} }, { periodRole: 'cur', extra: {} }, { periodRole: 'old', extra: {} }]);
  assert.deepEqual(groups.map((g) => [g.role, g.channel, g.extras.length]), [['old', 'tiktok', 2], ['cur', 'tiktok', 1]]);
});

test('pack/unpack round-trips rows exactly, key order included', () => {
  const extras = [{ 'Campaign name': 'Sale 10.10', 'Amount spent (IDR)': 125000.5, Age: '25-34', __EMPTY: '' }, null, { 'Kata Pencarian': 'kemeja wanita ✨' }];
  const back = unpack(pack(extras));
  assert.deepEqual(back, extras);
  assert.deepEqual(Object.keys(back[0]), Object.keys(extras[0]));
});
