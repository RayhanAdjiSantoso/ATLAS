import { useState } from 'react';
import FilterPanel from '../components/dashboard/FilterPanel.jsx';
import DashboardTab from '../components/dashboard/DashboardTab.jsx';
import UploadDataTab from '../components/dashboard/UploadDataTab.jsx';

const TABS = [
  'Upload Data',
  'Executive Snapshot',
  'Business Growth',
  'Traffic & Funnel',
  'Retention Analysis',
  'Transaction Behavior',
  'Basket Analysis',
  'Product Performance',
];

export default function DashboardPage() {
  // Default landing tab -- kept as Executive Snapshot regardless of tab
  // order, since TABS[0] is now Upload Data (leftmost by request, not the
  // intended first thing a user sees on opening the dashboard).
  const [activeTab, setActiveTab] = useState('Executive Snapshot');
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
          <h1>Dashboard Business Overview</h1>
          <p>Insight dan analisis metrik penjualan Shopee Anda secara realtime.</p>
        </div>
      </div>

      {/* Dynamic Global Filter Panel -- irrelevant for Upload Data (not
          scoped to a date range), so hidden on that tab. */}
      {activeTab !== 'Upload Data' && <FilterPanel filters={filters} onChange={setFilters} />}

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

      {/* Dynamic Rendered Tab Content Area -- Upload Data bypasses
          DashboardTab entirely, since it isn't scoped to the date filters
          DashboardTab fetches data against. */}
      {activeTab === 'Upload Data' ? (
        <UploadDataTab />
      ) : (
        <DashboardTab activeTab={activeTab} filters={filters} onNavigateTab={setActiveTab} />
      )}

    </div>
  );
}
