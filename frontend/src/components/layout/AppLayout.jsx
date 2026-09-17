import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  History,
  Home,
  LogOut,
  Megaphone,
  FileBarChart,
  Building2,
  SlidersHorizontal,
  CalendarCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Radar,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import api from '../../api/client.js';
import atlasIcon from '../../assets/atlas-icon.png';

const COLLAPSE_KEY = 'atlas_sidebar_collapsed';

// One entry per destination so the collapsed rail, the expanded list and the
// tooltips can never drift apart.
const NAV = [
  { to: '/', label: 'Beranda', Icon: Home, end: true, group: 'Workspace' },
  { to: '/dashboard', label: 'Dashboard Business Overview', Icon: LayoutDashboard, group: 'Workspace' },
  // No adminOnly: both internal staff and client accounts fill this in
  // themselves, unlike everywhere else a view-only account can only read.
  { to: '/daily-tracking', label: 'Daily Tracking', Icon: CalendarCheck, group: 'Workspace' },
  // Sits directly under the dashboard it feeds: this is where the data those
  // charts read comes in, and it used to be that page's first tab.
  { to: '/pengaturan-brand', label: 'Pengaturan Brand', Icon: SlidersHorizontal, group: 'Workspace' },
  { to: '/report-generator', label: 'Report Generator', Icon: FileBarChart, group: 'Workspace' },
  { to: '/meta-automation', label: 'Meta Ads Automation', Icon: Megaphone, adminOnly: true, group: 'Operasional' },
  { to: '/internal-dashboard', label: 'Internal Dashboard', Icon: Building2, adminOnly: true, group: 'Operasional' },
  { to: '/pusat-kendali', label: 'Pusat Kendali', Icon: Radar, adminOnly: true, group: 'Operasional' },
  { to: '/history', label: 'History Upload', Icon: History, group: 'Operasional' },
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

  // Phone-width drawer. Separate from `collapsed`, which is the desktop rail's
  // remembered preference: a drawer is closed by default every visit, and
  // remembering it would be remembering the wrong thing.
  const [mobileOpen, setMobileOpen] = useState(false);

  // Pusat Kendali badge: overdue MOM tasks + brands needing data action this
  // month. Refreshed on navigation at most once a minute — a reminder, not a
  // live feed, and not worth a request on every click.
  const location = useLocation();
  const [attention, setAttention] = useState(null);
  const lastSummaryAt = useRef(0);
  useEffect(() => {
    if (!isAdmin || Date.now() - lastSummaryAt.current < 60_000) return;
    lastSummaryAt.current = Date.now();
    api.get('/control-center/summary').then(({ data }) => setAttention(data)).catch(() => {});
  }, [isAdmin, location.pathname]);
  const badgeCount = (attention?.overdueTasks ?? 0) + (attention?.dataAttention ?? 0);
  const badgeTitle = attention
    ? `${attention.overdueTasks} to do tertunda · ${attention.dataAttention} brand perlu tindakan data`
    : undefined;

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

  // Escape closes the drawer, the way every other overlay on the web does.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const links = NAV.filter((n) => !n.adminOnly || isAdmin);
  const groups = ['Workspace', 'Operasional']
    .map((label) => ({ label, links: links.filter((link) => link.group === label) }))
    .filter((group) => group.links.length > 0);
  const open = !collapsed || peek;
  const displayName = user?.full_name || user?.fullName || 'Pengguna ATLAS';
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <div className="layout">
      {/* The sidebar itself is fixed, so this is what actually holds the column
          open in the flex row. Keeping the two separate is what lets the hover
          peek widen the panel without moving the page underneath it. */}
      <div className={`sidebar-spacer${collapsed ? ' collapsed' : ''}`} aria-hidden />

      <button
        type="button"
        className={`sidebar-scrim${mobileOpen ? ' is-open' : ''}`}
        aria-label="Tutup menu"
        tabIndex={mobileOpen ? 0 : -1}
        onClick={() => setMobileOpen(false)}
      />

      <aside
        className={`sidebar${collapsed ? ' collapsed' : ''}${peek ? ' peek' : ''}${mobileOpen ? ' mobile-open' : ''}`}
        onMouseEnter={() => collapsed && setPeek(true)}
        onMouseLeave={() => setPeek(false)}
      >
        <Link to="/" className="sidebar-brand">
          {/* The mark IS the A — collapsed, the rail keeps the logo and drops
              the letters, which is what the wordmark does on its own. */}
          <img src={atlasIcon} alt="" className="sidebar-brand-mark" />
          <span className="sidebar-label">TLAS</span>
          <span className="sidebar-brand-dot">.</span>
        </Link>

        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div className="sidebar-nav-group" key={group.label}>
              <span className="sidebar-nav-title">{group.label}</span>
              {group.links.map(({ to, label, Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                  // Only useful while collapsed; when the label is on screen a
                  // tooltip repeating it is noise.
                  title={open ? undefined : label}
                >
                  <Icon size={18} className="sidebar-ico" />
                  <span className="sidebar-label">{label}</span>
                  {to === '/pusat-kendali' && badgeCount > 0 && (
                    <span className="sidebar-badge" title={badgeTitle} aria-label={badgeTitle}>{badgeCount > 99 ? '99+' : badgeCount}</span>
                  )}
                </NavLink>
              ))}
            </div>
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
            <span className="sidebar-user-avatar" aria-hidden>{initials || 'A'}</span>
            <span className="sidebar-user-copy">
              <strong>{displayName}</strong>
              <span className="sidebar-label">
                {user?.email} · {isAdmin ? 'Admin' : 'User'}
              </span>
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
        {/* Only rendered at phone widths (CSS), where the sidebar is a drawer. */}
        <div className="mobile-bar">
          <button
            type="button"
            className="mobile-bar-btn"
            aria-label="Buka menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </button>
          <Link to="/" className="sidebar-brand" style={{ margin: 0 }}>
            <img src={atlasIcon} alt="" className="sidebar-brand-mark" />
            <span>TLAS</span>
            <span className="sidebar-brand-dot">.</span>
          </Link>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
