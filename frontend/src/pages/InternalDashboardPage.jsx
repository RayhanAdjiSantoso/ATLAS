import useSessionState from '../hooks/useSessionState.js';
import { useState } from 'react';
import InputDataTab from '../components/internalDashboard/InputDataTab.jsx';
import ExecutiveOverviewTab from '../components/internalDashboard/ExecutiveOverviewTab.jsx';
import CategoryComparisonTab from '../components/internalDashboard/CategoryComparisonTab.jsx';
import IndustryTab from '../components/internalDashboard/IndustryTab.jsx';
import ChannelPlatformTab from '../components/internalDashboard/ChannelPlatformTab.jsx';
import BusinessCheckupTab from '../components/internalDashboard/BusinessCheckupTab.jsx';
import BenchmarkTab from '../components/internalDashboard/BenchmarkTab.jsx';
import ClientDetailTab from '../components/internalDashboard/ClientDetailTab.jsx';
import DataQualityTab from '../components/internalDashboard/DataQualityTab.jsx';

// Internal Dashboard MIL Digital — admin-only, all-clients performance.
// All 8 view sections (S1–S8) + Input Data.
const TABS = ['Executive Overview', 'Business Checkup', 'Kategori Besar', 'Industry', 'Benchmarking', 'Channel & Platform', 'Client Detail', 'Data Quality', 'Input Data'];
const TAB_COMPONENTS = {
  'Executive Overview': ExecutiveOverviewTab,
  'Business Checkup': BusinessCheckupTab,
  'Kategori Besar': CategoryComparisonTab,
  Industry: IndustryTab,
  Benchmarking: BenchmarkTab,
  'Channel & Platform': ChannelPlatformTab,
  'Client Detail': ClientDetailTab,
  'Data Quality': DataQualityTab,
  'Input Data': InputDataTab,
};

export default function InternalDashboardPage() {
  const [activeTab, setActiveTab] = useSessionState('internal:section', TABS[0]);
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
