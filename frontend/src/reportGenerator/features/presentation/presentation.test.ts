import assert from 'node:assert/strict';
import test from 'node:test';
import { fromDisplayRow, shortMiddle, tableBlock, L } from './data/helpers';
import { defaultFileName, formatCell, formatCompact, formatDelta, formatValue, parseCell, parseDelta, periodLabelFromDates } from './format';
import { mergeDocuments } from './merge';
import { LAYOUTS, MAX_TABLE_PAGES, applyLanguage, planDocument, visibleSlides } from './plan';
import type { KpiBlock, PresentationConfig, Snapshot, TableBlock } from './types';
import { exportableSlides, factsForSlide, isEmptySlide, reviewDocument } from './validate';

const ID = { lang: 'id', currency: 'IDR' } as const;
const EN = { lang: 'en', currency: 'IDR' } as const;
const MY = { lang: 'en', currency: 'MYR' } as const;

const config = (over: Partial<PresentationConfig> = {}): PresentationConfig => ({
  brandId: 1, brandName: 'Brand', lang: 'id', tone: 'professional', template: 'mil-blue', currency: 'IDR',
  period: { curStart: '2026-09-01', curEnd: '2026-09-30', curLabel: 'September 2026', oldStart: '2026-08-01', oldEnd: '2026-08-31', oldLabel: 'Agustus 2026' },
  channels: { meta: { enabled: true, runId: 1 }, shopee: { enabled: false, runId: null }, tiktok: { enabled: false, runId: null }, google: { enabled: false, runId: null } },
  includeBusiness: false,
  ...over,
});

const kpi = (id: string, source: KpiBlock['source']): KpiBlock => ({
  id, source, kind: 'kpi', title: L(id), rows: [{ label: 'Spend', old: { n: 100, f: 'money' }, cur: { n: 150, f: 'money' }, delta: { n: 50, tone: 'neutral' } }],
});
const table = (id: string, rows: number): TableBlock => ({
  id, source: 'meta', kind: 'table', title: L(id), nameLabel: 'Campaign', columns: [{ key: 'a', label: 'A' }],
  rows: Array.from({ length: rows }, (_, i) => ({ name: `Row ${i}`, cells: { a: { n: i, f: 'num' } } })),
});

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return { builtAt: '2026-10-01', sources: [], blocks: {}, missing: [], metaSubs: [], shopeeChannels: [], ...over };
}

test('display strings read back under both decimal conventions', () => {
  assert.deepEqual(parseCell('Rp1.234.567'), { n: 1234567, f: 'money', rounded: true });
  assert.deepEqual(parseCell('12,34%'), { n: 12.34, f: 'pct' });
  assert.deepEqual(parseCell('12.34%'), { n: 12.34, f: 'pct' }, 'fmtShopee writes a dot');
  assert.deepEqual(parseCell('1,23x'), { n: 1.23, f: 'x' });
  assert.deepEqual(parseCell('1.23x'), { n: 1.23, f: 'x' });
  assert.deepEqual(parseCell('1.234'), { n: 1234, f: 'num' }, 'a dot before three digits groups thousands');
  assert.deepEqual(parseCell('1.23'), { n: 1.23, f: 'dec' }, 'TikTok ROI');
  assert.deepEqual(parseCell('1.234,56'), { n: 1234.56, f: 'dec' });
  assert.equal(parseCell('—').n, null);
  assert.equal(parseCell('').n, null);
  assert.equal(parseCell('N/A').n, null);
  assert.deepEqual(parseCell('Aktif'), { n: null, f: 'text', t: 'Aktif' });
});

test('delta strings keep their meaning and the report tone', () => {
  assert.deepEqual(parseDelta('+50,00%', 'delta-good'), { n: 50, tone: 'good' });
  assert.deepEqual(parseDelta('-12.50%', 'delta-bad'), { n: -12.5, tone: 'bad' });
  assert.deepEqual(parseDelta('New', 'delta-neutral'), { n: null, s: 'New', tone: 'neutral' });
  assert.deepEqual(parseDelta('anything', 'delta-good', 7.5), { n: 7.5, tone: 'good' }, 'the number wins when present');
});

test('money follows the report settings, never converting a value', () => {
  assert.equal(formatValue(1234567, 'money', ID), 'Rp1.234.567');
  assert.equal(formatValue(1234567, 'money', EN), 'Rp1,234,567');
  assert.equal(formatValue(1234.5, 'money', MY), 'RM1,234.50');
  assert.equal(formatValue(null, 'money', ID), '—');
  assert.equal(formatValue(Number.NaN, 'pct', ID), '—');
  assert.equal(formatValue(0, 'money', ID), 'Rp0', 'zero is a reading, unlike a missing value');
});

