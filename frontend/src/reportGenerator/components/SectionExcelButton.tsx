import { useState } from 'react';
import { downloadSectionExcel } from '../utils/exportExcel';

// Excel counterpart of SectionDownloadButton, used by the wide metric-column
// tables where a PNG would drop any column scrolled out of view. Same
// self-locating pattern: finds its own .sec-block ancestor from the click
// event and hands the whole card to downloadSectionExcel, which pulls the
// real <table> out of it.
export function SectionExcelButton() {
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const block = e.currentTarget.closest('.sec-block') as HTMLElement | null;
    if (!block) return;
    setBusy(true);
    try {
      await downloadSectionExcel(block);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="sec-download-btn" title="Download Excel" disabled={busy} onClick={handleClick}>
      {busy ? '⏳' : '⬇ Excel'}
    </button>
  );
}
