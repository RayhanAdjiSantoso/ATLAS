// A lazy import() of a vendor chunk (html2canvas / jspdf / xlsx) throws
// "Failed to fetch dynamically imported module" when this tab was opened
// before a deploy re-hashed the chunk filenames. The only fix is to reload
// so the browser fetches the current index.html + chunk map. Returns true if
// it handled the error (caller should stop), false if it's an unrelated error.
export function handleStaleChunk(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const isStale =
    /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg);
  if (!isStale) return false;
  if (sessionStorage.getItem('chunk-reload') !== '1') {
    sessionStorage.setItem('chunk-reload', '1');
    window.location.reload();
  } else {
    alert('Aplikasi baru saja diperbarui. Muat ulang halaman (refresh), lalu coba lagi.');
  }
  return true;
}