test('a rounded source is not shown with decimals it does not have', () => {
  assert.equal(formatCell({ n: 1, f: 'money', rounded: true }, MY), 'RM1');
  assert.equal(formatCell({ n: 0.52, f: 'money' }, MY), 'RM0.52');
});

test('a row with exact figures prefers them over its rounded display', () => {
  const row = fromDisplayRow({ label: 'CPC', old: 'Rp1', cur: 'Rp1', delta: '+4,00%', cls: 'delta-bad', oldNum: 0.5, curNum: 0.52, deltaNum: 4 });
  assert.equal(formatCell(row.cur, MY), 'RM0.52');
  assert.equal(formatCell(fromDisplayRow({ label: 'CPC', old: 'Rp1', cur: 'Rp1', delta: '—', cls: 'delta-neutral' }).cur, MY), 'RM1');
});

test('changes and axis labels read correctly', () => {
  assert.equal(formatDelta({ n: 4.915, tone: 'good' }, EN), '+4.92%');
  assert.equal(formatDelta({ n: -4.9, tone: 'bad' }, ID), '-4,90%');
  assert.equal(formatDelta({ n: null, s: 'New', tone: 'neutral' }, ID), 'New');
  assert.equal(formatCompact(1200000000, 'money', ID), 'Rp1,2 M');
  assert.equal(formatCompact(1200000000, 'money', EN), 'Rp1.2B');
  assert.equal(formatCompact(350000000, 'money', ID), 'Rp350 jt');
  assert.equal(formatCompact(5800, 'num', ID), '5,8 rb');
});

test('period labels and the default file name', () => {
  assert.equal(periodLabelFromDates('2026-09-01', '2026-09-30', 'id'), 'September 2026');
  assert.equal(periodLabelFromDates('2026-08-01', '2026-08-31', 'en'), 'August 2026');
  assert.equal(periodLabelFromDates('2026-09-01', '2026-09-15', 'id'), '1-15 Sep 2026');
  assert.equal(periodLabelFromDates('2026-08-28', '2026-09-03', 'id'), '28 Ags - 3 Sep 2026');
  assert.equal(defaultFileName("Poppy's Dream", '2026-09-30', 'en'), "Poppy's Dream - Monthly Overview - September 2026.pdf");
  assert.equal(defaultFileName('A/B: C', '2026-09-30', 'id'), 'A-B- C - Monthly Overview - September 2026.pdf');
});

test('a table note matches what the deck can show', () => {
  const rows = Array.from({ length: 196 }, (_, i) => ({ name: `P${i}`, cells: {} }));
  const block = tableBlock('t', 'shopee', L('T'), 'Name', [], rows);
  assert.equal(block?.rows.length, MAX_TABLE_PAGES * LAYOUTS.table.rowsPerPage);
  assert.match(block?.note?.en ?? '', /top 24 of 196/);
  assert.equal(tableBlock('t', 'shopee', L('T'), 'Name', [], []), null, 'no rows, no block');
  assert.equal(shortMiddle('NV(Boost Post) | Traffic - Boost IG Post | Number One').includes('Number One'), true, 'names that differ at the end stay distinct');
});

test('the plan only carries channels that have data', () => {
  const metaOnly = planDocument(config(), snap({
    sources: [{ source: 'meta', label: 'Meta Ads', status: 'ok' }, { source: 'shopee', label: 'Shopee Ads', status: 'unavailable' }],
    blocks: { 'meta.boost.kpi': kpi('meta.boost.kpi', 'meta') },
    metaSubs: [{ key: 'boost', label: 'Boost Post' }],
  }));
  const channels = metaOnly.sections.filter((s) => s.kind === 'channel').map((s) => s.channel);
  assert.deepEqual(channels, ['meta']);
  assert.ok(!metaOnly.slides.some((s) => /shopee/i.test(s.title)));

  const none = planDocument(config(), snap());
  assert.deepEqual(none.sections.filter((s) => s.kind === 'channel'), []);
  assert.ok(!none.slides.some((s) => s.title === 'Sales Performance'), 'no revenue data, no revenue slide');
  assert.ok(!none.slides.some((s) => s.title === 'Advertising Spend'));
  assert.deepEqual(none.slides.flatMap((s) => s.blockIds), [], 'never a reference to a block that is not there');
});

