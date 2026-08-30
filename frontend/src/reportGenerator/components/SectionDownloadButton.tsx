import { useState } from 'react';
import { downloadSectionPNG } from '../utils/exportImage';

// Ported from the original attachSectionDownloadButtons: a small "⬇ PNG"
// button appended to every .sec-heading, downloading just that card as an
// image. Finds its own .sec-block ancestor via the click event, same as the
// original's `btn.closest('.sec-block')` — no ref plumbing needed.
export function SectionDownloadButton() {
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const block = e.currentTarget.closest('.sec-block') as HTMLElement | null;
    if (!block) return;
    setBusy(true);
    try {
      await downloadSectionPNG(block);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="sec-download-btn" title="Download PNG" disabled={busy} onClick={handleClick}>
      {busy ? '⏳' : '⬇ PNG'}
    </button>
  );
}
