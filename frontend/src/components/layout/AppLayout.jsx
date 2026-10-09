import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Home, LogOut, Megaphone, FileBarChart, Building2, SlidersHorizontal, PanelLeftClose, PanelLeftOpen, Menu, Radar, ShieldCheck } from 'lucide-react';
import { BRAND_SETTING_SECTIONS } from '../brandSettings/sections.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import api from '../../api/client.js';
import atlasIcon from '../../assets/atlas-icon.png';

const COLLAPSE_KEY = 'atlas_sidebar_collapsed';

// One entry per destination so the collapsed rail, the expanded list and the
// tooltips can never drift apart.
// Ordered the way ATLAS is worked. Everything a brand puts IN — its context,
// its files, its daily numbers — is one entry, Brand Setting, whose own
// section bar switches between the three; what ATLAS gives back OUT
// (Business Overview, Report Generator) follows, so input and output never
// read as one long list.
const NAV = [
  { to: '/', label: 'Beranda', Icon: Home, end: true, group: 'Workspace' },
  { id: 'brand-setting', label: 'Brand Setting', Icon: SlidersHorizontal, group: 'Workspace', sections: BRAND_SETTING_SECTIONS },
  { to: '/dashboard', label: 'Business Overview', Icon: LayoutDashboard, group: 'Workspace', module: 'dashboard' },
  { to: '/report-generator', label: 'Report Generator', Icon: FileBarChart, group: 'Workspace', module: 'report_generator' },
  { to: '/meta-automation', label: 'Meta Ads Automation', Icon: Megaphone, group: 'Operasional', module: 'meta_automation' },
  { to: '/internal-dashboard', label: 'Internal Dashboard', Icon: Building2, group: 'Operasional', module: 'internal_dashboard' },
  { to: '/pusat-kendali', label: 'Pusat Kendali', Icon: Radar, group: 'Operasional', module: 'control_center' },
  // Account and permission management — superadmin and admin only.
  { to: '/pengaturan-akses', label: 'Pengaturan Akses', Icon: ShieldCheck, group: 'Operasional', adminOnly: true },
];
const ROLE_BADGE = { superadmin: 'Superadmin', admin: 'Admin', user: 'User', client: 'Client' };

export default function AppLayout() {
  const { user, logout, isAdmin, isViewOnly, can } = useAuth();
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
    if (!can('control_center') || Date.now() - lastSummaryAt.current < 60_000) return;
    lastSummaryAt.current = Date.now();
    api.get('/control-center/summary').then(({ data }) => setAttention(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.modules, location.pathname]);
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

  const allowed = (n) => (!n.adminOnly || (isAdmin && !isViewOnly)) && (!n.module || can(n.module));
  // Brand Setting opens on the first section this account may use and
  // disappears when it has none.
  const links = NAV
    .map((n) => {
      if (!n.sections) return n;
      const sections = n.sections.filter(allowed);
      if (!sections.length) return null;
      // One section left (a client account: Brand Tracking only) is named for
      // what it is, not for a group of one.
      if (sections.length === 1) return { ...n, to: sections[0].to, label: sections[0].label, Icon: sections[0].Icon, sections };
      return { ...n, to: sections[0].to, sections };
    })
    .filter((n) => n && (n.sections || allowed(n)));
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

  const navLink = ({ to, label, Icon, end, sections }) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      onClick={() => setMobileOpen(false)}
      // Brand Setting stays lit on every one of its sections, not only the
      // first one it links to.
      className={({ isActive }) => `sidebar-link${isActive || sections?.some((x) => location.pathname.startsWith(x.to)) ? ' active' : ''}`}
      // Only useful while collapsed; when the label is on screen a tooltip
      // repeating it is noise.
      title={open ? undefined : label}
    >
      <Icon size={18} className="sidebar-ico" />
      <span className="sidebar-label">{label}</span>
      {to === '/pusat-kendali' && badgeCount > 0 && (
        <span className="sidebar-badge" title={badgeTitle} aria-label={badgeTitle}>{badgeCount > 99 ? '99+' : badgeCount}</span>
      )}
    </NavLink>
  );

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
              {group.links.map(navLink)}
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
                {user?.email} · {ROLE_BADGE[user?.role] ?? 'User'}
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
