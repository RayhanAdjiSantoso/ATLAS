import { randomUUID } from 'crypto';
import pool from '../config/db.js';
import { AppError } from '../utils/errors.js';
import * as brandService from './brandService.js';
import * as repo from '../repositories/googleAdsRepository.js';
import * as library from './brandLibraryService.js';
import { applyGoogleAdsSpend } from './dailyTrackingService.js';
import {
  parseAuctionInsights, parseSearchTerms, parseChangeHistory, buildSearchTermsWorkbook, buildChangeHistoryWorkbook, AUCTION_METRICS,
} from './googleAdsFiles.js';

// Google Ads for Pengaturan Brand (which accounts feed a brand) and the
// Report Generator (the monthly report). The numbers are pushed in from
// outside through the ingest functions below — today by the Google Ads
// Script in apps-script/GoogleAdsReport.js, later by a Google Ads API
// fetcher. Both ask getJobs() what to fetch and report through
// startRun/ingestRows/finishRun, so swapping one for the other touches
// nothing else here.

const LEVELS = new Set(['campaign', 'ad_group', 'keyword', 'search_term', 'city']);
const SOURCES = new Set(['ads_script', 'api']);
// A day's conversions keep arriving for a while after it ends. A month only
// counts as fetched once a run covered it at least this long after its last day.
const SETTLE_DAYS = 3;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function assertBrand(brandId) {
  const brand = await brandService.getBrandById(brandId);
  if (!brand) throw new AppError('Client tidak ditemukan', 404);
  return brand;
}

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// '123-456-7890' / '1234567890' -> '1234567890', anything else -> null.
export function normalizeCustomerId(value) {
  const digits = String(value ?? '').replace(/[\s-]/g, '');
  return /^\d{10}$/.test(digits) ? digits : null;
}

// ── date helpers (all 'YYYY-MM-DD' strings, calendar arithmetic in UTC) ──
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const toISO = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return toISO(d); };
const monthStart = (s) => `${s.slice(0, 7)}-01`;
const monthEnd = (s) => { const d = toDate(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + 1, 0); return toISO(d); };
const maxDate = (a, b) => (a > b ? a : b);
const minDate = (a, b) => (a < b ? a : b);

// Today as the team sees it. Accounts in other time zones (KL is an hour
// ahead) are at most a day off, which the month-to-date re-fetch absorbs.
function todayJakarta() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function defaultBackfillFrom() {
  const d = toDate(monthStart(todayJakarta()));
  d.setUTCMonth(d.getUTCMonth() - 6);
  return toISO(d);
}

// ---------------------------------------------------------------------
// Pengaturan Brand
// ---------------------------------------------------------------------
export async function getOverview(brandId) {
  await assertBrand(brandId);
  const [accounts, coverage, runs] = await Promise.all([
    repo.listAccounts(brandId), repo.coverage(brandId), repo.listRecentRuns(brandId),
  ]);
  const byCustomer = new Map(coverage.map((c) => [c.customer_id, c]));
  return {
    accounts: accounts.map((a) => ({ ...a, coverage: byCustomer.get(a.customer_id) ?? null })),
    runs,
    defaultBackfillFrom: defaultBackfillFrom(),
  };
}

export async function addAccount({ brandId, customerId, label, backfillFrom, userId }) {
  await assertBrand(brandId);
  const id = normalizeCustomerId(customerId);
  if (!id) throw new AppError('Customer ID harus 10 digit, mis. 123-456-7890', 400);
  const existing = await repo.getAccountByCustomerId(id);
  if (existing) {
    const owner = existing.brand_id === brandId ? 'brand ini' : 'brand lain';
    throw new AppError(`Customer ID ini sudah terdaftar di ${owner}`, 409);
  }
  const from = backfillFrom || defaultBackfillFrom();
  if (!ISO_DATE.test(from)) throw new AppError('Tanggal mulai tidak valid', 400);
  await repo.insertAccount({ brandId, customerId: id, label: label?.trim() || null, backfillFrom: from, userId });
  return getOverview(brandId);
}

