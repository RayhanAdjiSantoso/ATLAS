import * as XLSX from 'xlsx';
import { deltaClassForSentiment, computeDelta, formatDeltaID } from './delta';
import { buildParsedPeriod, daysBetweenInclusive, emptyParsedPeriod, type ParsedPeriod } from './periodLabel';
import type { DeltaClassName, Sentiment, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// META ADS — ported 1:1 from the original vanilla-JS logic.
// ══════════════════════════════════════════════════════

export const DEFS = {
  boostPost: ['amount spent', 'profile visits', 'cost per profile visit'],
  nonBoost: ['amount spent', 'purchases', 'purchases conversion value', 'roas'],
  nonBoostDemo: ['amount spent', 'cost per add to cart', 'cost per purchase', 'roas'],
  cpasOverall: [
    'amount spent',
    'results',
    'cost per result',
    'purchases with shared',
    'purchases conversion value for shared',
    'purchase roas for shared',
  ],
  cpasDemo: ['amount spent', 'cost per adds to cart', 'cost per add to cart', 'cost per purchase with shared', 'purchase roas for shared'],
  cpasNV: [
    'amount spent',
    'results',
    'cost per result',
    'purchases with shared',
    'purchases conversion value for shared',
    'purchase roas for shared',
  ],
  cpasRM: [
    'amount spent',
    'results',
    'cost per result',
    'purchases with shared',
    'purchases conversion value for shared',
    'purchase roas for shared',
  ],
} as const;

export const SKIP_COLS = ['reporting starts', 'reporting ends', 'attribution setting', 'starts', 'ends'];
// 'day' covers Meta's per-day breakdown export (see parseMetaDayValue) —
// listed alongside 'month' since a file uses one or the other, never both.
export const DIM_NAMES = ['month', 'day', 'campaign name', 'age', 'gender'];
export const RATE_KW = ['cost', 'cpm', 'cpc', 'cpa', 'cpp', 'ctr', 'ratio', 'rate', 'roas', 'frequency', 'per '];

// NOTE: order matters — displayName() returns on the FIRST match, and every
// "Cost per X ... with shared items" header contains "X ... with shared
// items" as a literal substring (e.g. "Cost per purchases with shared
// items" contains "purchases with shared items"). So every "cost per ..."
// pattern below must be listed BEFORE its bare/base counterpart, or the
// cost column gets mislabeled with the base metric's name. Meta also
// varies singular/plural spelling per export ("purchase" vs "purchases",
// "add" vs "adds", "view" vs "views") so both variants are listed.
export const RENAME_MAP: { match: string; label: string }[] = [
  { match: 'purchases conversion value for shared items only', label: 'Purchases Conversion Value' },
  { match: 'purchase roas for shared items only', label: 'ROAS' },
  { match: 'cost per purchase with shared', label: 'Cost per Purchase' },
  { match: 'cost per purchases with shared', label: 'Cost per Purchase' },
  { match: 'cost per atc with', label: 'Cost per Add to Cart' },
  { match: 'cost per atc shared', label: 'Cost per Add to Cart' },
  { match: 'cost per add to cart with shared', label: 'Cost per Add to Cart' },
  { match: 'cost per adds to cart with shared', label: 'Cost per Add to Cart' },
  { match: 'cost per content view with shared', label: 'Cost per Content View' },
  { match: 'cost per content views with shared', label: 'Cost per Content View' },
  { match: 'cost per reach', label: 'Cost per Reach' },
  { match: 'cost per result', label: 'Cost per Result' },
  { match: 'purchases with shared items', label: 'Purchases' },
  { match: 'adds to cart with shared items', label: 'Add to Cart' },
  { match: 'content views with shared items', label: 'Content Views' },
  { match: 'purchases conversion value', label: 'Purchases Conversion Value' },
  { match: 'purchases', label: 'Purchases' },
  { match: 'cost per purchase', label: 'Cost per Purchase' },
  { match: 'cost per add to cart', label: 'Cost per Add to Cart' },
  { match: 'adds to cart', label: 'Add to Cart' },
];

export function displayName(col: string): string {
  const lc = col.toLowerCase();
  for (const r of RENAME_MAP) {
    if (lc.includes(r.match)) return r.label;
  }
  return col;
}

export function isSkip(col: string): boolean {
  const lc = col.toLowerCase();
  return SKIP_COLS.some((k) => lc === k || lc.startsWith(k)) || DIM_NAMES.some((k) => lc === k);
}

export function isNumericCol(col: string, rows: SheetRow[]): boolean {
  if (isSkip(col)) return false;
  // Check ALL rows (not just 20) and treat 0 and "" as potentially numeric
  // A col is numeric if at least one row has a parseable number (including 0)
  const vals = rows.map((r) => r[col]).filter((v) => v !== '' && v != null);
  if (!vals.length) return false;
  // If any value is a non-zero number or parseable string, include it
  const hasNumeric = vals.some((v) => {
    if (typeof v === 'number') return !isNaN(v);
    const s = String(v).trim().replace(/[Rp,%\s]/g, '').replace(/,/g, '');
    return s !== '' && !isNaN(parseFloat(s));
  });
  if (hasNumeric) return true;
  // Also include cols where all values are 0 (valid metric, just empty period)
  const allZeroOrEmpty = vals.every((v) => {
    if (typeof v === 'number') return v === 0 || isNaN(v);
    const s = String(v).trim().replace(/[Rp,%\s]/g, '').replace(/,/g, '');
    return s === '' || s === '0' || isNaN(parseFloat(s));
  });
  // Only include zero-cols if col name looks like a metric keyword
  if (allZeroOrEmpty) {
    return (
      RATE_KW.some((k) => col.toLowerCase().includes(k)) ||
      ['purchase', 'revenue', 'reach', 'impression', 'view', 'click', 'add to cart', 'conversion', 'visit', 'follow', 'like', 'comment', 'share', 'video', 'play', 'landing'].some((k) =>
        col.toLowerCase().includes(k),
      )
    );
  }
  return false;
}

export function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = String(v).trim().replace(/[Rp\s]/g, '').replace(/,/g, '');
  if (!s) return null;
  const pct = s.endsWith('%');
  const n = parseFloat(pct ? s.slice(0, -1) : s);
  return isNaN(n) ? null : n;
}

export const COST_PER_MAP: { cost: string; denom: string }[] = [
  { cost: 'cost per checkout initiated', denom: 'checkouts initiated' },
  { cost: 'cost per profile visit', denom: 'profile visit' },
  { cost: 'cost per instagram profile', denom: 'instagram profile visit' },
  // Meta's pivot "Boost Post" export names this "Cost Per IG Visit (IDR)" —
  // same figure as "Cost per Profile Visit" (Spend ÷ Instagram profile
  // visits), just a different header. Without this it falls through to the
  // generic path, which strips the prefix to "ig visit (idr)", finds no
  // matching count column, and shows "—".
  { cost: 'cost per ig visit', denom: 'instagram profile visit' },
  { cost: 'cost per follow', denom: 'instagram follow' },
  { cost: 'cost per messaging conversation', denom: 'messaging conversation' },
  { cost: 'cost per total message', denom: 'total message' },
  { cost: 'cost per message', denom: 'total message' },
  { cost: 'cost per purchase with', denom: 'purchases with shared' },
  { cost: 'cost per purchases with', denom: 'purchases with shared' },
  { cost: 'cost per purchase', denom: 'purchase' },
  { cost: 'cost per atc with', denom: 'adds to cart with shared' },
  { cost: 'cost per adds to cart with', denom: 'adds to cart with shared' },
  { cost: 'cost per atc', denom: 'adds to cart' },
  { cost: 'cost per add to cart', denom: 'adds to cart' },
  { cost: 'cost per adds to cart', denom: 'adds to cart' },
  { cost: 'cost per content view with', denom: 'content views with shared' },
  { cost: 'cost per content views with', denom: 'content views with shared' },
  { cost: 'cost per view content with', denom: 'content views with shared' },
  { cost: 'cost per content view', denom: 'content view' },
  { cost: 'cost per view content', denom: 'content view' },
  { cost: 'cost per reach', denom: 'reach' },
  { cost: 'cost per result', denom: 'results' },
  { cost: 'cost per revenue', denom: 'conversion value' },
  { cost: 'cost per conversion', denom: 'conversion' },
  { cost: 'cost per landing', denom: 'landing page view' },
  { cost: 'cost per video', denom: 'video play' },
  { cost: 'cost per thruplay', denom: 'thruplay' },
  { cost: 'cpc (cost per link', denom: 'link click' },
];

