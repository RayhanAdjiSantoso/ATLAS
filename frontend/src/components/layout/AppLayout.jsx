import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Upload, History, LogOut, Megaphone, FileBarChart } from 'lucide-react';
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
        <div className="sidebar-brand">ATLAS<span>.</span></div>
        <nav className="sidebar-nav">
          <NavLink to="/dashboard" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
            <LayoutDashboard size={18} /> Dashboard
          </NavLink>
          <NavLink to="/upload" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
            <Upload size={18} /> Upload Data
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
            <History size={18} /> History Upload
          </NavLink>
          <NavLink to="/report-generator" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
            <FileBarChart size={18} /> Report Generator
          </NavLink>
          {isAdmin && (
            <NavLink to="/meta-automation" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              <Megaphone size={18} /> Meta Ads Automation
            </NavLink>
          )}
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
