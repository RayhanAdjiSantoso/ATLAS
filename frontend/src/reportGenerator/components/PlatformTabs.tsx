export type TabKey = 'meta' | 'shopee' | 'tiktok' | 'business' | 'summary' | 'reports';

const TABS: { key: TabKey; label: string; className?: string }[] = [
  { key: 'meta', label: 'Meta Ads' },
  { key: 'shopee', label: 'Shopee Ads', className: 'shopee-tab' },
  { key: 'tiktok', label: 'TikTok GMV Max', className: 'tiktok-tab' },
  { key: 'business', label: 'Business Overview', className: 'business-tab' },
  { key: 'summary', label: 'Summary Overview', className: 'summary-tab' },
  { key: 'reports', label: 'Riwayat Laporan', className: 'reports-tab' },
];

interface PlatformTabsProps {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
  badges: Record<TabKey, string>;
}

export function PlatformTabs({ activeTab, onChange, badges }: PlatformTabsProps) {
  return (
    <div className="platform-tabs">
      {TABS.map((t) => (
        <div
          key={t.key}
          className={`ptab${t.className ? ' ' + t.className : ''}${activeTab === t.key ? ' active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          <div className="ptab-dot" />
          {t.label}
          <span className="ptab-badge">{badges[t.key] ?? '—'}</span>
        </div>
      ))}
    </div>
  );
}
