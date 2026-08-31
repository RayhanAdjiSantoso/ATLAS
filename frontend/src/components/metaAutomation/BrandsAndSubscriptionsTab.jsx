import { useState } from 'react';
import BrandsSection from './BrandsSection.jsx';
import SubscriptionsSection from './SubscriptionsSection.jsx';

const SUB_TABS = ['Brand', 'Langganan'];

export default function BrandsAndSubscriptionsTab() {
  const [active, setActive] = useState(SUB_TABS[0]);

  return (
    <div>
      <div
        style={{
          display: 'flex', gap: '0.5rem',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.5rem', marginBottom: '1.5rem',
        }}
      >
        {SUB_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`btn ${active === tab ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              fontWeight: 600, fontSize: '0.85rem', padding: '0.4rem 1rem',
              border: active === tab ? 'none' : '1px solid var(--border)',
            }}
            onClick={() => setActive(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {active === 'Brand' ? <BrandsSection /> : <SubscriptionsSection />}
    </div>
  );
}
