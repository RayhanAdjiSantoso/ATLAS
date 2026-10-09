import { NavLink } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import atlasWordmark from '../../assets/atlas-wordmark.png';
import './pageBand.css';

// The header every workspace page in ATLAS opens with: a deep-blue band with
// the page's name, one line on what it is for, and the page's top-level
// switch as folder tabs on its lower edge. The open tab is painted the
// floor colour and sits flush on the band, so it visibly *is* the page
// underneath — level 1 of three, with a section's own views (a compact
// white segmented control) and in-card tabs (underlines) beneath it.
//
// Brand Setting, Business Overview and Report Generator all render this one
// component, so the three pages cannot drift apart. The frame around it sets
// two CSS custom properties: --band-bleed (the frame's padding, which the
// band cancels to reach the frame's edges) and --band-floor (the frame's
// background, which the open tab takes).
//
// tabs: [{ key, label, hint?, icon, to? | onSelect?, badge? , logo? }]
//   `to` makes a tab a route (NavLink); otherwise it is a button.
//   `logo: true` puts the icon on a white tile (multi-colour brand marks).
export default function PageBand({
  kicker, title, desc, tabs = [], activeKey, layoutId = 'band-sheet', compact = false, aside, tools, ariaLabel = 'Bagian halaman',
}) {
  const reduced = useReducedMotion();
  const spring = reduced ? { duration: 0 } : { type: 'spring', duration: 0.42, bounce: 0.1 };

  return (
    <header className={`band-head${tabs.length ? '' : ' is-bare'}${compact ? ' is-compact' : ''}`}>
      <div className="band-top">
        <div className="band-copy">
          {kicker && <span className="band-kicker">{kicker}</span>}
          <h1>{title}</h1>
          {desc && <p>{desc}</p>}
        </div>
        {/* `tools`: the page's context controls (brand, period) in the band's
            corner, in place of the wordmark. */}
        {tools ? <div className="band-tools">{tools}</div> : (
          <div className="band-aside">
            {aside}
            <img src={atlasWordmark} alt="ATLAS" className="band-mark" />
          </div>
        )}
      </div>

      {tabs.length > 0 && (
        <nav className="band-tabs" aria-label={ariaLabel} style={{ '--band-count': tabs.length }}>
          {tabs.map((t, i) => {
            const on = t.key === activeKey;
            const inner = (
              <>
                {on && <motion.span layoutId={layoutId} className="band-sheet" transition={spring} />}
                <span className={`band-ico${t.logo ? ' is-logo' : ''}`} aria-hidden="true">{t.icon}</span>
                <span className="band-text">
                  {!compact && <small>{String(i + 1).padStart(2, '0')}</small>}
                  <strong>
                    {t.label}
                    {t.badge && <b className="band-badge">{t.badge}</b>}
                  </strong>
                  {t.hint && <em>{t.hint}</em>}
                </span>
              </>
            );
            const cls = `band-tab${on ? ' is-on' : ''}`;
            return t.to ? (
              <NavLink key={t.key} to={t.to} className={cls} aria-current={on ? 'page' : undefined} title={compact ? t.hint : undefined}>
                {inner}
              </NavLink>
            ) : (
              <button key={t.key} type="button" className={cls} aria-pressed={on} onClick={t.onSelect} title={compact ? t.hint : undefined}>
                {inner}
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}
