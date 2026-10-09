import { sanitizeFilename } from '../../utils/exportImage';
import { handleStaleChunk } from '../../utils/staleChunk';
import { GOAL_LABELS, channelLabel, matchTypeLabel, type GadsAd, type GadsReport, type GoalKey } from './googleAds';
import { FINDING_LABEL, KEYWORD_LABEL, SEVERITY_LABEL, TERM_LABEL } from './GoogleAdsInsights';
import { auctionRanks } from './GoogleAdsContext';

// The whole Google Ads report as one workbook, one sheet per table. Built
// from the report data rather than the screen: every row (not the top 10 a
// table shows), numbers kept as numbers with Excel formats, and the same
// periods, currency and metric definitions as the report. On-screen table
// filters are not applied — the class/status columns are there so Excel's
// own filter does that job.

type Kind = 'text' | 'money' | 'int' | 'dec' | 'pct' | 'x';
interface Col<T> { label: string; kind?: Kind; value: (r: T) => string | number | null | undefined }

const FORMAT: Record<Exclude<Kind, 'text'>, string> = { money: '#,##0.00', int: '#,##0', dec: '#,##0.00', pct: '0.00%', x: '0.00"x"' };
const DOW = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const human = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '');

type Metric = { cost: number; impressions: number; clicks: number; conversions: number; conversions_value: number; ctr: number | null; avg_cpc: number | null; avg_cpm: number | null; cost_per_conv: number | null; cvr: number | null; roas: number | null };
function metricCols<T extends Partial<Metric>>(): Col<T>[] {
  return [
    { label: 'Cost', kind: 'money', value: (r) => r.cost }, { label: 'Impressions', kind: 'int', value: (r) => r.impressions },
    { label: 'Clicks', kind: 'int', value: (r) => r.clicks }, { label: 'CTR', kind: 'pct', value: (r) => r.ctr },
    { label: 'Avg. CPC', kind: 'money', value: (r) => r.avg_cpc }, { label: 'Conversions', kind: 'dec', value: (r) => r.conversions },
    { label: 'Cost / conv.', kind: 'money', value: (r) => r.cost_per_conv }, { label: 'CVR', kind: 'pct', value: (r) => r.cvr },
    { label: 'Conv. value', kind: 'money', value: (r) => r.conversions_value }, { label: 'ROAS', kind: 'x', value: (r) => r.roas },
  ];
}

