import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute, PublicRoute } from './components/ProtectedRoute.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import UploadPage from './pages/UploadPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import MetaAutomationPage from './pages/MetaAutomationPage.jsx';
import ReportGeneratorPage from './pages/ReportGeneratorPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<PublicRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/history" element={<HistoryPage />} />
          {/* No role restriction — any logged-in user, unlike meta-automation below. */}
          <Route path="/report-generator" element={<ReportGeneratorPage />} />
        </Route>

        <Route element={<ProtectedRoute roles={['admin']} />}>
          <Route element={<AppLayout />}>
            <Route path="/meta-automation" element={<MetaAutomationPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
