import { useState } from 'react';
import InputDataTab from '../components/internalDashboard/InputDataTab.jsx';
import ExecutiveOverviewTab from '../components/internalDashboard/ExecutiveOverviewTab.jsx';
import CategoryComparisonTab from '../components/internalDashboard/CategoryComparisonTab.jsx';
import IndustryTab from '../components/internalDashboard/IndustryTab.jsx';
import ChannelPlatformTab from '../components/internalDashboard/ChannelPlatformTab.jsx';
import BusinessCheckupTab from '../components/internalDashboard/BusinessCheckupTab.jsx';
import BenchmarkTab from '../components/internalDashboard/BenchmarkTab.jsx';

// Internal Dashboard MIL Digital — admin-only, all-clients performance.
// S1/S2/S3/S4/S5/S6 + Input Data exist; S7 Client Detail and S8 Data
// Quality become sibling tabs later.
const TABS = ['Executive Overview', 'Business Checkup', 'Kategori Besar', 'Industry', 'Benchmarking', 'Channel & Platform', 'Input Data'];
const TAB_COMPONENTS = {
  'Executive Overview': ExecutiveOverviewTab,
  'Business Checkup': BusinessCheckupTab,
  'Kategori Besar': CategoryComparisonTab,
  Industry: IndustryTab,
  Benchmarking: BenchmarkTab,
  'Channel & Platform': ChannelPlatformTab,
  'Input Data': InputDataTab,
};

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
