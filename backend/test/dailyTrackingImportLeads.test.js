import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDailyTrackingFile } from '../src/services/dailyTrackingImportParser.js';

// Shaped like a non-retail brand's sheet (Valentine): one block with a single
// "Cold Leads (First chat)" column, one split per region with a total, a
// month Total row, and derived lead columns that must not become channels.
const CSV = [
  ',No,Tanggal,Hari,Notes,FB Ads,Boostpost Instagram,Total Ads,Cold Leads (First chat),Hot Leads (Meeting),Hot Leads Rate,Deal Leads,Deal Leads Rate,Cost per leads,From facebook (Hallo),Keterangan',
  ',1,1 February 2026,,,"Rp10,000","Rp5,000","Rp15,000",8,0,,,,,0,',
  ',2,2 February 2026,,,"Rp12,000","Rp6,000","Rp18,000",13,1,,2,,,1,by WO',
  ',,,,Total,"Rp22,000","Rp11,000","Rp33,000",21,1,1.15%,2,340.00%,,,',
  ',No,Tanggal,Hari,Notes,FB Ads,Boostpost Instagram,Total Ads,Cold Leads BANDUNG,Cold Leads JAKARTA,Cold Leads Other Region,Total Cold Leads,Hot Leads (Meeting),Deal Leads',
  ',1,1 August 2026,,,"Rp9,000","Rp4,000","Rp13,000",5,2,1,8,0,',
  ',2,2 August 2026,,,"Rp9,000","Rp4,000","Rp13,000",3,4,,,0,1',
].join('\n');

test('Daily Tracking import: cold leads and deals become Leads Data, not ad channels', () => {
  const p = parseDailyTrackingFile(Buffer.from(CSV), 'valentine.csv');
  const ids = p.columns.map((c) => c.id).sort();
  assert.deepEqual(ids, ['leads:coldLeads', 'leads:deals', 'spend:meta_boost_post', 'spend:meta_nonboost_post']);

  const byDate = Object.fromEntries(p.leadRows.map((r) => [r.entryDate, r]));
  assert.equal(byDate['2026-02-01'].coldLeads, 8);
  assert.equal(byDate['2026-02-01'].deals, null, 'blank deal cell is not 0');
  assert.deepEqual(byDate['2026-02-01'].fields, ['coldLeads']);
  assert.equal(byDate['2026-02-02'].deals, 2);
  assert.equal(byDate['2026-08-01'].coldLeads, 8, 'Total Cold Leads wins over the regions');
  assert.equal(byDate['2026-08-02'].coldLeads, 7, 'regions added up when the total is blank');
  assert.equal(byDate['2026-08-02'].deals, 1);
  assert.equal(p.leadRows.length, 4, 'the month Total row is not a day');
});
