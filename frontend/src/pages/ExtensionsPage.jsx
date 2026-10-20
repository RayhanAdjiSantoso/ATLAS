import { Link } from 'react-router-dom';
import { Download, ExternalLink, ShieldCheck, Puzzle } from 'lucide-react';
import extensions from 'virtual:atlas-extensions';
import PageBand from '../components/common/PageBand.jsx';
import atlasIcon from '../assets/atlas-icon.png';
import '../components/dashboard/console.css';
import '../components/dashboard/softShell.css';
import './extensions.css';

// Extensions: the browser extensions ATLAS ships, as zips built from the
// /extensions folder at build time (frontend/build/extensionZips.js), so the
// download is always the version in the repository. Installed unpacked —
// none is on the Chrome Web Store.

// What each extension is for, where its output goes, and what it reads.
const GUIDE = {
  'google-reviews-exporter': {
    purpose: 'Mengumpulkan ulasan yang tampil di halaman bisnis Google Maps dan mengekspornya ke CSV untuk Google Reviews Analytics.',
    target: { to: '/google-reviews', label: 'Buka Google Reviews Analytics' },
    usage: [
      'Buka Google Maps di Chrome (login ke akun Google agar daftar ulasan lengkap), lalu buka halaman bisnisnya.',
      'Klik ikon extension → Start Collection. Biarkan tab Google Maps terbuka sampai status Completed.',
      'Tekan Export CSV, lalu unggah file-nya di Google Reviews Analytics → Upload Google Reviews CSV.',
    ],
    reads: 'Nama, alamat, rating, jumlah ulasan bisnis, dan ulasan yang tampil di halaman. Tidak membaca password, cookie, atau halaman di luar Google Maps; tidak mengirim data ke mana pun.',
  },
};

const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const INSTALL = [
  <>Unduh file zip, lalu ekstrak (klik dua kali di Mac, atau klik kanan → <b>Extract All</b> di Windows).</>,
  <>Buka <code>chrome://extensions</code> di Google Chrome.</>,
  <>Aktifkan <b>Developer mode</b> di pojok kanan atas.</>,
  <>Klik <b>Load unpacked</b>, lalu pilih folder hasil ekstrak (folder yang berisi <code>manifest.json</code>).</>,
  <>Sematkan ikon ATLAS di toolbar lewat ikon puzzle → pin. Jika tab Google Maps sudah terbuka, muat ulang tab itu sekali.</>,
];

export default function ExtensionsPage() {
  return (
    <div className="con soft-shell ext-page">
      <div className="soft-frame">
        <PageBand
          kicker="Integration · Alat bantu"
          title="Extensions"
          desc="Chrome extension buatan ATLAS untuk mengumpulkan data dari luar ATLAS. Unduh, pasang sekali, lalu gunakan bersama halaman ATLAS terkait."
        />

        {!extensions.length && (
          <section className="soft-card ext-card"><p className="ext-muted">Belum ada extension yang tersedia.</p></section>
        )}

        {extensions.map((x) => {
          const g = GUIDE[x.id];
          return (
            <section key={x.id} className="soft-card ext-card" aria-labelledby={`ext-${x.id}`} data-feature={`ext-${x.id}`}>
              <div className="ext-head">
                <img src={atlasIcon} alt="" width="48" height="48" />
                <div className="ext-title">
                  <h2 id={`ext-${x.id}`}>{x.name}</h2>
                  <p>{g?.purpose ?? x.description}</p>
                  <span className="ext-meta">Versi {x.version} · {x.files} file · {fmtSize(x.bytes)} · Chrome (Manifest V3)</span>
                </div>
                <div className="ext-actions">
                  <a className="btn btn-primary" href={`/${x.file}`} download data-feature="ext-download">
                    <Download size={16} aria-hidden="true" /> Download .zip
                  </a>
                  {g?.target && <Link className="ext-link" to={g.target.to}>{g.target.label} <ExternalLink size={12} aria-hidden="true" /></Link>}
                </div>
              </div>

              <div className="ext-grid">
                <div>
                  <h3>Cara memasang</h3>
                  <ol className="ext-steps">{INSTALL.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  <p className="ext-muted ext-small">Versi baru: unduh lagi, ganti isi folder lama dengan yang baru, lalu tekan ikon ↻ pada kartu extension di <code>chrome://extensions</code>.</p>
                </div>
                {g && (
                  <div>
                    <h3>Cara memakai</h3>
                    <ol className="ext-steps">{g.usage.map((s) => <li key={s}>{s}</li>)}</ol>
                    <div className="ext-privacy">
                      <ShieldCheck size={16} aria-hidden="true" />
                      <p><b>Data yang dibaca:</b> {g.reads}</p>
                    </div>
                    <p className="ext-muted ext-small"><Puzzle size={12} aria-hidden="true" /> Izin: {x.permissions.join(', ')}</p>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