async function accountOfBrand(brandId, accountId) {
  const account = await repo.getAccount(accountId);
  if (!account || account.brand_id !== brandId) throw new AppError('Akun Google Ads tidak ditemukan', 404);
  return account;
}

export async function updateAccount({ brandId, accountId, label, isActive, backfillFrom }) {
  await accountOfBrand(brandId, accountId);
  if (backfillFrom != null && !ISO_DATE.test(backfillFrom)) throw new AppError('Tanggal mulai tidak valid', 400);
  await repo.updateAccount(accountId, {
    label: label === undefined ? null : label.trim(),
    isActive: isActive ?? null,
    backfillFrom: backfillFrom ?? null,
  });
  return getOverview(brandId);
}

// Removing an account removes its numbers too: they are only a copy of what
// Google holds, and leaving them would keep them in the brand's reports.
export async function removeAccount({ brandId, accountId }) {
  const account = await accountOfBrand(brandId, accountId);
  await inTransaction(async (db) => {
    await repo.deleteCustomerRows(account.customer_id, db);
    await repo.deleteCustomerChangeEvents(account.customer_id, db);
    await repo.deleteAccount(accountId, db);
  });
  return getOverview(brandId);
}

export async function requestResync({ brandId, accountId, from, to }) {
  const account = await accountOfBrand(brandId, accountId);
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) throw new AppError('Rentang tanggal tidak valid', 400);
  const yesterday = addDays(todayJakarta(), -1);
  await repo.requestResync(account.id, { from, to: minDate(to, yesterday) });
  return getOverview(brandId);
}

// ---------------------------------------------------------------------
// Fetch planning (asked by the fetcher at the start of every run)
// ---------------------------------------------------------------------
// One job = one account × one calendar month (clipped to backfill_from and
// yesterday). A month is due unless a successful run covered all of it and
// started at least SETTLE_DAYS after its last day — so last month is
// re-fetched until its conversions have settled and older months once. The
// month in progress (ending yesterday) is due once per day: its range grows
// every day, and a second run the same day (a Preview, say) finds it
// covered. A "Tarik ulang" adds: covered by a run started after the
// request. Newest months come first so fresh numbers land before backfill.
export function planJobs(accounts, runs, today) {
  const yesterday = addDays(today, -1);
  const runsByCustomer = new Map();
  for (const r of runs) {
    if (!runsByCustomer.has(r.customer_id)) runsByCustomer.set(r.customer_id, []);
    runsByCustomer.get(r.customer_id).push(r);
  }

  const jobs = [];
  const resyncDone = [];
  for (const account of accounts) {
    if (account.backfill_from > yesterday) continue;
    const own = runsByCustomer.get(account.customer_id) ?? [];
    const resyncAt = account.resync_requested_at ? new Date(account.resync_requested_at) : null;
    let resyncPending = false;

    for (let m = monthStart(yesterday); m >= monthStart(account.backfill_from); m = monthStart(addDays(m, -1))) {
      const start = maxDate(m, account.backfill_from);
      const end = minDate(monthEnd(m), yesterday);
      const inResync = resyncAt && account.resync_from <= end && account.resync_to >= start;
      const settledAfter = toDate(addDays(end, SETTLE_DAYS));
      const inProgress = end === yesterday;
      const covered = own.some((r) => r.start_date <= start && r.end_date >= end
        && (inProgress || new Date(r.started_at) >= settledAfter)
        && (!inResync || new Date(r.started_at) > resyncAt));
      const resyncCovered = !inResync || own.some((r) => r.start_date <= start && r.end_date >= end && new Date(r.started_at) > resyncAt);
      if (!resyncCovered) resyncPending = true;
      if (!covered) {
        jobs.push({
          brandId: account.brand_id, customerId: account.customer_id, startDate: start, endDate: end,
          reason: inResync && !resyncCovered ? 'resync' : inProgress ? 'current' : 'backfill',
          // Lets an MCC-level fetcher stay quiet about an account it cannot
          // reach once another fetcher (a script in that account) has synced it.
          hasSyncedBefore: own.length > 0,
        });
      }
    }
    if (resyncAt && !resyncPending) resyncDone.push(account.id);
  }
  return { jobs, resyncDone };
}

