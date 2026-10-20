import { _internals } from '../textAnalytics.js';
import { aspectOf } from './aspects.js';
import {
  BOOSTERS_AFTER, BOOSTERS_BEFORE, CONCESSIVE, CONTRAST, DAMPENERS, EMOJI, EMPHATIC_TAIL, ENGINE_VERSION, LANGUAGE_HINTS, NEGATORS, PHRASES, TERMS,
} from './lexicon.js';

// Google Reviews › the code-based sentiment engine. No API, no model file:
// a lexicon with rules, run in the backend in microseconds per review.
//
//   1. normalise   lower case, slang folded, stretched letters squeezed
//   2. tokenise    words and emoji; punctuation splits clauses
//   3. language    id / en / mixed / unknown from function words
//   4. score       phrase first, then words; each hit is turned by a
//                  negator, strengthened by a booster, softened by a
//                  dampener; a clause after "tapi/but" counts more, one
//                  under "meskipun/although" less
//   5. classify    compound = sum / sqrt(sum² + 15) (the VADER squash):
//                  ≥ 0.2 positive, ≤ −0.2 negative, else neutral
//   6. evidence    how much the reading rests on — "clear", "low_evidence"
//                  (one weak hit), "ambiguous" (praise and complaint of
//                  similar weight), "no_evidence" (nothing recognised). No
//                  invented confidence number.
//   7. aspects     what each clause is about, praised or criticised
//                  according to that clause's own score.
//
// Limits, stated where they bite: sarcasm ("bagus banget, 2 jam nunggu")
// reads as written; unusual slang and words outside the lexicon count for
// nothing; meaning carried by context rather than words is missed.

export { ENGINE_VERSION };
const ALPHA = 15;
const THRESHOLD = 0.2;
const NEGATION_REACH = 3;
const MINOR_CONTRAST = new Set(['cuma', 'hanya']);
const { normaliseToken } = _internals;

const SPLIT = /[.!?;:\n\r()[\]{}"“”|]+|,(?=\s)|\s[-–—]\s/;
const TOKEN = /[\p{L}\p{N}'’-]+|\p{Extended_Pictographic}/gu;

function tokenize(clause) {
  const out = [];
  for (const m of clause.match(TOKEN) ?? []) {
    if (/\p{Extended_Pictographic}/u.test(m)) { out.push({ t: m, emoji: true }); continue; }
    const n = normaliseToken(m);
    if (!n) continue;
    // raw: the word as written, for telling the language ("hasilnya").
    for (const part of n.split(' ')) if (part) out.push({ t: part, raw: m.toLowerCase() });
  }
  return out;
}

export function detectLanguage(tokens) {
  let id = 0;
  let en = 0;
  for (const { t, raw = t } of tokens) {
    if (LANGUAGE_HINTS.id.has(raw) || LANGUAGE_HINTS.id.has(t) || /.nya$/.test(raw)) id += 1;
    if (LANGUAGE_HINTS.en.has(raw)) en += 1;
  }
  if (!id && !en) return 'unknown';
  if (id >= 2 && en >= 2) return 'mixed';
  return id >= en ? 'id' : 'en';
}

function emojiWeight(e) {
  for (const [re, w] of EMOJI) if (re.test(e)) return w;
  return 0;
}

// Score one clause. Returns its hits (term, weight after rules) and the
// aspects it names.
function scoreClause(tokens) {
  const hits = [];
  const aspects = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.emoji) {
      const w = emojiWeight(tok.t);
      if (w) hits.push({ term: tok.t, weight: w });
      continue;
    }
    const a = aspectOf(tok.t);
    if (a && !aspects.includes(a.label)) aspects.push(a.label);

    // Longest phrase starting here, else the single word.
    let base = null;
    let len = 1;
    for (const [p, w] of PHRASES) {
      if (p.length > (base == null ? 0 : len) && p.every((word, k) => tokens[i + k]?.t === word)) {
        base = w;
        len = p.length;
      }
    }
    if (base == null) base = TERMS[tok.t] ?? null;
    const term = tokens.slice(i, i + len).map((x) => x.t).join(' ');
    if (base == null) continue;
    if (base === 0) { i += len - 1; continue; }
    for (let k = i; k < i + len; k += 1) {
      const asp = aspectOf(tokens[k].t);
      if (asp && !aspects.includes(asp.label)) aspects.push(asp.label);
    }

    let w = base;
    // "sudah (cukup) lama langganan": a duration, not a wait.
    if (tok.t === 'lama' && len === 1 && tokens.slice(Math.max(0, i - 2), i).some((x) => x.t === 'sudah' || x.t === 'dari')) continue;
    // Modifiers in the few words before it.
    let negated = false;
    let negStrength = 1;
    for (let k = i - 1; k >= Math.max(0, i - NEGATION_REACH); k -= 1) {
      const prev = tokens[k].t;
      if (TERMS[prev] != null && k < i - 1) break; // another sentiment word ends the reach
      if (NEGATORS.has(prev) && !negated) {
        negated = true;
        negStrength = NEGATORS.get(prev);
      } else if (BOOSTERS_BEFORE.has(prev) && k >= i - 2) {
        w *= BOOSTERS_BEFORE.get(prev);
      } else if (DAMPENERS.has(prev) && k >= i - 2) {
        w *= DAMPENERS.get(prev);
      }
    }
    // Boosters after it ("ramah banget", "mahal parah"); a booster used
    // here is not read again as a word of its own.
    const after = tokens[i + len]?.t;
    let used = 0;
    if (after && BOOSTERS_AFTER.has(after)) { w *= BOOSTERS_AFTER.get(after); used = 1; }

    if (negated) {
      if (w > 0) {
        w = -w * 0.8 * negStrength; // "tidak ramah"
      } else {
        // "tidak buruk" / "not bad": mildly positive, more with "at all".
        const tail = EMPHATIC_TAIL.some((t) => t.every((word, j) => tokens[i + len + j]?.t === word));
        w = Math.abs(w) * (tail ? 0.9 : 0.5) * negStrength;
      }
    }
    hits.push({ term: (negated ? 'NOT ' : '') + term, weight: Math.round(w * 100) / 100 });
    i += len - 1 + used;
  }
  return { hits, aspects };
}