export async function downloadGoogleAdsWorkbook(report: GadsReport, { p1, p2, brand }: { p1: string; p2: string; brand: string }) {
  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const add = <T,>(name: string, rows: T[], cols: Col<T>[]) => {
      if (!rows.length) return;
      const aoa: (string | number | null)[][] = [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => {
        const v = c.value(r);
        return v === undefined ? null : v;
      }))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      cols.forEach((c, ci) => {
        if (!c.kind || c.kind === 'text') return;
        for (let ri = 1; ri < aoa.length; ri += 1) {
          const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
          if (cell && typeof cell.v === 'number') cell.z = FORMAT[c.kind];
        }
      });
      ws['!cols'] = cols.map((c) => ({ wch: Math.min(60, Math.max(10, c.label.length + 2, c.kind ? 12 : 24)) }));
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    };
    const { cur, old } = report;

    // Ringkasan: both periods side by side.
    const summary: [string, Kind, keyof Metric | 'all_conversions'][] = [
      ['Cost', 'money', 'cost'], ['Impressions', 'int', 'impressions'], ['Clicks', 'int', 'clicks'], ['CTR', 'pct', 'ctr'], ['Avg. CPC', 'money', 'avg_cpc'],
      ['Avg. CPM', 'money', 'avg_cpm'], ['Conversions', 'dec', 'conversions'], ['Cost / conv.', 'money', 'cost_per_conv'], ['CVR', 'pct', 'cvr'],
      ['All conv.', 'dec', 'all_conversions'], ['Conv. value', 'money', 'conversions_value'], ['ROAS', 'x', 'roas'],
    ];
    const rowsSummary = summary.map(([label, kind, key]) => ({ label, kind, a: old.totals[key] as number | null, b: cur.totals[key] as number | null }));
    const ws0 = XLSX.utils.aoa_to_sheet([
      [`Google Ads Performance Report — ${brand}`], [`Periode: ${p1} (${old.start} s.d. ${old.end}) → ${p2} (${cur.start} s.d. ${cur.end})`], [`Mata uang: ${report.currency ?? 'campuran'}`], [],
      ['Metrik', p1, p2, 'Perubahan'],
      ...rowsSummary.map((r) => [r.label, r.a, r.b, r.a ? ((r.b ?? 0) - r.a) / Math.abs(r.a) : null]),
    ]);
    rowsSummary.forEach((r, i) => {
      const fmt = r.kind === 'text' ? null : FORMAT[r.kind];
      for (const c of [1, 2]) { const cell = ws0[XLSX.utils.encode_cell({ r: 5 + i, c })]; if (cell && fmt) cell.z = fmt; }
      const d = ws0[XLSX.utils.encode_cell({ r: 5 + i, c: 3 })]; if (d) d.z = '0.0%';
    });
    ws0['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws0, 'Ringkasan');

    if (cur.goals) {
      const goals = (['purchase', 'lead', 'micro', 'other'] as GoalKey[]).map((g) => ({ g, a: old.goals?.[g], b: cur.goals![g] }));
      add('Tujuan Bisnis', goals, [
        { label: 'Tujuan', value: (r) => GOAL_LABELS[r.g] },
        { label: `Konversi primer ${p1}`, kind: 'dec', value: (r) => r.a?.conversions }, { label: `Konversi primer ${p2}`, kind: 'dec', value: (r) => r.b.conversions },
        { label: `All conv. ${p2}`, kind: 'dec', value: (r) => r.b.all_conversions }, { label: `Nilai ${p2}`, kind: 'money', value: (r) => r.b.conversions_value },
        { label: 'Cost / hasil (seluruh biaya)', kind: 'money', value: (r) => r.b.blended_cost_per_result }, { label: 'Cost / hasil (campaign tujuan ini)', kind: 'money', value: (r) => r.b.focus_cost_per_result },
        { label: 'ROAS', kind: 'x', value: (r) => r.b.blended_roas }, { label: 'Action belum diverifikasi', kind: 'int', value: (r) => r.b.unverified },
      ]);
    }

    const settings = new Map((report.campaignSettings ?? []).map((s) => [`${s.customer_id}|${s.campaign_id}`, s]));
    const shares = new Map((cur.competitive?.campaigns ?? []).map((s) => [`${s.customer_id}|${s.campaign_id}`, s]));
    add('Campaign', cur.campaigns, [
      { label: 'Campaign', value: (r) => r.campaign_name }, { label: 'Tipe', value: (r) => channelLabel(r.channel_type) },
      { label: 'Status', value: (r) => human(settings.get(`${r.customer_id}|${r.campaign_id}`)?.status) },
      { label: 'Tujuan', value: (r) => { const g = cur.campaignGoals?.[`${r.customer_id}|${r.campaign_id}`]; return g ? GOAL_LABELS[g.goal] : ''; } },
      { label: 'Bidding', value: (r) => human(settings.get(`${r.customer_id}|${r.campaign_id}`)?.bidding_strategy_type) },
      { label: 'Target CPA', kind: 'money', value: (r) => settings.get(`${r.customer_id}|${r.campaign_id}`)?.target_cpa },
      { label: 'Target ROAS', kind: 'x', value: (r) => settings.get(`${r.customer_id}|${r.campaign_id}`)?.target_roas },
      { label: 'Budget / hari', kind: 'money', value: (r) => settings.get(`${r.customer_id}|${r.campaign_id}`)?.budget_amount ?? r.budget },
      ...metricCols<typeof cur.campaigns[number]>(),
      { label: 'Search IS', kind: 'pct', value: (r) => shares.get(`${r.customer_id}|${r.campaign_id}`)?.search_impression_share },
      { label: 'Lost IS (budget)', kind: 'pct', value: (r) => shares.get(`${r.customer_id}|${r.campaign_id}`)?.search_budget_lost_is },
      { label: 'Lost IS (rank)', kind: 'pct', value: (r) => shares.get(`${r.customer_id}|${r.campaign_id}`)?.search_rank_lost_is },
      { label: 'Sumber IS', value: (r) => { const g = shares.get(`${r.customer_id}|${r.campaign_id}`)?.granularity; return g === 'daily_estimate' ? 'estimasi harian' : g === 'range' ? 'Google' : ''; } },
    ]);
    add('Ad Group', cur.adGroups, [{ label: 'Ad group', value: (r) => r.ad_group_name }, { label: 'Campaign', value: (r) => r.campaign_name }, ...metricCols<typeof cur.adGroups[number]>()]);

    if (cur.keywordDetail) {
      add('Keyword', cur.keywordDetail, [
        { label: 'Keyword', value: (r) => r.keyword }, { label: 'Match type', value: (r) => matchTypeLabel(r.match_type) }, { label: 'Ad group', value: (r) => r.ad_group_name },
        { label: 'Campaign', value: (r) => r.campaign_name }, ...metricCols<typeof cur.keywordDetail[number]>(),
        { label: 'Search IS', kind: 'pct', value: (r) => r.search_impression_share }, { label: 'Quality Score', kind: 'int', value: (r) => r.quality_score },
        { label: 'Expected CTR', value: (r) => human(r.expected_ctr) }, { label: 'Ad relevance', value: (r) => human(r.ad_relevance) },
        { label: 'Landing page exp.', value: (r) => human(r.landing_page_experience) }, { label: 'Klasifikasi', value: (r) => KEYWORD_LABEL[r.classification] },
        { label: 'Alasan', value: (r) => [...r.reasons, ...r.quality_flags].join('; ') }, { label: 'Saran', value: (r) => r.suggested_action },
      ]);
    } else {
      add('Keyword', cur.keywords, [{ label: 'Keyword', value: (r) => r.keyword }, ...metricCols<typeof cur.keywords[number]>()]);
    }

    if (cur.searchTermDetail) {
      add('Search Terms', cur.searchTermDetail, [
        { label: 'Search term', value: (r) => r.search_term }, { label: 'Campaign', value: (r) => r.campaign_name }, { label: 'Ad group', value: (r) => r.ad_group_name },
        { label: 'Match type', value: (r) => matchTypeLabel(r.match_type) }, ...metricCols<typeof cur.searchTermDetail[number]>(),
        { label: 'Klasifikasi', value: (r) => TERM_LABEL[r.classification] }, { label: 'Alasan', value: (r) => r.reasons.join('; ') }, { label: 'Saran', value: (r) => r.suggested_action },
      ]);
    } else {
      add('Search Terms', cur.searchTerms, [{ label: 'Search term', value: (r) => r.search_term }, { label: 'Match type', value: (r) => matchTypeLabel(r.match_type) }, ...metricCols<typeof cur.searchTerms[number]>()]);
    }

    const oldCity = new Map(old.cities.map((c) => [c.city, c]));
    add('Kota', cur.cities, [{ label: 'Kota', value: (r) => r.city }, ...metricCols<typeof cur.cities[number]>(), { label: `Konversi ${p1}`, kind: 'dec', value: (r) => oldCity.get(r.city)?.conversions }]);

    add('Iklan', cur.ads ?? [], [
      { label: 'Ad group', value: (r) => r.ad_group_name }, { label: 'Campaign', value: (r) => r.campaign_name }, { label: 'Ad ID', value: (r) => r.ad_id },
      { label: 'Tipe', value: (r) => human(r.ad_type) }, { label: 'Ad strength', value: (r) => human(r.ad_strength) }, ...metricCols<GadsAd>(),
      { label: 'Headline', value: (r) => (r.headlines ?? []).map((h) => h.text).join(' | ') }, { label: 'Description', value: (r) => (r.descriptions ?? []).map((d) => d.text).join(' | ') },
      { label: 'Final URL', value: (r) => (r.final_urls ?? [])[0] ?? '' }, { label: 'Catatan', value: (r) => (r.flags ?? []).join('; ') },
    ]);

    const costAll = cur.totals.cost;
    add('Konversi', cur.conversionActions ?? [], [
      { label: 'Conversion action', value: (r) => r.name }, { label: 'Kategori', value: (r) => human(r.category) }, { label: 'Tujuan', value: (r) => GOAL_LABELS[r.goal] },
      { label: 'Sumber tujuan', value: (r) => (r.goal_source === 'manual' ? 'Diatur brand' : 'Bawaan (belum diverifikasi)') },
      { label: 'Dihitung di Conversions', value: (r) => (r.primary == null ? '' : r.primary ? 'Primer' : 'Sekunder') },
      { label: 'Conversions', kind: 'dec', value: (r) => r.conversions }, { label: 'All conv.', kind: 'dec', value: (r) => r.all_conversions },
      { label: 'Nilai (all)', kind: 'money', value: (r) => r.all_conversions_value }, { label: 'Biaya akun / action', kind: 'money', value: (r) => (r.all_conversions ? costAll / r.all_conversions : null) },
    ]);

    add('Device', cur.devices?.devices ?? [], [
      { label: 'Device', value: (r) => human(r.device) }, { label: 'Porsi cost', kind: 'pct', value: (r) => r.cost_share }, { label: 'Porsi konversi', kind: 'pct', value: (r) => r.conversion_share },
      ...metricCols<NonNullable<GadsReport['cur']['devices']>['devices'][number]>(), { label: 'Catatan', value: (r) => r.flags.join('; ') },
    ]);
    add('Hari x Jam', [...(cur.schedule?.grid ?? [])].sort((a, b) => a.dow - b.dow || a.hour - b.hour), [
      { label: 'Hari', value: (r) => DOW[r.dow] }, { label: 'Jam', kind: 'int', value: (r) => r.hour }, { label: 'Hari dengan data', kind: 'int', value: (r) => r.days },
      ...metricCols<NonNullable<GadsReport['cur']['schedule']>['grid'][number]>(),
    ]);
    add('Landing Page', cur.landingPages?.pages ?? [], [
      { label: 'Landing page', value: (r) => r.url }, { label: 'Varian URL', kind: 'int', value: (r) => r.variants }, { label: 'Clicks', kind: 'int', value: (r) => r.clicks },
      { label: 'Impressions', kind: 'int', value: (r) => r.impressions }, { label: 'Cost', kind: 'money', value: (r) => r.cost }, { label: 'CTR', kind: 'pct', value: (r) => r.ctr },
      { label: 'Conversions', kind: 'dec', value: (r) => r.conversions }, { label: 'CVR', kind: 'pct', value: (r) => r.cvr }, { label: 'Cost / conv.', kind: 'money', value: (r) => r.cost_per_conv },
      { label: 'Catatan', value: (r) => r.flags.join('; ') },
    ]);

    const share = (s: { value: number | null; text: string | null } | undefined) => (s?.value ?? s?.text ?? null);
    const ai = report.auctionInsights;
    const rankCur = auctionRanks(ai.cur.rows);
    const rankOld = auctionRanks(ai.old.rows);
    const oldOf = (r: typeof ai.cur.rows[number]) => ai.old.rows.find((o) => o.domain.toLowerCase() === r.domain.toLowerCase()) ?? (r.isYou ? ai.old.rows.find((o) => o.isYou) : undefined);
    add('Auction Insights', ai.cur.rows, [
      { label: 'Domain', value: (r) => (r.isYou ? `Anda (${r.domain})` : r.domain) }, { label: `Impression share ${p2}`, kind: 'pct', value: (r) => share(r.impression_share) },
      { label: `Peringkat ${p2}`, value: (r) => rankCur.get(r.domain.toLowerCase()) ?? '' },
      { label: `Impression share ${p1}`, kind: 'pct', value: (r) => share(oldOf(r)?.impression_share) },
      { label: `Peringkat ${p1}`, value: (r) => { const o = oldOf(r); return o ? rankOld.get(o.domain.toLowerCase()) ?? '' : ''; } },
      { label: 'Perubahan', kind: 'pct', value: (r) => { const o = oldOf(r); return r.impression_share.value != null && o?.impression_share.value != null ? r.impression_share.value - o.impression_share.value : null; } },
      { label: 'Overlap rate', kind: 'pct', value: (r) => share(r.overlap_rate) }, { label: 'Position above rate', kind: 'pct', value: (r) => share(r.position_above_rate) },
      { label: 'Top of page rate', kind: 'pct', value: (r) => share(r.top_of_page_rate) }, { label: 'Abs. top of page rate', kind: 'pct', value: (r) => share(r.abs_top_of_page_rate) },
      { label: 'Outranking share', kind: 'pct', value: (r) => share(r.outranking_share) },
    ]);
    add('Change History', report.changeHistory.rows, [
      { label: 'Waktu', value: (r) => r.changed_at }, { label: 'Oleh', value: (r) => r.user_email || r.client_type || '' }, { label: 'Item', value: (r) => human(r.resource_type) },
      { label: 'Operasi', value: (r) => human(r.operation) }, { label: 'Campaign', value: (r) => r.campaign_name ?? '' }, { label: 'Ad group', value: (r) => r.ad_group_name ?? '' },
      { label: 'Perubahan', value: (r) => r.changes ?? '' }, { label: 'Sumber', value: (r) => (r.source === 'upload' ? 'File unggahan' : 'Google Ads Script') },
    ]);
    add('Perubahan Setting', (report.campaignSettingChanges ?? []).flatMap((c) => c.changed_fields.map((f) => ({ c, f }))), [
      { label: 'Terlihat', value: (r) => new Date(r.c.valid_from).toLocaleDateString('id-ID') }, { label: 'Campaign', value: (r) => r.c.campaign_name },
      { label: 'Setting', value: (r) => r.f.field.replace(/_/g, ' ') }, { label: 'Sebelum', value: (r) => JSON.stringify(r.f.from ?? null) }, { label: 'Sesudah', value: (r) => JSON.stringify(r.f.to ?? null) },
    ]);
    add('Diagnostics', report.diagnostics ?? [], [
      { label: 'Tingkat', value: (r) => SEVERITY_LABEL[r.severity] }, { label: 'Temuan', value: (r) => FINDING_LABEL[r.type] ?? r.type },
      { label: 'Entity', value: (r) => (r.entity_type === 'account' ? 'Seluruh akun' : r.entity_name) }, { label: 'Keyakinan', value: (r) => human(r.confidence) },
      { label: 'Fakta', value: (r) => r.facts.join('; ') }, { label: 'Kemungkinan penyebab', value: (r) => r.possible_causes.join('; ') }, { label: 'Langkah berikutnya', value: (r) => r.next_steps.join('; ') },
    ]);
    add('Hari Tidak Biasa', report.anomalies?.anomalies ?? [], [
      { label: 'Tanggal', value: (r) => r.date }, { label: 'Metrik', value: (r) => r.metric }, { label: 'Nilai', kind: 'dec', value: (r) => r.value },
      { label: 'Biasanya (median)', kind: 'dec', value: (r) => r.expected }, { label: 'Arah', value: (r) => (r.direction === 'up' ? 'Naik' : 'Turun') },
    ]);

    XLSX.writeFile(wb, `${sanitizeFilename(`Google Ads - ${brand} - ${p2}`)}.xlsx`);
  } catch (err) {
    console.error(err);
    if (handleStaleChunk(err)) return;
    alert('Gagal membuat Excel: ' + (err as Error).message);
  }
}
