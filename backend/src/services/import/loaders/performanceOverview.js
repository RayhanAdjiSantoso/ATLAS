import {
  parseIdr,
  parseIntValue,
  parsePct,
  parsePeriodSummary,
  parseTs,
  readSheetAsStrings,
  readSheetRaw,
  readWorkbook,
  toDateString,
} from '../parsers.js';

const STAGE_SHEETS = ['Pesanan Dibuat', 'Pesanan Siap Dikirim', 'Pesanan Dibayar'];

export function detectPerformanceOverviewPeriod(filepath) {
  const wb = readWorkbook(filepath);
  const raw = readSheetRaw(wb, 'Pesanan Dibuat');
  if (raw.length > 1 && raw[1]?.[0]) {
    const summary = parsePeriodSummary(raw[1][0]);
    if (summary) return summary;
  }

  const rows = readSheetAsStrings(wb, 'Pesanan Dibuat');
  const dates = rows
    .map((r) => parseTs(r['Tanggal'], '%d-%m-%Y'))
    .filter(Boolean);
  if (dates.length === 0) return { start: null, end: null };
  dates.sort((a, b) => a - b);
  return { start: toDateString(dates[0]), end: toDateString(dates[dates.length - 1]) };
}

export async function loadDailyOrderPerformance(client, resolver, filepath, brandId, uploadId) {
  let inserted = 0;

  for (const sheetName of STAGE_SHEETS) {
    const wb = readWorkbook(filepath);
    const rows = readSheetAsStrings(wb, sheetName).filter((row) => {
      const d = parseTs(row['Tanggal'], '%d-%m-%Y');
      return d != null;
    });

    const stageId = await resolver.getOrCreateOne(
      'order_pipeline_stages', 'stage_id', 'stage_name', sheetName,
    );

    for (const row of rows) {
      const result = await client.query(
        `INSERT INTO daily_order_performance (
          report_date, stage_id, total_sales_idr, total_orders, sales_per_order,
          products_clicked, total_visitors, order_conversion_rate,
          cancelled_orders, cancelled_sales_idr, returned_orders, returned_sales_idr,
          total_buyers, new_buyers, existing_buyers, potential_buyers,
          repeat_purchase_rate, brand_id, upload_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT (brand_id, report_date, stage_id) DO NOTHING RETURNING id`,
        [
          parseTs(row['Tanggal'], '%d-%m-%Y'), stageId,
          parseIdr(row['Total Penjualan (IDR)']) ?? 0, parseIntValue(row['Total Pesanan']) ?? 0,
          parseIdr(row['Penjualan per Pesanan']), parseIntValue(row['Produk Diklik']) ?? 0,
          parseIntValue(row['Total Pengunjung']) ?? 0, parsePct(row['Tingkat Konversi Pesanan']),
          parseIntValue(row['Pesanan Dibatalkan']) ?? 0, parseIdr(row['Penjualan Dibatalkan']) ?? 0,
          parseIntValue(row['Pesanan Dikembalikan']) ?? 0, parseIdr(row['Penjualan Dikembalikan']) ?? 0,
          parseIntValue(row['Pembeli']) ?? 0, parseIntValue(row['Total Pembeli Baru']) ?? 0,
          parseIntValue(row['Total Pembeli Saat Ini']) ?? 0, parseIntValue(row['Total Potensi Pembeli']) ?? 0,
          parsePct(row['Tingkat Pembelian Berulang']),
          brandId, uploadId,
        ],
      );
      if (result.rowCount > 0) inserted += 1;
    }
  }

  return inserted;
}

