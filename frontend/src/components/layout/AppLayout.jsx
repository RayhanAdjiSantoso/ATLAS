import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  History,
  Home,
  LogOut,
  Megaphone,
  FileBarChart,
  Building2,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';

const COLLAPSE_KEY = 'atlas_sidebar_collapsed';

// One entry per destination so the collapsed rail, the expanded list and the
// tooltips can never drift apart.
const NAV = [
  { to: '/', label: 'Beranda', Icon: Home, end: true },
  { to: '/dashboard', label: 'Dashboard Business Overview', Icon: LayoutDashboard },
  { to: '/report-generator', label: 'Report Generator', Icon: FileBarChart },
  { to: '/meta-automation', label: 'Meta Ads Automation', Icon: Megaphone, adminOnly: true },
  { to: '/internal-dashboard', label: 'Internal Dashboard', Icon: Building2, adminOnly: true },
  { to: '/history', label: 'History Upload', Icon: History },
];

export default function AppLayout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  // Remembered per browser: whoever collapses the sidebar means it, and having
  // it spring back open on every page load would make the setting useless.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Hovering the collapsed rail floats it back open on top of the page rather
  // than pushing the page over. Pushing is what the reference component does,
  // but ATLAS is full of chart.js canvases and wide tables: reflowing all of
  // them on every accidental mouse pass is a lot of layout work for a glance,
  // and the charts visibly re-draw. Floating costs nothing.
  const [peek, setPeek] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* private window / storage blocked — the sidebar still works, it just forgets */
    }
  }, [collapsed]);

  const toggle = useCallback(() => {
    setCollapsed((c) => !c);
    setPeek(false);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const links = NAV.filter((n) => !n.adminOnly || isAdmin);
  const open = !collapsed || peek;

  return (
    <div className="layout">
      {/* The sidebar itself is fixed, so this is what actually holds the column
          open in the flex row. Keeping the two separate is what lets the hover
          peek widen the panel without moving the page underneath it. */}
      <div className={`sidebar-spacer${collapsed ? ' collapsed' : ''}`} aria-hidden />

      <aside
        className={`sidebar${collapsed ? ' collapsed' : ''}${peek ? ' peek' : ''}`}
        onMouseEnter={() => collapsed && setPeek(true)}
        onMouseLeave={() => setPeek(false)}
      >
        <Link to="/" className="sidebar-brand">
          <span className="sidebar-brand-a">A</span>
          <span className="sidebar-label">TLAS</span>
          <span className="sidebar-brand-dot">.</span>
        </Link>

        <nav className="sidebar-nav">
          {links.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              // Only useful while collapsed; when the label is on screen a
              // tooltip repeating it is noise.
              title={open ? undefined : label}
            >
              <Icon size={18} className="sidebar-ico" />
              <span className="sidebar-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Perlebar sidebar' : 'Perkecil sidebar'}
            title={collapsed ? 'Perlebar sidebar' : 'Perkecil sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            <span className="sidebar-label">Perkecil</span>
          </button>

          <div className="user-info">
            <strong>{user?.full_name || user?.fullName}</strong>
            <span className="sidebar-label">
              {user?.email} · {isAdmin ? 'Admin' : 'User'}
            </span>
          </div>

          <button
            type="button"
            className="btn btn-secondary sidebar-logout"
            onClick={handleLogout}
            title={open ? undefined : 'Logout'}
            aria-label="Logout"
          >
            <LogOut size={16} />
            <span className="sidebar-label">Logout</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