export async function getJobs() {
  const accounts = await repo.listActiveAccounts();
  const runs = await repo.listSuccessfulRuns(accounts.map((a) => a.customer_id));
  const { jobs, resyncDone } = planJobs(accounts, runs, todayJakarta());
  await Promise.all(resyncDone.map((id) => repo.clearResync(id)));
  return { today: todayJakarta(), jobs };
}

// ---------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------
async function requireOpenRun(runId) {
  const run = await repo.getRun(runId);
  if (!run) throw new AppError('Run tidak ditemukan', 404);
  if (run.status !== 'running') throw new AppError('Run sudah selesai', 409);
  return run;
}

export async function startRun({ customerId, startDate, endDate, source, account }) {
  const id = normalizeCustomerId(customerId);
  const registered = id && await repo.getAccountByCustomerId(id);
  if (!registered) throw new AppError('Customer ID belum terdaftar di Pengaturan Brand', 404);
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate) || startDate > endDate) throw new AppError('Rentang tanggal tidak valid', 400);
  const runId = randomUUID();
  await repo.insertRun({
    brandId: registered.brand_id, customerId: id, startDate, endDate,
    source: SOURCES.has(source) ? source : 'ads_script', runId,
  });
  if (account) {
    await repo.updateAccountMeta(id, {
      accountName: account.name ?? null, currencyCode: account.currencyCode ?? null, timeZone: account.timeZone ?? null,
    });
  }
  return { runId };
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ratio = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v) => (v == null ? '' : String(v).trim());

export function normalizeRow(raw) {
  if (!raw || !ISO_DATE.test(raw.date) || !LEVELS.has(raw.level)) return null;
  return {
    entry_date: raw.date,
    level: raw.level,
    campaign_id: text(raw.campaignId),
    campaign_name: text(raw.campaignName),
    channel_type: text(raw.channelType),
    ad_group_id: text(raw.adGroupId),
    ad_group_name: text(raw.adGroupName),
    item: text(raw.item),
    match_type: text(raw.matchType),
    budget_amount: raw.budget == null ? null : num(raw.budget),
    cost: num(raw.cost),
    impressions: num(raw.impressions),
    clicks: num(raw.clicks),
    conversions: num(raw.conversions),
    conversions_value: num(raw.conversionsValue),
    all_conversions: num(raw.allConversions),
    abs_top_impression_pct: ratio(raw.absTopImpressionPct),
    search_lost_top_is_rank: ratio(raw.searchLostTopIsRank),
  };
}

export async function ingestRows({ runId, rows }) {
  const run = await requireOpenRun(runId);
  // Rows outside the run's range are dropped rather than trusted: a stray
  // date would land in a range whose stale-row cleanup this run never owns.
  const byKey = new Map();
  for (const raw of rows) {
    const r = normalizeRow(raw);
    if (!r || r.entry_date < run.start_date || r.entry_date > run.end_date) continue;
    // One INSERT ... ON CONFLICT cannot touch the same key twice; keep the last.
    byKey.set([r.entry_date, r.level, r.campaign_id, r.ad_group_id, r.item, r.match_type].join('|'), r);
  }
  const written = await repo.upsertRows({ brandId: run.brand_id, customerId: run.customer_id, runId, rows: [...byKey.values()] });
  return { received: rows.length, written };
}

