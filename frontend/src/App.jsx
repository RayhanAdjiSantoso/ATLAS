import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute, PublicRoute } from './components/ProtectedRoute.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import HomePage from './pages/HomePage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import MetaAutomationPage from './pages/MetaAutomationPage.jsx';
import ReportGeneratorPage from './pages/ReportGeneratorPage.jsx';
import InternalDashboardPage from './pages/InternalDashboardPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<PublicRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/history" element={<HistoryPage />} />
          {/* No role restriction — any logged-in user, unlike meta-automation below.
              The report type is a URL param so each one is linkable and the
              back button works; the page component stays mounted across those
              param changes, so an upload in progress survives switching. */}
          <Route path="/report-generator" element={<Navigate to="/report-generator/meta" replace />} />
          <Route path="/report-generator/:platform" element={<ReportGeneratorPage />} />
        </Route>

        <Route element={<ProtectedRoute roles={['admin']} />}>
          <Route element={<AppLayout />}>
            <Route path="/meta-automation" element={<MetaAutomationPage />} />
            <Route path="/internal-dashboard" element={<InternalDashboardPage />} />
          </Route>
        </Route>
      </Route>

      {/* "/" is the landing page now (above, inside the layout), so an
          unknown path lands there rather than on the dashboard. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
