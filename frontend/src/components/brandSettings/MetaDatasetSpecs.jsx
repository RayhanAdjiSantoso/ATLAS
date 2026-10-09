import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import './metaAdsAutoFetch.css';

// Static, so read once per page load and shared by every row that opens.
let catalogRequest = null;
const loadCatalog = () => {
  catalogRequest ??= api.get('/meta-ads-insights/catalog').then((res) => res.data)
    .catch((err) => { catalogRequest = null; throw err; });
  return catalogRequest;
};

// The breakdowns and metrics a Meta dataset's file holds, per campaign type —
// the same list Automate Input with API shows, for users who cannot open that
// panel. `sections` are catalog keys (boost, ecom, b2b, cpas).
export default function MetaDatasetSpecs({ sections }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadCatalog().then((d) => alive && setData(d)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  if (failed) return <p className="maf-hint">Daftar breakdown &amp; metrik belum dapat dimuat.</p>;
  if (!data) return null;

  const shown = data.catalog.filter((s) => sections.includes(s.key));
  return (
    <div className="maf-block maf-specs">
      <h4>Breakdown</h4>
      <div className="maf-chips" aria-label="Breakdown">
        {data.breakdowns.map((b) => <span key={b} className="maf-chip">{b}</span>)}
      </div>
      <h4 className="maf-sub">Metrik per jenis campaign</h4>
      {shown.map((section) => (
        <div key={section.key} className="maf-section">
          <h5>{section.label}</h5>
          <div className="maf-chips" aria-label={`Metrik ${section.label}`}>
            {section.metrics.map((m) => <span key={m.key} className="maf-chip">{m.label}</span>)}
          </div>
        </div>
      ))}
    </div>
  );
}
