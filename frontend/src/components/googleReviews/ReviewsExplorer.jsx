import { forwardRef, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageSquareOff, X } from 'lucide-react';
import api from '../../api/client.js';
import SearchField from '../common/SearchField.jsx';
import SelectMenu from '../common/SelectMenu.jsx';
import { SENTIMENT } from './charts.jsx';
import MonthRange, { monthEnd, monthStart } from './MonthRange.jsx';

// Google Reviews › every collected review, filtered and paged on the server.
// A word picked in the cloud or a topic picked in Customer Insights arrives
// as `term` / `topic` and shows as a removable chip.

const SENTIMENT_OPTIONS = [
  { value: '', label: 'Semua sentimen' },
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' },
  { value: 'rating_only', label: 'Rating only (tanpa komentar)' },
  { value: 'failed', label: 'Gagal dianalisis' },
  { value: 'pending', label: 'Belum dianalisis' },
];
const RATING_OPTIONS = [{ value: '', label: 'Semua rating' }, ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} bintang` }))];
const SORT_OPTIONS = [
  { value: 'newest', label: 'Terbaru' },
  { value: 'oldest', label: 'Terlama' },
  { value: 'rating_desc', label: 'Rating tertinggi' },
  { value: 'rating_asc', label: 'Rating terendah' },
];
const BADGE = {
  positive: 'Positive', neutral: 'Neutral', negative: 'Negative', rating_only: 'Rating only', failed: 'Gagal', pending: 'Belum dianalisis',
};

// Code-Based readings say how much they rest on, instead of a confidence %.
const EVIDENCE = {
  low_evidence: ['perlu cek', 'Bukti lemah: hanya sedikit kata sentimen yang dikenali.'],
  ambiguous: ['campuran', 'Pujian dan keluhan dengan bobot mirip.'],
  no_evidence: ['tanpa kata sentimen', 'Tidak ada kata sentimen yang dikenali; dibaca netral.'],
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }) : '—');
// An approximate date ("6 months ago" at collection) is shown only as
// precisely as it is known.
function fmtReviewDate(d, precision) {
  if (!d) return '—';
  const opts = { timeZone: 'Asia/Jakarta' };
  if (precision === 'year') return `± ${new Date(d).toLocaleDateString('id-ID', { ...opts, year: 'numeric' })}`;
  if (precision === 'month') return `± ${new Date(d).toLocaleDateString('id-ID', { ...opts, month: 'short', year: 'numeric' })}`;
  if (precision === 'week') return `± ${fmtDate(d)}`;
  return fmtDate(d);
}
const PRECISION_HINT = { day: 'Perkiraan dari tanggal relatif (hari)', week: 'Perkiraan dari tanggal relatif (minggu)', month: 'Perkiraan dari tanggal relatif (bulan)', year: 'Perkiraan dari tanggal relatif (tahun)' };

function ReviewText({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return <span className="gr-no-text"><MessageSquareOff size={14} aria-hidden="true" /> Tanpa komentar</span>;
  const long = text.length > 220;
  return (
    <span className="gr-review-text">
      {open || !long ? text : `${text.slice(0, 220)}…`}
      {long && (
        <button type="button" className="gr-link" onClick={() => setOpen((v) => !v)}>
          {open ? 'Ringkas' : 'Selengkapnya'}
        </button>
      )}
    </span>
  );
}

const ReviewsExplorer = forwardRef(function ReviewsExplorer({ businessId, method = 'code', earliest, latest, term, topic, onClearTerm, onClearTopic, version }, ref) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sentiment, setSentiment] = useState('');
  const [rating, setRating] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Any filter change goes back to page 1.
  useEffect(() => { setPage(1); }, [debounced, sentiment, rating, from, to, sort, term, topic]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api.get(`/google-reviews/businesses/${businessId}/reviews`, {
      params: { method, q: debounced || undefined, sentiment: sentiment || undefined, rating: rating || undefined, from: monthStart(from), to: monthEnd(to), sort, page, pageSize: 20, term: term || undefined, topic: topic || undefined },
    })
      .then(({ data: d }) => live && setData(d))
      .catch((err) => live && setError(err.response?.data?.message || 'Gagal memuat ulasan.'))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [businessId, method, debounced, sentiment, rating, from, to, sort, page, term, topic, version]);

  const filtered = Boolean(debounced || sentiment || rating || from || to || term || topic);
  const reset = () => {
    setQ(''); setSentiment(''); setRating(''); setFrom(''); setTo(''); setSort('newest');
    onClearTerm?.(); onClearTopic?.();
  };

  return (
    <section className="soft-card gr-card" ref={ref} aria-labelledby="gr-explorer-title" data-feature="gr-explorer">
      <header className="gr-card-head">
        <div>
          <h2 id="gr-explorer-title">Reviews Explorer</h2>
          <p>{data ? `${data.total.toLocaleString('id-ID')} ulasan${filtered ? ' cocok dengan filter' : ' terkumpul'}` : 'Memuat…'}</p>
        </div>
      </header>

      <div className="gr-filters">
        <SearchField value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kata dalam ulasan…" aria-label="Cari ulasan" className="gr-filter-search" />
        <SelectMenu value={sentiment} onChange={setSentiment} options={SENTIMENT_OPTIONS} label="Sentimen" menuTitle="Sentimen" className="gr-filter-select" />
        <SelectMenu value={rating} onChange={setRating} options={RATING_OPTIONS} label="Rating" menuTitle="Rating" className="gr-filter-select" />
        <MonthRange earliest={earliest} latest={latest} from={from} to={to} onChange={(r) => { setFrom(r.from); setTo(r.to); }} />
        <SelectMenu value={sort} onChange={setSort} options={SORT_OPTIONS} label="Urutkan" menuTitle="Urutkan" className="gr-filter-select" />
      </div>

      {(term || topic || filtered) && (
        <div className="gr-chips">
          {term && <button type="button" className="gr-chip" onClick={onClearTerm}>Kata: “{term}” <X size={13} aria-label="Hapus filter kata" /></button>}
          {topic && <button type="button" className="gr-chip" onClick={onClearTopic}>Topik: {topic} <X size={13} aria-label="Hapus filter topik" /></button>}
          {filtered && <button type="button" className="gr-link" onClick={reset}>Reset semua filter</button>}
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className={`gr-table-wrap${loading ? ' is-loading' : ''}`}>
        <table className="gr-table">
          <thead>
            <tr>
              <th scope="col">Tanggal</th>
              <th scope="col">Rating</th>
              <th scope="col">Ulasan</th>
              <th scope="col">Sentimen</th>
              <th scope="col">Topik</th>
              <th scope="col">Balasan pemilik</th>
            </tr>
          </thead>
          <tbody>
            {!data && loading && Array.from({ length: 5 }, (_, i) => (
              <tr key={i} className="gr-skel-row"><td colSpan={6}><span className="gr-skel" /></td></tr>
            ))}
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td className="gr-nowrap" title={PRECISION_HINT[r.datePrecision]}>{fmtReviewDate(r.date, r.datePrecision)}</td>
                <td className="gr-nowrap" aria-label={r.rating ? `${r.rating} bintang` : 'Tanpa rating'}>
                  {r.rating ? <span className="gr-stars">{'★'.repeat(r.rating)}<span>{'★'.repeat(5 - r.rating)}</span></span> : '—'}
                </td>
                <td><ReviewText text={r.text} /></td>
                <td className="gr-nowrap">
                  <span className={`gr-badge is-${r.sentiment}`}>
                    {SENTIMENT[r.sentiment] && <i style={{ background: SENTIMENT[r.sentiment].color }} />}
                    {BADGE[r.sentiment]}
                  </span>
                  {r.confidence != null && r.confidence < 0.6 && <span className="gr-lowconf" title={`Keyakinan model ${Math.round(r.confidence * 100)}%`}>ragu</span>}
                  {EVIDENCE[r.evidence] && <span className="gr-lowconf" title={`${EVIDENCE[r.evidence][1]}${r.terms?.length ? ` Kata terdeteksi: ${r.terms.join(', ')}` : ''}`}>{EVIDENCE[r.evidence][0]}</span>}
                  {r.evidence === 'clear' && r.terms?.length > 0 && <span className="gr-terms" title="Kata/frasa yang menentukan sentimen (Code-Based)">{r.terms.slice(0, 3).join(', ')}</span>}
                </td>
                <td>{r.topics.length ? <span className="gr-topic-list">{r.topics.map((t) => <span key={t}>{t}</span>)}</span> : <span className="gr-muted">—</span>}</td>
                <td className="gr-owner">{r.ownerResponse ? <ReviewText text={r.ownerResponse} /> : <span className="gr-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.items.length && (
          <div className="gr-empty">
            <strong>Tidak ada ulasan yang cocok.</strong>
            <span>{filtered ? 'Ubah atau reset filter untuk melihat ulasan lain.' : 'Belum ada ulasan yang terkumpul untuk bisnis ini.'}</span>
          </div>
        )}
      </div>

      {data && data.pages > 1 && (
        <nav className="gr-pager" aria-label="Halaman ulasan">
          <button type="button" className="btn btn-secondary btn-icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Halaman sebelumnya"><ChevronLeft size={16} /></button>
          <span>Halaman {data.page} dari {data.pages}</span>
          <button type="button" className="btn btn-secondary btn-icon" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} aria-label="Halaman berikutnya"><ChevronRight size={16} /></button>
        </nav>
      )}
    </section>
  );
});

export default ReviewsExplorer;
