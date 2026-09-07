import ReportGeneratorApp from '../reportGenerator/App';
import '../reportGenerator/index.css';
import '../reportGenerator/app/shell.css';
import '../reportGenerator/app/atlas-fit.css';

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
export default function ReportGeneratorPage() {
  return <ReportGeneratorApp />;
}