test('a long table continues over more slides, up to the limit', () => {
  const build = (rows: number) => planDocument(config(), snap({
    sources: [{ source: 'meta', label: 'Meta Ads', status: 'ok' }],
    blocks: { 'meta.x.kpi': kpi('meta.x.kpi', 'meta'), 'meta.x.campaigns': table('meta.x.campaigns', rows) },
    metaSubs: [{ key: 'x', label: 'X' }],
  })).slides.filter((s) => s.blockIds.includes('meta.x.campaigns'));
  assert.equal(build(8).length, 1);
  assert.equal(build(9).length, 2);
  assert.equal(build(500).length, MAX_TABLE_PAGES);
  assert.deepEqual(build(20).map((s) => s.page), [0, 1, 2]);
});

test('switching language translates generated titles and leaves edited ones', () => {
  const doc = planDocument(config(), snap({
    sources: [{ source: 'shopee', label: 'Shopee Ads', status: 'ok' }],
    blocks: { 'shopee.daily': { id: 'shopee.daily', source: 'shopee', kind: 'chart', chart: 'line', title: L('x'), labels: ['1'], series: [], fmt: 'money' } },
  }));
  const daily = doc.slides.find((s) => s.title === 'Tren Harian Toko');
  assert.ok(daily);
  doc.slides[0].title = 'Judul saya';
  const en = applyLanguage(doc, 'en');
  assert.equal(en.config.lang, 'en');
  assert.equal(en.config.period.curLabel, 'September 2026');
  assert.equal(en.config.period.oldLabel, 'August 2026');
  assert.ok(en.slides.some((s) => s.title === 'Store Daily Trends'));
  assert.equal(en.slides[0].title, 'Judul saya');
  assert.ok(applyLanguage(en, 'id').slides.some((s) => s.title === 'Tren Harian Toko'), 'and back');
});

test('hidden slides and disabled sections stay out; blank narrative stays out of the PDF', () => {
  const doc = planDocument(config(), snap());
  const narrative = doc.slides.find((s) => s.layout === 'narrative');
  assert.ok(narrative && isEmptySlide(narrative));
  assert.ok(!exportableSlides(doc).includes(narrative));
  narrative.narrative.findings.push({ id: 'p', text: 'Terisi' });
  assert.ok(exportableSlides(doc).includes(narrative));

  const shown = visibleSlides(doc).length;
  doc.slides[0].hidden = true;
  assert.equal(visibleSlides(doc).length, shown - 1);
  const section = doc.sections.find((s) => s.kind === 'conclusion');
  assert.ok(section);
  section.enabled = false;
  assert.ok(!visibleSlides(doc).some((s) => s.sectionId === section.id));
});

test('next actions: blank until there is something to list', () => {
  const doc = planDocument(config(), snap({
    sources: [{ source: 'meta', label: 'Meta Ads', status: 'ok' }],
    blocks: { 'meta.x.kpi': kpi('meta.x.kpi', 'meta') },
    metaSubs: [{ key: 'x', label: 'X' }],
  }));
  const channel = doc.slides.find((s) => s.layout === 'next_actions' && !s.aggregateActions);
  const summary = doc.slides.find((s) => s.aggregateActions);
  assert.ok(channel && isEmptySlide(channel));
  assert.ok(summary && !isEmptySlide(summary));
  assert.ok(!exportableSlides(doc).includes(summary), 'nothing to summarise yet');
  channel.actions.push({ id: 'a', action: 'Uji creative', owner: 'MIL Digital', priority: 'High' });
  assert.ok(exportableSlides(doc).includes(summary));
});

test('review reports what needs a person, and what cannot be exported', () => {
  const doc = planDocument(config(), snap({ sources: [{ source: 'meta', label: 'Meta Ads', status: 'ok' }], blocks: { 'meta.x.kpi': kpi('meta.x.kpi', 'meta') }, metaSubs: [{ key: 'x', label: 'X' }] }));
  const slide = doc.slides.find((s) => s.blockIds.includes('meta.x.kpi'));
  assert.ok(slide);
  slide.blockIds = ['meta.gone'];
  const issues = reviewDocument(doc, snap({
    sources: [
      { source: 'shopee', label: 'Shopee Ads', status: 'error', message: 'boom' },
      { source: 'meta', label: 'Meta Ads', status: 'ok', periodMismatch: true, periodCur: 'W1', periodOld: 'W0' },
      { source: 'google', label: 'Google Ads', status: 'ok', currency: 'USD' },
    ],
  }), new Set([doc.slides[0].id]));
  const kinds = issues.map((i) => i.kind);
  assert.ok(kinds.includes('overflow'));
  assert.ok(kinds.includes('missing-data'));
  assert.ok(issues.some((i) => i.kind === 'source' && i.level === 'error'));
  assert.ok(issues.some((i) => i.kind === 'period' && /W1/.test(i.message)));
  assert.ok(issues.some((i) => /USD/.test(i.message)), 'a currency mismatch is never silently relabelled');
  assert.ok(issues.filter((i) => i.kind === 'empty-narrative').length <= 1, 'headlines are summarised');
});