// Change history for the run's range: Google keeps only the last 30 days,
// so the script sends what it can and older months stay manual uploads.
export async function ingestChanges({ runId, rows }) {
  const run = await requireOpenRun(runId);
  const byKey = new Map();
  for (const raw of rows) {
    const changedAt = String(raw?.changedAt ?? '').slice(0, 19);
    const day = changedAt.slice(0, 10);
    if (!raw?.key || !ISO_DATE.test(day) || day < run.start_date || day > run.end_date) continue;
    byKey.set(String(raw.key), {
      event_key: String(raw.key),
      changed_at: changedAt,
      user_email: text(raw.userEmail) || null,
      client_type: text(raw.clientType) || null,
      resource_type: text(raw.resourceType) || null,
      operation: text(raw.operation) || null,
      campaign_name: text(raw.campaignName) || null,
      ad_group_name: text(raw.adGroupName) || null,
      changes: text(raw.changes).slice(0, 2000) || null,
    });
  }
  const written = await repo.upsertChangeEvents({ brandId: run.brand_id, customerId: run.customer_id, runId, rows: [...byKey.values()] });
  return { received: rows.length, written };
}

export async function finishRun({ runId, status, rowCount, note }) {
  const run = await requireOpenRun(runId);
  const result = await finishRunRows({ run, runId, status, rowCount, note });
  // Daily Tracking is daily data, filled on every run (the script runs at
  // 01:00, so yesterday lands then). Data & file is monthly data: a month is
  // filed only once a run has covered it to its last day — the run on the
  // 1st — and re-filed if last month is fetched again while conversions
  // settle. A failure in either must not turn a successful fetch into a
  // failed one, so it is only logged.
  if (status === 'success') {
    // Daily Tracking › Google Ads: the brand's cost per day over the run's
    // range, written at the time the script runs (the Meta auto-fill rule).
    try {
      const daily = await repo.reportDaily(run.brand_id, run.start_date, run.end_date);
      const byDate = new Map(daily.map((d) => [d.date, Number(d.cost) || 0]));
      const days = [];
      for (let d = run.start_date; d <= run.end_date; d = addDays(d, 1)) days.push({ date: d, cost: byDate.get(d) ?? 0 });
      result.dailyTracking = await applyGoogleAdsSpend({ brandId: run.brand_id, days });
    } catch (err) {
      console.warn('[google-ads] gagal mengisi Daily Tracking', { brandId: run.brand_id, reason: err.message });
    }
    for (const month of monthsBetween(run.start_date, run.end_date)) {
      try {
        result.library = run.end_date >= monthEnd(`${month}-01`)
          ? await syncLibraryMonth(run.brand_id, month)
          : await dropPartialAutoFiles(run.brand_id, month);
      } catch (err) {
        console.warn('[google-ads] gagal mengisi Data & file', { brandId: run.brand_id, month, reason: err.message });
      }
    }
  }
  return result;
}

function finishRunRows({ run, runId, status, rowCount, note }) {
  return inTransaction(async (db) => {
    let removedStale = 0;
    // Zero rows on a "success" is read as "Google returned nothing", not as
    // proof the range is empty — one hiccup must not wipe a good month.
    if (status === 'success' && rowCount > 0) {
      removedStale = await repo.deleteStaleRows({
        customerId: run.customer_id, startDate: run.start_date, endDate: run.end_date, runId,
      }, db);
    }
    const parts = [];
    if (note) parts.push(note);
    if (status === 'success' && rowCount === 0) parts.push('Google Ads tidak mengembalikan data untuk rentang ini; data lama (jika ada) tidak diubah');
    if (removedStale) parts.push(`${removedStale} baris lama yang tidak ada lagi di Google Ads dihapus`);
    await repo.finishRun({ runId, status, rowCount, note: parts.join(' · ') || null }, db);
    await repo.recordSyncResult(run.customer_id, { status, error: status === 'failed' ? (note || 'Gagal') : null }, db);
    return { status, rowCount, removedStale };
  });
}

