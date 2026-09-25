import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

// `roles` limits a route to certain roles; `module` to roles that Pengaturan
// Akses lets open that module. The server enforces both on every request —
// this only keeps people from landing on a page that would refuse them.
export function ProtectedRoute({ roles, module }) {
  const { user, loading, can, mustChangePassword } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-page">
        <p>Memuat...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // A temporary password must be replaced before anything else opens.
  if (mustChangePassword && location.pathname !== '/ganti-password') {
    return <Navigate to="/ganti-password" replace />;
  }

  const roleOk = !roles || roles.includes(user.role) || (roles.includes('admin') && user.role === 'superadmin');
  if (!roleOk || (module && !can(module))) {
    return <Navigate to={can('dashboard') ? '/dashboard' : '/'} replace />;
  }

  return <Outlet />;
}

export function PublicRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
