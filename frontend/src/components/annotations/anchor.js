// How a comment stays on its element.
//
// A comment is never stored as a screen position. `describe` records what the
// clicked element IS — a short selector path from the nearest stable landmark,
// the element's own text, and where inside it the click landed (as a fraction
// of its box) — and `resolve` finds that element again on a later visit, at
// any scroll position or window size.
//
// Finding it again degrades in steps rather than failing at once:
//   1. the selector path, exactly;
//   2. the same kind of element with the same text, anywhere under the
//      landmark (the layout around it was rearranged);
//   3. the nearest ancestor on the path that still exists (the element itself
//      is gone or was renamed) — the pin then sits on that section;
//   4. nothing: the element is not in this view (another tab, another filter),
//      and the comment is shown in the list only.
//
// A section can be given a name that survives any restyling with
// `data-annotate="some-name"`; paths are measured from the nearest one.

// The annotation UI itself is never a target.
export const UI_ROOT = '.ann-root';

const STATE_CLASS = /^(active|open|opened|closed|collapsed|expanded|selected|disabled|hover|focus|focused|peek|show|shown|hide|hidden|visible|loading|pending|current|on|off|dragging|sticky|stuck)$|^(is|has|js|anim|animate|motion)-|-(open|active|selected|collapsed|expanded|hidden|visible|loading)$/;
const SAFE_NAME = /^[a-zA-Z_][\w-]*$/;
// Generated names (React's useId, hashed classes, row keys) change between
// renders or builds; a path through one would not be found again.
const looksGenerated = (name) => /\d{3,}/.test(name) || name.includes(':');

const INLINE = new Set(['SPAN', 'B', 'STRONG', 'EM', 'I', 'SMALL', 'U', 'MARK', 'CODE', 'ABBR', 'TIME', 'IMG']);
const LANDMARKS = ['.main-content', '.sidebar'];

const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();

// The element a click means. Clicking the icon or the label inside a button
// means the button; anywhere inside an inline <svg> means the graphic.
export function pickTarget(node) {
  let el = node instanceof Element ? node : node?.parentElement;
  if (!el || el.closest(UI_ROOT)) return null;
  const svg = el.closest('svg');
  if (svg) el = svg;
  if (INLINE.has(el.tagName) || el.tagName === 'svg') {
    const control = el.parentElement?.closest('button, a, label, [role="button"], [role="tab"], [role="switch"]');
    if (control) el = control;
  }
  if (el === document.documentElement || el === document.body) return null;
  return el;
}

function landmarkSelector(el) {
  const named = el.getAttribute('data-annotate');
  if (named) return `[data-annotate="${CSS.escape(named)}"]`;
  if (el.id && SAFE_NAME.test(el.id) && !looksGenerated(el.id)) return `#${CSS.escape(el.id)}`;
  for (const selector of LANDMARKS) if (el.matches(selector)) return selector;
  if (el === document.body) return 'body';
  return null;
}

function stableClasses(el) {
  return [...el.classList]
    .filter((c) => SAFE_NAME.test(c) && !STATE_CLASS.test(c) && !looksGenerated(c))
    .slice(0, 2);
}

// One step of the path: the tag, its lasting class names, and a position only
// when siblings would otherwise be indistinguishable.
function segment(el) {
  const tag = el.tagName.toLowerCase();
  let selector = tag + stableClasses(el).map((c) => `.${CSS.escape(c)}`).join('');
  const siblings = el.parentElement ? [...el.parentElement.children] : [];
  if (siblings.filter((s) => s.matches(selector)).length > 1) {
    const sameTag = siblings.filter((s) => s.tagName === el.tagName);
    selector += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
  }
  return selector;
}

// A short human name for the element, shown in the list and the thread.
export function labelFor(el) {
  const aria = norm(el.getAttribute('aria-label') || el.getAttribute('title'));
  if (aria) return aria.slice(0, 80);
  const heading = el.matches('h1,h2,h3,h4,h5,h6') ? el : el.querySelector('h1,h2,h3,h4,h5,h6');
  const headingText = norm(heading?.textContent);
  if (headingText) return headingText.slice(0, 80);
  const text = norm(el.textContent);
  if (text && text.length <= 80) return text;
  if (text) return `${text.slice(0, 77)}…`;
  const tag = el.tagName.toLowerCase();
  if (tag === 'canvas') return 'Grafik';
  if (tag === 'svg' || tag === 'img') return 'Gambar';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return norm(el.getAttribute('placeholder') || el.getAttribute('name')) || 'Kolom isian';
  const cls = stableClasses(el)[0];
  return cls ? `${tag}.${cls}` : tag;
}

export function describe(el, point) {
  const path = [];
  let root = null;
  let node = el;
  while (node && node !== document.documentElement) {
    const landmark = landmarkSelector(node);
    // The element itself may be a landmark; it still needs no path under it.
    if (landmark) { root = landmark; break; }
    path.unshift(segment(node));
    node = node.parentElement;
  }
  const rect = el.getBoundingClientRect();
  const clamp = (v) => Math.min(Math.max(v, 0), 1);
  const text = norm(el.textContent);
  return {
    v: 1,
    root: root ?? 'body',
    path,
    tag: el.tagName.toLowerCase(),
    // Long text is a container's whole content, not a fingerprint.
    text: text.length <= 120 ? text : '',
    x: rect.width ? clamp((point.x - rect.left) / rect.width) : 0.5,
    y: rect.height ? clamp((point.y - rect.top) / rect.height) : 0.5,
  };
}

const onScreen = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

function query(selector) {
  try {
    return [...document.querySelectorAll(selector)].filter((el) => !el.closest(UI_ROOT) && onScreen(el));
  } catch {
    return [];
  }
}

// → { el, exact } or null. `exact: false` means the pin sits on the nearest
// surviving section rather than on the element itself.
export function resolve(anchor) {
  if (!anchor?.root || !Array.isArray(anchor.path)) return null;
  const full = [anchor.root, ...anchor.path].join(' > ');

  const hits = query(full);
  if (hits.length === 1) return { el: hits[0], exact: true };
  if (hits.length > 1) {
    const byText = anchor.text ? hits.find((el) => norm(el.textContent) === anchor.text) : null;
    return { el: byText ?? hits[0], exact: true };
  }

  if (anchor.text && anchor.text.length >= 3 && anchor.tag) {
    const same = query(`${anchor.root} ${anchor.tag}`).filter((el) => norm(el.textContent) === anchor.text);
    if (same.length === 1) return { el: same[0], exact: true };
  }

  // Walk up the path. The bare landmark counts only when it is a named one —
  // "somewhere in the page" is not a place to put a pin.
  const namedRoot = !LANDMARKS.includes(anchor.root) && anchor.root !== 'body';
  for (let keep = anchor.path.length - 1; keep >= (namedRoot ? 0 : 1); keep -= 1) {
    const up = query([anchor.root, ...anchor.path.slice(0, keep)].join(' > '));
    if (up.length === 1) return { el: up[0], exact: false };
  }
  return null;
}
