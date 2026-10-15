import { useEffect, useState } from 'react';
import { Check, Copy, Download, Loader2 } from 'lucide-react';

const KEY_PLACEHOLDER = 'GANTI-DENGAN-INGEST-KEY';

// The script as it lives in the repo, with this ATLAS's API address filled
// in. The ingest key stays a placeholder on purpose: it also opens Daily
// Tracking's ingest, so it is handed out by a superadmin, never shown here.
// Loaded on first open — it is ~50 KB nobody needs until they set one up.
let scriptRequest = null;
const loadScript = () => {
  scriptRequest ??= import('../../../../apps-script/GoogleAdsReport.js?raw')
    .then((m) => m.default.replace("'https://GANTI-DOMAIN-ATLAS/api'", `'${window.location.origin}/api'`))
    .catch((err) => { scriptRequest = null; throw err; });
  return scriptRequest;
};

// Line (1-based) holding the key, as the Google Ads editor numbers it.
const keyLine = (code) => code.split('\n').findIndex((l) => l.includes(KEY_PLACEHOLDER)) + 1;

function ScriptCode({ code, failed: loadFailed }) {
  const [copyFailed, setFailed] = useState(false);
  const failed = loadFailed || copyFailed;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (failed) return <p className="maf-hint">Kode script belum dapat dimuat. Muat ulang halaman, lalu coba lagi.</p>;
  if (!code) return <p className="maf-loading"><Loader2 size={14} className="maf-spin" /> Memuat kode…</p>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setFailed(true);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'GoogleAdsReport.js' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="gads-code">
      <div className="gads-code-bar">
        <span>GoogleAdsReport.js · {code.split('\n').length.toLocaleString('id-ID')} baris</span>
        <button type="button" className="btn btn-ghost dt-btn-sm" onClick={download}><Download size={14} /> Unduh</button>
        <button type="button" className="btn btn-primary dt-btn-sm" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Tersalin' : 'Salin kode'}
        </button>
      </div>
      <pre tabIndex={0} aria-label="Kode Google Ads Script"><code>{code}</code></pre>
    </div>
  );
}

// Data Collection Hub › Google Ads: how to install the Google Ads Script in
// a client's own Google Ads account, step by step, with the code to paste.
export default function GoogleAdsScriptGuide() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || code) return undefined;
    let alive = true;
    setFailed(false);
    loadScript().then((c) => alive && setCode(c)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [open, code]);

  const line = code ? keyLine(code) : 0;
  return (
    <details className="mx-specs gads-guide" data-feature="google-ads-script-guide" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span>Panduan setup Google Ads Script</span>
        <small>sekali per akun Google Ads · ±10 menit</small>
      </summary>
      <div className="maf-block">
        <p className="maf-hint">
          Data Google Ads masuk ke ATLAS lewat Google Ads Script yang dipasang di <strong>akun Google Ads klien itu sendiri</strong> (satu salinan per akun).
          Tanpa script ini, akun yang sudah dihubungkan di atas tidak akan menerima data.
        </p>
        <ol className="gads-steps">
          <li>
            <strong>Hubungkan Customer ID di ATLAS.</strong> Isi form <em>Tambah akun</em> di atas. Customer ID ada di pojok kanan atas Google Ads (format 123-456-7890).
          </li>
          <li>
            <strong>Minta INGEST_KEY ke superadmin via Slack.</strong> Kunci ini tidak ditampilkan di ATLAS. Jangan menyimpannya di dokumen, chat grup, atau tempat lain selain script.
          </li>
          <li>
            <strong>Buka akun klien di Google Ads.</strong> Masuk ke <a href="https://ads.google.com" target="_blank" rel="noreferrer">ads.google.com</a>, lalu pilih akun klien tersebut. Pastikan Customer ID di pojok kanan atas sama dengan yang didaftarkan.
          </li>
          <li>
            <strong>Buka halaman Scripts.</strong> Klik <em>Tools</em> › <em>Bulk actions</em> › <em>Scripts</em>.
          </li>
          <li>
            <strong>Buat script baru.</strong> Klik tombol <em>+</em> › <em>New script</em>. Ganti nama script menjadi <code>ATLAS Google Ads Report</code>.
          </li>
          <li>
            <strong>Tempel kode.</strong> Hapus seluruh isi editor (termasuk <code>function main() {'{}'}</code> bawaan Google), lalu tempel kode dari tombol <em>Salin kode</em> di bawah. Alamat ATLAS sudah terisi otomatis.
          </li>
          <li>
            <strong>Isi INGEST_KEY.</strong> Di bagian atas kode, di dalam <code>var CONFIG</code>{line > 0 && <> pada <strong>baris {line}</strong> (nomor baris terlihat di kiri editor Google Ads)</>}, ganti <code>{KEY_PLACEHOLDER}</code> dengan kunci dari superadmin. Tanda kutip <code>'…'</code> di kiri-kanannya tetap dipertahankan.
          </li>
          <li>
            <strong>Authorize.</strong> Klik <em>Authorize</em>, pilih akun Google yang punya akses ke akun Ads ini, lalu <em>Allow</em>.
          </li>
          <li>
            <strong>Preview sekali untuk cek.</strong> Klik <em>Preview</em>, tunggu selesai, lalu buka tab <em>Logs</em>. Preview langsung mengirim data ke ATLAS. Arti log:
            <ul>
              <li><code>… ok (N baris …)</code>: berhasil. Data muncul di <em>Riwayat penarikan</em> di atas.</li>
              <li><code>Akun ini (…) tidak punya job di ATLAS</code>: normal kalau data akun ini sudah lengkap; kalau akunnya baru, cek apakah Customer ID sudah didaftarkan di langkah 1.</li>
              <li><code>ATLAS … 401: … Ingest key tidak valid</code>: INGEST_KEY salah. Cek lagi kunci dan tanda kutipnya.</li>
            </ul>
          </li>
          <li>
            <strong>Simpan & jadwalkan.</strong> Klik <em>Save</em>, lalu <em>Close</em>. Di daftar Scripts, pada kolom <em>Frequency</em> script ini, pilih <em>Daily</em> jam <em>1:00 AM</em>.
          </li>
          <li>
            <strong>Selesai.</strong> Data mundur sampai tanggal <em>Tarik data sejak</em> ditarik bertahap pada jalan-jalan berikutnya. Status sinkron terlihat di tabel <em>Akun terhubung</em>.
          </li>
        </ol>
        <p className="maf-hint">
          <strong>Memperbarui script:</strong> kalau ATLAS merilis versi script baru, buka script yang sama di setiap akun, ganti seluruh kodenya dengan kode di bawah, isi lagi INGEST_KEY, lalu <em>Save</em>.
          Bila perubahan menyangkut cara hitung data lama, tarik ulang rentangnya dengan tombol <em>Tarik ulang</em> di tabel akun.
        </p>
        {open && <ScriptCode code={code} failed={failed} />}
      </div>
    </details>
  );
}
