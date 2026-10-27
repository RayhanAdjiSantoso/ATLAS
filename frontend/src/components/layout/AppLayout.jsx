import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Home, LogOut, FileBarChart, Building2, SlidersHorizontal, PanelLeftClose, PanelLeftOpen, Menu, ShieldCheck, MessageSquareText, Puzzle } from 'lucide-react';
import { BRAND_SETTING_SECTIONS, BRAND_TRACKING } from '../brandSettings/sections.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import AnnotationLayer from '../annotations/AnnotationLayer.jsx';
import FeatureSpotlight from '../common/FeatureSpotlight.jsx';
import atlasIcon from '../../assets/atlas-icon.png';
import ReportGeneratorPage from '../../pages/ReportGeneratorPage.jsx';

const COLLAPSE_KEY = 'atlas_sidebar_collapsed';

// One entry per destination so the collapsed rail, the expanded list and the
// tooltips can never drift apart.
// Ordered the way ATLAS is worked. Everything a brand puts IN — its context,
// its files, its daily numbers — is one entry, Brand Setting, whose own
// section bar switches between the three; what ATLAS gives back OUT
// (Report Generator) follows, so input and output never read as one long
// list. The three overview pages sit on top, above every group, because
// they are where a session starts.
const NAV = [
  { to: '/', label: 'Beranda', Icon: Home, end: true, group: 'Top' },
  { to: '/internal-dashboard', label: 'Business Insight', Icon: Building2, group: 'Top', module: 'internal_dashboard' },
  { to: '/dashboard', label: 'Brand Overview', Icon: LayoutDashboard, group: 'Top', module: 'dashboard' },
  { id: 'brand-setting', label: 'Brand Setting', Icon: SlidersHorizontal, group: 'Workspace', sections: BRAND_SETTING_SECTIONS },
  { to: BRAND_TRACKING.to, label: BRAND_TRACKING.label, Icon: BRAND_TRACKING.Icon, group: 'Workspace', module: BRAND_TRACKING.module },
  { to: '/report-generator', label: 'Report Generator', Icon: FileBarChart, group: 'Workspace', module: 'report_generator' },
  { to: '/google-reviews', label: 'Google Reviews', Icon: MessageSquareText, group: 'Integration', module: 'google_reviews' },
  { to: '/extensions', label: 'Extensions', Icon: Puzzle, group: 'Integration', module: 'google_reviews' },
  // Account and permission management — superadmin and admin only.
  { to: '/pengaturan-akses', label: 'Pengaturan Akses', Icon: ShieldCheck, group: 'Integration', adminOnly: true },
];
const ROLE_BADGE = { superadmin: 'Superadmin', admin: 'Admin', reviewer: 'Reviewer', user: 'User', client: 'Client' };

export default function AppLayout() {
  const { user, logout, isAdmin, isSuperAdmin, isViewOnly, can } = useAuth();

  // The generator's address while it is on screen, and the report type it
  // last showed while it is not — so the hidden instance keeps rendering the
  // same report instead of jumping back to Meta.
  const generatorMatch = useMatch('/report-generator/:platform');
  const canGenerator = can('report_generator');
  const generatorRoute = Boolean(generatorMatch && canGenerator);
  const [lastGeneratorPlatform, setLastGeneratorPlatform] = useState(null);
  const generatorPlatform = generatorRoute ? generatorMatch.params.platform : lastGeneratorPlatform;
  useEffect(() => {
    if (generatorRoute) setLastGeneratorPlatform(generatorMatch.params.platform);
  }, [generatorRoute, generatorMatch?.params.platform]);
  const keepGenerator = canGenerator && Boolean(generatorPlatform);
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

  const location = useLocation();

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
      // Back to the report type last open, where the kept-alive report waits.
      if (n.to === '/report-generator' && lastGeneratorPlatform) return { ...n, to: `/report-generator/${lastGeneratorPlatform}` };
      if (!n.sections) return n;
      const sections = n.sections.filter(allowed);
      if (!sections.length) return null;
      // One section left is named for what it is, not for a group of one.
      if (sections.length === 1) return { ...n, to: sections[0].to, label: sections[0].label, Icon: sections[0].Icon, sections };
      return { ...n, to: sections[0].to, sections };
    })
    .filter((n) => n && (n.sections || allowed(n)));
  const groups = ['Top', 'Workspace', 'Integration']
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
      data-nav={to}
      // Brand Setting stays lit on every one of its sections, not only the
      // first one it links to.
      className={({ isActive }) => `sidebar-link${isActive || sections?.some((x) => location.pathname.startsWith(x.to)) ? ' active' : ''}`}
      // Only useful while collapsed; when the label is on screen a tooltip
      // repeating it is noise.
      title={open ? undefined : label}
    >
      <Icon size={18} className="sidebar-ico" />
      <span className="sidebar-label">{label}</span>
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
              {/* The top group has no heading: it stands above the named groups. */}
              {group.label !== 'Top' && <span className="sidebar-nav-title">{group.label}</span>}
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
        {/* Report Generator, kept alive: mounted the first time it is opened
            and only hidden while another page is on screen, so a generated
            report (and its files and selections) is still there on return. */}
        {keepGenerator && (
          <div className="rg-keepalive" hidden={!generatorRoute}>
            <ReportGeneratorPage platform={generatorPlatform} />
          </div>
        )}
      </main>

      {/* Feedback pinned to parts of the page — only for roles Pengaturan
          Akses gives the module to. Unlike `can`, an account whose module
          list has not loaded yet gets nothing: the comments are not for it
          to glimpse while the list arrives. */}
      {(isSuperAdmin || user?.modules?.includes('annotations')) && <AnnotationLayer />}
      {/* "Fitur baru": points at a newly shipped feature once (whatsNew.js). */}
      <FeatureSpotlight />
    </div>
  );
}
