// Classification metrics for the sentiment benchmark: accuracy, per-class
// precision / recall / F1, macro F1 and the confusion matrix. Pure; used by
// test/codeSentimentBenchmark.test.js and scripts/sentimentBenchmark.js.

export const LABELS = ['positive', 'neutral', 'negative'];

export function evaluate(pairs) {
  // pairs: [{ expected, predicted }]
  const matrix = Object.fromEntries(LABELS.map((e) => [e, Object.fromEntries(LABELS.map((p) => [p, 0]))]));
  let correct = 0;
  for (const { expected, predicted } of pairs) {
    if (!matrix[expected] || matrix[expected][predicted] === undefined) continue;
    matrix[expected][predicted] += 1;
    if (expected === predicted) correct += 1;
  }
  const perClass = {};
  for (const c of LABELS) {
    const tp = matrix[c][c];
    const fp = LABELS.reduce((a, e) => a + (e === c ? 0 : matrix[e][c]), 0);
    const fn = LABELS.reduce((a, p) => a + (p === c ? 0 : matrix[c][p]), 0);
    const support = tp + fn;
    const precision = tp + fp ? tp / (tp + fp) : null;
    const recall = support ? tp / support : null;
    const f1 = precision != null && recall != null && precision + recall ? (2 * precision * recall) / (precision + recall) : (support ? 0 : null);
    perClass[c] = { precision, recall, f1, support };
  }
  const present = LABELS.filter((c) => perClass[c].support > 0);
  const macroF1 = present.length ? present.reduce((a, c) => a + (perClass[c].f1 ?? 0), 0) / present.length : null;
  return { n: pairs.length, accuracy: pairs.length ? correct / pairs.length : null, macroF1, perClass, matrix };
}

const f = (v) => (v == null ? '  —  ' : v.toFixed(3));
export function formatReport(title, r) {
  const lines = [
    `${title} — n=${r.n}, accuracy ${f(r.accuracy)}, macro-F1 ${f(r.macroF1)}`,
    '  class     precision  recall   f1     support',
    ...LABELS.map((c) => `  ${c.padEnd(9)} ${f(r.perClass[c].precision)}      ${f(r.perClass[c].recall)}   ${f(r.perClass[c].f1)}  ${r.perClass[c].support}`),
    '  confusion (rows = label, cols = predicted: pos / neu / neg)',
    ...LABELS.map((e) => `  ${e.padEnd(9)} ${LABELS.map((p) => String(r.matrix[e][p]).padStart(4)).join(' ')}`),
  ];
  return lines.join('\n');
}
