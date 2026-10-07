import { useState } from 'react';
import { Megaphone, Radio } from 'lucide-react';
import BrandsSection from '../components/metaAutomation/BrandsSection.jsx';
import SubscriptionsSection from '../components/metaAutomation/SubscriptionsSection.jsx';
import WeeklyDailyTab from '../components/metaAutomation/WeeklyDailyTab.jsx';
import DailyTrackingTab from '../components/metaAutomation/DailyTrackingTab.jsx';

// Manage the account registry and subscriptions here. The brand-scoped
// account creation form remains in Data Collection Hub's Meta Ads channel.
const TABS = ['Brand', 'Langganan', 'Weekly & Daily', 'Daily Tracking'];
const TAB_ICONS = { Brand: Megaphone, Langganan: Radio };

const TAB_COMPONENTS = {
  Brand: BrandsSection,
  Langganan: SubscriptionsSection,
  'Weekly & Daily': WeeklyDailyTab,
  'Daily Tracking': DailyTrackingTab,
};

export default function MetaAutomationPage() {
  const [activeTab, setActiveTab] = useState(TABS[0]);
  const ActiveTabComponent = TAB_COMPONENTS[activeTab];

  return (
    <div>
      <div className="page-header">
        <h1>Meta Ads Automation</h1>
        <p>Kelola akun brand, langganan notifikasi, dan automasi Meta Ads yang jalan di Google Apps Script (Weekly Campaign Review, Daily Urgent Check, Daily Tracking Boost Post).</p>
      </div>

      <div
        className="tabs-nav"
        role="group"
        aria-label="Bagian Meta Ads Automation"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.5rem',
          marginBottom: '1.5rem',
        }}
      >
        {TABS.map((tab) => {
          const Icon = TAB_ICONS[tab];
          return (
            <button
              key={tab}
              type="button"
              aria-pressed={activeTab === tab}
              className={`btn ${activeTab === tab ? 'btn-primary' : 'btn-secondary'}`}
              style={{
                fontWeight: '600',
                fontSize: '0.9rem',
                padding: '0.5rem 1.25rem',
                border: activeTab === tab ? 'none' : '1px solid var(--border)',
              }}
              onClick={() => setActiveTab(tab)}
            >
              {Icon && <Icon size={16} aria-hidden="true" />} {tab}
            </button>
          );
        })}
      </div>

      <ActiveTabComponent />
    </div>
  );
}