// CTR variants map to different click numerators — must match explicitly rather
// than guess, since "Clicks (all)" / "Link clicks" / "Outbound clicks" are not
// interchangeable.
export const CTR_MAP: { ctr: string; click: string }[] = [
  { ctr: 'ctr (link click-through rate)', click: 'link click' },
  { ctr: 'outbound ctr', click: 'outbound click' },
  { ctr: 'ctr (all)', click: 'clicks (all)' },
];

// A real denominator is a raw count/value column — never another ratio,
// rate, or "Cost per X" column that merely happens to contain the search
// keyword as a substring (unless the keyword itself is asking for that —
// e.g. "conversion value" legitimately matches a "…conversion value"
// column). Verified against a real export: searching for "purchase" as
// "Cost per Purchase"'s denominator (no bare "Purchases" count column in
// the file) matched "ATC to Purchase ratio" first — column order put it
// ahead of "Purchases conversion value" — computing spend ÷ a summed
// percentage column instead of failing safely to the concept-derived
// fallback in agg().
//
// '(%)' and 'roas' are noise too: Meta's pivot "CPAS" export ships a
// "Purchase (%)" ratio column AND a "Purchase ROAS for shared items only"
// column, both of which contain "purchase" and sort BEFORE the real
// "Purchases with shared items" count — without excluding them, "Cost Per
// Purchase" divided Spend by a summed percentage/ROAS column (verified: the
// displayed value matched Spend ÷ Purchase(%), not Spend ÷ Purchases).
export function findDenomCol(rows: SheetRow[], keyword: string, excludeCol?: string): string | null {
  const hs = Object.keys(rows[0] || {});
  const noiseWords = ['ratio', 'rate', 'value', 'cost per', '(%)', 'roas'].filter((w) => !keyword.includes(w));
  return (
    hs.find((h) => {
      if (h === excludeCol) return false;
      const lc = h.toLowerCase();
      if (!lc.includes(keyword)) return false;
      return !noiseWords.some((w) => lc.includes(w));
    }) || null
  );
}

export function findSpentCol(rows: SheetRow[]): string | null {
  const hs = Object.keys(rows[0] || {});
  return hs.find((h) => h.toLowerCase().includes('amount spent')) || null;
}

function literalSum(rows: SheetRow[], col: string): number | null {
  let s = 0;
  let found = false;
  rows.forEach((r) => {
    const v = parseNum(r[col]);
    if (v !== null) {
      s += v;
      found = true;
    }
  });
  return found ? s : null;
}

// True when a raw Age/Gender cell means "this dimension isn't broken out
// here" — either the literal text Meta/Ads-Manager exports use ("All",
// case-insensitive) or a blank cell, which is how a per-campaign/month row
// with every other dimension collapsed has shown up in real exports (e.g. a
// file's single blank-Campaign/Age/Gender/Month row representing an
// account-wide total — see splitMonths' month-matching, which already keeps
// a row like that out of any single month's old/cur rows before this ever
// runs). This is distinct from Meta's literal "Unknown" category text, which
// means the opposite — a real user whose age/gender Meta couldn't identify.
export function isAllValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return s === '' || s.toLowerCase() === 'all';
}

// Meta's pivot-style exports (breakdown hierarchy Month > Age > Gender >
// Campaign name) carry a SUBTOTAL row at every level that isn't fully
// broken out, marked by Campaign name = "All" (and, in exports that repeat
// the header, a blank cell in the *second* "Campaign name" column). Only
// leaf rows — a specific campaign — may be classified/aggregated: summing
// the subtotals in double-counts an entire copy of every campaign's spend
// (see buildMetaReport). This returns the header to test for "is this a
// leaf row": the last "Campaign name"-ish column (the one that's blank, not
// "All", on a subtotal in a repeated-header export), or the only one.
// Returns null when the file has no campaign column at all.
//
// A per-campaign Age=All/Gender=All rollup row (the plain "Formatted data
// table" export shape, which computeGroupedSum deliberately prefers) still
// has a real campaign name here, so `!isAllValue(row[col])` keeps it.
export function findLeafCampaignCol(rows: SheetRow[]): string | null {
  const hs = Object.keys(rows[0] || {});
  const camps = hs.filter((h) => h.toLowerCase().includes('campaign'));
  return camps.length ? camps[camps.length - 1] : null;
}

// THE fix for the pivot double-count bug — call it once, right after
// splitMonths / splitByDayRange, in every Meta breakdown entry point
// (buildMetaReport's Boost/Non-Boost path, its CPAS path, rowMapping's save
// path, …). Drops every subtotal row so only leaf (specific-campaign) rows
// reach classification and aggregation. Same root cause surfaced separately
// in the Boost Post and CPAS modules; keeping the rule in one shared helper
// means a module that forgets to call it is the only way to reintroduce it.
export function stripCampaignSubtotals(rows: SheetRow[]): SheetRow[] {
  const leafCol = findLeafCampaignCol(rows);
  return leafCol ? rows.filter((r) => !isAllValue(r[leafCol])) : rows;
}

// Splits rows into per-campaign+period groups — one group per campaign,
// further split by the raw Month/Day value so a multi-day Day-breakdown
// selection can't have one day's row merged with another day's. Returns
// `null` columns (ageCol/genderCol) when the file has no Age/Gender
// breakdown at all, so callers know grouping doesn't apply.
function groupRowsByCampaignPeriod(rows: SheetRow[]): { groups: SheetRow[][]; ageCol?: string; genderCol?: string } {
  const hs = Object.keys(rows[0] || {});
  const campCol = hs.find((h) => h.toLowerCase().includes('campaign'));
  const ageCol = hs.find((h) => h.toLowerCase().includes('age'));
  const genderCol = hs.find((h) => h.toLowerCase().includes('gender'));
  if (!campCol || (!ageCol && !genderCol)) return { groups: [rows] };
  const periodCol = hs.find((h) => h.toLowerCase().includes('month')) || hs.find((h) => h.toLowerCase().includes('day'));

  const map = new Map<string, SheetRow[]>();
  rows.forEach((r) => {
    const key = `${String(r[campCol] ?? '')}|${periodCol ? String(r[periodCol] ?? '') : ''}`;
    const group = map.get(key);
    if (group) group.push(r);
    else map.set(key, [r]);
  });
  return { groups: [...map.values()], ageCol, genderCol };
}

function findAllRow(groupRows: SheetRow[], ageCol?: string, genderCol?: string): SheetRow | undefined {
  if (!ageCol && !genderCol) return undefined;
  return groupRows.find((r) => (!ageCol || isAllValue(r[ageCol])) && (!genderCol || isAllValue(r[genderCol])));
}

