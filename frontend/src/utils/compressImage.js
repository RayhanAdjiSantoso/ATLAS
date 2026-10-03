// Shrinks an image in the browser before it is uploaded, so the homepage's
// photos and logos stay small in the database (Neon storage is limited).
// Photos: longest side ≤ 1600px, WebP ~0.8. Logos: width ≤ 480px, WebP with
// alpha kept. SVG logos are vector already and pass through untouched.
export async function compressImage(file, kind) {
  if (file.type === 'image/svg+xml') return { blob: file, width: null, height: null, type: file.type };
  const bitmap = await createImageBitmap(file);
  const max = kind === 'logo' ? { w: 480, h: 240 } : { w: 1600, h: 1600 };
  const scale = Math.min(1, max.w / bitmap.width, max.h / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const quality = kind === 'logo' ? 0.9 : 0.8;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  // Browsers without WebP encoding hand back PNG; keep whichever is smaller.
  const out = blob && blob.size < file.size ? blob : file;
  return { blob: out, width, height, type: out.type || file.type };
}

export function formatBytes(n) {
  if (!n) return '0 KB';
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
