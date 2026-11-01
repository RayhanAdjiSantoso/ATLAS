import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute, PublicRoute } from './components/ProtectedRoute.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import HomePage from './pages/HomePage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import DailyTrackingPage from './pages/DailyTrackingPage.jsx';
import { ReportGeneratorRoute } from './pages/ReportGeneratorPage.jsx';
import InternalDashboardPage from './pages/InternalDashboardPage.jsx';
import GoogleReviewsPage from './pages/GoogleReviewsPage.jsx';
import ExtensionsPage from './pages/ExtensionsPage.jsx';
import BrandSettingsPage from './pages/BrandSettingsPage.jsx';
import BrandDataPage from './pages/BrandDataPage.jsx';
import BrandSettingLayout from './pages/BrandSettingLayout.jsx';
import BrandTrackingLayout from './pages/BrandTrackingLayout.jsx';
import AccessSettingsPage from './pages/AccessSettingsPage.jsx';
import AttributionPage from './pages/AttributionPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';
import LandingPage from './pages/LandingPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<PublicRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      {/* The public homepage, open to anyone with the link — and where a
          logged-in team member previews or manages it. A visitor who is not
          logged in gets the same page at "/". */}
      <Route path="/selamat-datang" element={<LandingPage />} />

      <Route element={<ProtectedRoute guestHome={<LandingPage />} />}>
        {/* Outside the layout: a temporary password is replaced before the
            rest of ATLAS opens (ProtectedRoute redirects here). */}
        <Route path="/ganti-password" element={<ChangePasswordPage />} />

        {/* One layout for every page, so the sidebar is not rebuilt on each
            navigation. Inside it, each page opens only for roles Pengaturan
            Akses allows to use it; the matching API refuses them either way. */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route element={<ProtectedRoute module="dashboard" />}>
            <Route path="/dashboard" element={<DashboardPage />} />
          </Route>
          {/* Brand Setting: one page whose two sections share a frame and
              a section bar (BrandSettingLayout). */}
          <Route element={<BrandSettingLayout />}>
            <Route element={<ProtectedRoute module="brand_settings" />}>
              <Route path="/pengaturan-brand" element={<BrandSettingsPage />} />
              <Route path="/data-brand" element={<BrandDataPage />} />
            </Route>
          </Route>
          {/* Brand Tracking: its own sidebar page. */}
          <Route element={<ProtectedRoute module="daily_tracking" />}>
            <Route element={<BrandTrackingLayout />}>
              <Route path="/brand-tracking" element={<DailyTrackingPage />} />
            </Route>
          </Route>
          {/* Brand Tracking's old address — bookmarks and links still land. */}
          <Route path="/daily-tracking" element={<Navigate to="/brand-tracking" replace />} />
          <Route element={<ProtectedRoute module="report_generator" />}>
            {/* The report type is a URL param so each one is linkable and the
                back button works. The generator itself is kept mounted by
                AppLayout (so a generated report survives leaving the page);
                this route holds the access guard and the address. */}
            <Route path="/report-generator" element={<Navigate to="/report-generator/meta" replace />} />
            <Route path="/report-generator/:platform" element={<ReportGeneratorRoute />} />
          </Route>
          <Route element={<ProtectedRoute module="google_reviews" />}>
            <Route path="/google-reviews" element={<GoogleReviewsPage />} />
            {/* Extensions: today only the Google Reviews exporter, so the page
                follows that module. */}
            <Route path="/extensions" element={<ExtensionsPage />} />
          </Route>
          <Route element={<ProtectedRoute module="internal_dashboard" />}>
            <Route path="/internal-dashboard" element={<InternalDashboardPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={['admin']} />}>
            <Route path="/pengaturan-akses" element={<AccessSettingsPage />} />
            <Route path="/atribusi-channel" element={<AttributionPage />} />
          </Route>
        </Route>
      </Route>

      {/* "/" is the landing page now (above, inside the layout), so an
          unknown path lands there rather than on the dashboard. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
