import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { exportElementToPDF } from '../utils/exportImage';

interface DownloadPdfButtonProps {
  targetId: string;
  filename: string;
  label?: string;
  // Selector of the cards to keep (see exportElementToPDF); all when omitted.
  only?: string;
}

// Ported from the original downloadReportPDF/downloadSummaryPDF/downloadBusinessPDF
// — one full-report PDF export button, rendering every .sec-block card in
// the target container onto A4 pages.
export function DownloadPdfButton({ targetId, filename, label, only }: DownloadPdfButtonProps) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await exportElementToPDF(document.getElementById(targetId), filename, { only });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn btn-ghost" disabled={busy} onClick={handleClick}>
      {busy ? <><Loader2 size={15} className="rg-spin" aria-hidden /> Menyiapkan PDF…</> : <><Download size={15} aria-hidden /> {label || 'Download PDF'}</>}
    </button>
  );
}
