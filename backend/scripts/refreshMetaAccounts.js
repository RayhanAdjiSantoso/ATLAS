/**
 * refreshMetaAccounts.js — copy the ad accounts registered in Pengaturan
 * Brand > "Meta Ads Automation" into brand_ad_accounts, then re-roll the
 * brands whose accounts / Boost keyword changed.
 *
 * ATLAS does this automatically after every brand save/delete in Meta Ads
 * Automation; run this once after deploying (initial load), or if a save's
 * automatic refresh failed (logged on the server).
 *
 *   node scripts/refreshMetaAccounts.js
 *
 * Requires META_AUTOMATION_WEBAPP_URL / META_AUTOMATION_API_KEY.
 */

import dotenv from 'dotenv';

dotenv.config();

const { refreshMetaAccountsMirror } = await import('../src/services/internalDashboardSync/metaAccountsMirror.js');
const { refreshInternalDashboard } = await import('../src/services/internalDashboardSync/dailyTrackingSync.js');
const { default: pool } = await import('../src/config/db.js');

try {
  const res = await refreshMetaAccountsMirror();
  console.log(`${res.accounts} ad account disalin. Dilewati: ${res.skippedUnlinked} belum tertaut ke brand ATLAS, ${res.skippedUnknownBrand} brand_id tidak ada di DB ini.`);
  for (const brandId of res.changedBrands) {
    const r = await refreshInternalDashboard(brandId);
    console.log(`  brand ${brandId}: ${r ? `roll-up ${r.status}, ${r.rowsWritten} baris` : 'tidak ada data Daily Tracking / gagal (lihat log)'}`);
  }
  const { rows } = await pool.query(
    `SELECT b.brand_name, a.ad_account_id, a.account_type, a.boost_keyword
     FROM brand_ad_accounts a JOIN brands b USING (brand_id) ORDER BY 1, 3`);
  for (const r of rows) console.log(`  ${r.brand_name.padEnd(22)} ${r.ad_account_id.padEnd(22)} ${r.account_type.padEnd(5)} ${r.boost_keyword ?? ''}`);
} finally {
  await pool.end();
}
