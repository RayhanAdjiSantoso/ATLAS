import { Link } from 'react-router-dom';
import { Database, ArrowRight } from 'lucide-react';
import UploadDataTab from '../components/dashboard/UploadDataTab.jsx';
import '../components/dashboard/console.css';

// Pengaturan Brand — the single place data enters ATLAS.
//
// Ingest used to be the first tab of Business Overview, sitting beside six
// analytic domains as if uploading a file were a way of reading the business.
// It is the opposite: it is what every module reads *from*. Moving it here
// gives it one home, so no other surface has to grow an uploader of its own
// and the same brand cannot be filled twice from two places.
//
// The uploader itself is unchanged — the same component, the same POST to
// /api/uploads and /api/brands, the same idempotent import — so everything
// already loaded into ATLAS keeps working and everything loaded from here
// still feeds every module.

export default function BrandSettingsPage() {
  return (
    <div className="con">
      <header className="con-head">
        <div>
          <h1>Pengaturan Brand</h1>
          <p>
            Sumber tunggal data ATLAS. Daftarkan brand di sini, lalu unggah file ekspor Shopee-nya —
            seluruh modul membaca dari data yang masuk lewat halaman ini.
          </p>
        </div>
        <span className="con-head-scope">Sumber data Shopee</span>
      </header>

      <div className="con-body con-body-single">
        <div className="con-canvas">
          <section className="con-focus">
            <div className="con-focus-head">
              <h2>Impor Data Brand</h2>
              <p className="con-focus-q">
                Periode dibaca otomatis dari isi file. Mengunggah ulang file yang sama tidak menimpa
                data yang sudah ada.
              </p>
            </div>
            <div className="con-focus-body">
              <UploadDataTab />
            </div>
          </section>

          <Link to="/dashboard" className="con-handoff">
            <span className="con-handoff-ico"><Database size={16} strokeWidth={2} /></span>
            <span>
              <strong>Data sudah masuk?</strong>
              <span>Buka Dashboard Business Overview untuk membacanya per periode.</span>
            </span>
            <ArrowRight size={15} strokeWidth={2.4} />
          </Link>
        </div>
      </div>
    </div>
  );
}
