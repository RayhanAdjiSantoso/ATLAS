import { useState } from 'react';
import { Megaphone, Radio } from 'lucide-react';
import BrandsSection from '../metaAutomation/BrandsSection.jsx';
import SubscriptionsSection from '../metaAutomation/SubscriptionsSection.jsx';

// Meta Ads Automation's brand registry, moved here from its own page.
//
// These are NOT ATLAS brands — they are ad-account registrations held by the
// Apps Script project, keyed by ad account id and linked back to an ATLAS
// brand. They lived under Meta Ads Automation, which meant registering an
// account and then configuring the brand that uses it were two different
// pages; the auto-fetch panel a few sections below even had to send people
// there by link. Brand-level setup belongs with the rest of brand setup.
//
// Brand and Langganan stay two views of one section because they are one
// record: deleting a brand deletes its subscriptions, and a subscription
// cannot exist without a brand to attach to.
const SUB_VIEWS = [
  { id: 'brand', label: 'Brand', Icon: Megaphone, hint: 'Kredensial ad account' },
  { id: 'langganan', label: 'Langganan', Icon: Radio, hint: 'Penerima laporan email' },
];

export default function MetaAutomationSection() {
  const [sub, setSub] = useState('brand');
  const active = SUB_VIEWS.find((v) => v.id === sub) ?? SUB_VIEWS[0];

  return (
    <>
      <div className="brand-workspace-head">
        <div>
          <h2>Meta Ads Automation</h2>
          <p>
            Daftarkan ad account Meta beserta tokennya, lalu atur siapa yang menerima laporan otomatisnya. Brand yang sudah tertaut di sini bisa mengisi
            Daily Tracking dan auto-fetch bulanan tanpa langkah tambahan.
          </p>
        </div>
        <span className="brand-section-meta">{active.hint}</span>
      </div>

      <div className="brand-meta-subnav">
        <div className="brand-status-filter" role="group" aria-label="Bagian Meta Ads Automation">
          {SUB_VIEWS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={sub === id ? 'is-selected' : ''}
              aria-pressed={sub === id}
              onClick={() => setSub(id)}
            >
              <Icon size={14} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="brand-meta-body">{sub === 'brand' ? <BrandsSection /> : <SubscriptionsSection />}</div>
    </>
  );
}