export async function loadDailyChannelPerformance(client, resolver, filepath, brandId, uploadId) {
  const wb = readWorkbook(filepath);
  let inserted = 0;

  const stageAsalSheets = {
    'Pesanan Dibuat': '(pesanan dibuat)Asal',
    'Pesanan Siap Dikirim': '(pesanan siap dikirim)Asal',
    'Pesanan Dibayar': '(pesanan dibayar)Asal'
  };

  const channelNames = ['Halaman Produk', 'Live Penjual', 'Video Penjual', 'Affiliate', 'Iklan Shopee'];

  for (const [stageName, sheetPrefix] of Object.entries(stageAsalSheets)) {
    const matchedSheet = wb.SheetNames.find(n => n.startsWith(sheetPrefix));
    if (!matchedSheet) continue;

    const rawRows = readSheetRaw(wb, matchedSheet);
    if (rawRows.length === 0) continue;

    const stageId = await resolver.getOrCreateOne(
      'order_pipeline_stages', 'stage_id', 'stage_name', stageName,
    );

    let currentChannel = null;
    let currentSubSource = null;

    for (const row of rawRows) {
      if (!row || row.length === 0) continue;
      
      const col0 = String(row[0] || '').trim();
      if (!col0 || col0 === 'Sumber Kunjungan') continue;

      // Check if this row defines a Channel
      if (channelNames.includes(col0)) {
        // If other columns are empty, it defines a new Channel
        const isInduk = row.slice(1).every(val => val === null || val === '');
        if (isInduk) {
          currentChannel = col0;
          currentSubSource = null;
          continue;
        }
      }

      // Check if it is a date row (data row)
      const isDate = /^\d{2}-\d{2}-\d{4}$/.test(col0);
      if (isDate) {
        if (!currentChannel) continue; // Skip if no channel active yet
        
        const subSourceName = currentSubSource || 'Semua';
        const channelId = await resolver.getOrCreateOne(
          'traffic_channels', 'channel_id', 'channel_name', currentChannel,
        );
        const subSourceId = await resolver.getOrCreateOne(
          'traffic_sub_sources', 'sub_source_id', 'sub_source_name', subSourceName,
        );

        const reportDate = parseTs(col0, '%d-%m-%Y');
        
        const result = await client.query(
          `INSERT INTO daily_channel_performance (
            report_date, stage_id, channel_id, sub_source_id,
            sales_idr, sales_ratio, products_viewed, products_clicked,
            total_orders, products_ordered, click_percentage, conversion_rate,
            sales_per_order, total_buyers, unique_products_viewed, unique_products_clicked,
            brand_id, upload_id
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (brand_id, report_date, stage_id, channel_id, sub_source_id) DO NOTHING RETURNING id`,
          [
            reportDate, stageId, channelId, subSourceId,
            parseIdr(row[2]) ?? 0, parsePct(row[1]), parseIntValue(row[3]) ?? 0, parseIntValue(row[4]) ?? 0,
            parseIdr(row[5]) ?? 0, parseIdr(row[6]) ?? 0, parsePct(row[7]), parsePct(row[8]),
            parseIdr(row[9]), parseIntValue(row[10]) ?? 0, parseIntValue(row[11]) ?? 0, parseIntValue(row[12]) ?? 0,
            brandId, uploadId
          ]
        );
        if (result.rowCount > 0) inserted += 1;
      } else {
        // If it's not a channel name and not a date, it defines a new SubSource
        // (unless it's the total row for the channel itself: row[0] === currentChannel)
        if (col0 !== currentChannel) {
          currentSubSource = col0;
        }
      }
    }
  }

  return inserted;
}

export async function deriveReportPeriod(client, resolver, filepath, stageSheet = 'Pesanan Dibuat') {
  const wb = readWorkbook(filepath);
  const rows = readSheetAsStrings(wb, stageSheet);
  const dates = rows
    .map((r) => parseTs(r['Tanggal'], '%d-%m-%Y'))
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (dates.length === 0) return null;

  const periodStart = toDateString(dates[0]);
  const periodEnd = toDateString(dates[dates.length - 1]);

  return resolver.getOrCreate(
    'report_periods', 'period_id', ['period_start', 'period_end'],
    [periodStart, periodEnd],
  );
}
