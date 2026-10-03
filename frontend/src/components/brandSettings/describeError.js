// Turns an axios failure into something actionable rather than "gagal".
// Shared by Pengaturan Brand and Data Brand.
export function describeError(err, what) {
  const status = err?.response?.status;
  const body = err?.response?.data?.message || err?.response?.data?.error;
  if (status === 404) return `${what}: endpoint belum dikenal server (404). Backend kemungkinan masih proses lama — restart API-nya (npm run dev di folder backend).`;
  if (status === 401) return `${what}: sesi berakhir. Login ulang.`;
  if (status === 413) return `${what}: file terlalu besar untuk server.`;
  if (!err?.response) return `${what}: API tidak merespons. Pastikan backend berjalan di port 5001.`;
  return `${what}: ${body || `HTTP ${status}`}`;
}
