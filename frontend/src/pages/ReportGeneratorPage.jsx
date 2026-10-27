import ReportGeneratorApp from '../reportGenerator/App';
import '../reportGenerator/index.css';
import '../reportGenerator/app/shell.css';
import '../reportGenerator/app/atlas-fit.css';
import '../reportGenerator/app/report-skin.css';
import '../reportGenerator/app/workspace.css';

// The "Performance Report Generator" (Meta / Shopee / TikTok ads reports),
// merged in as one page — same pattern as MetaAutomationPage.jsx mounting a
// feature that started life elsewhere. Everything under src/reportGenerator/
// is that app's own component tree, kept close to verbatim so it can be
// re-synced from the standalone project; each file's header comment records
// what changed for ATLAS and why. The three big ones:
//
//   - the API layer calls ATLAS's shared, auth'd axios client instead of its
//     own standalone backend (features/reports/api.ts),
//   - the stylesheets are scoped under .mil-ui instead of styling the whole
//     document (regenerate with frontend/scripts/scope-css.py),
//   - the router is ATLAS's: the report type is a URL param, not local state.
//
// Kept alive: AppLayout mounts this once the generator is first opened and only
// hides it while another page is on screen, so a generated report, its files
// and selections are still there when the user comes back. The route itself
// renders ReportGeneratorRoute (nothing) — it only keeps the access guard and
// the URL.
export default function ReportGeneratorPage({ platform }) {
  return <ReportGeneratorApp platform={platform} />;
}

export function ReportGeneratorRoute() {
  return null;
}
