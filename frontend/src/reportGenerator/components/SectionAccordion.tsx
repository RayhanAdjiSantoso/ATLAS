import { Children, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Everything sticky above the report stacks: site header → report-type rail →
// the report's own tab bar. Measure whichever is lowest rather than hardcode a
// number, so opening a section parks it just under the chrome instead of
// behind it.
function stickyBottom(): number {
  const bottoms = ['.gen-rail', '.report-tabs', '.site-header']
    .map((sel) => document.querySelector(sel)?.getBoundingClientRect().bottom ?? 0)
    .filter((n) => n > 0);
  return bottoms.length ? Math.max(...bottoms) : 0;
}

const prefersReduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// Collapses a run of report sections into a single-open accordion: clicking a
// section's heading opens it, closes whichever was open, and scrolls it up to
// the top of the reading area — a report is a dozen tall cards, and opening
// the ninth shouldn't leave you looking at the eighth.
//
// Each child renders its own `.sec-block` + `.sec-heading`, so rather than
// re-plumbing every section component this wraps them and animates the block's
// max-height between "heading only" and its measured content height. The
// clamp is dropped once the transition finishes: these sections hold live
// tables whose height changes when you add or remove a metric, and a section
// frozen at its opening height would clip them. Same reason `overflow` is only
// hidden while animating — the metric pickers inside open as popups.
//
// The heading click is caught on the wrapper, with the buttons inside it
// (⬇ PNG / ⬇ Excel) excluded so they still work.
//
// Keyboard access comes from a real <button> laid over the heading rather than
// role="button" on the heading itself: the heading already contains the export
// buttons, and interactive content nested inside a button role is invalid and
// unreliably exposed. As a sibling overlay the toggle keeps its own accessible
// name (read off the heading text) while ⬇ PNG / ⬇ Excel stay reachable — they
// just sit a layer above it.
export function SectionAccordion({ children, defaultOpen = 0 }: { children: ReactNode; defaultOpen?: number }) {
  const items = Children.toArray(children).filter(Boolean);
  const [open, setOpen] = useState(defaultOpen);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  // Scroll only for a click, never for the initial render.
  const pendingScroll = useRef<{ next: number; prev: number } | null>(null);
  const mounted = useRef(false);

  const blockOf = (i: number) => refs.current[i]?.querySelector<HTMLElement>('.sec-block') ?? null;
  const headOf = (block: HTMLElement) => block.querySelector<HTMLElement>('.sec-heading');
  const headHeight = (block: HTMLElement) => headOf(block)?.offsetHeight ?? 56;

  // Wire the overlay toggle to its panel: the heading supplies the accessible
  // name, and the overlay is sized to the heading so it never covers content.
  useLayoutEffect(() => {
    items.forEach((_, i) => {
      const wrap = refs.current[i];
      const block = blockOf(i);
      if (!wrap || !block) return;
      if (!block.id) block.id = `sec-acc-panel-${i}`;
      const toggle = wrap.querySelector<HTMLButtonElement>('.sec-acc-toggle');
      if (!toggle) return;
      toggle.setAttribute('aria-controls', block.id);
      wrap.style.setProperty('--acc-head-h', `${headHeight(block)}px`);
      // Strip the export-button glyphs out of the name; they are their own
      // controls and would otherwise read as part of the section title.
      const head = headOf(block);
      if (head) {
        const name = Array.from(head.childNodes)
          .filter((n) => !(n instanceof HTMLElement && (n.tagName === 'BUTTON' || n.tagName === 'A')))
          .map((n) => n.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (name) toggle.setAttribute('aria-label', name);
      }
    });
  });

  useLayoutEffect(() => {
    items.forEach((_, i) => {
      const block = blockOf(i);
      if (!block) return;
      const isOpen = open === i;
      const head = headHeight(block);

      // First paint: set the collapsed state outright, no transition.
      if (!mounted.current) {
        if (!isOpen) {
          block.style.maxHeight = `${head}px`;
          block.style.overflow = 'hidden';
        }
        return;
      }

      const done = () => {
        block.style.maxHeight = '';
        block.style.overflow = '';
      };

      if (isOpen) {
        if (!block.style.maxHeight) return; // already open
        if (prefersReduced()) return done();
        block.style.overflow = 'hidden';
        block.style.maxHeight = `${block.scrollHeight}px`;
        block.addEventListener('transitionend', function end(e) {
          if (e.propertyName !== 'max-height') return;
          block.removeEventListener('transitionend', end);
          done();
        });
      } else {
        if (block.style.maxHeight === `${head}px`) return; // already closed
        if (prefersReduced()) {
          block.style.maxHeight = `${head}px`;
          block.style.overflow = 'hidden';
          return;
        }
        // Pin the current height first so the transition has somewhere to go.
        block.style.overflow = 'hidden';
        block.style.maxHeight = `${block.scrollHeight}px`;
        void block.offsetHeight;
        block.style.maxHeight = `${head}px`;
      }
    });
    mounted.current = true;
  }, [open, items.length]);

  useEffect(() => {
    const pending = pendingScroll.current;
    pendingScroll.current = null;
    if (pending === null || pending.next !== open) return;
    const el = refs.current[pending.next];
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      // A section closing ABOVE this one is still at full height right now and
      // will collapse over the next 420ms, pulling this section up with it.
      // Scrolling to the position measured today lands it behind the header,
      // so subtract the height that is about to disappear.
      let collapsing = 0;
      if (pending.prev !== -1 && pending.prev < pending.next) {
        const prevBlock = blockOf(pending.prev);
        if (prevBlock) collapsing = Math.max(0, prevBlock.getBoundingClientRect().height - headHeight(prevBlock));
      }
      const top = el.getBoundingClientRect().top + window.scrollY - collapsing - stickyBottom() - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: prefersReduced() ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const toggle = (i: number) =>
    setOpen((cur) => {
      const next = cur === i ? -1 : i;
      pendingScroll.current = { next, prev: cur };
      return next;
    });

  return (
    <div className="sec-accordion">
      {items.map((child, i) => (
        <div
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={`sec-acc-item${open === i ? ' open' : ''}`}
          onClickCapture={(e) => {
            const el = e.target as HTMLElement;
            // Mouse fallback for any part of the heading the overlay doesn't
            // cover. Never the export buttons living in it, and never the
            // overlay itself — that has its own handler and would double-fire.
            if (!el.closest('.sec-heading') || el.closest('button') || el.closest('a')) return;
            e.preventDefault();
            toggle(i);
          }}
        >
          <button
            type="button"
            className="sec-acc-toggle"
            aria-expanded={open === i}
            onClick={() => toggle(i)}
          />
          {child}
        </div>
      ))}
    </div>
  );
}
