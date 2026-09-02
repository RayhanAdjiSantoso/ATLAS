// ══════════════════════════════════════════════════════
// PDF / PNG EXPORT — ported 1:1 from the original's PDF EXPORT and
// PER-SECTION PNG EXPORT sections. The `<script>`-tag availability checks
// (`typeof html2canvas==='undefined'`) are dropped since these are now
// bundled npm imports, not optionally-loaded CDN scripts — the failure mode
// they guarded against can't happen anymore. Button disabled/spinner state,
// which the original mutated directly on the DOM button, is left to the
// calling React component's own state instead.
//
// html2canvas/jsPDF are ~450KB combined — imported dynamically so that
// weight only loads the first time a user actually clicks a download
// button, instead of bloating every page load with libraries most report
// views never touch.
//
// KNOWN LIMITATION: html2canvas's DOM-to-canvas path re-implements text
// layout itself rather than reading the browser's actual rendering, so long
// values in the Business Overview input table's <input> cells can render
// visibly clipped in exported PDF/PNG (the calculated tables below, which
// are plain text rather than form inputs, are unaffected and always render
// correctly). Tried `foreignObjectRendering:true` — the standard fix for
// this class of bug — but it produced solid black blocks instead, likely a
// canvas-tainting issue with a Google Font, so it's off. (The app has since
// dropped its second Google Font — JetBrains Mono — but this wasn't
// re-tested against that change, so the flag is left as-is.)
// ══════════════════════════════════════════════════════

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

// A "block" is one .report-top banner or one .sec-block card. Handles both
// a root whose cards live inside a [data-role="r-body"] wrapper and a root
// whose cards are direct children, with the same logic. (A data attribute
// is used here instead of the original's `#r-body` id — with every tab now
// mounted simultaneously, that id would no longer be unique per the DOM spec.)
function getReportBlocks(rootEl: HTMLElement): HTMLElement[] {
  const body = rootEl.querySelector<HTMLElement>('[data-role="r-body"]') || rootEl;
  const blocks: HTMLElement[] = [];
  const top = rootEl.querySelector(':scope > .report-top');
  if (top) blocks.push(top as HTMLElement);
  [...body.children].forEach((child) => {
    // .period-warning (Fase 1) is captured alongside .sec-block so the
    // "periods aren't the same length" warning survives into the export —
    // the whole point of the warning is to travel with a shared report.
    if (child.classList.contains('sec-block') || child.classList.contains('period-warning')) blocks.push(child as HTMLElement);
  });
  return blocks;
}

export async function exportElementToPDF(rootEl: HTMLElement | null, filename: string): Promise<void> {
  if (!rootEl) return;
  const blocks = getReportBlocks(rootEl);
  if (!blocks.length) {
    alert('Tidak ada konten laporan untuk diunduh.');
    return;
  }

  // Was document.body.classList — toggled on the nearest .report-generator-app
  // ancestor instead, now that this app is one page inside ATLAS rather than
  // owning the whole document (index.css's &.pdf-export-mode rules expect
  // the class on this element, not on <body>).
  const scopeEl = rootEl.closest<HTMLElement>('.report-generator-app') ?? document.body;
  scopeEl.classList.add('pdf-export-mode');
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 28;
    const usableW = pageW - margin * 2;
    const usableH = pageH - margin * 2;
    const gap = 14;
    let cursorY = margin;

    for (const block of blocks) {
      const canvas = await html2canvas(block, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const imgH = canvas.height * (usableW / canvas.width);

      if (imgH <= usableH) {
        if (cursorY > margin && cursorY + imgH > margin + usableH) {
          doc.addPage();
          cursorY = margin;
        }
        doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, cursorY, usableW, imgH);
        cursorY += imgH + gap;
      } else {
        // Block taller than a single page (e.g. a very long table) — slice it
        // into page-height chunks so it never gets cut mid-row visually, each
        // slice instead lands cleanly at the top of its own page.
        if (cursorY > margin) {
          doc.addPage();
          cursorY = margin;
        }
        const scale = usableW / canvas.width;
        const sliceHeightPx = Math.max(1, Math.floor(usableH / scale));
        let renderedPx = 0;
        let first = true;
        while (renderedPx < canvas.height) {
          const thisPx = Math.min(sliceHeightPx, canvas.height - renderedPx);
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = thisPx;
          sliceCanvas.getContext('2d')!.drawImage(canvas, 0, renderedPx, canvas.width, thisPx, 0, 0, canvas.width, thisPx);
          if (!first) doc.addPage();
          doc.addImage(sliceCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, usableW, thisPx * scale);
          renderedPx += thisPx;
          first = false;
        }
        // Force the next block (if any) onto a fresh page, without eagerly
        // calling addPage() now — that would leave a trailing blank page if
        // this was the last block.
        cursorY = margin + usableH + 1;
      }
    }
    doc.save(filename);
  } catch (err) {
    console.error(err);
    alert('Gagal membuat PDF: ' + (err as Error).message);
  } finally {
    scopeEl.classList.remove('pdf-export-mode');
  }
}

export async function downloadSectionPNG(block: HTMLElement): Promise<void> {
  const heading = block.querySelector('.sec-heading');
  const title = (heading?.childNodes[0]?.textContent || '').trim();
  const badge = heading?.querySelector('.sec-badge')?.textContent?.trim();
  const filename = sanitizeFilename(`${title || 'Section'}${badge ? ' - ' + badge : ''}`) + '.png';

  // See exportElementToPDF's comment above on why this isn't document.body.
  const scopeEl = block.closest<HTMLElement>('.report-generator-app') ?? document.body;
  // `png-fit-content` (see index.css) is added only for the section-PNG path:
  // it lets every table shrink-wrap to its content and each horizontal-scroll
  // wrapper widen to fit, so the exported image sizes each column to its
  // content instead of clipping/squeezing the on-screen scroll view. Vertical
  // row caps are deliberately left untouched.
  scopeEl.classList.add('pdf-export-mode');
  scopeEl.classList.add('png-fit-content');
  try {
    const { default: html2canvas } = await import('html2canvas');
    // Let the fit-content relayout settle before html2canvas measures the node.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvas = await html2canvas(block, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      windowWidth: Math.max(document.documentElement.clientWidth, Math.ceil(block.scrollWidth)),
    });
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error(err);
    alert('Gagal membuat gambar: ' + (err as Error).message);
  } finally {
    scopeEl.classList.remove('pdf-export-mode');
    scopeEl.classList.remove('png-fit-content');
  }
}