// ---------------------------------------------------------------------
// Report Generator
// ---------------------------------------------------------------------
// Ratios the Looker report shows, derived from the summed metrics so a
// period's CTR is total clicks / total impressions, never an average of days.
function withRatios(row) {
  const r = { ...row };
  for (const k of ['cost', 'impressions', 'clicks', 'conversions', 'conversions_value', 'all_conversions']) r[k] = Number(r[k] ?? 0);
  r.ctr = r.impressions ? r.clicks / r.impressions : null;
  r.avg_cpc = r.clicks ? r.cost / r.clicks : null;
  r.avg_cpm = r.impressions ? (r.cost / r.impressions) * 1000 : null;
  r.cost_per_conv = r.conversions ? r.cost / r.conversions : null;
  r.cvr = r.clicks ? r.conversions / r.clicks : null;
  r.roas = r.cost ? r.conversions_value / r.cost : null;
  return r;
}

async function periodReport(brandId, start, end) {
  const [totals, daily, campaigns, adGroups, keywords, searchTerms, cities] = await Promise.all([
    repo.reportTotals(brandId, start, end),
    repo.reportDaily(brandId, start, end),
    repo.reportCampaigns(brandId, start, end),
    repo.reportAdGroups(brandId, start, end),
    repo.reportKeywords(brandId, start, end),
    repo.reportSearchTerms(brandId, start, end),
    repo.reportCities(brandId, start, end, 'SEARCH'),
  ]);
  return {
    start, end,
    totals: withRatios(totals),
    daily: daily.map(withRatios),
    campaigns: campaigns.map(withRatios),
    adGroups: adGroups.map(withRatios),
    keywords: keywords.map(withRatios),
    searchTerms: searchTerms.map(withRatios),
    cities: cities.map(withRatios),
  };
}

export async function getReport({ brandId, oldStart, oldEnd, curStart, curEnd }) {
  await assertBrand(brandId);
  for (const d of [oldStart, oldEnd, curStart, curEnd]) {
    if (!ISO_DATE.test(d)) throw new AppError('Tanggal periode tidak valid', 400);
  }
  if (oldStart > oldEnd || curStart > curEnd) throw new AppError('Tanggal mulai harus sebelum tanggal akhir', 400);
  const accounts = await repo.listAccounts(brandId);
  const coverage = await repo.coverage(brandId);
  const [old, cur] = await Promise.all([periodReport(brandId, oldStart, oldEnd), periodReport(brandId, curStart, curEnd)]);
  const currencies = [...new Set(accounts.map((a) => a.currency_code).filter(Boolean))];
  const files = await libraryFiles(brandId);
  const [auctionOld, auctionCur, changes] = await Promise.all([
    auctionInsightsFor(brandId, files, oldStart, oldEnd),
    auctionInsightsFor(brandId, files, curStart, curEnd),
    changeHistoryFor(brandId, files, curStart, curEnd),
  ]);
  // An uploaded Search terms report wins over the script's numbers for the
  // months it covers (user decision 2026-10-02), and fills months the
  // script never fetched.
  for (const [period, start, end] of [[old, oldStart, oldEnd], [cur, curStart, curEnd]]) {
    period.searchTermsSource = 'atlas';
    const uploaded = await uploadedSearchTerms(brandId, files, start, end);
    if (!uploaded.rows.length) continue;
    const kept = uploaded.months.size
      ? (await repo.reportSearchTerms(brandId, start, end, [...uploaded.months])).map(withRatios)
      : [];
    period.searchTerms = mergeTerms([...kept, ...uploaded.rows]).map(withRatios);
    period.searchTermsSource = kept.length ? 'mixed' : 'upload';
  }
  return {
    auctionInsights: { old: auctionOld, cur: auctionCur },
    changeHistory: changes,
    accounts: accounts.map((a) => ({ customerId: a.customer_id, label: a.label, name: a.account_name, currency: a.currency_code })),
    currency: currencies.length === 1 ? currencies[0] : null,
    mixedCurrency: currencies.length > 1,
    coverage,
    old,
    cur,
  };
}