function granularRows(groupRows: SheetRow[], ageCol?: string, genderCol?: string): SheetRow[] {
  if (!ageCol && !genderCol) return groupRows;
  const g = groupRows.filter((r) => (!ageCol || !isAllValue(r[ageCol])) && (!genderCol || !isAllValue(r[genderCol])));
  return g.length ? g : groupRows;
}

// Sums ANY metric column the way Ads Manager itself reports it: per
// campaign+period, prefer a row where Age/Gender are already rolled up to
// "All" (Meta's own number for that exact slice — e.g. a "Formatted data
// table" export's Age=All/Gender=All row for one campaign+month) over
// summing that campaign's individual Age/Gender breakdown rows.
//
// For a genuinely additive metric (Amount Spent, Impressions, Purchases…)
// this lands on the identical number either way — Meta's own total for a
// campaign really is the sum of its breakdown cells for those. It matters
// for a metric Meta computes as its own per-row estimate instead (Reach,
// and anything derived from it, like Frequency or Cost per Reach): a
// breakdown cell's Reach isn't a slice of one precise count, so summing
// cells doesn't reproduce the collapsed figure (verified against a real
// export: summing 11 Age×Gender rows for one campaign/month landed at
// 1,367,235, while Ads Manager's own Age=All/Gender=All figure for the same
// campaign/month was 1,397,733). Preferring the "All" row whenever the file
// has one sidesteps having to know which kind of metric this is, and always
// matches Ads Manager exactly when that row is present — this is also what
// keeps every metric consistent for both Boost Post and Non-Boost Post,
// since both read from the same per-campaign group.
//
// Falls back to summing a campaign's own granular (non-"All") rows only —
// deliberately excluding any intermediate rollup row (e.g. one Age bucket
// with Gender still "All"), which would double-count against the fully
// granular rows — when the campaign+period has no "All" row available; the
// file simply doesn't contain the number to read directly there, so summing
// remains the closest available approximation (flagged via `approximated`,
// so callers can warn that a specific figure — e.g. Reach — might be off).
function computeGroupedSum(rows: SheetRow[], col: string): { total: number | null; approximated: boolean } {
  const { groups, ageCol, genderCol } = groupRowsByCampaignPeriod(rows);
  let total = 0;
  let found = false;
  let approximated = false;
  for (const groupRows of groups) {
    const allRow = findAllRow(groupRows, ageCol, genderCol);
    let v: number | null;
    if (allRow) {
      v = parseNum(allRow[col]);
    } else {
      v = literalSum(granularRows(groupRows, ageCol, genderCol), col);
      // A lone non-"All" row is still exact (nothing else was summed in);
      // only >1 breakdown rows summed together without an "All" row to
      // prefer is the approximation-prone case.
      if (groupRows.length > 1) approximated = true;
    }
    if (v !== null) {
      total += v;
      found = true;
    }
  }
  return { total: found ? total : null, approximated };
}

