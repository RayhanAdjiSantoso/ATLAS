import WeeklyTab from './WeeklyTab.jsx';
import DailyTab from './DailyTab.jsx';
import BrandAccountsSection from './BrandAccountsSection.jsx';

export default function WeeklyDailyTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      <div>
        <h2 style={{ fontSize: '1.05rem', marginBottom: '1rem' }}>Weekly Campaign Review</h2>
        <WeeklyTab />
      </div>
      <div>
        <h2 style={{ fontSize: '1.05rem', marginBottom: '1rem' }}>Daily Urgent Check</h2>
        <DailyTab />
      </div>
      <div>
        <h2 style={{ fontSize: '1.05rem', marginBottom: '1rem' }}>Kelola Brand & Akun Meta Ads</h2>
        <BrandAccountsSection />
      </div>
    </div>
  );
}
