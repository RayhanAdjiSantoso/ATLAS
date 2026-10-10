import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { BRAND_SETTING_SECTIONS } from '../components/brandSettings/sections.js';
import PageBand from '../components/common/PageBand.jsx';
import Coachmark, { TourButton } from '../components/common/Coachmark.jsx';
import { TOURS } from '../components/common/tours.js';
import '../components/dashboard/console.css';
import '../components/dashboard/softShell.css';
import './brandPages.css';

// Brand Setting — one page, three sections, and three levels of navigation
// that must never be confused for one another:
//   1. the section (Brand Context / Data Collection Hub / Brand Tracking) —
//      folder tabs on the deep-blue header band, the loudest thing on the
//      page; the open one takes the colour of the floor below, so it reads
//      as the page it opened;
//   2. a section's own views (Performance Database / Minutes of Meeting,
//      Performance Overview / Input) — a compact white segmented control on
//      the floor (brandPages.css re-skins .soft-tabs inside .bs);
//   3. anything inside a view (platforms, Revenue / Spending) — underline
//      tabs inside the card.
// The frame and header stay mounted while the section changes, so moving
// between sections reads as one workspace rather than three pages.
export default function BrandSettingLayout() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const sections = BRAND_SETTING_SECTIONS.filter((s) => can(s.module));
  const current = sections.find((s) => pathname.startsWith(s.to)) ?? sections[0];
  // An account with one section (a client: Brand Tracking only) gets that
  // section as the page — no bar offering a single choice.
  const single = sections.length === 1;
  const tourId = { '/pengaturan-brand': 'brand-context', '/data-brand': 'data-hub', '/brand-tracking': 'brand-tracking' }[current?.to] ?? 'brand-tracking';

  return (
    <div className="con brand-settings soft-shell bp bs">
      <div className="soft-frame">
        <PageBand
          kicker={single ? 'ATLAS · Ruang klien' : 'Workspace · Input brand'}
          title={single ? current.label : 'Brand Setting'}
          desc={current?.desc}
          tabs={single ? [] : sections.map((s) => ({ key: s.to, to: s.to, label: s.label, hint: s.hint, icon: <s.Icon size={19} /> }))}
          activeKey={current?.to}
          layoutId="bs-tab-sheet"
          ariaLabel="Bagian Brand Setting"
          aside={<TourButton tourId={tourId} />}
        />

        <Outlet />
        <Coachmark key={tourId} id={tourId} steps={TOURS[tourId]} />
      </div>
    </div>
  );
}