// ---------------------------------------------------------------------
// Data & file (Pengaturan Brand) — the Google Ads tab
// ---------------------------------------------------------------------
// Auto-filed months carry this prefix; anything else in a slot was uploaded
// by someone and is never overwritten (user decision 2026-10-02: a manual
// file wins over the script's copy).
const AUTO_FILE_PREFIX = 'ATLAS-auto_google_';

function monthsBetween(start, end) {
  const out = [];
  for (let m = monthStart(start); m <= end; m = addDays(monthEnd(m), 1)) out.push(m.slice(0, 7));
  return out;
}

async function fileAutoMonth(brand, channel, month, rowCount, buffer) {
  const parts = await library.listSlotParts(brand.brand_id, 'google', channel, `${month}-01`);
  const manual = parts.filter((p) => !p.original_filename.startsWith(AUTO_FILE_PREFIX));
  const auto = parts.find((p) => p.original_filename.startsWith(AUTO_FILE_PREFIX));
  if (manual.length) {
    // The upload is what this month uses; an older auto copy beside it would
    // only make the slot look like two parts of one export.
    if (auto) await library.deleteLibraryFile(brand.brand_id, auto.id);
    return { channel, filed: false, reason: 'file manual sudah ada' };
  }
  const coverage = library.summariseRange({ start: `${month}-01`, end: monthEnd(`${month}-01`) }, month);
  const slug = String(brand.brand_name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'brand';
  await library.upsertLibraryFile({
    brandId: brand.brand_id, platform: 'google', channel,
    periodMonth: coverage.periodMonth, periodStart: coverage.periodStart, periodEnd: coverage.periodEnd,
    coveredDays: coverage.coveredDays, dayBitmap: coverage.dayBitmap, rowCount, periodSource: 'declared',
    partIndex: auto?.part_index ?? 1, filename: `${AUTO_FILE_PREFIX}${channel}_${slug}_${month}.xlsx`, buffer, userId: null,
  });
  return { channel, filed: true, rowCount };
}

// A month still in progress has no file yet. Auto files written for one
// before this rule (they used to be refreshed daily) are removed so the grid
// does not show a half month as filed; uploads are left alone.
async function dropPartialAutoFiles(brandId, month) {
  const removed = [];
  for (const channel of ['search_terms', 'change_history']) {
    const parts = await library.listSlotParts(brandId, 'google', channel, `${month}-01`);
    for (const p of parts.filter((x) => x.original_filename.startsWith(AUTO_FILE_PREFIX))) {
      await library.deleteLibraryFile(brandId, p.id);
      removed.push(channel);
    }
  }
  return { month, inProgress: true, removed };
}

export async function syncLibraryMonth(brandId, month) {
  const brand = await assertBrand(brandId);
  const start = `${month}-01`;
  const end = monthEnd(start);
  const out = [];
  const terms = await repo.searchTermsForFile(brandId, start, end);
  if (terms.length) out.push(await fileAutoMonth(brand, 'search_terms', month, terms.length, buildSearchTermsWorkbook(month, terms)));
  const changes = await repo.listChangeEvents(brandId, start, end);
  if (changes.length) out.push(await fileAutoMonth(brand, 'change_history', month, changes.length, buildChangeHistoryWorkbook(month, changes)));
  return out;
}

// ---------------------------------------------------------------------
// Report reads from the library
// ---------------------------------------------------------------------
async function libraryFiles(brandId) {
  const all = await library.listLibrary(brandId);
  return all.filter((f) => f.platform === 'google' && f.period_month);
}

function filesFor(files, channel, start, end, { manualOnly = false } = {}) {
  const months = new Set(monthsBetween(start, end));
  return files.filter((f) => f.channel === channel
    && months.has(String(f.period_month).slice(0, 7))
    && (!manualOnly || !f.original_filename.startsWith(AUTO_FILE_PREFIX)));
}

async function readFiles(brandId, files, parse) {
  const out = [];
  for (const f of files) {
    const bytes = await library.getLibraryFileBytes(brandId, f.id);
    if (!bytes?.raw_file) continue;
    try {
      out.push({ file: f, rows: parse(bytes.raw_file) });
    } catch (err) {
      console.warn('[google-ads] file tidak terbaca', { fileId: f.id, reason: err.message });
      out.push({ file: f, rows: [], error: true });
    }
  }
  return out;
}

const fileMonth = (f) => String(f.period_month).slice(0, 7);

// Auction insights are monthly shares, not sums. A period inside one month
// uses that month's file; a period spanning several averages each domain's
// shares over the months it appears in, and says so.
async function auctionInsightsFor(brandId, files, start, end) {
  const parsed = (await readFiles(brandId, filesFor(files, 'auction_insights', start, end), parseAuctionInsights)).filter((p) => p.rows.length);
  const months = [...new Set(parsed.map((p) => fileMonth(p.file)))].sort();
  const byDomain = new Map();
  for (const { rows } of parsed) {
    for (const r of rows) {
      const key = r.domain.toLowerCase();
      if (!byDomain.has(key)) byDomain.set(key, { domain: r.domain, isYou: r.isYou, samples: [] });
      byDomain.get(key).samples.push(r);
    }
  }
  const rows = [...byDomain.values()].map(({ domain, isYou, samples }) => {
    const out = { domain, isYou };
    for (const k of AUCTION_METRICS) {
      const values = samples.map((s) => s[k].value).filter((v) => v != null);
      out[k] = values.length
        ? { value: values.reduce((a, b) => a + b, 0) / values.length, text: null }
        : { value: null, text: samples.find((s) => s[k].text !== '—')?.[k].text ?? '—' };
    }
    return out;
  });
  return { months, files: parsed.map((p) => p.file.original_filename), rows };
}

const parseLooseDate = (text) => {
  const t = Date.parse(String(text).replace(/,(\s*\d{1,2}:)/, ' $1'));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

// What was changed in the account during the period: uploaded exports for
// the months they cover (a manual file wins), fetched events for the rest.
async function changeHistoryFor(brandId, files, start, end) {
  const uploadFiles = filesFor(files, 'change_history', start, end, { manualOnly: true });
  const uploadedMonths = new Set(uploadFiles.map(fileMonth));
  const fetched = (await repo.listChangeEvents(brandId, start, end))
    .filter((r) => !uploadedMonths.has(r.changed_at.slice(0, 7)))
    .map((r) => ({ ...r, source: 'atlas' }));
  const uploads = await readFiles(brandId, uploadFiles, parseChangeHistory);
  const uploaded = uploads.flatMap(({ rows }) => rows
    .filter((r) => { const d = parseLooseDate(r.changed_at); return !d || (d >= start && d <= end); })
    .map((r) => ({ ...r, source: 'upload' })));
  return { rows: [...fetched, ...uploaded], uploadedFiles: uploads.map((u) => u.file.original_filename) };
}

// Uploaded Search terms reports for the period, and which months they
// cover — those months are left out of the script's numbers.
async function uploadedSearchTerms(brandId, files, start, end) {
  const parsed = (await readFiles(brandId, filesFor(files, 'search_terms', start, end, { manualOnly: true }), parseSearchTerms))
    .filter((p) => p.rows.length);
  const months = new Set(parsed.map((p) => fileMonth(p.file)));
  // Months of the period the uploads do NOT cover keep the script's rows.
  const others = new Set(monthsBetween(start, end).filter((m) => !months.has(m)));
  return { rows: parsed.flatMap((p) => p.rows), months: others };
}

const TERM_METRICS = ['cost', 'impressions', 'clicks', 'conversions', 'conversions_value', 'all_conversions'];
function mergeTerms(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.search_term.toLowerCase()}|${r.match_type}`;
    const acc = byKey.get(key) ?? { search_term: r.search_term, match_type: r.match_type, ...Object.fromEntries(TERM_METRICS.map((k) => [k, 0])) };
    for (const k of TERM_METRICS) acc[k] += Number(r[k] ?? 0);
    byKey.set(key, acc);
  }
  return [...byKey.values()];
}
