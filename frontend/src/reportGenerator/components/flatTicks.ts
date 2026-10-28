import type { Scale } from 'chart.js';

const FONT = "600 11px 'Inter', system-ui, sans-serif";

// Category labels laid flat under their bars, never slanted. Each label wraps
// onto at most two lines within the width of its own slot on the axis,
// measured in the axis font, and the second line is cut with an ellipsis, so
// neighbours never run into each other. The tooltip still shows the full name.
export function flatCategoryTicks(labels: readonly string[]) {
  return {
    maxRotation: 0,
    minRotation: 0,
    autoSkip: false,
    callback(this: Scale, _value: string | number, index: number) {
      const full = (labels[index] ?? '').replace(/\s+/g, ' ').trim();
      const slot = this.width / Math.max(labels.length, 1) - 10;
      const ctx = this.ctx;
      ctx.save();
      ctx.font = FONT;
      const fits = (s: string) => ctx.measureText(s).width <= slot;
      // The longest head of `text` that fits, ending in an ellipsis.
      const cut = (text: string) => {
        if (fits(text)) return text;
        let lo = 0;
        let hi = text.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (fits(`${text.slice(0, mid).trimEnd()}…`)) lo = mid;
          else hi = mid - 1;
        }
        return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : '…';
      };
      const words = full.split(' ');
      let first = '';
      let i = 0;
      while (i < words.length && fits(first ? `${first} ${words[i]}` : words[i])) {
        first = first ? `${first} ${words[i]}` : words[i];
        i += 1;
      }
      let out: string | string[];
      if (!first) out = cut(full); // one word too long for the slot
      else if (i === words.length) out = first;
      else out = [first, cut(words.slice(i).join(' '))];
      ctx.restore();
      return out;
    },
  };
}
