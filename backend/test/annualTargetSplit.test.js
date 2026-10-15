import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../src/services/annualTargetService.js';

const { splitEqual, splitByWeight, runningMonth } = __test;
const sum = (a) => a.reduce((x, y) => x + y, 0);

test('splitEqual: 12 months add up exactly to the year', () => {
  for (const total of [4_000_000_000, 1_000_000_007, 11, 0]) {
    const parts = splitEqual(total, 12);
    assert.equal(parts.length, 12);
    assert.equal(sum(parts), total);
    assert.ok(parts.every((p) => Number.isInteger(p) && p >= 0));
  }
});

test('splitByWeight: keeps proportions and adds up exactly', () => {
  const parts = splitByWeight(1_000_000, [100, 300, 600]);
  assert.deepEqual(parts, [100_000, 300_000, 600_000]);
  assert.equal(sum(splitByWeight(999_999_999, [1, 1, 1, 7])), 999_999_999);
});

test('splitByWeight: all-zero weights fall back to an even split', () => {
  const parts = splitByWeight(300, [0, 0, 0]);
  assert.deepEqual(parts, [100, 100, 200 - 100]);
  assert.equal(sum(parts), 300);
});

test('an update spreads only the remainder over the remaining months', () => {
  // Year of 1.2 M split evenly; from October the target becomes 1.5 M.
  const months = splitEqual(1_200_000_000, 12);
  const past = months.slice(0, 9);
  const rest = months.slice(9);
  const remainder = 1_500_000_000 - sum(past);
  const shares = splitByWeight(remainder, rest);
  assert.equal(sum(past) + sum(shares), 1_500_000_000);
  assert.deepEqual(past, months.slice(0, 9)); // past months untouched
});

test('runningMonth: Jakarta month this year, January ahead, none for a past year', () => {
  // 31 Oct 2026 20:00 UTC is already 1 Nov in Jakarta.
  const now = new Date('2026-10-31T20:00:00Z');
  assert.equal(runningMonth(2026, now), 11);
  assert.equal(runningMonth(2027, now), 1);
  assert.equal(runningMonth(2025, now), null);
});
