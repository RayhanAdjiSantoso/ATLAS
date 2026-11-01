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

import { handleStaleChunk } from './staleChunk';

// html2canvas draws a copy of the page made in a hidden iframe. Linked
// stylesheets in that copy load again, and html2canvas can start drawing
// before they arrive: the image comes out with browser default styles —
// serif text, no borders, the Excel/PNG buttons showing (a Google Ads
// section PNG came out exactly like that).
// Copying the page's CSS rules into the clone as one <style> makes the
// styles present before anything is measured. Cross-origin sheets (Google
// Fonts) cannot be read and keep their own <link>.
function pageCss(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      parts.push(Array.from(sheet.cssRules).map((r) => r.cssText).join('\n'));
    } catch {
      // cross-origin stylesheet: unreadable, left to its <link>
    }
  }
  return parts.join('\n');
}

export function inlineStylesOnClone(clonedDoc: Document): void {
  const style = clonedDoc.createElement('style');
  style.setAttribute('data-export-inline', '');
  style.textContent = pageCss();
  clonedDoc.head.appendChild(style);
}

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
  // .sec-block / .period-warning cards, whether they sit directly under the
  // report body (Meta / TikTok) or inside a .report-tab-panel wrapper (the
  // Shopee report is paged — every page is force-shown during pdf-export-mode).
  // .period-warning (Fase 1) is captured alongside .sec-block so the "periods
  // aren't the same length" warning survives into the export.
  // Every top-level card, wherever the page nests it — directly under the
  // body, inside a paged .report-tab-panel, or inside a section workspace
  // (SectionAccordion) wrapper. A .sec-block nested inside another one is part
  // of that card, not a card of its own.
  body.querySelectorAll<HTMLElement>('.sec-block, .period-warning').forEach((el) => {
    if (el.parentElement?.closest('.sec-block')) return;
    blocks.push(el);
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

  // Was document.body.classList. This app is one page inside ATLAS now rather
  // than the whole document: index.css scopes its &.pdf-export-mode and
  // &.png-export rules under .report-generator-app, so the class has to
  // land on that element — on <body> it would match nothing at all.
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

    // Allow the export scale and responsive charts to settle before capture.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    for (const block of blocks) {
      const canvas = await html2canvas(block, { scale: 2, backgroundColor: '#ffffff', useCORS: true, onclone: inlineStylesOnClone });
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
    if (handleStaleChunk(err)) return;
    alert('Gagal membuat PDF: ' + (err as Error).message);
  } finally {
    scopeEl.classList.remove('pdf-export-mode');
  }
}

// What is cut off on screen behind a horizontal scroll still belongs in the
// image: the section is widened, for the capture only, by what its widest
// scrolled box hides — nothing else changes, so the image is laid out as the
// section is on screen. A box in a split column gets only its share of the
// extra width, hence a few passes.
function widenForScrolledContent(block: HTMLElement): void {
  for (let pass = 0; pass < 4; pass += 1) {
    let hidden = 0;
    block.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      const { overflowX } = getComputedStyle(el);
      if (overflowX === 'auto' || overflowX === 'scroll') hidden = Math.max(hidden, el.scrollWidth - el.clientWidth);
    });
    if (!hidden) return;
    block.style.maxWidth = 'none';
    block.style.width = `${Math.ceil(block.getBoundingClientRect().width + hidden)}px`;
  }
}

const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// One section card as an image, as it looks on screen (2× for sharpness).
// `part` narrows it to one piece of the card — Fundamental Analysis's table or
// its Root Cause — with a little white margin around it.
export async function downloadSectionPNG(block: HTMLElement, part?: { el: HTMLElement; name: string }): Promise<void> {
  const heading = block.querySelector('.sec-heading');
  const title = (heading?.childNodes[0]?.textContent || '').trim();
  const badge = heading?.querySelector('.sec-badge')?.textContent?.trim();
  const filename = sanitizeFilename(`${title || 'Section'}${part ? ' - ' + part.name : ''}${badge ? ' - ' + badge : ''}`) + '.png';

  // `png-export` (see index.css): a ranking table shows its first rows whole
  // instead of its scroll cap. See exportElementToPDF above on why this is not
  // document.body.
  const scopeEl = block.closest<HTMLElement>('.report-generator-app') ?? document.body;
  const before = { width: block.style.width, maxWidth: block.style.maxWidth };
  scopeEl.classList.add('pdf-export-mode');
  scopeEl.classList.add('png-export');
  try {
    const { default: html2canvas } = await import('html2canvas');
    await settle();
    widenForScrolledContent(block);
    await settle();
    const target = part?.el ?? block;
    const pad = part ? 20 : 0;
    const box = target.getBoundingClientRect();
    const canvas = await html2canvas(target, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      // The copy is laid out in a window this wide: the page's own width, or
      // more when the section was widened past it.
      windowWidth: Math.max(document.documentElement.clientWidth, Math.ceil(block.getBoundingClientRect().right + 24)),
      ...(pad ? { x: -pad, y: -pad, width: Math.ceil(box.width) + pad * 2, height: Math.ceil(box.height) + pad * 2 } : {}),
      onclone: inlineStylesOnClone,
    });
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error(err);
    if (handleStaleChunk(err)) return;
    alert('Gagal membuat gambar: ' + (err as Error).message);
  } finally {
    block.style.width = before.width;
    block.style.maxWidth = before.maxWidth;
    scopeEl.classList.remove('pdf-export-mode');
    scopeEl.classList.remove('png-export');
  }
}
