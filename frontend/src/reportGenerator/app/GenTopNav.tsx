import { type CSSProperties } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ReportIcon } from '../components/ReportIcon';
import { isReportKey, REPORT_NAV, type ReportKey } from './reports';

// The generator's report-type switcher: a horizontal bar under the site
// header carrying the five report types and nothing else.
//
// It is deliberately NOT sticky. Three stacked sticky bars (site header →
// this → the report's own tab bar) ate 170px of every viewport and made it
// genuinely hard to tell which level you were navigating. This one is a
// once-per-session choice, so it scrolls away with the page and leaves the
// report tabs to stick alone under the header.
//
// Riwayat IS on this rail, unlike in MRG. There it lived in the site header,
// which is not ported — ATLAS's chrome is its own left sidebar, and that
// sidebar lists ATLAS's pages, not this page's report types. With no second
// navigation level to hold it, a link left off the rail would have nowhere at
// all to be reached from.
//
// Pengaturan Brand, MRG's seventh entry, is absent because the page is not
// ported (see reports.ts).
const PRIMARY: ReportKey[] = ['meta', 'shopee', 'tiktok', 'business', 'summary', 'reports'];

export function GenTopNav({ badges }: { badges: Record<ReportKey, string> }) {
  const { platform } = useParams();
  const reduce = useReducedMotion();
  const activeKey: ReportKey = isReportKey(platform) ? platform : 'meta';

  const primary = REPORT_NAV.filter((r) => PRIMARY.includes(r.key));

  return (
    <div className="gen-rail">
      <nav className="gen-rail-inner bleed" aria-label="Jenis laporan">
        {primary.map((r, i) => {
          const active = r.key === activeKey;
          const badge = badges[r.key];
          return (
            <motion.div
              key={r.key}
              className="gen-rail-item"
              initial={reduce ? undefined : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.03 * i, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <NavLink
                to={`/report-generator/${r.key}`}
                className={`gen-rail-link${active ? ' active' : ''}`}
                style={{ '--gr-accent': r.accent, '--gr-tint': r.tint } as CSSProperties}
                aria-current={active ? 'page' : undefined}
              >
                {active && (
                  <motion.span
                    className="gen-rail-pill"
                    layoutId="gen-rail-pill"
                    aria-hidden
                    transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 44, mass: 0.6 }}
                  />
                )}
                <span className="gen-rail-ico" aria-hidden>
                  <ReportIcon name={r.key} className="gen-rail-ico-svg" />
                </span>
                <span className="gen-rail-label">{r.label}</span>
                {badge && badge !== '—' && (
                  <span className={`gen-rail-badge${badge === '✓' ? ' done' : ''}`}>{badge === '✓' ? '' : badge}</span>
                )}
              </NavLink>
            </motion.div>
          );
        })}
      </nav>
    </div>
  );
}
