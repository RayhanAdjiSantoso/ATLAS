import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Loader2, UploadCloud, X } from 'lucide-react';
import api from '../../api/client.js';
import SelectMenu from '../common/SelectMenu.jsx';

// Google Reviews › Import CSV: a file from the ATLAS Google Reviews Exporter
// (Chrome extension) is uploaded, checked on the server and previewed; only
// on confirm are its reviews stored and sent to the analysis. The browser
// checks the extension and size for a quick answer; the server checks
// everything again.

const MAX_BYTES = 4 * 1024 * 1024;
const fmtInt = (v) => (v == null ? '—' : Number(v).toLocaleString('id-ID'));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) : '—');
const errMsg = (err, fallback) => err.response?.data?.message || err.message || fallback;

function Stat({ label, value, tone }) {
  return (
    <div className={`gr-imp-stat${tone ? ` is-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Issues({ issues }) {
  if (!issues?.length) return null;
  return (
    <details className="gr-imp-issues" open={issues.length <= 5}>
      <summary>{issues.length >= 50 ? '50+' : issues.length} catatan validasi</summary>
      <div className="gr-table-wrap">
        <table className="gr-table is-compact">
          <thead><tr><th scope="col">Baris</th><th scope="col">Kolom</th><th scope="col">Catatan</th></tr></thead>
          <tbody>
            {issues.map((i, n) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={n}><td>{i.row}</td><td><code>{i.column}</code></td><td>{i.message}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function CsvImport({ businessId = null, onImported, onClose }) {
  const [phase, setPhase] = useState('idle'); // idle | uploading | preview | importing | done
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [mapping, setMapping] = useState('');
  const [brands, setBrands] = useState(null);
  const [brandId, setBrandId] = useState('');
  const inputRef = useRef(null);

  // Brands are optional: an account without access to the brand list simply
  // imports without linking one.
  useEffect(() => {
    api.get('/brands').then(({ data }) => setBrands(data.brands ?? [])).catch(() => setBrands([]));
  }, []);

  const reset = () => {
    setPhase('idle');
    setPreview(null);
    setResult(null);
    setError(null);
    setProgress(0);
    setMapping('');
  };

  const upload = async (file) => {
    setError(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) { setError({ message: 'File harus berekstensi .csv.' }); return; }
    if (file.size > MAX_BYTES) { setError({ message: 'File lebih dari 4 MB. Kurangi “Maksimum ulasan” di extension atau bagi file-nya.' }); return; }
    if (!file.size) { setError({ message: 'File kosong.' }); return; }
    setPhase('uploading');
    setProgress(0);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post('/google-reviews/imports/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => e.total && setProgress(Math.round((e.loaded / e.total) * 100)),
      });
      const p = data.import;
      setPreview(p);
      // A file for a business already open here maps to it by default.
      if (p.needsMapping) setMapping(businessId ? String(businessId) : p.candidates[0] ? String(p.candidates[0].id) : 'new');
      setPhase('preview');
    } catch (err) {
      setError({ message: errMsg(err, 'Upload gagal.'), issues: err.response?.data?.details?.issues });
      setPhase('idle');
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    upload(e.dataTransfer.files?.[0]);
  };

  const confirm = async () => {
    setPhase('importing');
    setError(null);
    const body = {};
    if (preview.needsMapping) {
      if (mapping === 'new') body.createNew = true;
      else body.businessId = Number(mapping);
    }
    if (brandId) body.brandId = Number(brandId);
    try {
      const { data } = await api.post(`/google-reviews/imports/${preview.id}/confirm`, body);
      setResult(data.import);
      setPhase('done');
      onImported?.(data.import);
    } catch (err) {
      setError({ message: errMsg(err, 'Import gagal.') });
      setPhase(err.response?.status === 409 ? 'idle' : 'preview');
    }
  };

  const cancel = async () => {
    if (preview && phase === 'preview') await api.post(`/google-reviews/imports/${preview.id}/cancel`).catch(() => {});
    reset();
  };

  const willCreate = preview && ((preview.needsMapping && mapping === 'new') || (!preview.needsMapping && !preview.matchedBusiness));
  const otherBusiness = preview && businessId && preview.matchedBusiness && preview.matchedBusiness.id !== businessId;

  return (
    <section className="soft-card gr-card gr-import" aria-labelledby="gr-import-title" data-feature="gr-csv-import">
      <header className="gr-card-head">
        <div>
          <h2 id="gr-import-title"><FileUp size={16} aria-hidden="true" /> Upload Google Reviews CSV</h2>
          <p>File dari Chrome extension <b>ATLAS Google Reviews Exporter</b>. ATLAS memeriksa file dulu dan menampilkan ringkasan sebelum data disimpan.</p>
        </div>
        {onClose && <button type="button" className="gr-link" onClick={() => { cancel(); onClose(); }}>Tutup</button>}
      </header>

      {error && (
        <div className="alert alert-error gr-imp-error">
          <span>{error.message}</span>
          <Issues issues={error.issues} />
        </div>
      )}

      {phase === 'idle' && (
        <div
          className={`gr-drop${drag ? ' is-drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <UploadCloud size={28} aria-hidden="true" />
          <strong>Tarik file CSV ke sini</strong>
          <span>atau</span>
          <button type="button" className="btn btn-secondary" onClick={() => inputRef.current?.click()}>Pilih file</button>
          <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          <small>.csv, UTF-8, maks. 4 MB</small>
        </div>
      )}

      {phase === 'uploading' && (
        <div className="gr-run" role="status">
          <div className="gr-run-line"><Loader2 size={16} className="gr-spin" aria-hidden="true" /> Mengunggah dan memeriksa file… {progress}%</div>
          <div className="gr-progress"><span style={{ width: `${progress}%` }} /></div>
        </div>
      )}

      {phase === 'preview' && preview && (
        <div className="gr-imp-preview">
          <div className="gr-imp-file">
            <strong>{preview.filename}</strong>
            <span>
              {preview.business?.name}
              {preview.business?.key ? <> · <code>{preview.business.key}</code></> : ' · tanpa business_id'}
              {preview.fromExporter ? ' · dari ATLAS Exporter' : ''}
            </span>
          </div>
          <div className="gr-imp-stats">
            <Stat label="Total baris" value={fmtInt(preview.totalRows)} />
            <Stat label="Ulasan valid" value={fmtInt(preview.validRows)} tone="good" />
            <Stat label="Baris tidak valid" value={fmtInt(preview.invalidRows)} tone={preview.invalidRows ? 'bad' : null} />
            <Stat label="Duplikat di file" value={fmtInt(preview.duplicateRows)} />
            <Stat label="Rating only" value={fmtInt(preview.ratingOnlyRows)} />
            <Stat label="Cakupan tanggal" value={preview.dateFrom ? `${fmtDate(preview.dateFrom)} – ${fmtDate(preview.dateTo)}` : '—'} />
          </div>
          {preview.withoutDate > 0 && <p className="gr-muted gr-small">{fmtInt(preview.withoutDate)} ulasan tanpa tanggal yang terbaca — tetap diimpor, tidak masuk tren.</p>}
          {preview.business?.totalReviews && (
            <p className="gr-muted gr-small">Google melaporkan {fmtInt(preview.business.totalReviews)} ulasan; file ini berisi {fmtInt(preview.validRows)}.</p>
          )}

          {preview.comparison ? (
            <div className="gr-imp-compare">
              <span>Dibandingkan data di ATLAS untuk <b>{preview.matchedBusiness.name}</b>:</span>
              <div className="gr-imp-stats">
                <Stat label="Sudah ada" value={fmtInt(preview.comparison.existing)} />
                <Stat label="Ulasan baru" value={fmtInt(preview.comparison.newReviews)} tone="good" />
                <Stat label="Mungkin diperbarui" value={fmtInt(preview.comparison.mayUpdate)} tone={preview.comparison.mayUpdate ? 'warn' : null} />
              </div>
            </div>
          ) : !preview.needsMapping && (
            <p className="gr-muted gr-small">Bisnis ini belum ada di ATLAS dan akan dibuat dari data di file.</p>
          )}
          {preview.previouslyImportedAt && (
            <p className="gr-note">File yang sama pernah diimpor {fmtDateTime(preview.previouslyImportedAt)}. Mengimpor lagi aman — tidak ada ulasan yang terduplikasi.</p>
          )}
          {otherBusiness && (
            <p className="gr-note"><AlertTriangle size={14} aria-hidden="true" /> File ini milik <b>{preview.matchedBusiness.name}</b>, bukan bisnis yang sedang dibuka. Data akan masuk ke bisnis sesuai file.</p>
          )}

          {preview.needsMapping && (
            <fieldset className="gr-imp-map">
              <legend>File ini tidak punya business_id. Ulasan ini milik bisnis yang mana?</legend>
              {preview.candidates.map((c) => (
                <label key={c.id}>
                  <input type="radio" name="gr-map" value={c.id} checked={mapping === String(c.id)} onChange={() => setMapping(String(c.id))} />
                  <span><b>{c.name}</b>{c.address ? ` — ${c.address}` : ''}</span>
                </label>
              ))}
              <label>
                <input type="radio" name="gr-map" value="new" checked={mapping === 'new'} onChange={() => setMapping('new')} />
                <span>Buat bisnis baru: <b>{preview.business?.name}</b>{preview.business?.address ? ` — ${preview.business.address}` : ''}</span>
              </label>
              <small className="gr-muted">Pastikan cabangnya benar — ulasan dari cabang lain tidak boleh tercampur.</small>
            </fieldset>
          )}

          {willCreate && brands?.length > 0 && (
            <div className="gr-imp-brand">
              <span>Hubungkan ke brand (opsional)</span>
              <SelectMenu
                value={brandId}
                onChange={setBrandId}
                options={[{ value: '', label: 'Tanpa brand' }, ...brands.map((b) => ({ value: String(b.brand_id), label: b.brand_name }))]}
                label="Brand"
                menuTitle="Brand"
                searchable
              />
              <small className="gr-muted">Akun yang dibatasi ke brand tertentu hanya melihat bisnis dari brand-nya.</small>
            </div>
          )}

          <Issues issues={preview.issues} />

          <div className="gr-imp-actions">
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={preview.needsMapping && !mapping}>
              Import {fmtInt(preview.validRows)} ulasan
            </button>
            <button type="button" className="btn btn-secondary" onClick={cancel}><X size={15} aria-hidden="true" /> Batal</button>
          </div>
        </div>
      )}

      {phase === 'importing' && (
        <div className="gr-run" role="status">
          <div className="gr-run-line"><Loader2 size={16} className="gr-spin" aria-hidden="true" /> Menyimpan ulasan…</div>
          <div className="gr-progress is-indeterminate"><span /></div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="gr-imp-done" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <div>
            <strong>Import selesai — {result.businessName}</strong>
            <span>{fmtInt(result.newReviews)} ulasan baru · {fmtInt(result.updatedReviews)} diperbarui · {fmtInt(result.unchangedReviews)} sudah ada.</span>
            <span>
              Langkah berikutnya: pilih metode analisis (Code-Based gratis, atau AI-Based) lalu tekan <b>Run Sentiment Analysis</b> di dashboard bisnis.
            </span>
          </div>
          <button type="button" className="btn btn-secondary" onClick={reset}>Import file lain</button>
        </div>
      )}
    </section>
  );
}

const STATUS = {
  imported: ['Berhasil', 'good'], previewed: ['Menunggu konfirmasi', 'neutral'], importing: ['Diproses', 'neutral'],
  failed: ['Gagal', 'bad'], cancelled: ['Dibatalkan', 'neutral'], expired: ['Kedaluwarsa', 'neutral'],
};

export function ImportHistory({ businessId = null, version = 0, onOpenBusiness }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api.get('/google-reviews/imports', { params: { businessId: businessId || undefined } })
      .then(({ data }) => live && setItems(data.imports))
      .catch((err) => live && setError(errMsg(err, 'Gagal memuat riwayat import.')));
    return () => { live = false; };
  }, [businessId, version]);

  return (
    <section className="soft-card gr-card" aria-labelledby="gr-imp-hist" data-feature="gr-import-history">
      <header className="gr-card-head">
        <div>
          <h2 id="gr-imp-hist">Riwayat import</h2>
          <p>{businessId ? 'File CSV yang pernah diimpor untuk bisnis ini.' : 'File CSV yang bisa Anda akses, terbaru di atas.'}</p>
        </div>
      </header>
      {error && <div className="alert alert-error">{error}</div>}
      {items && !items.length && <div className="gr-empty"><strong>Belum ada import.</strong></div>}
      {items?.length > 0 && (
        <div className="gr-table-wrap">
          <table className="gr-table is-compact">
            <thead>
              <tr>
                <th scope="col">Tanggal</th>
                {!businessId && <th scope="col">Bisnis</th>}
                <th scope="col">File</th>
                <th scope="col">Baris</th>
                <th scope="col">Baru</th>
                <th scope="col">Diperbarui</th>
                <th scope="col">Duplikat / sudah ada</th>
                <th scope="col">Status</th>
                <th scope="col">Oleh</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const [label, tone] = STATUS[i.status] ?? [i.status, 'neutral'];
                return (
                  <tr key={i.id}>
                    <td className="gr-nowrap">{fmtDateTime(i.confirmedAt ?? i.createdAt)}</td>
                    {!businessId && (
                      <td>{i.businessId && onOpenBusiness
                        ? <button type="button" className="gr-link" onClick={() => onOpenBusiness(i.businessId)}>{i.businessName}</button>
                        : i.businessName ?? '—'}</td>
                    )}
                    <td className="gr-imp-fname" title={i.filename}>{i.filename}</td>
                    <td>{fmtInt(i.totalRows)}</td>
                    <td>{fmtInt(i.newReviews)}</td>
                    <td>{fmtInt(i.updatedReviews)}</td>
                    <td>{i.status === 'imported' ? fmtInt((i.duplicateRows ?? 0) + (i.unchangedReviews ?? 0)) : fmtInt(i.duplicateRows)}</td>
                    <td>
                      <span className={`gr-pill is-${tone === 'good' ? 'positive' : tone === 'bad' ? 'negative' : 'neutral'}`} title={i.error ?? undefined}>{label}</span>
                      {i.error && <span className="gr-imp-err">{i.error}</span>}
                    </td>
                    <td className="gr-nowrap">{i.createdBy ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
