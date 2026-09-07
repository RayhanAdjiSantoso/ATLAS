import { sanitizeFilename } from './exportImage';
import { handleStaleChunk } from './staleChunk';

// ══════════════════════════════════════════════════════
// PER-SECTION EXCEL EXPORT — the wide "add metric columns to the side"
// tables (Age/Gender Breakdown, Analisis Per Item, Tren Harian) can hold
// more columns than fit on screen, and a PNG/PDF snapshot only captures the
// pixels that were actually painted — anything scrolled out of the
// horizontal-overflow container is silently lost. Exporting the real
// <table> to a spreadsheet keeps every column regardless of viewport.
//
// The workbook is built straight from the rendered DOM table (same
// philosophy as downloadSectionPNG working off the live .sec-block), so it
// always matches exactly what the user configured — current metric columns,
// their order, and any inline renames. The interactive-only bits (☰ drag
// handle, × remove button, ▲/▼ sort caret) are stripped from a clone first.
// `xlsx` is a dependency the app already ships; the dynamic import keeps its
// weight off tabs that never export.
// ══════════════════════════════════════════════════════

const STRIP_SELECTOR = '.metric-drag-handle, .metric-remove-btn, .kpi-row-edit-icon, .demo-th-edit-icon, .sec-download-btn';

function cleanTableClone(table: HTMLTableElement): HTMLTableElement {
  const clone = table.cloneNode(true) as HTMLTableElement;
  clone.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove());
  // Sort carets are bare text nodes appended after the header label, not
  // their own element — scrub the glyphs (and any whitespace they leave)
  // from every header cell.
  clone.querySelectorAll('th').forEach((th) => {
    th.textContent = (th.textContent || '').replace(/[▲▼]/g, '').replace(/\s+/g, ' ').trim();
  });
  return clone;
}

export async function downloadSectionExcel(block: HTMLElement): Promise<void> {
  const heading = block.querySelector('.sec-heading');
  const title = (heading?.childNodes[0]?.textContent || '').trim();
  const badge = heading?.querySelector('.sec-badge')?.textContent?.trim();
  const base = sanitizeFilename(`${title || 'Section'}${badge ? ' - ' + badge : ''}`);

  const tables = [...block.querySelectorAll('table')] as HTMLTableElement[];
  if (!tables.length) {
    alert('Tidak ada tabel untuk diunduh.');
    return;
  }

  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    tables.forEach((table, i) => {
      const ws = XLSX.utils.table_to_sheet(cleanTableClone(table));
      const name = tables.length > 1 ? `Tabel ${i + 1}` : 'Data';
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    XLSX.writeFile(wb, `${base}.xlsx`);
  } catch (err) {
    console.error(err);
    if (handleStaleChunk(err)) return;
    alert('Gagal membuat Excel: ' + (err as Error).message);
  }
}
