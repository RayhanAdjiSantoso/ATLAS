// Code-Based sentiment against hand-labelled reviews stored in the database.
//
//   node scripts/sentimentBenchmark.js <labels.json> [--ai]
//
// labels.json: { "businessId": 16, "labels": { "<external_id>": "positive" | "neutral" | "negative" } }
// Review texts are read from gr_reviews, so real reviews never have to be
// copied into the repository; keep the labels file outside it too. With
// --ai, the stored AI readings of the same reviews are scored as well (no
// API call — only what an AI run already saved).
import fs from 'fs';
import pool from '../src/config/db.js';
import { analyzeText } from '../src/services/googleReviews/codeSentiment/engine.js';
import { evaluate, formatReport } from '../src/services/googleReviews/codeSentiment/metrics.js';

const [file, flag] = process.argv.slice(2);
if (!file) { console.error('Usage: node scripts/sentimentBenchmark.js <labels.json> [--ai]'); process.exit(1); }
const { businessId, labels } = JSON.parse(fs.readFileSync(file, 'utf8'));
const ids = Object.keys(labels);
const { rows } = await pool.query(
  `SELECT r.external_id, r.text, a.sentiment AS ai
   FROM public.gr_reviews r
   LEFT JOIN public.gr_review_analysis a ON a.review_id = r.id AND a.method = 'ai' AND a.content_hash = r.content_hash
   WHERE r.business_id = $1 AND r.external_id = ANY($2) AND r.text IS NOT NULL`,
  [businessId, ids],
);
const code = rows.map((r) => ({ expected: labels[r.external_id], predicted: analyzeText(r.text).sentiment, text: r.text }));
console.log(formatReport(`Code-Based, ${rows.length} labelled reviews (business ${businessId})`, evaluate(code)));
const wrong = code.filter((p) => p.expected !== p.predicted);
if (wrong.length) console.log(`\nMisclassified (${wrong.length}):\n${wrong.map((p) => `  [${p.expected} → ${p.predicted}] ${p.text.replace(/\s+/g, ' ').slice(0, 140)}`).join('\n')}`);
if (flag === '--ai') {
  const ai = rows.filter((r) => r.ai).map((r) => ({ expected: labels[r.external_id], predicted: r.ai }));
  console.log(ai.length ? `\n${formatReport('AI-Based (stored readings)', evaluate(ai))}` : '\nAI-Based: no stored AI readings for these reviews.');
}
await pool.end();