test('AI facts come only from the slide, its channel, or the overview', () => {
  const blocks = { 'meta.x.kpi': kpi('meta.x.kpi', 'meta'), 'shopee.kpi': kpi('shopee.kpi', 'shopee'), 'overview.exec': kpi('overview.exec', 'overview') };
  const s = snap({ sources: [{ source: 'meta', label: 'Meta Ads', status: 'ok' }], blocks, metaSubs: [{ key: 'x', label: 'X' }] });
  const doc = planDocument(config(), s);
  const dataSlide = doc.slides.find((x) => x.blockIds.includes('meta.x.kpi'));
  assert.ok(dataSlide);
  const facts = factsForSlide(dataSlide, doc, s).facts;
  assert.equal(facts.length, 1);
  assert.match(facts[0], /Rp150/);
  assert.match(facts[0], /\+50\.00%/);
  const channelNarrative = doc.slides.find((x) => x.layout === 'narrative' && doc.sections.find((c) => c.id === x.sectionId)?.channel === 'meta');
  assert.ok(channelNarrative);
  const own = factsForSlide(channelNarrative, doc, s).facts;
  assert.ok(own.length > 0 && own.every((f) => f.startsWith('meta.x.kpi')), 'another channel never leaks in');
  assert.deepEqual(factsForSlide(dataSlide, doc, null).facts, [], 'no snapshot, no facts');
});

function teamDoc() {
  const doc = planDocument(config(), snap({
    sources: [{ source: 'meta', label: 'Meta Ads', status: 'ok' }],
    blocks: { 'meta.x.kpi': kpi('meta.x.kpi', 'meta') },
    metaSubs: [{ key: 'x', label: 'X' }],
  }));
  return doc;
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

test("teammates' edits on different slides both survive", () => {
  const base = teamDoc();
  const mine = clone(base);
  const theirs = clone(base);
  mine.slides[2].headline = 'Meta dari saya';
  theirs.slides[5].headline = 'Shopee dari rekan';
  const { doc, conflicts } = mergeDocuments(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(doc.slides[2].headline, 'Meta dari saya');
  assert.equal(doc.slides[5].headline, 'Shopee dari rekan');
});

test('different fields of one slide merge; the same field is a conflict', () => {
  const base = teamDoc();
  const mine = clone(base);
  const theirs = clone(base);
  mine.slides[2].headline = 'Headline saya';
  theirs.slides[2].narrative.takeaways = [{ id: 'p', text: 'Poin rekan' }];
  const merged = mergeDocuments(base, mine, theirs);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.doc.slides[2].headline, 'Headline saya');
  assert.equal(merged.doc.slides[2].narrative.takeaways[0].text, 'Poin rekan');

  theirs.slides[2].headline = 'Headline rekan';
  assert.deepEqual(mergeDocuments(base, mine, theirs).conflicts, [base.slides[2].title]);
  theirs.slides[2].headline = 'Headline saya';
  assert.deepEqual(mergeDocuments(base, mine, theirs).conflicts, [], 'the same change is no conflict');
});

test('added, deleted and reordered slides combine', () => {
  const base = teamDoc();
  const mine = clone(base);
  const theirs = clone(base);
  const added = { ...clone(base.slides[0]), id: 'mine_new', title: 'Baru' };
  mine.slides.splice(3, 0, added);
  const gone = theirs.slides.splice(1, 1)[0];
  const moved = theirs.slides.pop();
  assert.ok(moved);
  theirs.slides.unshift(moved);
  const { doc, conflicts } = mergeDocuments(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  const ids = doc.slides.map((s) => s.id);
  assert.ok(ids.includes('mine_new'));
  assert.ok(!ids.includes(gone.id), 'their delete holds');
  assert.equal(ids[0], moved.id, 'their reorder holds');
  assert.equal(new Set(ids).size, ids.length, 'nothing duplicated');
});

test('editing a slide a teammate deleted is a conflict, not a silent loss', () => {
  const base = teamDoc();
  const mine = clone(base);
  const theirs = clone(base);
  mine.slides[2].headline = 'Masih saya kerjakan';
  theirs.slides.splice(2, 1);
  assert.deepEqual(mergeDocuments(base, mine, theirs).conflicts, [base.slides[2].title]);
});
