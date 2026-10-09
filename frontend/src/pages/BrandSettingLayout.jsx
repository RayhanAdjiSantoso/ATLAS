import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext.jsx';
import { BRAND_SETTING_SECTIONS } from '../components/brandSettings/sections.js';
import atlasWordmark from '../assets/atlas-wordmark.png';
import '../components/dashboard/console.css';
import '../components/dashboard/softShell.css';
import './brandPages.css';

// Brand Setting — one page, three sections, and three levels of navigation
// that must never be confused for one another:
//   1. the section (Brand Context / Data Collection Hub / Brand Tracking) —
//      folder tabs on the deep-blue header band, the loudest thing on the
//      page; the open one takes the colour of the floor below, so it reads
//      as the page it opened;
//   2. a section's own views (Performance Database / Minutes of Meeting,
//      Performance Overview / Input) — a compact white segmented control on
//      the floor (brandPages.css re-skins .soft-tabs inside .bs);
//   3. anything inside a view (platforms, Revenue / Spending) — underline
//      tabs inside the card.
// The frame and header stay mounted while the section changes, so moving
// between sections reads as one workspace rather than three pages.
export default function BrandSettingLayout() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const reduced = useReducedMotion();
  const sections = BRAND_SETTING_SECTIONS.filter((s) => can(s.module));
  const current = sections.find((s) => pathname.startsWith(s.to)) ?? sections[0];
  // An account with one section (a client: Brand Tracking only) gets that
  // section as the page — no bar offering a single choice.
  const single = sections.length === 1;

  return (
    <div className="con brand-settings soft-shell bp bs">
      <div className="soft-frame">
        <header className={`bs-head${single ? ' is-single' : ''}`}>
          <div className="bs-head-top">
            <div className="bs-head-copy">
              <span className="bs-head-kicker">{single ? 'ATLAS · Ruang klien' : 'Workspace · Input brand'}</span>
              <h1>{single ? current.label : 'Brand Setting'}</h1>
              <p>{current?.desc}</p>
            </div>
            <img src={atlasWordmark} alt="ATLAS" className="bs-head-mark" />
          </div>

          {!single && (
            <nav className="bs-tabs" aria-label="Bagian Brand Setting" style={{ '--bs-count': sections.length }}>
              {sections.map((s, i) => {
                const on = s === current;
                return (
                  <NavLink key={s.to} to={s.to} className={`bs-tab${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined}>
                    {on && (
                      <motion.span
                        layoutId="bs-tab-sheet"
                        className="bs-tab-sheet"
                        transition={reduced ? { duration: 0 } : { type: 'spring', duration: 0.42, bounce: 0.1 }}
                      />
                    )}
                    <span className="bs-tab-ico"><s.Icon size={19} aria-hidden="true" /></span>
                    <span className="bs-tab-text">
                      <small>{String(i + 1).padStart(2, '0')}</small>
                      <strong>{s.label}</strong>
                      <em>{s.hint}</em>
                    </span>
                  </NavLink>
                );
              })}
            </nav>
          )}
        </header>

        <Outlet />
      </div>
    </div>
  );
}
