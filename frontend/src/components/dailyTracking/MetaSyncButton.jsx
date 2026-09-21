import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../api/client.js';

// Last-known source list, kept in localStorage so the button can render the
// instant the page opens: the two Apps Script lookups that build it have
// been measured at anywhere from a few seconds to over a minute. It is only
// a head start — the fetch below always runs and replaces it. Only the
// fields this component reads are stored. A stale entry is harmless: sync
// re-validates server-side, and the background refresh corrects the list.
const CACHE_KEY = 'atlas:daily-tracking:meta-sources';

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (Array.isArray(raw?.configs) && Array.isArray(raw?.accounts)) return raw;
  } catch { /* storage unavailable or malformed — behave as if empty */ }
  return null;
}

function writeCache(configs, accounts) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      configs: configs.map((c) => ({ id: c.id, label: c.label, atlasBrandId: c.atlasBrandId, accountClient: c.accountClient })),
      accounts: accounts.map((a) => ({ client: a.client, type: a.type, atlasBrandId: a.atlasBrandId, boostMatch: a.boostMatch })),
    }));
  } catch { /* quota/private mode — the cache is optional */ }
}

// The first pull for an account is often the slow one (Meta/Apps Script cold
// start, or Google's occasional interstitial page) while an immediate second
// try usually lands fast. The sync is idempotent — it upserts the same
// H-1 values and never overwrites manually-locked cells — so one automatic
// retry on a gateway-type failure is safe. Genuine errors (403 wrong brand,
// 4xx validation, Apps Script's own message) are not retried.
async function postSync(body, onRetry) {
  try {
    return await api.post('/daily-tracking/meta-sync', body);
  } catch (err) {
    const status = err.response?.status;
    const retriable = !err.response || status === 502 || status === 503 || status === 504;
    if (!retriable) throw err;
    onRetry();
    return api.post('/daily-tracking/meta-sync', body);
  }
}

// Only mention a channel this source actually produced — a CPAS-typed
// source never has boostSpend/nonBoostSpend at all, so showing "Boost:
// dilewati" for it would misleadingly read as a failure.
function describeResult(data) {
  const parts = [];
  if (data.boostSpend != null) parts.push(`Boost ${data.applied?.boost ? 'diisi' : 'dilewati (manual)'}`);
  if (data.nonBoostSpend != null) parts.push(`Non-Boost ${data.applied?.nonBoost ? 'diisi' : 'dilewati (manual)'}`);
  if (data.cpasSpend != null) parts.push(`CPAS ${data.applied?.cpas ? 'diisi' : 'dilewati (manual)'}`);
  return parts.length ? parts.join(' · ') : 'tidak ada channel yang cocok untuk sumber ini';
}

