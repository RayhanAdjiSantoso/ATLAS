import { inlineStylesOnClone } from '../../utils/exportImage';
import { handleStaleChunk } from '../../utils/staleChunk';

// One slide, one page, 1440×810pt (the size MIL's Canva decks export at). Runs in
// the browser on the html2canvas + jsPDF already bundled for the Performance
// Report, so it needs nothing the hosting cannot provide and no print dialog.
// Slides are captured from a hidden host at full stage size: nothing from the
// editor can be in the picture, and every page comes out the same size.

const PAGE_W = 1440;
const PAGE_H = 810;
const STAGE_W = 1920;
const STAGE_H = 1080;
// 3840×2160 per page; sharp on a large meeting-room display.
const SCALE = 2;
const JPEG_QUALITY = 0.92;

async function settled(host: HTMLElement): Promise<void> {
  await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  // Charts draw once measured; images once fetched. Bounded, so one failed image
  // costs a moment rather than the export.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const canvases = Array.from(host.querySelectorAll<HTMLCanvasElement>('.prs-chart-box canvas'));
    const images = Array.from(host.querySelectorAll<HTMLElement>('.prs-image'));
    if (canvases.every((c) => c.dataset.ready === '1') && images.every((i) => i.dataset.imageReady === '1')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export async function exportDeckToPdf(host: HTMLElement, filename: string, onProgress: (done: number, total: number) => void): Promise<void> {
  const slides = Array.from(host.querySelectorAll<HTMLElement>('.prs-slide'));
  if (!slides.length) throw new Error('Tidak ada slide untuk diekspor.');
  let html2canvas: typeof import('html2canvas').default;
  let jsPDF: typeof import('jspdf').jsPDF;
  try {
    [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  } catch (err) {
    if (handleStaleChunk(err)) return;
    throw err;
  }
  await settled(host);

  const doc = new jsPDF({ unit: 'pt', format: [PAGE_W, PAGE_H], orientation: 'landscape', compress: true });
  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i];
    const canvas = await html2canvas(slide, {
      scale: SCALE,
      width: STAGE_W,
      height: STAGE_H,
      windowWidth: STAGE_W,
      windowHeight: STAGE_H,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      onclone: inlineStylesOnClone,
      // html2canvas copies the whole document for every capture. ATLAS keeps
      // every report tab mounted, so only this slide's path through the tree is
      // kept, which is the difference between seconds and minutes per slide.
      ignoreElements: (el) => !(el.contains(slide) || slide.contains(el) || el.closest('head') !== null),
    });
    if (i > 0) doc.addPage([PAGE_W, PAGE_H], 'landscape');
    doc.addImage(canvas.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG', 0, 0, PAGE_W, PAGE_H, undefined, 'FAST');
    canvas.width = 0;
    canvas.height = 0;
    onProgress(i + 1, slides.length);
    // Lets the progress bar paint between slides.
    await new Promise((r) => setTimeout(r, 0));
  }
  doc.save(filename);
}
