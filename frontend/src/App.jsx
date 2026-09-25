import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute, PublicRoute } from './components/ProtectedRoute.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import HomePage from './pages/HomePage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import DailyTrackingPage from './pages/DailyTrackingPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import MetaAutomationPage from './pages/MetaAutomationPage.jsx';
import ReportGeneratorPage from './pages/ReportGeneratorPage.jsx';
import InternalDashboardPage from './pages/InternalDashboardPage.jsx';
import BrandSettingsPage from './pages/BrandSettingsPage.jsx';
import ControlCenterPage from './pages/ControlCenterPage.jsx';
import AccessSettingsPage from './pages/AccessSettingsPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<PublicRoute />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
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
          <Route element={<ProtectedRoute module="daily_tracking" />}>
            <Route path="/daily-tracking" element={<DailyTrackingPage />} />
          </Route>
          <Route element={<ProtectedRoute module="brand_settings" />}>
            <Route path="/pengaturan-brand" element={<BrandSettingsPage />} />
          </Route>
          <Route element={<ProtectedRoute module="history" />}>
            <Route path="/history" element={<HistoryPage />} />
          </Route>
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