// Split into clauses and weigh them: what follows "tapi/but" carries the
// point; what sits under "meskipun/although" is conceded.
function clauses(text) {
  const out = [];
  for (const raw of String(text).split(SPLIT)) {
    const tokens = tokenize(raw);
    if (!tokens.length) continue;
    let cur = [];
    let weight = 1;
    const flush = (next) => {
      if (cur.length) out.push({ tokens: cur, weight });
      cur = [];
      weight = next;
    };
    for (const tok of tokens) {
      if (MINOR_CONTRAST.has(tok.t)) { flush(1); continue; } // "…, cuma parkir sempit": a side note
      if (CONTRAST.has(tok.t)) {
        // Everything before the contrast in this sentence counts less.
        for (const c of out.slice(-1)) if (c.weight === 1) c.weight = 0.7;
        if (weight === 1 && cur.length) weight = 0.7;
        flush(1.5);
        continue;
      }
      if (CONCESSIVE.has(tok.t)) { flush(0.5); continue; }
      cur.push(tok);
    }
    flush(1);
  }
  return out;
}

const r2 = (v) => Math.round(v * 1000) / 1000;

// One review's text -> the reading stored per review.
export function analyzeText(text) {
  const parts = clauses(text ?? '');
  const allTokens = parts.flatMap((p) => p.tokens);
  const praises = new Set();
  const complaints = new Set();
  const aspects = new Set();
  const terms = [];
  let sum = 0;
  let pos = 0;
  let neg = 0;
  for (const p of parts) {
    const { hits, aspects: named } = scoreClause(p.tokens);
    let clauseScore = 0;
    for (const h of hits) {
      const w = h.weight * p.weight;
      clauseScore += w;
      if (w > 0) pos += w; else neg += -w;
      terms.push(h.term);
    }
    sum += clauseScore;
    for (const a of named) {
      aspects.add(a);
      if (clauseScore > 0.3) praises.add(a);
      else if (clauseScore < -0.3) complaints.add(a);
    }
  }
  const compound = sum / Math.sqrt(sum * sum + ALPHA);
  const sentiment = compound >= THRESHOLD ? 'positive' : compound <= -THRESHOLD ? 'negative' : 'neutral';
  const hitsCount = terms.length;
  const balance = pos && neg ? Math.min(pos, neg) / Math.max(pos, neg) : 0;
  const evidence = !hitsCount ? 'no_evidence'
    : balance >= 0.6 ? 'ambiguous'
      : hitsCount === 1 || Math.abs(compound) < 0.35 ? 'low_evidence'
        : 'clear';
  return {
    sentiment,
    score: r2(compound),
    evidence,
    language: detectLanguage(allTokens),
    terms: [...new Set(terms)].slice(0, 12),
    praises: [...praises],
    complaints: [...complaints],
    aspects: [...aspects],
    engineVersion: ENGINE_VERSION,
  };
}
