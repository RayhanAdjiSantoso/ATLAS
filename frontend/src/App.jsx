import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute, PublicRoute } from './components/ProtectedRoute.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import HomePage from './pages/HomePage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import DailyTrackingPage from './pages/DailyTrackingPage.jsx';
import MetaAutomationPage from './pages/MetaAutomationPage.jsx';
import ReportGeneratorPage from './pages/ReportGeneratorPage.jsx';
import InternalDashboardPage from './pages/InternalDashboardPage.jsx';
import BrandSettingsPage from './pages/BrandSettingsPage.jsx';
import BrandDataPage from './pages/BrandDataPage.jsx';
import BrandSettingLayout from './pages/BrandSettingLayout.jsx';
import ControlCenterPage from './pages/ControlCenterPage.jsx';
import AccessSettingsPage from './pages/AccessSettingsPage.jsx';
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
          {/* Brand Setting: one page whose three sections share a frame and
              a section bar (BrandSettingLayout); each keeps its own
              permission. */}
          <Route element={<BrandSettingLayout />}>
            <Route element={<ProtectedRoute module="brand_settings" />}>
              <Route path="/pengaturan-brand" element={<BrandSettingsPage />} />
              <Route path="/data-brand" element={<BrandDataPage />} />
            </Route>
            <Route element={<ProtectedRoute module="daily_tracking" />}>
              <Route path="/brand-tracking" element={<DailyTrackingPage />} />
            </Route>
          </Route>
          {/* Brand Tracking's old address — bookmarks and links still land. */}
          <Route path="/daily-tracking" element={<Navigate to="/brand-tracking" replace />} />
          <Route element={<ProtectedRoute module="report_generator" />}>
            {/* The report type is a URL param so each one is linkable and the
                back button works; the page stays mounted across param changes,
                so an upload in progress survives switching. */}
            <Route path="/report-generator" element={<Navigate to="/report-generator/meta" replace />} />
            <Route path="/report-generator/:platform" element={<ReportGeneratorPage />} />
          </Route>
          <Route element={<ProtectedRoute module="meta_automation" />}>
            <Route path="/meta-automation" element={<MetaAutomationPage />} />
          </Route>
          <Route element={<ProtectedRoute module="internal_dashboard" />}>
            <Route path="/internal-dashboard" element={<InternalDashboardPage />} />
          </Route>
          <Route element={<ProtectedRoute module="control_center" />}>
            <Route path="/pusat-kendali" element={<ControlCenterPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={['admin']} />}>
            <Route path="/pengaturan-akses" element={<AccessSettingsPage />} />
          </Route>
        </Route>
      </Route>

      {/* "/" is the landing page now (above, inside the layout), so an
          unknown path lands there rather than on the dashboard. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