// Same "prefer the campaign's own Age=All/Gender=All row" principle as
// computeGroupedSum, but for a column that can't be validly SUMMED across
// campaigns because it's already a ratio/percentage (CTR or CPC, whose true
// weight — Impressions — this app always has). Adding two campaigns' CTR
// percentages together is meaningless, so campaigns are instead combined via
// a weighted average against `weightCol`. For a single campaign this reduces
// to exactly that campaign's own "All" row value.
//
// This is the LAST-RESORT fallback for a "Cost per X"/ratio column with no
// concept mapping (see computeCostPerFallback/computeRatioFromConcepts
// below, which are exact where they apply — this one is only a rough
// approximation, since Impressions isn't every metric's true denominator).
function computeGroupedWeightedAvg(rows: SheetRow[], col: string, weightCol: string): number | null {
  const { groups, ageCol, genderCol } = groupRowsByCampaignPeriod(rows);
  let weightedSum = 0;
  let totalWeight = 0;
  for (const groupRows of groups) {
    const allRow = findAllRow(groupRows, ageCol, genderCol);
    // Weight EVERY contributing row individually by weightCol — never
    // collapse a group's own granular rows into a plain average first. A
    // Day-breakdown "Formatted data table" export has no Age=All/Gender=All
    // row for any single day (only for the whole exported file period,
    // which the selected date range excludes) — verified against a real
    // export, where averaging each day's ~10 Age×Gender rows unweighted
    // before weighting by that day's Impressions compounded across ~30
    // days into CTR (all) reading 1.93% instead of the correct 1.58%.
    // Weighting every row from the start keeps this exact regardless of how
    // many levels of grouping there are, since it's mathematically the same
    // as SUM(col·weight)/SUM(weight) over the raw rows either way.
    const rowsToWeight = allRow ? [allRow] : granularRows(groupRows, ageCol, genderCol);
    rowsToWeight.forEach((r) => {
      const v = parseNum(r[col]);
      const w = parseNum(r[weightCol]);
      if (v !== null && w !== null) {
        weightedSum += v * w;
        totalWeight += w;
      }
    });
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

// Known "X count" concepts this app can derive even when the file has no
// bare count column for that concept, by dividing Amount Spent by the
// file's own "Cost per X" column — Meta computed CostPerX = Spend/X for
// that exact row, so Spend/CostPerX recovers X exactly, not an estimate.
// Keyed to match COST_PER_MAP's own denom keywords.
const COST_PER_CONCEPT_COL: Record<string, string> = {
  'adds to cart': 'cost per add to cart',
  purchase: 'cost per purchase',
  // Meta's pivot "Boost Post" export has no raw Clicks column at all, only a
  // per-row "CPC (cost per link click)" — Link Clicks = Spend/CPC recovers it
  // exactly per row. Lets agg()'s CPC branch combine campaigns as
  // SUM(Spend)/SUM(implied clicks) instead of showing "—".
  'link click': 'cpc (cost per link',
};

// Same idea, mirrored: a count derivable from a percentage-point-scaled
// ratio column (see fmt()'s CTR-vs-"ratio" scale note) times a known count
// column — e.g. Clicks = CTR(all)/100 × Impressions. Used for CPC when the
// file has no bare Clicks column, the same way COST_PER_CONCEPT_COL covers
// Adds to Cart/Purchases.
const RATIO_DERIVED_CONCEPT_COL: Record<string, { ratioKeyword: string; countKeyword: string }> = {
  clicks: { ratioKeyword: 'ctr (all)', countKeyword: 'impression' },
};

// Sums `value(row)` across `rows` the same grouped, prefer-the-campaign's-
// own-Age=All/Gender=All-row way computeGroupedSum sums a raw metric column —
// the shared engine behind every "derive a count/total per row, then add
// them up" helper below (implied Clicks from Spend/CPC, implied Impressions
// from Clicks/(CTR/100), implied Adds-to-Cart from Spend/CostPerATC, …).
// Deriving PER ROW and only then summing is what keeps these exact once
// there's no "All" row to read directly and a group has many breakdown rows
// (see resolveConceptCount's docs). A `value` of null skips that row; a
// non-finite result (e.g. divide-by-zero) is skipped too.
function sumPerRow(rows: SheetRow[], value: (r: SheetRow) => number | null): number | null {
  const { groups, ageCol, genderCol } = groupRowsByCampaignPeriod(rows);
  let total = 0;
  let found = false;
  for (const groupRows of groups) {
    const allRow = findAllRow(groupRows, ageCol, genderCol);
    const rowsToSum = allRow ? [allRow] : granularRows(groupRows, ageCol, genderCol);
    rowsToSum.forEach((r) => {
      const v = value(r);
      if (v !== null && Number.isFinite(v)) {
        total += v;
        found = true;
      }
    });
  }
  return found ? total : null;
}

// Sums Spend_row/CostPerX_row per row across `rows` — the shared engine
// behind resolveConceptCount's "Cost per X" derivation.
function sumImpliedFromCostPer(rows: SheetRow[], spentCol: string, costPerCol: string): number | null {
  return sumPerRow(rows, (r) => {
    const spent = parseNum(r[spentCol]);
    const costPer = parseNum(r[costPerCol]);
    return spent !== null && costPer !== null && costPer !== 0 ? spent / costPer : null;
  });
}

// Sums (Ratio_row/100)·Count_row per row across `rows` — the shared engine
// behind resolveConceptCount's ratio-derived count (e.g. Clicks via CTR).
function sumImpliedFromRatio(rows: SheetRow[], ratioCol: string, countCol: string): number | null {
  return sumPerRow(rows, (r) => {
    const ratio = parseNum(r[ratioCol]);
    const count = parseNum(r[countCol]);
    return ratio !== null && count !== null ? (ratio / 100) * count : null;
  });
}

// Resolves a concept's total count across `rows`: a literal raw count
// column when the file has one (e.g. "Content views"), summed the same
// grouped/prefer-"All"-row way as any other additive metric — or, failing
// that, derived per row via COST_PER_CONCEPT_COL or RATIO_DERIVED_CONCEPT_COL
// when the file has the "Cost per X"/ratio column that derivation needs
// instead. Used by computeCostPerFallback and computeRatioFromConcepts
// below. Returns null when none of these are available.
//
// Deriving PER ROW (never averaging a "Cost per X"/ratio column across a
// group's rows first) matters once there's no Age=All/Gender=All row to
// read directly — a Day-breakdown "Formatted data table" export has no such
// row for any single day (only for the whole exported file period, which
// the selected date range excludes), so nearly every group falls into this
// branch. Averaging unweighted across a day's ~10 Age×Gender rows before
// dividing that day's spend by it was verified against a real export to
// badly distort the combined figure once compounded across ~30 days;
// summing each row's own exact implied value keeps this exact regardless of
// how many rows/days are involved.
//
// `excludeCol` (the calling metric's own column, e.g. "CPC (all)") guards
// the literal-count search against a short column name matching itself as
// its own concept source — verified against a real export: without it,
// resolving CPC's own "cpc (all)" as a made-up concept keyword found the
// "CPC (all)" column as its own denominator (findDenomCol's usual "cost
// per"-prefix self-match guard doesn't catch an abbreviated name like "CPC"
// that never spells that out). It does NOT apply to the derivation lookups
// below — resolving e.g. "adds to cart" for "Cost per add to cart" itself
// is meant to read that exact same column (that's the whole mechanism, not
// a self-match bug).
function resolveConceptCount(rows: SheetRow[], concept: string, excludeCol?: string): number | null {
  const literalCol = findDenomCol(rows, concept, excludeCol);
  if (literalCol) return aggSum(rows, literalCol);

  const hs = Object.keys(rows[0] || {});
  const spentCol = findSpentCol(rows);
  const costPerKeyword = COST_PER_CONCEPT_COL[concept];
  const costPerCol = costPerKeyword ? hs.find((h) => h.toLowerCase().includes(costPerKeyword)) : undefined;
  if (costPerCol && spentCol) return sumImpliedFromCostPer(rows, spentCol, costPerCol);

  const ratioSource = RATIO_DERIVED_CONCEPT_COL[concept];
  const ratioCol = ratioSource ? hs.find((h) => h.toLowerCase().includes(ratioSource.ratioKeyword)) : undefined;
  const countCol = ratioSource ? hs.find((h) => h.toLowerCase().includes(ratioSource.countKeyword)) : undefined;
  if (ratioCol && countCol) return sumImpliedFromRatio(rows, ratioCol, countCol);

  return null;
}

// "Cost per X" fallback for when the file has no raw X-count column at all
// (only Meta's own pre-computed "Cost per X" values) — combines campaigns
// via SUM(Spend)/SUM(implied X), where each campaign's implied X comes from
// resolveConceptCount. Exact, not an approximation: verified against a real
// export, "Cost per add to cart" computed this way across 10 non-boost
// campaigns landed at exactly Rp716,570 — matching Ads Manager and a manual
// SUM(Spend)/SUM(Adds to cart) check — while weight-averaging the literal
// "Cost per add to cart" values by Impressions (the previous fallback) did
// not.
function computeCostPerFallback(rows: SheetRow[], concept: string, spentCol: string, excludeCol?: string): number | null {
  const count = resolveConceptCount(rows, concept, excludeCol);
  if (count === null || count === 0) return null;
  const spent = aggSum(rows, spentCol);
  return spent !== null ? spent / count : null;
}

// "X to Y ratio" columns this app can recompute directly from resolved
// concept counts (numerator ÷ denominator) instead of weight-averaging the
// ratio column's own literal per-row values — exact wherever both concepts
// resolve, since it's built from the same real Spend/Content-Views numbers
// and "Cost per X" columns already used elsewhere. Verified against a real
// export: "View content to ATC ratio" (Adds to Cart ÷ Content Views) and
// "ATC to Purchase ratio" (Purchases ÷ Adds to Cart) both matched Ads
// Manager exactly computed this way (0.10% and 25.00%), while the old
// Impressions-weighted average of the literal ratio column did not.
const RATIO_CONCEPT_MAP: { ratio: string; numerConcept: string; denomConcept: string }[] = [
  { ratio: 'view content to atc ratio', numerConcept: 'adds to cart', denomConcept: 'content view' },
  { ratio: 'atc to purchase ratio', numerConcept: 'purchase', denomConcept: 'adds to cart' },
];

// Returns a plain 0–1 fraction (e.g. 0.0010243, not 0.10243) — the same
// scale Meta's own "X to Y ratio" columns use — so fmt()'s existing ×100
// for "ratio"-named columns applies uniformly regardless of which code path
// (this one, or reading the file's own value) produced the number.
function computeRatioFromConcepts(rows: SheetRow[], numerConcept: string, denomConcept: string, excludeCol?: string): number | null {
  const numer = resolveConceptCount(rows, numerConcept, excludeCol);
  const denom = resolveConceptCount(rows, denomConcept, excludeCol);
  if (numer === null || denom === null || denom === 0) return null;
  return numer / denom;
}

export function aggSum(rows: SheetRow[], col: string): number | null {
  return computeGroupedSum(rows, col).total;
}

// Base counts for Meta's pivot-export "ATC (%)" / "Purchase (%)" columns
// (per-row ratios that can't be summed or averaged across breakdown rows).
// ATC (%)      = Adds to Cart ÷ Link Clicks × 100
// Purchase (%) = Purchases    ÷ Adds to Cart × 100
// where Link Clicks is derived per row as Spend ÷ CPC (this export has no
// raw Clicks column). Combine campaigns from the SUMMED base counts, then
// take the ratio once — never average the raw ATC%/Purchase% cells.
function atcCountCol(rows: SheetRow[]): string | null {
  return findDenomCol(rows, 'adds to cart with shared') || findDenomCol(rows, 'adds to cart') || findDenomCol(rows, 'add to cart');
}
function purchaseCountCol(rows: SheetRow[]): string | null {
  return findDenomCol(rows, 'purchases with shared') || findDenomCol(rows, 'purchases') || findDenomCol(rows, 'purchase');
}
function linkClicksTotal(rows: SheetRow[]): number | null {
  const spentCol = findSpentCol(rows);
  const cpcCol = Object.keys(rows[0] || {}).find((h) => h.toLowerCase().includes('cpc') && h.toLowerCase().includes('link click'));
  return spentCol && cpcCol ? sumImpliedFromCostPer(rows, spentCol, cpcCol) : null;
}

// Used by buildMetaReport to decide whether reachApproxNote should surface —
// true when at least one campaign+period group in `rows` had no
// Age=All/Gender=All row to read Reach from directly and had to be summed
// from its breakdown cells instead.
export function reachIsApproximated(rows: SheetRow[], reachCol: string): boolean {
  return computeGroupedSum(rows, reachCol).approximated;
}

export function agg(rows: SheetRow[], col: string): number | null {
  if (!rows.length) return null;
  const lc = col.toLowerCase();
  if (lc.includes('cpm')) {
    const spentCol = findSpentCol(rows);
    const hs = Object.keys(rows[0] || {});
    const imprCol = hs.find((h) => h.toLowerCase().includes('impression'));
    if (spentCol && imprCol) {
      const ts = aggSum(rows, spentCol);
      const ti = aggSum(rows, imprCol);
      if (ts !== null && ti !== null && ti !== 0) return (ts / ti) * 1000;
    }
    return null;
  }
  if (lc.includes('cost per') || lc.startsWith('cpc')) {
    const hsCostPer = Object.keys(rows[0] || {});
    const imprColForCostPer = hsCostPer.find((h) => h.toLowerCase().includes('impression'));
    const spentColForCostPer = findSpentCol(rows);
    // Last resort when this column's own denom count isn't in the file at
    // all (e.g. a literal "Cost per add to cart" column with no bare "Adds
    // to cart" count anywhere): first try computeCostPerFallback (exact —
    // derives the implied count from this same "Cost per X" column, see its
    // docs), and only if that concept isn't mapped, read Meta's own per-row
    // cost value weighted by Impressions (a rough approximation).
    const fallback = (concept: string) => {
      const exact = spentColForCostPer ? computeCostPerFallback(rows, concept, spentColForCostPer, col) : null;
      if (exact !== null) return exact;
      return imprColForCostPer ? computeGroupedWeightedAvg(rows, col, imprColForCostPer) : null;
    };
    for (const map of COST_PER_MAP) {
      if (lc.includes(map.cost)) {
        const spentCol = findSpentCol(rows);
        const denomCol = findDenomCol(rows, map.denom, col);
        if (spentCol && denomCol) {
          const ts = aggSum(rows, spentCol);
          const td = aggSum(rows, denomCol);
          if (ts !== null && td !== null && td !== 0) return ts / td;
        }
        return fallback(map.denom);
      }
    }
    // Generic fallback: any unmatched "cost per X" → SUM(Spent)/SUM(X)
    // Strip "cost per " prefix and search for matching denom col. excludeCol=col
    // guards against self-match: a "Cost per X" column's own header can contain
    // the stripped keyword (e.g. "Cost per checkout initiated" contains "checkout
    // initiated"), which — if the true denom column is named differently, like
    // Meta's plural "Checkouts initiated" — would otherwise make this find the
    // cost column itself as its own denominator and silently return a nonsense
    // number instead of failing safely to reading the column's own value.
    const denomKw = lc.replace(/^cost per\s+/, '').trim();
    if (lc.startsWith('cost per ')) {
      const spentCol = findSpentCol(rows);
      const denomCol = findDenomCol(rows, denomKw, col);
      if (spentCol && denomCol) {
        const ts = aggSum(rows, spentCol);
        const td = aggSum(rows, denomCol);
        if (ts !== null && td !== null && td !== 0) return ts / td;
      }
    }
    // "cpc"-prefixed columns (e.g. "CPC (all)") never spell out "cost per
    // click" in a way denomKw's strip-"cost per "-prefix logic would catch,
    // but the concept they need is always "clicks" — see
    // RATIO_DERIVED_CONCEPT_COL (Clicks derived from CTR × Impressions).
    return fallback(lc.startsWith('cpc') ? 'clicks' : denomKw);
  }
  if (lc.includes('roas')) {
    const spentCol = findSpentCol(rows);
    const hs = Object.keys(rows[0] || {});
    const shared = lc.includes('shared');
    const purchase = lc.includes('purchase');
    const revCol = hs.find((h) => {
      const h2 = h.toLowerCase();
      return h2.includes('conversion value') && !h2.includes('roas') && h2.includes('shared') === shared && (!purchase || h2.includes('purchase'));
    });
    if (spentCol && revCol) {
      const ts = aggSum(rows, spentCol);
      const tr = aggSum(rows, revCol);
      if (ts !== null && tr !== null && ts !== 0) return tr / ts;
    }
    // No Conversion Value column to compute ROAS from — read Meta's own
    // per-row ROAS instead, weighted by Spend (ROAS's own true denominator:
    // weighted-avg ROAS = SUM(Value)/SUM(Spend) = SUM(ROAS·Spend)/SUM(Spend)).
    return spentCol ? computeGroupedWeightedAvg(rows, col, spentCol) : null;
  }
  if (lc.includes('ctr')) {
    const hs = Object.keys(rows[0] || {});
    const imprCol = hs.find((h) => h.toLowerCase().includes('impression'));
    // Last resort when the file has no raw Clicks column at all to compute
    // CTR from (only Meta's own pre-computed "CTR (all)" values) — read that
    // value directly, weighted by Impressions (CTR's own true denominator:
    // weighted-avg CTR = SUM(Clicks)/SUM(Impressions) = SUM(CTR·Impressions)
    // /SUM(Impressions)). For a single campaign this is exactly that
    // campaign's own figure — verified against a real export.
    const readOwnValue = () => (imprCol ? computeGroupedWeightedAvg(rows, col, imprCol) : null);
    // Last-ditch fallback for Meta's pivot "Boost Post" export, which has
    // neither a raw Clicks nor an Impressions column — only per-row "CPC
    // (cost per link click)" and this CTR ratio. Derive both per leaf row
    // (Clicks = Spend/CPC, Impressions = Clicks/(CTR/100)), then combine
    // campaigns as SUM(Clicks)/SUM(Impressions)×100. Weight-averaging this
    // CTR column has no Impressions weight to use here, and a plain average
    // over the many near-zero granular breakdown rows badly understates it.
    const derivedFromCostPerLinkClick = () => {
      const spentCol = findSpentCol(rows);
      const cpcCol = hs.find((h) => h.toLowerCase().includes('cpc') && h.toLowerCase().includes('link click'));
      if (!spentCol || !cpcCol) return null;
      const clicks = sumImpliedFromCostPer(rows, spentCol, cpcCol);
      const impressions = sumPerRow(rows, (r) => {
        const s = parseNum(r[spentCol]);
        const cpc = parseNum(r[cpcCol]);
        const ctr = parseNum(r[col]);
        if (s === null || cpc === null || cpc === 0 || ctr === null || ctr === 0) return null;
        return s / cpc / (ctr / 100);
      });
      if (clicks === null || impressions === null || impressions === 0) return null;
      return (clicks / impressions) * 100;
    };
    for (const map of CTR_MAP) {
      if (lc.includes(map.ctr)) {
        const clickCol = findDenomCol(rows, map.click);
        if (imprCol && clickCol) {
          const ti = aggSum(rows, imprCol);
          const tc = aggSum(rows, clickCol);
          if (ti !== null && tc !== null && ti !== 0) return (tc / ti) * 100;
        }
        return readOwnValue() ?? derivedFromCostPerLinkClick();
      }
    }
    return readOwnValue() ?? derivedFromCostPerLinkClick(); // unmapped CTR variant — don't guess the numerator
  }
  // Bare Reach column falls straight through to aggSum below — it's already
  // the per-campaign/period "prefer the All row" logic described there, no
  // special-casing needed here.
  // Frequency = Impressions / Reach (Meta's own definition, same shape as the
  // CPM branch above). A plain row average is wrong here: this app's rows are
  // broken down by campaign/age/gender/month, so a tiny audience-segment row
  // (Reach=6) would count exactly as much as a huge one (Reach=9,196) and skew
  // the average toward small buckets — verified against a real export where
  // that produced 1.37 instead of the correct ~1.63.
  if (lc.includes('frequency')) {
    const hs = Object.keys(rows[0] || {});
    const reachCol = hs.find((h) => h.toLowerCase().includes('reach'));
    const imprCol = hs.find((h) => h.toLowerCase().includes('impression'));
    if (reachCol && imprCol) {
      const tr = aggSum(rows, reachCol);
      const ti = aggSum(rows, imprCol);
      if (tr !== null && ti !== null && tr !== 0) return ti / tr;
    }
    // Fallback (no Reach/Impressions columns present): simple row average.
    let s = 0;
    let c = 0;
    rows.forEach((r) => {
      const v = parseNum(r[col]);
      if (v !== null) {
        s += v;
        c++;
      }
    });
    return c ? s / c : null;
  }
  // Ratio (e.g. "View content to ATC ratio", "ATC to Purchase ratio"): try
  // recomputing directly from resolved concept counts first (exact — see
  // RATIO_CONCEPT_MAP/computeRatioFromConcepts). A plain unweighted average
  // of every row (the original behavior) was verified wrong against a real
  // export: many near-zero granular breakdown rows dragged "View content to
  // ATC ratio" down to 0.01%, when Ads Manager says 0.95%; weighting by
  // Impressions instead (an earlier fix) got a single campaign's own figure
  // right but was still wrong once combined across many campaigns (0.35%
  // instead of the correct 0.10%) — Impressions isn't this ratio's true
  // denominator, Content Views is, and the concept map now uses that.
  if (lc.includes('ratio')) {
    for (const map of RATIO_CONCEPT_MAP) {
      if (lc.includes(map.ratio)) {
        const exact = computeRatioFromConcepts(rows, map.numerConcept, map.denomConcept, col);
        if (exact !== null) return exact;
        break; // concept(s) unresolvable for this file — fall through below
      }
    }
    // Last resort: read Meta's own per-row ratio value weighted by
    // Impressions (an approximation — see computeGroupedWeightedAvg's docs).
    const hs = Object.keys(rows[0] || {});
    const imprCol = hs.find((h) => h.toLowerCase().includes('impression'));
    if (imprCol) return computeGroupedWeightedAvg(rows, col, imprCol);
    let s = 0;
    let c = 0;
    rows.forEach((r) => {
      const v = parseNum(r[col]);
      if (v !== null) {
        s += v;
        c++;
      }
    });
    return c ? s / c : null;
  }
  // "ATC (%)" / "Purchase (%)" — Meta's pivot exports store these as a
  // per-row fraction (0.27 = 27%). Summing or averaging them across
  // breakdown rows is meaningless; recompute from summed base counts.
  if (lc.includes('atc') && lc.includes('(%)')) {
    const atcCol = atcCountCol(rows);
    const clicks = linkClicksTotal(rows);
    if (atcCol && clicks && clicks !== 0) {
      const totalAtc = aggSum(rows, atcCol);
      if (totalAtc !== null) return (totalAtc / clicks) * 100;
    }
    return null;
  }
  if (lc.includes('purchase') && lc.includes('(%)')) {
    const atcCol = atcCountCol(rows);
    const purCol = purchaseCountCol(rows);
    if (atcCol && purCol) {
      const totalAtc = aggSum(rows, atcCol);
      const totalPur = aggSum(rows, purCol);
      if (totalAtc && totalAtc !== 0 && totalPur !== null) return (totalPur / totalAtc) * 100;
    }
    return null;
  }
  if (lc.includes('average order value') || lc.includes('aov')) {
    const hs = Object.keys(rows[0] || {});
    const revCol = hs.find((h) => {
      const h2 = h.toLowerCase();
      return h2.includes('conversion value') && !h2.includes('roas');
    });
    const purCol = hs.find((h) => {
      const h2 = h.toLowerCase();
      return h2.includes('purchase') && !h2.includes('cost') && !h2.includes('roas') && !h2.includes('conversion value') && !h2.includes('average order value') && !h2.includes('aov');
    });
    if (revCol && purCol) {
      const tr = aggSum(rows, revCol);
      const tp = aggSum(rows, purCol);
      if (tr !== null && tp !== null && tp !== 0) return tr / tp;
    }
    return null;
  }
  return aggSum(rows, col);
}

// "." as the thousands separator and "," as the decimal separator (id-ID
// locale) — unlike val.toFixed(n), which always uses a dot for the decimal
// point regardless of locale.
function toFixedID(val: number, digits = 2): string {
  return val.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmt(val: number | null | undefined, col: string): string {
  if (val === null || val === undefined) return '—';
  const lc = col.toLowerCase();
  if (lc.includes('roas')) return toFixedID(val) + 'x';
  // CTR columns store their raw value already scaled to percentage points
  // (e.g. 1.78 means 1.78%, matching Ads Manager's own display) — but a
  // "X to Y ratio" column (e.g. "View content to ATC ratio") stores a plain
  // 0–1 fraction instead (e.g. 0.0095 means 0.95%), a different convention
  // in the same Meta export. Treating both the same way used to format
  // "View content to ATC ratio" as "0.01%" instead of the correct "0.95%" —
  // verified against a real export's Age=All/Gender=All row and Ads
  // Manager's own number, both 0.95%.
  if (lc.includes('ctr')) return toFixedID(val) + '%';
  if (lc.includes('ratio')) return toFixedID(val * 100) + '%';
  if (lc.includes('frequency')) return toFixedID(val);
  if (
    lc.includes('cost') ||
    lc.includes('cpm') ||
    lc.includes('cpc') ||
    lc.includes('cpa') ||
    lc.includes('cpp') ||
    lc.includes('spent') ||
    lc.includes('spend') ||
    lc.includes('average order value') ||
    lc.includes('aov')
  ) {
    return 'Rp' + Math.round(val).toLocaleString('id-ID');
  }
  if (lc.includes('conversion value') || lc.includes('revenue')) return 'Rp' + Math.round(val).toLocaleString('id-ID');
  if (val >= 1000) return Math.round(val).toLocaleString('id-ID');
  if (val % 1 !== 0) return toFixedID(val);
  return String(Math.round(val));
}

// Turns a raw "Month" cell into a start/end date pair. Fase 1 (Meta): Meta
// Ads Reporting isn't actually locked to full-calendar-month exports — a
// custom range like Aug 1-15 downloads fine with breakdown=month, it just
// changes what that column contains for the affected month:
//  - Full month covered by the query range -> a single date, e.g.
//    "2026-08-01" (or its Excel serial-number equivalent — see below) —
//    read as day 1 through that month's actual last day.
//  - Partial month (query starts/ends mid-month) -> an explicit range
//    string instead, e.g. "2026-08-01 - 2026-08-15" — the exact sub-range,
//    no assumption needed.
// Verified against a real "Aug 1-15 2026" Meta export, whose Month value for
// that (partial) month was literally "2026-08-01 - 2026-08-15".
function fullMonthOrSingleDay(y: number, m: number, d: number): [Date, Date] {
  const start = new Date(y, m, d);
  // A single date is only known to mean "whole month" when it's day 1 —
  // anything else is treated as just that one day rather than guessed at.
  if (d === 1) return [start, new Date(y, m + 1, 0)];
  return [start, start];
}

export function parseMetaMonthValue(raw: unknown): ParsedPeriod {
  if (raw == null || raw === '') return emptyParsedPeriod();
  if (typeof raw === 'string') {
    const range = raw.match(/(\d{4})-(\d{2})-(\d{2})\s*-\s*(\d{4})-(\d{2})-(\d{2})/);
    if (range) {
      const start = new Date(Number(range[1]), Number(range[2]) - 1, Number(range[3]));
      const end = new Date(Number(range[4]), Number(range[5]) - 1, Number(range[6]));
      return buildParsedPeriod(start, end);
    }
    const single = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (single) return buildParsedPeriod(...fullMonthOrSingleDay(Number(single[1]), Number(single[2]) - 1, Number(single[3])));
    return emptyParsedPeriod(raw);
  }
  // SheetJS auto-detects date-looking CSV/xlsx cells and converts them to an
  // Excel serial day number (even though sheet_to_json's default raw:true
  // otherwise preserves literal text) — so a "Month" column formatted as
  // "2026-06-01" can come back as the number 46174 instead of that string.
  // Decode it the same way Excel would, via SheetJS's own date utility,
  // rather than reinventing the serial-date epoch/leap-year math.
  if (typeof raw === 'number' && isFinite(raw)) {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) return buildParsedPeriod(...fullMonthOrSingleDay(d.y, d.m - 1, d.d));
  }
  return emptyParsedPeriod(String(raw));
}

// Turns a raw "Day" cell (Meta's per-day breakdown export, an alternative to
// the "Month" breakdown above) into a single Date. Verified against a real
// "Jul 1 - Aug 15 2026" day-breakdown export, where each row's Day value was
// a literal "2026-08-15"-style date (or its Excel serial-number equivalent,
// same auto-conversion quirk as parseMetaMonthValue).
export function parseMetaDayValue(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return null;
  }
  if (typeof raw === 'number' && isFinite(raw)) {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  return null;
}

// The min/max Day present across a day-breakdown file — bounds for the
// old/cur date-range pickers, so a user can't select a range the file
// doesn't actually cover.
export function metaDayRange(rows: SheetRow[], dayCol: string): { min: Date; max: Date } | null {
  let min: Date | null = null;
  let max: Date | null = null;
  for (const r of rows) {
    const d = parseMetaDayValue(r[dayCol]);
    if (!d) continue;
    if (!min || d.getTime() < min.getTime()) min = d;
    if (!max || d.getTime() > max.getTime()) max = d;
  }
  return min && max ? { min, max } : null;
}

// Suggests a starting old/cur split for a day-breakdown file's available
// [min, max] range — the user can freely adjust either side afterward. If
// the range crosses a calendar month boundary, defaults to "old = the first
// month's covered days, cur = the rest" (matching the original Month-
// breakdown behavior's default, just computed from real daily data instead
// of assumed). Otherwise splits the available days evenly in half.
export function defaultMetaDayRanges(min: Date, max: Date): { old: { start: Date; end: Date }; cur: { start: Date; end: Date } } {
  const endOfMinMonth = new Date(min.getFullYear(), min.getMonth() + 1, 0);
  const startOfNextMonth = new Date(min.getFullYear(), min.getMonth() + 1, 1);
  if (endOfMinMonth.getTime() < max.getTime() && startOfNextMonth.getTime() <= max.getTime()) {
    return { old: { start: min, end: endOfMinMonth }, cur: { start: startOfNextMonth, end: max } };
  }
  const totalDays = daysBetweenInclusive(min, max);
  const half = Math.max(1, Math.floor(totalDays / 2));
  const mid = new Date(min);
  mid.setDate(mid.getDate() + half - 1);
  const midNext = new Date(mid);
  midNext.setDate(midNext.getDate() + 1);
  return { old: { start: min, end: mid }, cur: { start: midNext, end: max } };
}

// Sums a day-breakdown file's rows whose Day falls within [start, end]
// (inclusive) into old/cur buckets — the day-breakdown equivalent of
// splitMonths(), used when the user picks custom sub-ranges instead of
// relying on Meta's own month-bucket boundaries.
export function splitByDayRange(
  rows: SheetRow[],
  dayCol: string,
  oldRange: { start: Date; end: Date },
  curRange: { start: Date; end: Date },
): { old: SheetRow[]; cur: SheetRow[] } {
  const inRange = (d: Date | null, range: { start: Date; end: Date }) => d != null && d.getTime() >= range.start.getTime() && d.getTime() <= range.end.getTime();
  const old: SheetRow[] = [];
  const cur: SheetRow[] = [];
  for (const r of rows) {
    const d = parseMetaDayValue(r[dayCol]);
    if (inRange(d, oldRange)) old.push(r);
    if (inRange(d, curRange)) cur.push(r);
  }
  return { old, cur };
}

export function splitMonths(
  rows: SheetRow[],
  monthCol: string | null,
): { old: SheetRow[]; cur: SheetRow[]; months: unknown[] } {
  // Meta's "Formatted data table" export can include a Month="All" row per
  // campaign (a whole-file-period rollup, not any single month) alongside
  // the real per-month rows — excluded here, or it could sort in as if it
  // were the latest "month" (its unparseable date falls back to a string
  // compare against real ISO date-range strings below, which — since digits
  // sort before letters — can place "All" after every real month) and get
  // picked as ms[0]/ms[last], silently making mCur (or mOld) the wrong rows.
  const raw = [...new Set(rows.map((r) => (monthCol ? r[monthCol] : undefined)).filter((v) => v !== undefined && v !== null && v !== '' && String(v).trim().toLowerCase() !== 'all'))];
  // A plain lexicographic/default sort silently breaks here: SheetJS
  // auto-converts a bare single-date cell ("2026-06-01") to an Excel serial
  // number, but leaves Meta's own partial-month range string
  // ("2026-08-01 - 2026-08-15") as text — so the same file can mix a number
  // and a string across its two month buckets, and default sort() stringifies
  // both before comparing, which can put them in the wrong chronological
  // order. Sort by each value's actual parsed start date instead.
  const ms = raw
    .map((v) => ({ v, start: parseMetaMonthValue(v).start }))
    .sort((a, b) => {
      if (a.start && b.start) return a.start.getTime() - b.start.getTime();
      return String(a.v).localeCompare(String(b.v));
    })
    .map((x) => x.v);
  return {
    old: rows.filter((r) => monthCol && r[monthCol] === ms[0]),
    cur: rows.filter((r) => monthCol && r[monthCol] === ms[ms.length - 1]),
    months: ms,
  };
}

export function groupByCamp(rows: SheetRow[], campCol: string | null, keywords: string[]): Record<string, SheetRow[]> {
  const groups: Record<string, SheetRow[]> = {};
  keywords.forEach((k) => (groups[k] = []));
  groups._other = [];
  rows.forEach((r) => {
    const v = String((campCol ? r[campCol] : '') || '').toLowerCase();
    let hit = false;
    for (const k of keywords) {
      const re = new RegExp('(^|[\\s|\\-])' + k.toLowerCase() + '([\\s|\\-]|$)');
      if (re.test(v)) {
        groups[k].push(r);
        hit = true;
        break;
      }
    }
    if (!hit) groups._other.push(r);
  });
  return groups;
}

export const AGE_ORDER = ['Under 18', '13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'Unknown'];

export function groupByDim(rows: SheetRow[], dimCol: string): Record<string, SheetRow[]> {
  const map: Record<string, SheetRow[]> = {};
  rows.forEach((r) => {
    const k = String(r[dimCol] || 'Unknown');
    if (!map[k]) map[k] = [];
    map[k].push(r);
  });
  return map;
}

export function metricSentiment(col: string): Sentiment {
  const lc = col.toLowerCase();
  if (lc.includes('amount spent') || lc.includes('frequency')) return 'neutral';
  const isLowerBetter =
    lc.includes('cost per') || lc.includes('cost/') || lc.includes('cpm') || lc.includes('cpc') || lc.includes('cpa') || lc.includes('cpp') || (lc.includes('cost') && !lc.includes('conversion value'));
  return isLowerBetter ? 'lower-better' : 'higher-better';
}

// Meta's column-name-driven delta class (distinct from the generic
// sentiment-based deltaClassForSentiment used by other platforms).
export function metaDeltaClass(deltaNum: number | null, col: string): DeltaClassName {
  return deltaClassForSentiment(deltaNum, metricSentiment(col));
}

export interface MetaKpiRow {
  col: string;
  val: string;
  old: string;
  delta: string;
  cls: DeltaClassName;
  deltaNum: number | null;
}

// Reach itself, Frequency (= Impressions/Reach), and Cost per Reach all
// derive from Reach — see buildMetaReport's `reachWarning` for why callers
// filter these out of a column list entirely (rather than compute and show
// a wrong number) for some inputs.
export function isReachDependentCol(col: string): boolean {
  const lc = col.toLowerCase();
  return lc.includes('reach') || lc.includes('frequency');
}

export function buildKPI(old: SheetRow[], cur: SheetRow[], cols: string[]): MetaKpiRow[] {
  return cols.map((col) => {
    const v1 = agg(old, col);
    const v2 = agg(cur, col);
    const { deltaNum, deltaStr } = v1 !== null && v2 !== null ? computeDelta(v1, v2) : { deltaNum: null, deltaStr: '—' };
    const cls = metaDeltaClass(deltaNum, col);
    // formatDeltaID re-renders computeDelta's dot-decimal string ("+50.00%")
    // with Indonesian "," decimals ("+50,00%") — Meta-only by request; other
    // platforms keep computeDelta's own deltaStr (see formatDeltaID's docs).
    return { col, val: fmt(v2, col), old: fmt(v1, col), delta: formatDeltaID(deltaNum, deltaStr), cls, deltaNum };
  });
}

export interface CprPair {
  spent: string | null;
  denom: string | null;
  label: string;
}

export interface CprRow {
  label: string;
  old: string;
  cur: string;
  delta: string;
  deltaNum: number | null;
  cls: DeltaClassName;
  sentiment: Sentiment;
}

// Computes the "Cost per X" row derived from raw spend/denominator columns
// (used both inline in the Overview card and to feed the Summary Overview).
export function buildCprRow(cprPair: CprPair | null | undefined, srcOld: SheetRow[] | null | undefined, srcCur: SheetRow[] | null | undefined): CprRow | null {
  if (!(cprPair && cprPair.spent && cprPair.denom && srcOld && srcCur)) return null;
  const spentOld = aggSum(srcOld, cprPair.spent);
  const spentCur = aggSum(srcCur, cprPair.spent);
  const denomOld = aggSum(srcOld, cprPair.denom);
  const denomCur = aggSum(srcCur, cprPair.denom);
  const cprOld = denomOld && denomOld !== 0 ? (spentOld as number) / denomOld : null;
  const cprCur = denomCur && denomCur !== 0 ? (spentCur as number) / denomCur : null;
  const { deltaNum, deltaStr } = cprOld !== null && cprCur !== null ? computeDelta(cprOld, cprCur) : { deltaNum: null, deltaStr: '—' };
  const cls: DeltaClassName = deltaNum === null ? 'delta-neutral' : deltaNum >= 0 ? 'delta-bad' : 'delta-good';
  return {
    label: cprPair.label || 'Cost per Result',
    old: cprOld !== null ? 'Rp' + Math.round(cprOld).toLocaleString('id-ID') : '—',
    cur: cprCur !== null ? 'Rp' + Math.round(cprCur).toLocaleString('id-ID') : '—',
    delta: formatDeltaID(deltaNum, deltaStr),
    deltaNum,
    cls,
    sentiment: 'lower-better',
  };
}

export interface OverviewDef {
  cols: string[];
  cprPair: CprPair | null;
}

export interface OverviewDefs {
  boost: OverviewDef;
  main?: OverviewDef;
  cpas: OverviewDef;
}

export type MetaIndustry = 'b2b' | 'retail' | 'custom' | null;

// Overview metric definitions per industry. `customResultsCol` is passed in
// explicitly (the original read a module-level global set by the industry
// picker UI) since this module has no DOM/UI state of its own.
export function getOverviewDefs(industry: MetaIndustry, allCols: string[], customResultsCol: string | null): OverviewDefs {
  // Same noise-word guard as findDenomCol: never match a "Cost per X",
  // ratio, or rate column as if it were the raw metric being searched for
  // (unless a keyword itself is asking for that, e.g. "conversion value"),
  // so e.g. `find(['purchases'])` can't pick "Purchases conversion value"
  // as a purchase *count* — verified against a real export with no bare
  // "Purchases" column: that produced a nonsense "Cost per Purchase" of
  // Rp2 (Spend ÷ a summed dollar-value column) in the Overview row instead
  // of failing safely to no Cost-per-Purchase pair at all.
  const find = (kws: string[]) => {
    const noiseWords = ['ratio', 'rate', 'value', 'cost per'].filter((w) => !kws.some((k) => k.includes(w)));
    return allCols.find((c) => {
      const lc = c.toLowerCase();
      if (!kws.some((k) => lc.includes(k.toLowerCase()))) return false;
      return !noiseWords.some((w) => lc.includes(w));
    }) || null;
  };
  const defs: OverviewDefs = {
    boost: {
      cols: [find(['amount spent']), find(['profile visit', 'instagram profile visit'])].filter((c): c is string => Boolean(c)),
      cprPair: { spent: find(['amount spent']), denom: find(['profile visit', 'instagram profile visit']), label: 'Cost per Profile Visit' },
    },
    cpas: { cols: [], cprPair: null },
  };
  if (industry === 'b2b') {
    defs.main = {
      cols: [find(['amount spent']), find(['total messages', 'messaging conversations started', 'messaging conversations'])].filter((c): c is string => Boolean(c)),
      cprPair: { spent: find(['amount spent']), denom: find(['total messages', 'messaging conversations started', 'messaging conversations']), label: 'Cost per Message' },
    };
  } else if (industry === 'retail') {
    defs.main = {
      cols: [find(['amount spent']), find(['purchases'])].filter((c): c is string => Boolean(c)),
      cprPair: { spent: find(['amount spent']), denom: find(['purchases']), label: 'Cost per Purchase' },
    };
  } else if (industry === 'custom') {
    defs.main = {
      cols: [find(['amount spent']), customResultsCol || null].filter((c): c is string => Boolean(c)),
      cprPair: { spent: find(['amount spent']), denom: customResultsCol || null, label: 'Cost per Result' },
    };
  }
  defs.cpas = {
    cols: [
      find(['amount spent']),
      find(['purchases with shared']),
      find(['purchases conversion value', 'conversion value for shared']),
      find(['purchase roas for shared', 'roas']),
    ].filter((c): c is string => Boolean(c)),
    cprPair: null,
  };
  return defs;
}
