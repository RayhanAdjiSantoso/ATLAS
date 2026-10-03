import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import api from '../../api/client.js';
import { compressImage, formatBytes } from '../../utils/compressImage.js';

// The homepage's own controls, as a drawer over the page being edited — so
// every change is seen in place. Opens for roles Pengaturan Akses allows
// (module `homepage_content`, admin by default); the server checks the same.

const TABS = [
  { id: 'photo', label: 'Foto carousel' },
  { id: 'logo', label: 'Logo klien' },
  { id: 'text', label: 'Teks' },
];

const mediaUrl = (m) => `/api/public/homepage/media/${m.id}?v=${m.version}`;

export function HomepageManager({ onClose, onChanged }) {
  const [tab, setTab] = useState('photo');
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState(null);
  const [totalBytes, setTotalBytes] = useState(0);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const panelRef = useRef(null);
  const fileRef = useRef(null);

  async function load() {
    const { data } = await api.get('/homepage/media');
    setItems(data.media);
    setTotalBytes(data.totalBytes);
    setSettings((s) => s ?? data.settings);
  }

  useEffect(() => {
    load().catch((e) => setError(e.response?.data?.message || 'Data homepage gagal dimuat.'));
    panelRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = items.filter((m) => m.kind === tab);

  async function run(label, fn) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Perubahan gagal disimpan.');
    } finally {
      setBusy(null);
    }
  }

  function upload(files) {
    const kind = tab;
    run(`Mengunggah ${files.length} gambar…`, async () => {
      for (const file of files) {
        const { blob, width, height, type } = await compressImage(file, kind);
        const form = new FormData();
        const ext = type === 'image/svg+xml' ? 'svg' : type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'webp';
        form.append('file', new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${ext}`, { type }));
        form.append('kind', kind);
        form.append('title', file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim());
        if (width) form.append('width', String(width));
        if (height) form.append('height', String(height));
        await api.post('/homepage/media', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
    });
  }

  const patch = (m, body) => run('Menyimpan…', () => api.patch(`/homepage/media/${m.id}`, body));
  const remove = (m) => {
    if (!window.confirm(`Hapus "${m.title || 'gambar ini'}" dari homepage?`)) return;
    run('Menghapus…', () => api.delete(`/homepage/media/${m.id}`));
  };
  const move = (m, dir) => {
    const ids = list.map((x) => x.id);
    const i = ids.indexOf(m.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setItems((prev) => {
      const others = prev.filter((x) => x.kind !== tab);
      return [...others, ...ids.map((id) => prev.find((x) => x.id === id))];
    });
    run('Mengurutkan…', () => api.put('/homepage/media/order', { ids }));
  };

  async function saveSettings(e) {
    e.preventDefault();
    await run('Menyimpan teks…', async () => {
      const { data } = await api.put('/homepage/settings', settings);
      setSettings(data.settings);
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="hm-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={panelRef} tabIndex={-1} className="hm-panel" role="dialog" aria-modal="true" aria-labelledby="hm-title">
        <header className="hm-head">
          <div>
            <h2 id="hm-title">Kelola homepage</h2>
            <p>Perubahan langsung tampil untuk semua pengunjung · {formatBytes(totalBytes)} tersimpan</p>
          </div>
          <button type="button" className="hm-icon-btn" onClick={onClose} aria-label="Tutup">
            <X size={18} />
          </button>
        </header>

        <div className="hm-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`hm-tab${tab === t.id ? ' is-on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id !== 'text' && <span>{items.filter((m) => m.kind === t.id).length}</span>}
            </button>
          ))}
        </div>

        <div className="hm-body">
          {error && <p className="hm-error" role="alert">{error}</p>}

          {tab !== 'text' ? (
            <>
              <label className={`hm-drop${busy ? ' is-busy' : ''}`}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  multiple
                  disabled={Boolean(busy)}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = '';
                    if (files.length) upload(files);
                  }}
                />
                {busy ? <Loader2 size={20} className="hm-spin" aria-hidden /> : <ImagePlus size={20} aria-hidden />}
                <span>
                  <strong>{busy || (tab === 'photo' ? 'Tambah foto' : 'Tambah logo')}</strong>
                  <small>
                    {tab === 'photo'
                      ? 'Tampil di galeri dan di dalam huruf mil. Dikompres otomatis (maks. 1600px, WebP); foto lanskap paling pas.'
                      : 'Logo versi putih/terang di latar transparan — tampil di band navy. PNG atau SVG, dikompres otomatis (lebar maks. 480px).'}
                  </small>
                </span>
              </label>

              {list.length === 0 ? (
                <p className="hm-empty">{tab === 'photo' ? 'Belum ada foto — huruf mil tampil dengan warna logonya.' : 'Belum ada logo — running logo disembunyikan dari pengunjung.'}</p>
              ) : (
                <ol className="hm-list">
                  {list.map((m, i) => (
                    <li key={m.id} className={`hm-item${m.isActive ? '' : ' is-hidden'}`}>
                      <img src={mediaUrl(m)} alt="" className={`hm-thumb hm-thumb-${tab}`} />
                      <div className="hm-fields">
                        <input
                          defaultValue={m.title || ''}
                          placeholder={tab === 'photo' ? 'Judul foto' : 'Nama klien'}
                          aria-label={tab === 'photo' ? 'Judul foto' : 'Nama klien'}
                          onBlur={(e) => e.target.value !== (m.title || '') && patch(m, { title: e.target.value })}
                        />
                        {tab === 'photo' && (
                          <input
                            defaultValue={m.caption || ''}
                            placeholder="Keterangan singkat (opsional)"
                            aria-label="Keterangan foto"
                            onBlur={(e) => e.target.value !== (m.caption || '') && patch(m, { caption: e.target.value })}
                          />
                        )}
                        <small>
                          {m.width && m.height ? `${m.width}×${m.height} · ` : ''}
                          {formatBytes(m.byteSize)}
                          {!m.isActive && ' · disembunyikan'}
                        </small>
                      </div>
                      <div className="hm-actions">
                        <button type="button" className="hm-icon-btn" disabled={i === 0 || Boolean(busy)} onClick={() => move(m, -1)} aria-label="Naikkan">
                          <ArrowUp size={15} />
                        </button>
                        <button type="button" className="hm-icon-btn" disabled={i === list.length - 1 || Boolean(busy)} onClick={() => move(m, 1)} aria-label="Turunkan">
                          <ArrowDown size={15} />
                        </button>
                        <button type="button" className="hm-icon-btn" disabled={Boolean(busy)} onClick={() => patch(m, { isActive: !m.isActive })} aria-label={m.isActive ? 'Sembunyikan' : 'Tampilkan'}>
                          {m.isActive ? <Eye size={15} /> : <EyeOff size={15} />}
                        </button>
                        <button type="button" className="hm-icon-btn is-danger" disabled={Boolean(busy)} onClick={() => remove(m)} aria-label="Hapus">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            settings && (
              <form className="hm-form" onSubmit={saveSettings}>
                <label>
                  <span>Judul utama</span>
                  <input value={settings.headline} maxLength={120} onChange={(e) => setSettings({ ...settings, headline: e.target.value })} />
                </label>
                <label>
                  <span>Kalimat pembuka</span>
                  <textarea rows={3} value={settings.lede} maxLength={300} onChange={(e) => setSettings({ ...settings, lede: e.target.value })} />
                </label>
                <label>
                  <span>Portofolio MIL Digital</span>
                  <textarea rows={5} value={settings.about} maxLength={600} onChange={(e) => setSettings({ ...settings, about: e.target.value })} />
                </label>
                <p className="hm-note">Kosongkan kolom untuk kembali ke teks bawaan. Angka klien aktif dihitung otomatis dari Pengaturan Brand.</p>
                <button type="submit" className="hm-save" disabled={Boolean(busy)}>
                  {saved ? 'Tersimpan' : 'Simpan teks'}
                </button>
              </form>
            )
          )}
        </div>
      </aside>
    </div>
  );
}
