import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../api/client.js';

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
// 2. Brand & Langganan accounts (GET /meta-automation/brands) that are
//    linked via atlasBrandId and have either a Kata Kunci Boost Post (MAIN)
//    or are typed CPAS — the newer, Sheet-free path (see BrandsSection).
//    An account already covered by a config in (1) is excluded here so it's
//    never synced twice.
// One click runs every source found, so a brand split across both (or with
// multiple accounts) fills Boost Post, Non-Boost Post and CPAS together.
export default function MetaSyncButton({ brandId, onSynced }) {
  const [configs, setConfigs] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // Sequential, not Promise.all — both hit the same Apps Script Web
        // App, and firing them at once is exactly the "concurrent script
        // executions" condition that makes Google's front end serve an
        // interstitial page instead of proxying through.
        const trackingRes = await api.get('/meta-automation/tracking');
        const brandsRes = await api.get('/meta-automation/brands');
        setConfigs(trackingRes.data.configs || []);
        setAccounts(brandsRes.data.brands || []);
      } catch {
        // Left empty — the page below already renders a graceful empty state.
      } finally {
        setLoaded(true);
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
      label: `${a.client} - ${a.type} (Brand & Langganan)`,
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
    const results = [];
    for (const src of sources) {
      try {
        const res = await api.post('/daily-tracking/meta-sync', { brandId, ...src.payload });
        results.push({ label: src.label, ok: true, data: res.data });
      } catch (err) {
        results.push({ label: src.label, ok: false, error: err.response?.data?.message || err.message || 'Gagal sync' });
      }
    }
    setOutcomes(results);
    setBusy(false);
    onSynced?.();
  };

  if (!loaded) return null;

  if (!sources.length) {
    return (
      <span className="dt-meta-sync-error">
        Belum ada sumber Meta Ads Automation untuk brand ini — isi Nama Brand + Kata Kunci Boost
        Post di Meta Ads Automation &gt; Brand &amp; Langganan (atau tautkan lewat config di tab
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
