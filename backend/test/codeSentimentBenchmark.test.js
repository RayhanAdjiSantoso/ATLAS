// Benchmark of the Code-Based engine on a labelled set (test/fixtures/
// sentiment-benchmark-v1.json). Prints accuracy, per-class precision /
// recall / F1, macro F1 and the confusion matrix; fails only on a clear
// regression below the floor measured when the engine was written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeText } from '../src/services/googleReviews/codeSentiment/engine.js';
import { evaluate, formatReport } from '../src/services/googleReviews/codeSentiment/metrics.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const { items } = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures/sentiment-benchmark-v1.json'), 'utf8'));
const FLOOR_MACRO_F1 = Number(process.env.GR_BENCH_FLOOR) || 0.8;

test('code-based sentiment benchmark (labelled set v1)', (t) => {
  const pairs = items.map(([text, expected]) => ({ text, expected, predicted: analyzeText(text).sentiment }));
  const r = evaluate(pairs);
  t.diagnostic(`\n${formatReport('Code-Based, benchmark v1', r)}`);
  const wrong = pairs.filter((p) => p.expected !== p.predicted);
  t.diagnostic(`misclassified (${wrong.length}):\n${wrong.map((p) => `  [${p.expected} → ${p.predicted}] ${p.text}`).join('\n')}`);
  assert.ok(r.macroF1 >= FLOOR_MACRO_F1, `macro-F1 ${r.macroF1.toFixed(3)} below floor ${FLOOR_MACRO_F1}`);
});
