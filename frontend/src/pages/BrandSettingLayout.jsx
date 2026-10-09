import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext.jsx';
import { BRAND_SETTING_SECTIONS } from '../components/brandSettings/sections.js';
import atlasWordmark from '../assets/atlas-wordmark.png';
import '../components/dashboard/console.css';
import '../components/dashboard/softShell.css';
import './brandPages.css';

// Brand Setting — one page, three sections. The frame, the masthead and the
// section bar live here and stay mounted while the section underneath
// changes, so moving between Brand Context, Data Collection Hub and Brand
// Tracking reads as one workspace rather than three pages. Each section is
// the parent of whatever tabs it has of its own; the bar sits on the
// masthead so it is visibly the level above them.
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
        <header className="soft-masthead bs-masthead">
          <div className="soft-masthead-copy">
            {single
              ? <h1>{current.label}<span className="soft-title-dot" aria-hidden="true">.</span></h1>
              : <h1><span>Brand</span> Setting<span className="soft-title-dot" aria-hidden="true">.</span></h1>}
            <p>{current?.desc}</p>
          </div>
          <div className="soft-masthead-signature">
            <img src={atlasWordmark} alt="ATLAS" />
            <span>{single ? `Ruang ${current.label.toLowerCase()}` : 'Ruang brand setting'}</span>
          </div>
        </header>

        {!single && <nav className="bs-nav" aria-label="Bagian Brand Setting" style={{ '--bs-count': sections.length }}>
          {sections.map((s, i) => {
            const on = s === current;
            return (
              <NavLink key={s.to} to={s.to} className={`bs-nav-item${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined}>
                {on && (
                  <motion.span
                    layoutId="bs-nav-pill"
                    className="bs-nav-pill"
                    transition={reduced ? { duration: 0 } : { type: 'spring', duration: 0.42, bounce: 0.12 }}
                  />
                )}
                <span className="bs-nav-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="bs-nav-ico"><s.Icon size={17} aria-hidden="true" /></span>
                <span className="bs-nav-text">
                  <strong>{s.label}</strong>
                  <small>{s.hint}</small>
                </span>
              </NavLink>
            );
          })}
        </nav>}

        <Outlet />
      </div>
    </div>
  );
}
