import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface ReportPage {
  id: string;
  label: string;
  content: ReactNode;
  // Drop the page from the tab bar entirely (e.g. a group with no data).
  hidden?: boolean;
}

// A report's sections split into tabbed pages instead of one endless scroll.
// The bar is a floating, sticky, glassy segmented control with a pill
// indicator that glides between tabs. Only the active page is on screen; a
// PDF/PNG export force-shows every page (see .pdf-export-mode in shell.css +
// exportImage.ts getReportBlocks). With ≤1 visible page it renders flat.
// `accent` colours the active tab's dot and pill; `accentInk` is the same
// identity one step darker, for the label text — a saturated platform hue on
// the white pill lands around 3.6:1, under AA. Falls back to `accent`.
export function ReportPages({ pages, accent, accentInk }: { pages: ReportPage[]; accent?: string; accentInk?: string }) {
  const visible = pages.filter((p) => !p.hidden);
  const [active, setActive] = useState(visible[0]?.id);
  const current = visible.some((p) => p.id === active) ? (active as string) : visible[0]?.id;

  const barRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [stuck, setStuck] = useState(false);

  // Move the pill indicator under the active tab (and keep it there on resize).
  useLayoutEffect(() => {
    function place() {
      const el = current ? btnRefs.current[current] : null;
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    }
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [current, visible.length]);

  // "stuck" = the bar has scrolled up against the site header → stronger shadow.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof IntersectionObserver === 'undefined') return;
    const sentinel = document.createElement('div');
    sentinel.style.cssText = 'position:absolute;top:-1px;height:1px;width:1px;pointer-events:none';
    bar.parentElement?.insertBefore(sentinel, bar);
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { rootMargin: '-80px 0px 0px 0px' });
    io.observe(sentinel);
    return () => {
      io.disconnect();
      sentinel.remove();
    };
  }, []);

  if (visible.length <= 1) return <>{visible[0]?.content ?? null}</>;

  return (
    <>
      <div
        ref={barRef}
        className={`report-tabs${stuck ? ' is-stuck' : ''}`}
        role="tablist"
        style={
          accent
            ? ({ '--rt-accent': accent, ...(accentInk ? { '--rt-accent-ink': accentInk } : {}) } as CSSProperties)
            : undefined
        }
      >
        {pill && <span className="report-tab-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} />}
        {visible.map((p, i) => (
          <button
            key={p.id}
            ref={(el) => {
              btnRefs.current[p.id] = el;
            }}
            type="button"
            role="tab"
            aria-selected={current === p.id}
            className={`report-tab${current === p.id ? ' active' : ''}`}
            style={{ '--rt-i': i } as CSSProperties}
            onClick={() => setActive(p.id)}
          >
            <span className="report-tab-dot" aria-hidden />
            {p.label}
          </button>
        ))}
      </div>
      {visible.map((p) => (
        <div key={p.id} role="tabpanel" className={`report-tab-panel${current === p.id ? ' active' : ''}`}>
          {p.content}
        </div>
      ))}
    </>
  );
}