// Admin-only manual "Sync Meta Sekarang" — combines TWO possible sources for
// the brand currently open on this page, matching apps-script/
// DailyTrackingBoostPost.gs's updateAllDailyTrackingSpend() exactly:
// 1. Daily Tracking tab configs (GET /meta-automation/tracking), linked via
//    config.atlasBrandId — the older, Sheet-writing path.
// 2. Meta Automation accounts (GET /meta-automation/brands) that are
//    linked via atlasBrandId and have either a Kata Kunci Boost Post (MAIN)
//    or are typed CPAS — the newer, Sheet-free path (see BrandsSection).
//    An account already covered by a config in (1) is excluded here so it's
//    never synced twice.
// One click runs every source found, so a brand split across both (or with
// multiple accounts) fills Boost Post, Non-Boost Post and CPAS together.
export default function MetaSyncButton({ brandId, onSynced }) {
  const [cached] = useState(readCache);
  const [configs, setConfigs] = useState(cached?.configs || []);
  const [accounts, setAccounts] = useState(cached?.accounts || []);
  // True once the live fetch has finished (success or failure) — distinct from
  // having cached data, which only means we can show something early.
  const [refreshed, setRefreshed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    (async () => {
      try {
        // Sequential, not Promise.all — both hit the same Apps Script Web
        // App, and firing them at once is exactly the "concurrent script
        // executions" condition that makes Google's front end serve an
        // interstitial page instead of proxying through.
        const trackingRes = await api.get('/meta-automation/tracking');
        const brandsRes = await api.get('/meta-automation/brands');
        const freshConfigs = trackingRes.data.configs || [];
        const freshAccounts = brandsRes.data.brands || [];
        setConfigs(freshConfigs);
        setAccounts(freshAccounts);
        writeCache(freshConfigs, freshAccounts);
      } catch {
        // A failed refresh keeps whatever the cache gave us; with no cache the
        // page below renders its graceful empty state.
      } finally {
        setRefreshed(true);
      }
    })();
  }, []);

  const brandConfigs = configs.filter((c) => Number(c.atlasBrandId) === Number(brandId));
  const coveredClients = new Set(configs.map((c) => c.accountClient));
  const brandAccounts = accounts.filter((a) => (
    Number(a.atlasBrandId) === Number(brandId)
    && (a.type === 'CPAS' || a.boostMatch)
    && !coveredClients.has(a.client)
  ));

  const sources = [
    ...brandConfigs.map((c) => ({ key: `config:${c.id}`, label: c.label, payload: { trackingConfigId: c.id } })),
    ...brandAccounts.map((a) => ({
      // Keyed by client+type, not client alone: the same brand can have a
      // MAIN and a CPAS account side by side (e.g. "Crabus"), and sending
      // just the name would be ambiguous server-side (see the long note on
      // findAccount_ in apps-script/DailyTrackingBoostPost.gs).
      key: `account:${a.client}:${a.type}`,
      label: `${a.client} - ${a.type} (Meta Automation)`,
      payload: { accountClient: a.client, accountType: a.type },
    })),
  ];

  useEffect(() => {
    // A stale result from a previously-viewed brand should never linger.
    setOutcomes(null);
  }, [brandId]);

  const handleSync = async () => {
    setBusy(true);
    setOutcomes(null);
    setNote('');
    const results = [];
    for (const src of sources) {
      try {
        const res = await postSync({ brandId, ...src.payload }, () => setNote(`${src.label}: Meta lambat merespons, mencoba ulang otomatis…`));
        results.push({ label: src.label, ok: true, data: res.data });
      } catch (err) {
        results.push({ label: src.label, ok: false, error: err.response?.data?.message || err.message || 'Gagal sync' });
      }
    }
    setNote('');
    setOutcomes(results);
    setBusy(false);
    onSynced?.();
  };

  // The two Apps Script lookups above can take several seconds (measured up
  // to over a minute), and until they finish there may be nothing to offer for
  // this brand — e.g. no cache yet, or a brand registered since the cache was
  // written. Show a wait notice rather than an empty gap or a premature "belum
  // ada sumber"; it resolves into the button or that message. With a cache hit
  // for this brand, sources is already non-empty and the button shows at once.
  if (!sources.length && !refreshed) {
    return (
      <span className="dt-meta-sync-result dt-meta-sync-loading">
        <RefreshCw size={13} className="dt-spin" /> Memuat data Meta Ads Automation… mohon tunggu sebentar,
        tombol &quot;Sync Meta Sekarang&quot; akan muncul otomatis untuk brand yang sudah terdaftar.
      </span>
    );
  }

  if (!sources.length) {
    return (
      <span className="dt-meta-sync-error">
        Belum ada sumber Meta Ads Automation untuk brand ini — isi Nama Brand + Kata Kunci Boost
        Post di Pengaturan Brand &gt; Meta Automation (atau tautkan lewat config di tab
        Daily Tracking).
      </span>
    );
  }

  return (
    <div className="dt-meta-sync">
      <button type="button" className="btn btn-secondary dt-btn-sm" onClick={handleSync} disabled={busy}>
        <RefreshCw size={13} className={busy ? 'dt-spin' : ''} /> Sync Meta Sekarang
        {sources.length > 1 ? ` (${sources.length} sumber)` : ''}
      </button>
      {busy && note && <span className="dt-meta-sync-result">{note}</span>}
      {outcomes && (
        <span className="dt-meta-sync-result">
          {outcomes.map((o) => (
            <span key={o.label} style={{ display: 'block' }}>
              {o.label}: {o.ok ? describeResult(o.data) : <span className="dt-meta-sync-error">{o.error}</span>}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
