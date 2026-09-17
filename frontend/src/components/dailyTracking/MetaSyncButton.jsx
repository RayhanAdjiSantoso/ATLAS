import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../api/client.js';

// Only mention a channel this config actually produced — a config for a
// CPAS-typed account never has boostSpend/nonBoostSpend at all (see
// apps-script/DailyTrackingBoostPost.gs's isPrimaryCpas branch), so showing
// "Boost: dilewati" for it would misleadingly read as a failure.
function describeResult(data) {
  const parts = [];
  if (data.boostSpend != null) parts.push(`Boost ${data.applied?.boost ? 'diisi' : 'dilewati (manual)'}`);
  if (data.nonBoostSpend != null) parts.push(`Non-Boost ${data.applied?.nonBoost ? 'diisi' : 'dilewati (manual)'}`);
  if (data.cpasSpend != null) parts.push(`CPAS ${data.applied?.cpas ? 'diisi' : 'dilewati (manual)'}`);
  return parts.length ? parts.join(' · ') : 'tidak ada channel yang cocok untuk config ini';
}

// Admin-only manual "Sync Meta Sekarang" — reuses the Meta Ads Automation
// Daily Tracking configs (GET /meta-automation/tracking), filtered to the
// config(s) linked to the brand currently open on this page
// (config.atlasBrandId, set on the Meta Ads Automation > Daily Tracking form
// — see DailyTrackingTab.jsx). A brand with both a MAIN and a CPAS ad
// account normally has TWO separate configs (e.g. "Petite Fleur - MAIN" and
// "Petite Fleur - CPAS") — one click here runs every config for this brand
// so Boost Post, Non-Boost Post and CPAS all get filled together, each from
// whichever config actually produces it.
export default function MetaSyncButton({ brandId, onSynced }) {
  const [configs, setConfigs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState(null);

  useEffect(() => {
    api.get('/meta-automation/tracking').then((res) => setConfigs(res.data.configs || [])).catch(() => {});
  }, []);

  const brandConfigs = configs.filter((c) => Number(c.atlasBrandId) === Number(brandId));

  useEffect(() => {
    // A stale result from a previously-viewed brand should never linger.
    setOutcomes(null);
  }, [brandId]);

  const handleSync = async () => {
    setBusy(true);
    setOutcomes(null);
    const results = [];
    for (const cfg of brandConfigs) {
      try {
        const res = await api.post('/daily-tracking/meta-sync', { brandId, trackingConfigId: cfg.id });
        results.push({ label: cfg.label, ok: true, data: res.data });
      } catch (err) {
        results.push({ label: cfg.label, ok: false, error: err.response?.data?.message || err.message || 'Gagal sync' });
      }
    }
    setOutcomes(results);
    setBusy(false);
    onSynced?.();
  };

  if (!configs.length) return null; // still loading, or Meta Automation isn't configured at all

  if (!brandConfigs.length) {
    return (
      <span className="dt-meta-sync-error">
        Belum ada config Meta Ads Automation untuk brand ini — tautkan lewat "Brand ATLAS" di halaman Meta Ads Automation &gt; Daily Tracking.
      </span>
    );
  }

  return (
    <div className="dt-meta-sync">
      <button type="button" className="btn btn-secondary dt-btn-sm" onClick={handleSync} disabled={busy}>
        <RefreshCw size={13} className={busy ? 'dt-spin' : ''} /> Sync Meta Sekarang
        {brandConfigs.length > 1 ? ` (${brandConfigs.length} config)` : ''}
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
