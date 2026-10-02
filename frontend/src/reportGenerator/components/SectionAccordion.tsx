import { Children, Fragment, isValidElement, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';

// A report page as a workspace: a sticky navigator of its sections on the
// left, the chosen section on the right. Replaces a column of folded rows —
// a dozen tall cards read one at a time, side by side with their index,
// instead of scrolled past.
//
// Each child renders its own `.sec-block` + `.sec-heading`; the navigator
// reads each section's title and badge from that heading after render, so no
// section component had to change. Inactive sections stay mounted (hidden),
// which keeps their state and lets a PDF export show every one of them
// (.pdf-export-mode unhides the lot and drops the navigator).
//
// A child carrying `alwaysOpen` is not a section but context for all of them
// (e.g. the Non-Boost objective chooser, the cross-channel contribution); it
// stays visible above whichever section is open.
//
// Exported under its old name so every page that used the accordion now
// gets the workspace unchanged.

// Names a run of sections in the navigator ("Audience Analysis", "Creative
// Analysis"). Outside a deck it is transparent.
export function SectionGroup({ children }: { label: string; children: ReactNode }) {
  return <>{children}</>;
}

interface Flat {
  node: ReactNode;
  group: string | null;
}

function flatten(children: ReactNode, group: string | null = null): Flat[] {
  return Children.toArray(children).flatMap((child): Flat[] => {
    if (isValidElement(child) && child.type === Fragment) return flatten((child as ReactElement<{ children?: ReactNode }>).props.children, group);
    if (isValidElement(child) && child.type === SectionGroup) {
      const p = (child as ReactElement<{ label: string; children?: ReactNode }>).props;
      return flatten(p.children, p.label);
    }
    return [{ node: child, group }];
  });
}

interface SectionMeta {
  title: string;
  badge: string;
}

const prefersReduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// "CPAS Shopee · Age Breakdown" → "Age Breakdown": the page tab already says
// which channel this is; the navigator only needs what tells sections apart.
function shortTitle(full: string): string {
  const i = full.indexOf(' · ');
  return i > 0 ? full.slice(i + 3) : full;
}

function readMeta(wrap: HTMLElement | null, fallback: string): SectionMeta {
  const head = wrap?.querySelector<HTMLElement>('.sec-heading');
  if (!head) return { title: fallback, badge: '' };
  const title = Array.from(head.childNodes)
    .filter((n) => !(n instanceof HTMLElement && (n.tagName === 'BUTTON' || n.tagName === 'A' || n.classList.contains('sec-badge'))))
    .map((n) => n.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const badge = head.querySelector('.sec-badge')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return { title: title || fallback, badge };
}

export function SectionAccordion({ children, defaultOpen = 0 }: { children: ReactNode; defaultOpen?: number }) {
  const flat = flatten(children).filter((f) => Boolean(f.node));
  const items = flat.map((f) => f.node);
  const statics = items.map((child) => isValidElement(child) && (child.props as { alwaysOpen?: boolean }).alwaysOpen === true);
  const sections = items.map((_, i) => i).filter((i) => !statics[i]);
  const first = sections.includes(defaultOpen) ? defaultOpen : sections[0] ?? 0;
  const [chosen, setChosen] = useState(first);
  const active = sections.includes(chosen) ? chosen : first;

  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const deckRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [meta, setMeta] = useState<SectionMeta[]>([]);

  // Titles come from the rendered headings; re-read after every render (a
  // heading can change — the Non-Boost breakdowns name their objective) but
  // only commit when something actually changed.
  useLayoutEffect(() => {
    const next = items.map((_, i) => readMeta(refs.current[i], `Bagian ${i + 1}`));
    if (JSON.stringify(next) !== JSON.stringify(meta)) setMeta(next);
  });

  function open(i: number) {
    setChosen(i);
    // Bring the workspace back into view when the switch happens far below it.
    const deck = deckRef.current;
    if (deck && deck.getBoundingClientRect().top < 0) {
      deck.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, pos: number) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const nextPos = e.key === 'Home' ? 0 : e.key === 'End' ? sections.length - 1 : (pos + step + sections.length) % sections.length;
    const next = sections[nextPos];
    open(next);
    tabRefs.current[next]?.focus();
  }

  // One section is not a workspace — render it as it is.
  if (sections.length <= 1) return <>{items}</>;

  return (
    <div className="sdeck" ref={deckRef}>
      <nav className="sdeck-nav" aria-label="Bagian laporan">
        <span className="sdeck-nav-label" aria-hidden="true">Bagian laporan</span>
        <div role="tablist" aria-orientation="vertical" className="sdeck-tabs">
          {sections.map((i, pos) => {
            const m = meta[i];
            const on = i === active;
            const group = flat[i].group;
            const prevGroup = pos > 0 ? flat[sections[pos - 1]].group : null;
            return (
              <Fragment key={i}>
              {group && group !== prevGroup && (
                <span className="sdeck-group" role="presentation">
                  {group}
                </span>
              )}
              <button
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`sdeck-tab-${i}`}
                aria-selected={on}
                aria-controls={`sdeck-panel-${i}`}
                tabIndex={on ? 0 : -1}
                className={`sdeck-tab${on ? ' is-on' : ''}`}
                onClick={() => open(i)}
                onKeyDown={(e) => onKey(e, pos)}
              >
                <span className="sdeck-dot" aria-hidden="true" />
                <span className="sdeck-tab-text">
                  <strong>{m ? shortTitle(m.title) : `Bagian ${pos + 1}`}</strong>
                  {m?.badge && <small>{m.badge}</small>}
                </span>
              </button>
              </Fragment>
            );
          })}
        </div>
      </nav>

      <div className="sdeck-body">
        {items.map((child, i) => (
          <div
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={statics[i] ? undefined : `sdeck-panel-${i}`}
            role={statics[i] ? undefined : 'tabpanel'}
            aria-labelledby={statics[i] ? undefined : `sdeck-tab-${i}`}
            className={`sdeck-item${statics[i] ? ' is-static' : ''}${i === active ? ' is-active' : ''}`}
            hidden={!statics[i] && i !== active}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}

export { SectionAccordion as SectionDeck };
