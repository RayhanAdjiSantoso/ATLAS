import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import { downloadSectionPNG } from '../utils/exportImage';

// A piece of the card that can be downloaded on its own, found inside the
// card by `selector`; `name` goes into the file name.
export interface SectionPart {
  label: string;
  name: string;
  selector: string;
}

// A table with its root cause beside it (.sec-split): either half alone.
export const TABLE_ROOT_PARTS: SectionPart[] = [
  { label: 'Tabel saja', name: 'Tabel', selector: '.sec-split-main' },
  { label: 'Root Cause saja', name: 'Root Cause', selector: '.sympt-panel' },
];

// Ported from the original attachSectionDownloadButtons: a small "PNG"
// button appended to every .sec-heading, downloading just that card as an
// image. Finds its own .sec-block ancestor via the click event, same as the
// original's `btn.closest('.sec-block')` — no ref plumbing needed.
// With `parts`, the button opens a short menu instead: the whole card, or
// one of its pieces.
export function SectionDownloadButton({ parts }: { parts?: SectionPart[] }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  async function download(from: HTMLElement, part?: SectionPart) {
    const block = from.closest('.sec-block') as HTMLElement | null;
    if (!block) return;
    const el = part ? block.querySelector<HTMLElement>(part.selector) : null;
    if (part && !el) return;
    setOpen(false);
    setBusy(true);
    try {
      await downloadSectionPNG(block, el && part ? { el, name: part.name } : undefined);
    } finally {
      setBusy(false);
    }
  }

  const icon = busy ? <Loader2 size={12} className="rg-spin" aria-hidden /> : <Download size={12} aria-hidden />;

  if (!parts?.length) {
    return (
      <button
        type="button"
        className="sec-download-btn"
        title="Download PNG"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          download(e.currentTarget);
        }}
      >
        {icon} PNG
      </button>
    );
  }

  return (
    <span className="sec-download-menu-wrap" ref={wrap} data-feature="section-png-parts">
      <button
        type="button"
        className="sec-download-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {icon} PNG <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <span className="sec-download-menu" role="menu">
          <button type="button" role="menuitem" onClick={(e) => download(e.currentTarget)}>
            Seluruh section
          </button>
          {parts.map((p) => (
            <button key={p.selector} type="button" role="menuitem" onClick={(e) => download(e.currentTarget, p)}>
              {p.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
