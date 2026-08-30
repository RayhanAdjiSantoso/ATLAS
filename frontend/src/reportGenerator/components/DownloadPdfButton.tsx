import { useState } from 'react';
import { exportElementToPDF } from '../utils/exportImage';

interface DownloadPdfButtonProps {
  targetId: string;
  filename: string;
  label?: string;
}

// Ported from the original downloadReportPDF/downloadSummaryPDF/downloadBusinessPDF
// — one full-report PDF export button, rendering every .sec-block card in
// the target container onto A4 pages.
export function DownloadPdfButton({ targetId, filename, label }: DownloadPdfButtonProps) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await exportElementToPDF(document.getElementById(targetId), filename);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn btn-ghost" disabled={busy} onClick={handleClick}>
      {busy ? '⏳ Menyiapkan PDF…' : label || '⬇ Download PDF'}
    </button>
  );
}
