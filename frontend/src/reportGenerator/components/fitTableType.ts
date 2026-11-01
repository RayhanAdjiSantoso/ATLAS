import { useLayoutEffect, type RefObject } from 'react';

// A table beside a taller root cause is stretched to the tree's height, and
// its rows used to take the slack as empty padding around small type. Here
// the slack goes to the type first: every cell (and what is inside it — the
// change pill, a sub-label) grows by one factor, up to MAX_SCALE, as far as
// the table's own height and width allow; whatever height is left still
// spreads over the rows. The sizes are inline, so a PNG of the section
// (html2canvas copies the DOM) carries them exactly as shown.

const MAX_SCALE = 1.3;
const FIT_ATTR = 'fitFs';

export function resetTableType(table: HTMLTableElement): void {
  table.querySelectorAll<HTMLElement>('[data-fit-fs]').forEach((el) => {
    el.style.fontSize = '';
    delete el.dataset[FIT_ATTR];
  });
}

// `table` must be at its natural height while this runs (nothing stretching
// it); `target` is the height it may grow its type into.
export function growTableType(table: HTMLTableElement, target: number): void {
  const els = Array.from(table.querySelectorAll<HTMLElement>('th, td, th *, td *'));
  const base = els.map((el) => parseFloat(getComputedStyle(el).fontSize) || 0);
  const box = table.parentElement;
  const cells = Array.from(table.querySelectorAll<HTMLElement>('th, td'));
  const rows = Array.from(table.rows);
  const rowBase = rows.map((r) => r.getBoundingClientRect().height);
  // What already spills at the normal size (a narrow card) is not this
  // fitting's to fix; it just must not spill more.
  const spill = (c: HTMLElement) => c.scrollWidth - c.clientWidth;
  const cellBase = cells.map(spill);
  const boxBase = box ? Math.max(0, box.scrollWidth - box.clientWidth) : 0;
  const apply = (scale: number) => {
    els.forEach((el, i) => {
      if (!base[i]) return;
      el.style.fontSize = `${(base[i] * scale).toFixed(2)}px`;
      el.dataset[FIT_ATTR] = '';
    });
  };
  // Bigger only while nothing gives way: the table within its height and its
  // box, no cell's content spilling past it, and no row breaking onto a new
  // line it did not need before (a row may grow with its type, not by a line).
  const fits = (scale: number) =>
    table.getBoundingClientRect().height <= target + 0.5
    && (!box || box.scrollWidth - box.clientWidth <= boxBase + 1)
    && cells.every((c, i) => spill(c) <= Math.max(0, cellBase[i]) + 1)
    && rows.every((r, i) => r.getBoundingClientRect().height <= rowBase[i] * scale + 1);

  if (table.getBoundingClientRect().height >= target) return;
  let lo = 1;
  let hi = MAX_SCALE;
  for (let i = 0; i < 7; i += 1) {
    const mid = (lo + hi) / 2;
    apply(mid);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  if (lo === 1) resetTableType(table);
  else apply(lo);
}

// For a split whose table is stretched by CSS (.sec-split-even): the type
// grows into the stretched height, re-fitted whenever the split, the aside
// or the table's rows change.
export function useFitSplitTable(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const split = ref.current;
    if (!split) return undefined;
    let frame = 0;
    let busy = false;
    const fit = () => {
      const main = split.querySelector<HTMLElement>(':scope > .sec-split-main');
      const aside = split.querySelector<HTMLElement>(':scope > :not(.sec-split-main)');
      const table = main?.querySelector<HTMLTableElement>('table');
      if (!main || !aside || !table) return;
      busy = true;
      resetTableType(table);
      const a = main.getBoundingClientRect();
      const b = aside.getBoundingClientRect();
      // Stacked (a narrow card): nothing stretches the table.
      if (a.height > 0 && b.height > 0 && Math.abs(a.top - b.top) < 4) {
        const target = table.getBoundingClientRect().height;
        table.style.flex = 'none';
        growTableType(table, target);
        table.style.flex = '';
      }
      requestAnimationFrame(() => {
        busy = false;
      });
    };
    const schedule = () => {
      if (busy) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(split);
    split.querySelectorAll(':scope > *').forEach((child) => ro.observe(child));
    const mo = new MutationObserver(schedule);
    mo.observe(split, { childList: true, subtree: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref]);
}
