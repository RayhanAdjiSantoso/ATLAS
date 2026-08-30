import ReportGeneratorApp from '../reportGenerator/App';
import '../reportGenerator/index.css';

// The standalone "Performance Report Generator" (Meta/Shopee/TikTok ads
// reports), merged in as one page — same pattern as MetaAutomationPage.jsx
// mounting a feature that started life elsewhere. Everything under
// src/reportGenerator/ is that app's own component tree, ported close to
// verbatim (see its files' header comments for what changed and why:
// mainly the API layer now calling ATLAS's shared, auth'd axios client
// instead of its own standalone backend, and index.css scoped under
// .report-generator-app instead of styling the whole document).
export default function ReportGeneratorPage() {
  return <ReportGeneratorApp />;
}
