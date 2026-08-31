import { useState } from 'react';
import WeeklyDailyTab from '../components/metaAutomation/WeeklyDailyTab.jsx';
import DailyTrackingTab from '../components/metaAutomation/DailyTrackingTab.jsx';
import BrandsAndSubscriptionsTab from '../components/metaAutomation/BrandsAndSubscriptionsTab.jsx';

const TABS = ['Weekly & Daily', 'Daily Tracking', 'Brand & Langganan'];

const TAB_COMPONENTS = {
  'Weekly & Daily': WeeklyDailyTab,
  'Daily Tracking': DailyTrackingTab,
  'Brand & Langganan': BrandsAndSubscriptionsTab,
};

export default function MetaAutomationPage() {
  const [activeTab, setActiveTab] = useState(TABS[0]);
  const ActiveTabComponent = TAB_COMPONENTS[activeTab];

  return (
    <div>
      <div className="page-header">
        <h1>Meta Ads Automation</h1>
        <p>Panel kontrol untuk automasi Meta Ads yang jalan di Google Apps Script (Weekly Campaign Review, Daily Urgent Check, Daily Tracking Boost Post).</p>
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
