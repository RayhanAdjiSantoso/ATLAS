import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, History, Home, LogOut, Megaphone, FileBarChart, Building2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';

export default function AppLayout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <Link to="/" className="sidebar-brand">ATLAS<span>.</span></Link>
        <nav className="sidebar-nav">
          {/* `end` so this only lights up on "/" itself — without it the
              landing page would read as active on every other route. */}
          <NavLink to="/" end className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
            <Home size={18} /> Beranda
          </NavLink>
          <NavLink to="/dashboard" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
            <LayoutDashboard size={18} /> Dashboard Business Overview
          </NavLink>
          <NavLink to="/report-generator" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
            <FileBarChart size={18} /> Report Generator
          </NavLink>
          {isAdmin && (
            <NavLink to="/meta-automation" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              <Megaphone size={18} /> Meta Ads Automation
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/internal-dashboard" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              <Building2 size={18} /> Internal Dashboard
            </NavLink>
          )}
          <NavLink to="/history" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
            <History size={18} /> History Upload
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            <strong>{user?.full_name || user?.fullName}</strong>
            {user?.email} · {isAdmin ? 'Admin' : 'User'}
          </div>
          <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={handleLogout}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
