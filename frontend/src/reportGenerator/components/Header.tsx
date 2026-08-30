// Was a standalone-app header (logo badge + title) — now uses ATLAS's own
// .page-header (global class, defined in ATLAS's src/index.css, not scoped
// under .report-generator-app) so this page's title reads exactly like
// DashboardPage/UploadPage/HistoryPage's "<h1>Title</h1><p>description</p>".
export function Header() {
  return (
    <div className="page-header">
      <h1>Performance Report Generator</h1>
      <p>MIL Digital · Meta Ads · CPAS · Shopee Ads · TikTok GMV Max</p>
    </div>
  );
}
