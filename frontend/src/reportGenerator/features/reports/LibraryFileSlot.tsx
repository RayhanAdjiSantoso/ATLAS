import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, FileSpreadsheet, RefreshCw, ChevronDown, Check, FolderOpen } from 'lucide-react';
import api from '../../../api/client.js';
import './librarySource.css';

type LibraryFile = { id: number; platform: string; channel: string; original_filename: string; period_month: string | null; period_start: string | null; period_end: string | null; part_index: number; row_count: number | null; period_source: string | null };
export type LibrarySelection = { label: string; start: string | null; end: string | null };
// Metadata is shared by slots; bytes are fetched only for the chosen files.
const catalog = new Map<number, Promise<LibraryFile[]>>();
function getCatalog(id: number) {
  if (!catalog.has(id)) catalog.set(id, api.get(`/brands/${id}/library`).then(r => r.data.files).catch(e => { catalog.delete(id); throw e; }));
  return catalog.get(id)!;
}
const formatMonth = (month: string) => new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month.slice(0,7)}-01T00:00:00Z`));
export function clearLibraryCatalog() { catalog.clear(); }
interface Props {
  clientId: number | null;
  platform: string;
  channel: string;
  tag: string;
  loaded?: boolean;
  fileName?: string;
  infoText?: string;
  className?: string;
  accept?: string;
  icon?: string;
  onFiles: (files: File[], selection: LibrarySelection) => Promise<void>;
}
export function LibraryFileSlot({ clientId, platform, channel, tag, loaded, fileName, infoText, onFiles }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [month, setMonth] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setFiles([]); setSelected([]); setMonth(''); setError('');
    if (!clientId) return;
    setLoading(true);
    getCatalog(clientId).then(rows => {
      if (!cancelled) setFiles(rows.filter(f => f.platform === platform && f.channel === channel));
    }).catch(e => { if (!cancelled) setError(e.response?.data?.error || 'Daftar file belum bisa dimuat. Coba muat ulang.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, platform, channel, revision]);
  const shown = files.filter(f => !month || f.period_month?.slice(0, 7) === month);
  const months = [...new Set(files.map(f => f.period_month?.slice(0, 7)).filter(Boolean))].sort().reverse();
  async function apply() {
    if (!clientId || !selected.length) return;
    setBusy(true); setError('');
    try {
      const choices = files.filter(f => selected.includes(f.id));
      if (choices.some(f => f.period_source === 'mismatch')) throw new Error('Periode file tidak sesuai slot bulan. Perbaiki file di Pengaturan Brand terlebih dahulu.');
      if (platform !== 'meta' && new Set(choices.map(f => f.period_month)).size > 1) throw new Error('Pilih file dari satu bulan untuk satu sisi perbandingan.');
      // Sequential downloads keep large multipart selections within memory limits.
      const downloaded: File[] = [];
      for (const f of choices) {
        const { data } = await api.get(`/brands/${clientId}/library/${f.id}/download`, { responseType: 'blob' });
        downloaded.push(new File([data], f.original_filename, { type: data.type }));
      }
      if (!alive.current) return;
      const starts = choices.map(f => f.period_start?.slice(0, 10)).filter(Boolean).sort();
      const ends = choices.map(f => f.period_end?.slice(0, 10)).filter(Boolean).sort();
      const keys = [...new Set(choices.map(f => f.period_month?.slice(0, 7)).filter(Boolean))].sort();
      const first = keys[0]; const last = keys[keys.length - 1];
      const endOfMonth = last ? new Date(Date.UTC(Number(last.slice(0,4)), Number(last.slice(5,7)), 0)).toISOString().slice(0,10) : null;
      await onFiles(downloaded, { label: keys.map(formatMonth).join(' / '), start: starts[0] ?? (first ? `${first}-01` : null), end: ends[ends.length-1] ?? endOfMonth });
      if (alive.current) setExpanded(false);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'File tidak dapat digunakan.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className={`library-slot${loaded ? ' is-loaded' : ''}${expanded ? ' is-expanded' : ''}`} aria-label={tag}>
    <div className="library-slot-head"><strong>{tag}</strong><span>{loading ? 'Memuat…' : `${files.length} file tersedia`}</span></div>
    <button type="button" className="library-source-trigger" disabled={!clientId || loading || busy} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
      <span className="library-source-icon">{loaded ? <Check size={19}/> : <FolderOpen size={20}/>}</span>
      <span className="library-source-copy"><strong>{loaded ? 'Sumber siap digunakan' : 'Pilih dari perpustakaan'}</strong><small>{loaded ? fileName : !clientId ? 'Pilih klien terlebih dahulu' : 'Pilih bulan dan bagian file untuk laporan ini'}</small></span>
      <ChevronDown size={17}/>
    </button>
    {loaded && infoText && <p className="library-source-info">{infoText}</p>}
    {expanded && <div className="library-source-panel">
      <div className="library-panel-tools"><span>File di Pengaturan Brand</span><button type="button" aria-label={`Muat ulang file ${tag}`} disabled={loading || busy} onClick={() => { if (clientId) catalog.delete(clientId); setRevision(v => v + 1); }}><RefreshCw size={14}/> Muat ulang</button></div>
      {months.length > 0 && <div className="library-month-tabs" role="group" aria-label={`Bulan sumber ${tag}`}>
        <button type="button" aria-pressed={!month} onClick={() => setMonth('')}>Semua bulan</button>
        {months.map(m => <button type="button" key={m} aria-pressed={month === m} onClick={() => setMonth(m!)}>{formatMonth(m!)}</button>)}
      </div>}
      <div className="library-file-list">
        {shown.map(f => <label key={f.id} className={`library-file-row${selected.includes(f.id) ? ' is-selected' : ''}`}><input type="checkbox" disabled={busy} checked={selected.includes(f.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, f.id] : ids.filter(id => id !== f.id))} /><FileSpreadsheet size={17} aria-hidden="true"/><span><strong>{f.original_filename}</strong><small>{f.period_month ? formatMonth(f.period_month) : 'Referensi lintas periode'} · Bagian {f.part_index ?? 1}{f.row_count != null ? ` · ${f.row_count.toLocaleString('id-ID')} baris` : ''}{f.period_source === 'mismatch' ? ' · periode tidak sesuai' : ''}</small></span></label>)}
        {!shown.length && <div className="library-source-empty"><Database size={22}/><strong>Sumber ini belum tersedia</strong><p>Unggah file melalui <Link to="/pengaturan-brand">Pengaturan Brand → Data &amp; file</Link>, lalu muat ulang daftar ini.</p></div>}
      </div>
      {files.length > 0 && <div className="library-slot-actions"><span>{selected.length ? `${selected.length} file dipilih` : 'Pilih file yang akan digunakan'}<small>Ekspor terbagi? Pilih semua bagiannya.</small></span><button type="button" className="btn btn-primary" disabled={!selected.length || busy} onClick={apply}>{busy ? 'Membaca…' : 'Gunakan sumber'}</button></div>}
    </div>}
    {error && <p className="library-error" role="alert">{error}</p>}
  </section>;
}
