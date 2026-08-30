import { useState } from 'react';
import FilterPanel from '../components/dashboard/FilterPanel.jsx';
import DashboardTab from '../components/dashboard/DashboardTab.jsx';

const TABS = [
  'Executive Snapshot',
  'Business Growth',
  'Traffic & Funnel',
  'Retention Analysis',
  'Transaction Behavior',
  'Basket Analysis',
  'Product Performance',
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState(TABS[0]);
  const [filters, setFilters] = useState({
    brandId: '',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    compare: false,
    compareStartDate: '',
    compareEndDate: '',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1>Dashboard Analitik</h1>
          <p>Insight dan analisis metrik penjualan Shopee Anda secara realtime.</p>
        </div>
      </div>

      {/* Dynamic Global Filter Panel */}
      <FilterPanel filters={filters} onChange={setFilters} />

      {/* Dynamic Tab Navigation */}
      <div 
        className="tabs-nav" 
        style={{ 
          display: 'flex', 
          gap: '0.5rem', 
          borderBottom: '1px solid var(--border)', 
          paddingBottom: '0.5rem', 
          marginBottom: '1rem' 
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
              border: activeTab === tab ? 'none' : '1px solid var(--border)'
            }}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Dynamic Rendered Tab Content Area */}
      <DashboardTab activeTab={activeTab} filters={filters} onNavigateTab={setActiveTab} />

    </div>
  );
}
