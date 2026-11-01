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

// `.xl-skip` is a figure the screen stacks inside another cell (last period
// under this one); its `.xl-only` twin — hidden on screen — is the column
// the workbook gets instead, with `data-xl-colspan` widening its header.
const STRIP_SELECTOR = '.metric-drag-handle, .metric-remove-btn, .kpi-row-edit-icon, .demo-th-edit-icon, .sec-download-btn, .xl-skip';

function cleanTableClone(table: HTMLTableElement): HTMLTableElement {
  const clone = table.cloneNode(true) as HTMLTableElement;
  clone.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove());
  clone.querySelectorAll<HTMLTableCellElement>('[data-xl-colspan]').forEach((th) => {
    th.colSpan = Number(th.dataset.xlColspan) || th.colSpan;
  });
  // Sort carets are bare text nodes appended after the header label, not
  // their own element — scrub the glyphs (and any whitespace they leave)
  // from every header cell.
  clone.querySelectorAll('th').forEach((th) => {
    th.textContent = (th.textContent || '').replace(/[▲▼]/g, '').replace(/\s+/g, ' ').trim();
  });
  return clone;
}

// The tables print Indonesian figures ("Rp1.234.567", "4,55%", "▲+12,84%",
// "13,28x"). Left to SheetJS, "11.170" would read as 11.17 and "4,55%" as
// 4.55, so the sheet is built from the text as shown (raw) and each figure is
// then turned into a real number here, keeping its look through a number
// format. Anything else — names, "New", "—" — stays text.
const ID_NUMBER = /^[▲▼]?\s*([+\-−]?)\s*(Rp\s?)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s*(%|x)?$/;

function idNumberCell(text: string): { v: number; z: string } | null {
  const m = ID_NUMBER.exec(text.trim());
  if (!m) return null;
  const [, sign, rp, int, frac = '', unit] = m;
  let v = Number(`${int.replace(/\./g, '')}${frac ? `.${frac}` : ''}`);
  if (sign === '-' || sign === '−') v = -v;
  const dec = frac ? `.${'0'.repeat(frac.length)}` : '';
  const signed = (f: string) => (sign || text.includes('+') ? `+${f};-${f};${f}` : f);
  if (unit === '%') return { v: v / 100, z: signed(`0${dec}%`) };
  if (unit === 'x') return { v, z: `0${dec}"x"` };
  if (rp) return { v, z: `"Rp"#,##0${dec}` };
  return { v, z: `#,##0${dec}` };
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
      const ws = XLSX.utils.table_to_sheet(cleanTableClone(table), { raw: true });
      for (const addr of Object.keys(ws)) {
        if (addr.startsWith('!')) continue;
        const c = ws[addr];
        if (c.t !== 's') continue;
        const num = idNumberCell(String(c.v));
        if (num) Object.assign(ws[addr], { t: 'n', v: num.v, z: num.z, w: undefined });
      }
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
