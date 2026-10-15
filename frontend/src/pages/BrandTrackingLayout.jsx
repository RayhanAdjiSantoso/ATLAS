import { Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { BRAND_TRACKING } from '../components/brandSettings/sections.js';
import PageBand from '../components/common/PageBand.jsx';
import Coachmark, { TourButton } from '../components/common/Coachmark.jsx';
import { TOURS } from '../components/common/tours.js';
import '../components/dashboard/console.css';
import '../components/dashboard/softShell.css';
import './brandPages.css';

// Brand Tracking as its own sidebar page: the brand's daily figures, its
// monthly and annual targets, and its meetings. It keeps Brand Setting's
// frame and classes (Brand Tracking's styles are written against them), only
// without a section bar — there is one page here, not a group.
export default function BrandTrackingLayout() {
  const { isClient } = useAuth();
  return (
    <div className="con brand-settings soft-shell bp bs">
      <div className="soft-frame">
        <PageBand
          kicker={isClient ? 'ATLAS · Ruang klien' : 'Workspace · Performa brand'}
          title={BRAND_TRACKING.label}
          desc={BRAND_TRACKING.desc}
          aside={<TourButton tourId="brand-tracking" />}
        />
        <Outlet />
        <Coachmark id="brand-tracking" steps={TOURS['brand-tracking']} />
      </div>
    </div>
  );
}
