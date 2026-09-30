import pool from '../../config/db.js';
import { callAppsScript } from '../metaAutomationService.js';

// =====================================================================
// brand_ad_accounts <- Pengaturan Brand > "Meta Ads Automation".
//
// Ad accounts (act_…), their type (MAIN/CPAS), the "Kata Kunci Boost Post"
// and the link to an ATLAS brand are registered only there, and stored by
// the Meta Automation Apps Script (Script Properties + its hard-coded
// CONFIG.ACCOUNTS — no spreadsheet involved). This copies that list into
// brand_ad_accounts so the Internal Dashboard reads Postgres only.
//
// Called after every brand save/delete in Meta Ads Automation (see
// metaAutomationController) and by scripts/refreshMetaAccounts.js.
// The table is replaced wholesale: an account removed there disappears
// here. Accounts not linked to an ATLAS brand (atlasBrandId empty) are
// skipped — they cannot be attributed to a client.
// =====================================================================

export async function refreshMetaAccountsMirror({ fetchList = () => callAppsScript('brandList') } = {}) {
  const list = await fetchList();
  const linked = (Array.isArray(list) ? list : [])
    .filter((a) => a?.id && Number.isInteger(Number(a.atlasBrandId)) && Number(a.atlasBrandId) > 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: before } = await client.query('SELECT brand_id, ad_account_id, account_type, boost_keyword FROM brand_ad_accounts');
    const { rows: brands } = await client.query('SELECT brand_id FROM brands WHERE brand_id = ANY($1::int[])', [linked.map((a) => Number(a.atlasBrandId))]);
    const known = new Set(brands.map((b) => b.brand_id));
    const usable = linked.filter((a) => known.has(Number(a.atlasBrandId)));

    await client.query('DELETE FROM brand_ad_accounts');
    for (const a of usable) {
      await client.query(
        `INSERT INTO brand_ad_accounts (brand_id, ad_account_id, account_name, account_type, boost_keyword, is_primary, synced_at)
         VALUES ($1, $2, $3, $4, $5, FALSE, now())
         ON CONFLICT (brand_id, ad_account_id) DO NOTHING`,
        [Number(a.atlasBrandId), String(a.id), a.client ?? null, a.type === 'CPAS' ? 'CPAS' : 'MAIN',
          a.type === 'CPAS' ? null : (String(a.boostMatch ?? '').trim().toLowerCase() || null)],
      );
    }
    await client.query('COMMIT');

    // Brands whose accounts or keyword changed — their Meta funnel split
    // must be recomputed.
    const sig = (rows) => new Map(rows.map((r) => [`${r.brand_id}|${r.ad_account_id}`, `${r.account_type}|${r.boost_keyword ?? ''}`]));
    const beforeSig = sig(before);
    const afterRows = usable.map((a) => ({
      brand_id: Number(a.atlasBrandId), ad_account_id: String(a.id), account_type: a.type === 'CPAS' ? 'CPAS' : 'MAIN',
      boost_keyword: a.type === 'CPAS' ? null : (String(a.boostMatch ?? '').trim().toLowerCase() || null),
    }));
    const afterSig = sig(afterRows);
    const changedBrands = new Set();
    for (const [k, v] of afterSig) if (beforeSig.get(k) !== v) changedBrands.add(Number(k.split('|')[0]));
    for (const k of beforeSig.keys()) if (!afterSig.has(k)) changedBrands.add(Number(k.split('|')[0]));

    return {
      accounts: usable.length,
      skippedUnlinked: (Array.isArray(list) ? list.length : 0) - linked.length,
      skippedUnknownBrand: linked.length - usable.length,
      changedBrands: [...changedBrands],
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// After a brand save/delete in Meta Ads Automation: refresh the copy, then
// re-roll the brands whose accounts or Boost keyword changed (their Meta
// funnel split depends on it). The save itself already succeeded in Apps
// Script, so a failure here is logged, never surfaced as a failed save.
export async function syncMetaAccountsToDashboard(opts = {}) {
  try {
    const res = await refreshMetaAccountsMirror(opts);
    const { refreshInternalDashboard } = await import('./dailyTrackingSync.js');
    for (const brandId of res.changedBrands) await refreshInternalDashboard(brandId);
    return res;
  } catch (err) {
    console.error('[internal-dashboard] gagal menyalin ad account dari Meta Ads Automation:', err.message);
    return null;
  }
}
