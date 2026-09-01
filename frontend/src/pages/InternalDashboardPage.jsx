import { useState } from 'react';
import InputDataTab from '../components/internalDashboard/InputDataTab.jsx';

// Internal Dashboard MIL Digital — admin-only, all-clients performance.
// Only the "Input Data" tab exists for now; the S1–S8 view sections
// (Executive Overview, Business Checkup, Kategori, Industry, Benchmark,
// Channel, Client Detail, Data Quality) become sibling tabs later.
const TABS = ['Input Data'];
const TAB_COMPONENTS = { 'Input Data': InputDataTab };

export default function InternalDashboardPage() {
  const [activeTab, setActiveTab] = useState(TABS[0]);
  const ActiveTabComponent = TAB_COMPONENTS[activeTab];

  return (
    <div>
      <div className="page-header">
        <h1>Internal Dashboard</h1>
        <p>Capture performance seluruh client MIL Digital. Input data bulanan manual per sumber.</p>
      </div>

      <div
        className="tabs-nav"
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.5rem',
          marginBottom: '1.5rem',
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`btn ${activeTab === tab ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              fontWeight: '600',
              fontSize: '0.9rem',
              padding: '0.5rem 1.25rem',
              border: activeTab === tab ? 'none' : '1px solid var(--border)',
            }}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <ActiveTabComponent />
    </div>
  );
}
