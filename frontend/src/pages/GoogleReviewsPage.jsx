import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Database, ExternalLink, FileUp, Loader2, MapPin, RefreshCw, Sparkles, Star, ThumbsDown, ThumbsUp,
} from 'lucide-react';
import api from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import PageBand from '../components/common/PageBand.jsx';
import SearchField from '../components/common/SearchField.jsx';
import { RatingBars, SENTIMENT, SentimentDonut, TrendChart } from '../components/googleReviews/charts.jsx';
import WordCloud from '../components/googleReviews/WordCloud.jsx';
import ReviewsExplorer from '../components/googleReviews/ReviewsExplorer.jsx';
import CsvImport, { ImportHistory } from '../components/googleReviews/CsvImport.jsx';
import MonthRange, { monthEnd, monthStart } from '../components/googleReviews/MonthRange.jsx';
import '../components/dashboard/console.css';
import '../components/dashboard/softShell.css';
import '../components/googleReviews/googleReviews.css';

// Google Reviews Analytics: find a business on Google Maps, collect its
// reviews, read them with AI and show what customers say.
//
// Everything shown comes from the server's collected reviews — nothing is
// filled in when a step fails. The page drives a run step by step (each step
// is one short request) so a long collection never holds one request open,
// and shows the source's coverage next to every headline number.

const fmtInt = (v) => (v == null ? '—' : Number(v).toLocaleString('id-ID'));
const fmtPct = (v) => (v == null ? '—' : `${v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) : '—');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }) : '—');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errMsg = (err, fallback) => err.response?.data?.message || err.message || fallback;

/* ── Search ───────────────────────────────────────────────────────────── */

function SearchPanel({ sources, canWrite, onOpen, compact }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState([]);

  useEffect(() => {
    api.get('/google-reviews/businesses').then(({ data }) => setSaved(data.businesses)).catch(() => {});
  }, []);

  const search = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) { setError('Masukkan minimal 2 karakter.'); return; }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/google-reviews/search', { query: q });
      setResults(data.results);
    } catch (err) {
      setError(errMsg(err, 'Pencarian gagal.'));
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (r) => {
    if (r.businessId) { onOpen(r.businessId); return; }
    setPicking(r.placeId);
    setError('');
    try {
      const { data } = await api.post('/google-reviews/businesses', { placeId: r.placeId });
      onOpen(data.business.id);
    } catch (err) {
      setError(errMsg(err, 'Gagal memilih bisnis.'));
    } finally {
      setPicking(null);
    }
  };

  const searchReady = Boolean(sources?.search);

  return (
    <section className={`soft-card gr-card gr-search${compact ? ' is-compact' : ''}`} aria-labelledby="gr-search-title" data-feature="gr-search">
      <header className="gr-card-head">
        <div>
          <h2 id="gr-search-title">{searchReady ? 'Cari bisnis' : 'Bisnis'}</h2>
          <p>{searchReady ? 'Ketik nama brand atau bisnis seperti di Google Maps. Cabang dengan nama serupa dibedakan dari alamat dan Place ID-nya.' : 'Buka bisnis yang sudah punya data, atau impor CSV untuk bisnis baru.'}</p>
        </div>
      </header>
      {!searchReady && (
        <p className="gr-note">Pencarian langsung ke Google Maps tidak aktif di server ini. Kumpulkan ulasan dengan Chrome extension <b>ATLAS Google Reviews Exporter</b>, lalu unggah CSV-nya di bawah.</p>
      )}
      {searchReady && <form className="gr-search-form" onSubmit={search}>
        <SearchField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="mis. Alluderma"
          aria-label="Nama brand atau bisnis"
          maxLength={120}
          disabled={!searchReady || !canWrite}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !searchReady || !canWrite}>
          {busy ? <Loader2 size={16} className="gr-spin" /> : null} Cari
        </button>
      </form>}
      {!canWrite && <p className="gr-muted gr-small">Akun view-only dapat membuka hasil analisis yang sudah ada, tetapi tidak dapat mencari, mengimpor, atau menambah bisnis.</p>}
      {error && <div className="alert alert-error">{error}</div>}

      {results && (
        results.length ? (
          <ul className="gr-results">
            {results.map((r) => (
              <li key={r.placeId}>
                <div className="gr-result-main">
                  <strong>{r.name}</strong>
                  <span className="gr-result-meta"><MapPin size={13} aria-hidden="true" /> {r.address || 'Alamat tidak tersedia'}</span>
                  <span className="gr-result-meta">
                    {r.category && <span>{r.category}</span>}
                    {r.rating != null && <span><Star size={13} className="gr-star-ico" aria-hidden="true" /> {r.rating.toLocaleString('id-ID', { minimumFractionDigits: 1 })}</span>}
                    {r.totalReviews != null && <span>{fmtInt(r.totalReviews)} ulasan Google</span>}
                    {r.mapsUrl && <a href={r.mapsUrl} target="_blank" rel="noreferrer">Google Maps <ExternalLink size={12} aria-hidden="true" /></a>}
                  </span>
                </div>
                <button type="button" className="btn btn-secondary" onClick={() => pick(r)} disabled={Boolean(picking)}>
                  {picking === r.placeId ? <Loader2 size={15} className="gr-spin" /> : null}
                  {r.businessId ? 'Buka analisis' : 'Pilih'}
                </button>
              </li>
            ))}
          </ul>
        ) : <div className="gr-empty"><strong>Tidak ada bisnis yang cocok.</strong><span>Coba nama lain, tambahkan kota, atau periksa ejaannya.</span></div>
      )}

      {!results && saved.length > 0 && (
        <div className="gr-saved">
          <h3>Bisnis yang sudah punya data</h3>
          <ul>
            {saved.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => onOpen(b.id)}>
                  <strong>{b.name}</strong>
                  <span>{b.address || '—'}</span>
                  <span>{fmtInt(b.collected)} ulasan · diperbarui {fmtDate(b.lastCollectedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ── Run progress ─────────────────────────────────────────────────────── */

function RunStatus({ run, onRetry, onCancel }) {
  if (!run) return null;
  if (run.status === 'running') {
    const collectPhase = {
      init: 'Initializing browser…',
      open: 'Opening business page…',
      load: 'Loading reviews…',
      collect: 'Collecting reviews…',
      save: 'Saving reviews…',
    }[run.phase];
    const stage = {
      collect: collectPhase
        ? `${collectPhase}${run.collected ? ` ${fmtInt(run.collected)} terbaca` : ''}`
        : `Mengumpulkan ulasan… ${fmtInt(run.collected)} diambil (${run.pages} halaman), ${fmtInt(run.newReviews)} baru`,
      analyze: `Running sentiment analysis (${run.method === 'ai' ? 'AI-Based' : 'Code-Based'})… ${fmtInt(run.analyzed)} dari ${fmtInt(run.toAnalyze)} ulasan`,
      summarize: 'Generating insights…',
    }[run.stage] ?? 'Memproses…';
    const fromImport = run.mode === 'import';
    const steps = fromImport ? ['Import', 'Sentimen', 'Insight'] : ['Browser', 'Halaman', 'Ulasan', 'Simpan', 'Sentimen', 'Insight'];
    const PHASE_STEP = { init: 0, open: 1, load: 2, collect: 2, save: 3 };
    const at = fromImport ? (run.stage === 'analyze' ? 1 : 2)
      : run.stage === 'collect' ? PHASE_STEP[run.phase] ?? 0 : run.stage === 'analyze' ? 4 : 5;
    const pct = run.stage === 'analyze' && run.toAnalyze ? Math.min(100, (run.analyzed / run.toAnalyze) * 100) : null;
    return (
      <div className="gr-run" role="status" aria-live="polite">
        <div className="gr-run-line">
          <Loader2 size={16} className="gr-spin" aria-hidden="true" />
          <span>{stage}</span>
          {onCancel && <button type="button" className="gr-link" onClick={onCancel}>Batalkan</button>}
        </div>
        <div className={`gr-progress${pct == null ? ' is-indeterminate' : ''}`}><span style={pct == null ? undefined : { width: `${pct}%` }} /></div>
        <ol className="gr-steps" aria-hidden="true">
          {steps.map((label, i) => <li key={label} className={i < at ? 'is-done' : i === at ? 'is-on' : ''}>{label}</li>)}
        </ol>
        {run.error && <p className="gr-run-warn">Percobaan terakhir gagal: {run.error} — mencoba lagi otomatis.</p>}
      </div>
    );
  }
  if (run.status === 'failed') {
    return (
      <div className="alert alert-error gr-run-alert">
        <span>Proses terakhir gagal: {String(run.error ?? '').replace(/\.+$/, '')}. Data yang sudah terkumpul tetap aman.</span>
        {onRetry && <button type="button" className="btn btn-secondary" onClick={onRetry}>Coba lagi</button>}
      </div>
    );
  }
  return null;
}

/* ── Sections ─────────────────────────────────────────────────────────── */

function BusinessHeader({ business, coverage, run, running, canWrite, liveSource, onAnalyze, onBack, onImport }) {
  const collected = Boolean(business.lastCollectedAt);
  return (
    <section className="soft-card gr-card gr-business" aria-label="Bisnis terpilih">
      <div className="gr-business-main">
        <button type="button" className="gr-link gr-back" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /> Ganti bisnis</button>
        <h2>{business.name}</h2>
        <p className="gr-result-meta">
          <MapPin size={14} aria-hidden="true" /> {business.address || 'Alamat tidak tersedia'}
        </p>
        <p className="gr-result-meta">
          {business.category && <span>{business.category}</span>}
          {business.googleRating != null && <span><Star size={13} className="gr-star-ico" aria-hidden="true" /> {business.googleRating.toLocaleString('id-ID', { minimumFractionDigits: 1 })} di Google</span>}
          {business.googleTotal != null && <span>{fmtInt(business.googleTotal)} ulasan Google</span>}
          {business.mapsUrl && <a href={business.mapsUrl} target="_blank" rel="noreferrer">Buka di Google Maps <ExternalLink size={12} aria-hidden="true" /></a>}
        </p>
      </div>
      {canWrite && (
        <div className="gr-business-actions">
          <button type="button" className="btn btn-secondary" onClick={onImport} disabled={running} data-feature="gr-import-button">
            <FileUp size={16} aria-hidden="true" /> Import CSV
          </button>
          {liveSource && (collected ? (
            <>
              <button type="button" className="btn btn-primary" onClick={() => onAnalyze('incremental')} disabled={running} data-feature="gr-refresh">
                <RefreshCw size={16} className={running ? 'gr-spin' : ''} aria-hidden="true" /> Refresh Reviews
              </button>
              <button type="button" className="gr-link" onClick={() => onAnalyze('full')} disabled={running} title="Ambil ulang semua ulasan dari awal, bukan hanya yang baru">
                Ambil ulang semua
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => onAnalyze('full')} disabled={running}>
              <Sparkles size={16} aria-hidden="true" /> Analyze Reviews
            </button>
          ))}
          <span className="gr-muted gr-small">Terakhir diperbarui: {fmtDateTime(business.lastCollectedAt)}</span>
        </div>
      )}
      {!canWrite && <span className="gr-muted gr-small">Terakhir diperbarui: {fmtDateTime(business.lastCollectedAt)}</span>}
      {coverage && run?.coverageNote && <p className="gr-muted gr-small gr-span">{run.coverageNote}</p>}
    </section>
  );
}

const ANALYSIS = {
  running: ['Sedang dianalisis', 'neutral'],
  not_run: ['Belum dijalankan', 'neutral'],
  pending: ['Ada ulasan menunggu', 'mixed'],
  unavailable: ['Model AI belum tersedia', 'mixed'],
  outdated: ['Ringkasan perlu diperbarui', 'mixed'],
  done: ['Selesai', 'positive'],
  empty: ['Belum ada data', 'neutral'],
};
const METHOD_LABEL = { code: 'Code-Based', ai: 'AI-Based' };

function DataSource({ data, coverage, method }) {
  if (!data || data.kind === 'none') return null;
  const [label, tone] = ANALYSIS[data.analysis.status] ?? [data.analysis.status, 'neutral'];
  const source = { csv: 'CSV Import', mixed: 'CSV Import + Google Maps langsung', live: 'Google Maps langsung' }[data.kind];
  return (
    <section className="gr-source" aria-label="Sumber data" data-feature="gr-data-source">
      <Database size={16} aria-hidden="true" />
      <dl>
        <div><dt>Data Source</dt><dd>{source}</dd></div>
        {data.lastImport && <div><dt>Last import</dt><dd title={data.lastImport.filename}>{fmtDateTime(data.lastImport.at)}</dd></div>}
        {data.kind !== 'live' && <div><dt>Ulasan diimpor</dt><dd>{fmtInt(data.importedReviews)}</dd></div>}
        <div><dt>Total di Google</dt><dd>{data.totalAvailable != null ? `${fmtInt(coverage.collected)} dari ${fmtInt(data.totalAvailable)}` : '—'}</dd></div>
        <div><dt>Analysis Method</dt><dd data-feature="gr-active-method">{METHOD_LABEL[method]}</dd></div>
        <div><dt>Analisis</dt><dd><span className={`gr-pill is-${tone}`}>{label}</span>{data.analysis.waiting > 0 && data.analysis.status !== 'running' && data.analysis.status !== 'not_run' ? ` · ${fmtInt(data.analysis.waiting)} ulasan menunggu` : ''}</dd></div>
      </dl>
    </section>
  );
}

// Choose how sentiment is read, and run it. Code-Based is the default and
// costs nothing; AI-Based is only ever started by pressing Run with it
// selected — never as a fallback. Picking a method also switches every
// chart below to that method's readings (the two are never mixed).
function MethodPanel({ analysis, status, canWrite, running, onSelect, onRun }) {
  const { method, methods } = analysis;
  const cards = [
    {
      key: 'code',
      title: 'Code-Based Analysis',
      tag: 'Gratis · Cepat',
      desc: 'Aturan dan leksikon Bahasa Indonesia–Inggris di server ATLAS. Tanpa API key, tanpa biaya token.',
      info: methods.code,
      available: true,
    },
    {
      key: 'ai',
      title: 'AI-Based Analysis',
      tag: 'Lanjutan',
      desc: `Claude / Gemini membaca konteks, sarkasme, dan membuat rekomendasi. Memakai token API${methods.ai.engine ? ` (${methods.ai.engine})` : ''}.`,
      info: methods.ai,
      available: methods.ai.available,
      why: 'Belum ada ANTHROPIC_API_KEY atau GEMINI_API_KEY di server.',
    },
  ];
  const sel = cards.find((c) => c.key === method);
  const label = (c) => (c.info.readings ? `${fmtInt(c.info.readings)} ulasan dianalisis · ${fmtDateTime(c.info.lastAnalyzedAt)}` : 'Belum pernah dijalankan');
  return (
    <section className="soft-card gr-card gr-method" aria-labelledby="gr-method-title" data-feature="gr-method">
      <header className="gr-card-head">
        <div>
          <h2 id="gr-method-title">Choose Analysis Method</h2>
          <p>Hasil tiap metode disimpan terpisah. Dashboard di bawah menampilkan metode yang dipilih: <b>{METHOD_LABEL[method]}</b>.</p>
        </div>
      </header>
      <div className="gr-method-cards" role="radiogroup" aria-label="Metode analisis">
        {cards.map((c) => (
          <label key={c.key} className={`gr-method-card${method === c.key ? ' is-on' : ''}${!c.available && !c.info.readings ? ' is-disabled' : ''}`}>
            <input
              type="radio"
              name="gr-method"
              value={c.key}
              checked={method === c.key}
              disabled={!c.available && !c.info.readings}
              onChange={() => onSelect(c.key)}
            />
            <span className="gr-method-body">
              <span className="gr-method-head"><strong>{c.title}</strong><em>{c.tag}</em></span>
              <span>{c.desc}</span>
              <small>{c.available ? label(c) : `${c.why}${c.info.readings ? ` Hasil lama tetap bisa dilihat (${label(c)}).` : ''}`}</small>
            </span>
          </label>
        ))}
      </div>
      {method === 'code' && (
        <p className="gr-note">Keterbatasan Code-Based: membaca kata dan frasa yang dikenal. Sarkasme, slang yang tidak umum, dan makna yang bergantung pada konteks bisa terbaca keliru — ulasan seperti itu ditandai “perlu cek” di Reviews Explorer.</p>
      )}
      {canWrite && (
        <div className="gr-method-run">
          <button type="button" className="btn btn-primary" onClick={onRun} disabled={running || !sel.available} data-feature="gr-run-analysis">
            <Sparkles size={16} aria-hidden="true" /> Run Sentiment Analysis
          </button>
          <span className="gr-muted gr-small">
            {!sel.available ? sel.why
              : status === 'not_run' ? `Metode ${METHOD_LABEL[method]} belum pernah dijalankan untuk bisnis ini.`
                : status === 'pending' ? 'Ada ulasan baru atau berubah yang belum dianalisis dengan metode ini.'
                  : status === 'outdated' ? 'Ringkasan perlu diperbarui.'
                    : 'Hanya ulasan baru atau yang berubah yang dianalisis ulang.'}
            {method === 'ai' && sel.available ? ' Menggunakan token API.' : ''}
          </span>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`gr-stat${tone ? ` is-${tone}` : ''}`}>
      <span className="gr-stat-label">{label}</span>
      <strong className="gr-stat-value">{value}</strong>
      {sub && <span className="gr-stat-sub">{sub}</span>}
    </div>
  );
}

function Overview({ business, coverage, sentiment }) {
  const pos = sentiment.items.find((i) => i.key === 'positive');
  const neg = sentiment.items.find((i) => i.key === 'negative');
  const share = coverage.googleTotal ? (coverage.collected / coverage.googleTotal) * 100 : null;
  return (
    <section aria-label="Ringkasan bisnis" className="gr-overview">
      <div className="gr-stats">
        <Stat label="Google Rating" value={business.googleRating != null ? business.googleRating.toLocaleString('id-ID', { minimumFractionDigits: 1 }) : '—'} sub="dilaporkan Google" />
        <Stat label="Total Google Reviews" value={fmtInt(coverage.googleTotal)} sub="dilaporkan Google" />
        <Stat label="Collected Reviews" value={fmtInt(coverage.collected)} sub={share != null ? `${fmtPct(Math.min(100, share))} dari total Google` : 'berhasil dikumpulkan'} />
        <Stat label="Analyzed Reviews" value={fmtInt(coverage.analyzed)} sub={`ulasan teks · ${fmtInt(coverage.ratingOnly)} rating only`} />
        <Stat label="Positive" value={fmtPct(pos?.pct)} sub={`${fmtInt(pos?.count)} ulasan teks`} tone="positive" />
        <Stat label="Negative" value={fmtPct(neg?.pct)} sub={`${fmtInt(neg?.count)} ulasan teks`} tone="negative" />
        <Stat label="Last Updated" value={fmtDate(business.lastCollectedAt)} sub={business.lastCollectedAt ? new Date(business.lastCollectedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB' : 'belum pernah'} />
      </div>
      {(coverage.limited || coverage.sourceNote || coverage.failed > 0 || coverage.pending > 0) && (
        <div className="gr-coverage" role="note">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            {coverage.limited && (
              <p>
                <strong>Cakupan data terbatas.</strong> Analisis memakai {fmtInt(coverage.collected)} dari {fmtInt(coverage.googleTotal)} ulasan yang dilaporkan Google
                {coverage.earliest && ` (ulasan ${fmtDate(coverage.earliest)} – ${fmtDate(coverage.latest)})`}. Hasilnya menggambarkan ulasan yang terkumpul, belum tentu seluruh pelanggan.
              </p>
            )}
            {coverage.sourceNote && <p>{coverage.sourceNote}</p>}
            {coverage.failed > 0 && <p>{fmtInt(coverage.failed)} ulasan gagal dianalisis dan tidak masuk persentase; akan dicoba lagi saat refresh berikutnya.</p>}
            {coverage.pending > 0 && <p>{fmtInt(coverage.pending)} ulasan belum dianalisis.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function Empty({ title, children }) {
  return <div className="gr-empty"><strong>{title}</strong>{children && <span>{children}</span>}</div>;
}

const CLOUD_MODES = [
  { key: 'overall', label: 'Overall' },
  { key: 'positive', label: 'Positive' },
  { key: 'negative', label: 'Negative' },
];

function Segmented({ options, value, onChange, label }) {
  return (
    <div className="gr-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} className={value === o.key ? 'is-on' : ''} onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

function TrendSection({ businessId, initial, version, method, earliest, latest }) {
  const [granularity, setGranularity] = useState('month');
  const [metric, setMetric] = useState('count');
  const [kind, setKind] = useState('line');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [trend, setTrend] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (granularity === 'month' && !from && !to) { setTrend(initial); return undefined; }
    let live = true;
    setLoading(true);
    setError('');
    api.get(`/google-reviews/businesses/${businessId}/trend`, { params: { granularity, from: monthStart(from), to: monthEnd(to), method } })
      .then(({ data }) => live && setTrend(data))
      .catch((err) => live && setError(errMsg(err, 'Gagal memuat tren.')))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [businessId, granularity, from, to, initial, version, method]);

  const points = trend?.points ?? [];
  const insights = trend?.insights;

  return (
    <section className="soft-card gr-card" aria-labelledby="gr-trend-title" data-feature="gr-trend">
      <header className="gr-card-head">
        <div>
          <h2 id="gr-trend-title">Sentiment Trend</h2>
          <p>Berdasarkan tanggal ulasan ditulis (WIB). Periode bertanda * masih berjalan.</p>
        </div>
      </header>
      <div className="gr-filters">
        <Segmented label="Periode" value={granularity} onChange={setGranularity} options={[{ key: 'week', label: 'Weekly' }, { key: 'month', label: 'Monthly' }]} />
        <Segmented label="Metrik" value={metric} onChange={setMetric} options={[{ key: 'count', label: 'Review Count' }, { key: 'pct', label: 'Sentiment %' }]} />
        <Segmented label="Jenis chart" value={kind} onChange={setKind} options={[{ key: 'line', label: 'Line' }, { key: 'bar', label: 'Stacked bar' }]} />
        <MonthRange earliest={earliest} latest={latest} from={from} to={to} onChange={(r) => { setFrom(r.from); setTo(r.to); }} />
        {(from || to) && <button type="button" className="gr-link" onClick={() => { setFrom(''); setTo(''); }}>Semua bulan</button>}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {points.length ? (
        <>
          <ul className="gr-legend is-inline" aria-label="Legenda">
            {Object.entries(SENTIMENT).map(([k, s]) => (
              <li key={k}><span className={`gr-swatch${kind === 'line' ? ' is-line' : ''}`} style={{ background: s.color }} /><span className="gr-legend-name">{s.label}</span></li>
            ))}
          </ul>
          <div className={loading ? 'is-loading' : ''}>
            <TrendChart points={points} metric={metric} kind={kind} />
          </div>
          {insights && (
            insights.sufficient ? (
              <ul className="gr-insights">
                {insights.items.map((i) => (
                  <li key={i.text} className={`is-${i.tone}`}>{i.text}</li>
                ))}
              </ul>
            ) : <p className="gr-note">{insights.message}</p>
          )}
          {trend?.imprecise > 0 && (
            <p className="gr-note">
              {fmtInt(trend.imprecise)} ulasan hanya bertanggal perkiraan {granularity === 'week' ? 'bulan/tahun' : 'tahun'} (mis. “a year ago”) sehingga tidak dimasukkan ke tren {granularity === 'week' ? 'mingguan' : 'bulanan'}.
            </p>
          )}
          <details className="gr-table-view">
            <summary>Lihat sebagai tabel</summary>
            <div className="gr-table-wrap">
              <table className="gr-table is-compact">
                <thead><tr><th scope="col">Periode</th><th scope="col">Ulasan teks</th><th scope="col">Positive</th><th scope="col">Neutral</th><th scope="col">Negative</th></tr></thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.period}>
                      <td>{p.label}{p.partial ? '*' : ''}</td>
                      <td>{fmtInt(p.total)}</td>
                      <td>{fmtInt(p.positive)} ({fmtPct(p.positivePct)})</td>
                      <td>{fmtInt(p.neutral)} ({fmtPct(p.neutralPct)})</td>
                      <td>{fmtInt(p.negative)} ({fmtPct(p.negativePct)})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <Empty title={loading ? 'Memuat tren…' : 'Belum ada ulasan bertanggal pada rentang ini.'}>
          {!loading && (trend?.imprecise
            ? `${fmtInt(trend.imprecise)} ulasan hanya bertanggal perkiraan yang terlalu kasar untuk tren ${granularity === 'week' ? 'mingguan' : 'bulanan'}${granularity === 'week' ? ' — coba Monthly' : ''}.`
            : trend?.undated ? `${trend.undated} ulasan tidak punya tanggal sehingga tidak masuk tren.` : 'Tren muncul setelah ulasan teks bertanggal dianalisis.')}
        </Empty>
      )}
    </section>
  );
}

const DOMINANT = {
  positive: { label: 'Dominan positif', cls: 'is-positive' },
  negative: { label: 'Dominan negatif', cls: 'is-negative' },
  neutral: { label: 'Dominan netral', cls: 'is-neutral' },
  mixed: { label: 'Campuran', cls: 'is-mixed' },
};

function InsightsSection({ topics, love, improve, onTopic, summaryReady }) {
  return (
    <section className="gr-grid-insights" aria-label="Customer insights">
      <div className="soft-card gr-card gr-topics" data-feature="gr-topics">
        <header className="gr-card-head">
          <div>
            <h2>Key Customer Insights</h2>
            <p>Topik dikelompokkan AI dari isi ulasan; jumlahnya dihitung dari ulasan. Klik topik untuk melihat ulasannya.</p>
          </div>
        </header>
        {topics.length ? (
          <ul className="gr-topic-cards">
            {topics.map((t) => {
              const d = DOMINANT[t.dominant] ?? DOMINANT.neutral;
              const total = t.sentiment.positive + t.sentiment.neutral + t.sentiment.negative;
              return (
                <li key={t.name}>
                  <button type="button" onClick={() => onTopic(t.name)}>
                    <span className="gr-topic-head">
                      <strong>{t.name}</strong>
                      <span className={`gr-pill ${d.cls}`}>{d.label}</span>
                    </span>
                    <span className="gr-topic-count">{fmtInt(t.count)} ulasan menyebut topik ini</span>
                    <span className="gr-split" aria-label={`Positif ${t.sentiment.positive}, netral ${t.sentiment.neutral}, negatif ${t.sentiment.negative}`}>
                      {['positive', 'neutral', 'negative'].map((k) => (t.sentiment[k] ? <i key={k} style={{ flexGrow: t.sentiment[k], background: SENTIMENT[k].color }} title={`${SENTIMENT[k].label}: ${t.sentiment[k]}`} /> : null))}
                    </span>
                    <span className="gr-split-legend">{t.sentiment.positive} positif · {t.sentiment.neutral} netral · {t.sentiment.negative} negatif{total ? '' : ''}</span>
                    {t.insight && <span className="gr-topic-insight">{t.insight}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <Empty title={summaryReady ? 'Belum ada topik yang cukup kuat.' : 'Topik muncul setelah analisis selesai.'} />}
      </div>

      <div className="gr-highlights">
        <Highlight title="What Customers Love" icon={<ThumbsUp size={16} aria-hidden="true" />} tone="positive" items={love} empty="Belum ada pujian yang berulang." />
        <Highlight title="Areas for Improvement" icon={<ThumbsDown size={16} aria-hidden="true" />} tone="negative" items={improve} empty="Tidak ada keluhan yang berulang pada ulasan yang terkumpul." />
      </div>
    </section>
  );
}

function Highlight({ title, icon, tone, items, empty }) {
  return (
    <div className={`soft-card gr-card gr-highlight is-${tone}`}>
      <header className="gr-card-head"><h2>{icon} {title}</h2></header>
      {items.length ? (
        <ol>
          {items.map((f) => (
            <li key={f.title}>
              <div className="gr-hl-head"><strong>{f.title}</strong><span className="gr-muted">{fmtInt(f.count)} ulasan</span></div>
              {f.detail && <p>{f.detail}</p>}
              {f.examples.map((ex) => (
                <blockquote key={ex.id}>
                  “{ex.text.length > 180 ? `${ex.text.slice(0, 180)}…` : ex.text}”
                  <cite>{ex.rating ? `${ex.rating}★ · ` : ''}{fmtDate(ex.date)}</cite>
                </blockquote>
              ))}
            </li>
          ))}
        </ol>
      ) : <p className="gr-muted">{empty}</p>}
    </div>
  );
}

function ExecutiveSummary({ summary, method }) {
  const title = method === 'ai' ? 'AI Executive Summary' : 'Statistical Summary (Code-Based)';
  if (!summary) {
    return (
      <section className="soft-card gr-card" aria-labelledby="gr-exec-title">
        <header className="gr-card-head"><h2 id="gr-exec-title"><Sparkles size={16} aria-hidden="true" /> {title}</h2></header>
        <Empty title={`Ringkasan muncul setelah analisis ${METHOD_LABEL[method]} dijalankan.`} />
      </section>
    );
  }
  const e = summary.executive;
  return (
    <section className="soft-card gr-card gr-exec" aria-labelledby="gr-exec-title" data-feature="gr-summary">
      <header className="gr-card-head">
        <div>
          <h2 id="gr-exec-title"><Sparkles size={16} aria-hidden="true" /> {title}</h2>
          <p>
            {method === 'ai' ? 'Disusun AI' : 'Disusun dari angka dan kata yang terdeteksi, tanpa AI generatif'} pada {fmtDateTime(summary.createdAt)}.
            {summary.stale ? ' Data sudah berubah sejak ringkasan ini dibuat — tekan Run Sentiment Analysis untuk memperbarui.' : ''}
          </p>
        </div>
      </header>
      <div className="gr-exec-grid">
        <div className="gr-exec-block is-wide">
          <h3>Overall Customer Sentiment</h3>
          <p>{e.overall}</p>
        </div>
        <div className="gr-exec-block">
          <h3>Key Strengths</h3>
          {e.strengths.length ? <ul>{e.strengths.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="gr-muted">—</p>}
        </div>
        <div className="gr-exec-block">
          <h3>Main Customer Complaints</h3>
          {e.complaints.length ? <ul>{e.complaints.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="gr-muted">Tidak ada keluhan berulang yang menonjol.</p>}
        </div>
        <div className="gr-exec-block is-wide">
          <h3>Sentiment Trend Overview</h3>
          <p>{e.trend}</p>
        </div>
        {e.actions.length > 0 && (
          <div className="gr-exec-block is-wide">
            <h3>Recommended Next Actions</h3>
            <ol className="gr-actions">
              {e.actions.map((a) => (
                <li key={a.action}><strong>{a.action}</strong>{a.reason && <span>{a.reason}</span>}</li>
              ))}
            </ol>
          </div>
        )}
        {e.limitations.length > 0 && (
          <div className="gr-exec-block is-wide gr-limits">
            <h3>Keterbatasan data</h3>
            <ul>{e.limitations.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="gr-skeleton" aria-busy="true" aria-label="Memuat analisis">
      <div className="gr-stats">{Array.from({ length: 7 }, (_, i) => <div key={i} className="gr-stat"><span className="gr-skel" /><span className="gr-skel is-big" /></div>)}</div>
      <div className="gr-grid-2"><div className="soft-card gr-card"><span className="gr-skel is-block" /></div><div className="soft-card gr-card"><span className="gr-skel is-block" /></div></div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function GoogleReviewsPage() {
  const { isViewOnly } = useAuth();
  const canWrite = !isViewOnly;
  const [params, setParams] = useSearchParams();
  const businessId = Number(params.get('b')) || null;
  // The method every chart reads, kept in the URL so a link opens the same view.
  const method = params.get('m') === 'ai' ? 'ai' : 'code';

  const [sources, setSources] = useState(null);
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [run, setRun] = useState(null);
  const [version, setVersion] = useState(0);
  const [cloudMode, setCloudMode] = useState('overall');
  const [term, setTerm] = useState('');
  const [topic, setTopic] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importVersion, setImportVersion] = useState(0);
  const explorerRef = useRef(null);
  const driving = useRef(null);
  const methodRef = useRef(method);
  methodRef.current = method;

  useEffect(() => {
    api.get('/google-reviews/sources').then(({ data }) => setSources(data)).catch(() => setSources(null));
  }, []);

  const loadDashboard = useCallback(async (id, { quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/google-reviews/businesses/${id}/dashboard`, { params: { method: methodRef.current } });
      setDash(data);
      setVersion((v) => v + 1);
      return data;
    } catch (err) {
      setError(errMsg(err, 'Gagal memuat analisis.'));
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // Step the run until it ends. One loop per run; leaving the page or
  // switching business stops it (the run itself waits on the server).
  const drive = useCallback(async (start) => {
    const token = {};
    driving.current = token;
    let current = start;
    let networkFailures = 0;
    setRun(current);
    while (current?.status === 'running' && driving.current === token) {
      // A step can take a while (a browser visit); meanwhile the run's phase
      // is read every two seconds so the page shows where it is.
      const runId = current.id;
      const poll = setInterval(() => {
        api.get(`/google-reviews/runs/${runId}`).then(({ data }) => {
          if (driving.current === token && data.run.status === 'running') setRun((r) => (r && r.id === runId && r.status === 'running' ? data.run : r));
        }).catch(() => {});
      }, 2000);
      try {
        const { data } = await api.post(`/google-reviews/runs/${current.id}/step`).finally(() => clearInterval(poll));
        networkFailures = 0;
        const prevStage = current.stage;
        current = data.run;
        if (driving.current !== token) return;
        setRun(current);
        // A finished stage is worth showing straight away.
        if (prevStage !== current.stage && current.stage !== 'collect') loadDashboard(current.businessId, { quiet: true });
        if (current.busy) await sleep(3000);
        else if (current.error) await sleep(4000);
      } catch (err) {
        networkFailures += 1;
        if (networkFailures >= 3 || err.response?.status === 404) {
          setRun({ ...current, status: 'failed', error: errMsg(err, 'Koneksi terputus.') });
          return;
        }
        await sleep(3000 * networkFailures);
      }
    }
    if (driving.current === token && current) {
      driving.current = null;
      await loadDashboard(current.businessId, { quiet: true });
    }
  }, [loadDashboard]);

  useEffect(() => {
    driving.current = null;
    setDash(null);
    setRun(null);
    setTerm('');
    setTopic('');
    setShowImport(false);
    if (!businessId) return undefined;
    loadDashboard(businessId).then((data) => {
      // A run left going (tab closed mid-way) is picked up again.
      if (data?.run?.status === 'running' && canWrite) drive(data.run);
      else setRun(data?.run ?? null);
    });
    return () => { driving.current = null; };
  }, [businessId, loadDashboard, drive, canWrite]);

  // Switching method re-reads the dashboard with that method's readings.
  const shownMethod = useRef(method);
  useEffect(() => {
    if (shownMethod.current === method) return;
    shownMethod.current = method;
    setTerm('');
    setTopic('');
    if (businessId) loadDashboard(businessId, { quiet: true });
  }, [method, businessId, loadDashboard]);

  const selectMethod = (m) => setParams(m === 'ai' ? { b: String(businessId), m: 'ai' } : { b: String(businessId) });

  const analyze = async (mode) => {
    setError('');
    try {
      const { data } = await api.post(`/google-reviews/businesses/${businessId}/runs`, { mode, method });
      drive(data.run);
    } catch (err) {
      setError(errMsg(err, 'Gagal memulai analisis.'));
    }
  };

  // Run Sentiment Analysis with the selected method (only what that method
  // has not read yet is read).
  const runAnalysis = async () => {
    setError('');
    try {
      const { data } = await api.post(`/google-reviews/businesses/${businessId}/analysis`, { method });
      drive(data.run);
    } catch (err) {
      setError(errMsg(err, 'Gagal memulai analisis.'));
    }
  };

  // An import finished: open its business, or refresh the one already open
  // and follow its analysis.
  const onImported = (imp) => {
    setImportVersion((v) => v + 1);
    if (imp.businessId !== businessId) { openBusiness(imp.businessId); return; }
    loadDashboard(businessId, { quiet: true });
    if (imp.run?.status === 'running') drive(imp.run);
  };

  const cancel = async () => {
    if (!run) return;
    driving.current = null;
    try {
      const { data } = await api.post(`/google-reviews/runs/${run.id}/cancel`);
      setRun(data.run);
    } catch { /* the next open shows its real state */ }
    loadDashboard(businessId, { quiet: true });
  };

  const openBusiness = (id) => setParams({ b: String(id) });
  const back = () => setParams({});
  const toExplorer = () => requestAnimationFrame(() => explorerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  const pickTerm = (t) => { setTerm((cur) => (cur === t ? '' : t)); toExplorer(); };
  const pickTopic = (t) => { setTopic(t); toExplorer(); };

  const running = run?.status === 'running';
  const hasData = dash && dash.coverage.collected > 0;
  const words = dash?.wordCloud?.[cloudMode] ?? [];

  return (
    <div className="con soft-shell gr-page">
      <div className="soft-frame">
        <PageBand
          kicker="Workspace · Reputasi brand"
          title="Google Reviews Analytics"
          desc="Kumpulkan ulasan Google Maps sebuah bisnis, baca sentimennya dengan AI, dan lihat apa yang paling sering dibicarakan pelanggan."
        />


        {sources?.ready && sources.reviews?.experimental && (
          <div className="gr-coverage" role="note">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <p><strong>Sumber data: {sources.reviews.label}.</strong> Hanya untuk development; cakupannya dijelaskan di tiap bisnis.</p>
              {sources.reviews.signedIn === true && <p>Akun Google: login (daftar ulasan lengkap, urut terbaru).</p>}
              {sources.reviews.signedIn === false && <p>Akun Google: belum login — Google hanya menampilkan ±5 ulasan per bisnis. Jalankan <code>npm run google-reviews:login</code> di folder backend untuk login.</p>}
              {!sources.ai && <p>Model AI belum diset di server ini: ulasan tetap dikumpulkan, tetapi analisis sentimen menunggu ANTHROPIC_API_KEY atau GEMINI_API_KEY.</p>}
            </div>
          </div>
        )}
        {error && <div className="alert alert-error">{error}</div>}

        {!businessId && (
          <>
            <SearchPanel sources={sources} canWrite={canWrite} onOpen={openBusiness} />
            {canWrite && <CsvImport onImported={onImported} />}
            <ImportHistory version={importVersion} onOpenBusiness={openBusiness} />
          </>
        )}

        {businessId && loading && !dash && <Skeleton />}

        {businessId && dash && (
          <>
            <BusinessHeader
              business={dash.business}
              coverage={dash.coverage}
              run={run}
              running={running}
              canWrite={canWrite}
              liveSource={Boolean(sources?.ready)}
              onAnalyze={analyze}
              onBack={back}
              onImport={() => setShowImport((v) => !v)}
            />
            {showImport && canWrite && <CsvImport businessId={businessId} onImported={onImported} onClose={() => setShowImport(false)} />}
            <RunStatus
              run={run}
              onRetry={canWrite ? (run?.mode === 'import' || !sources?.ready ? runAnalysis : () => analyze('incremental')) : null}
              onCancel={canWrite ? cancel : null}
            />
            <DataSource data={dash.dataSource} coverage={dash.coverage} method={method} />
            {hasData && dash.analysis && (
              <MethodPanel
                analysis={{ ...dash.analysis, method }}
                status={dash.dataSource.analysis.status}
                canWrite={canWrite}
                running={running}
                onSelect={selectMethod}
                onRun={runAnalysis}
              />
            )}

            {!hasData ? (
              <section className="soft-card gr-card">
                <Empty title={running ? 'Ulasan sedang dikumpulkan…' : 'Belum ada ulasan untuk bisnis ini.'}>
                  {!running && (canWrite
                    ? (sources?.ready ? 'Tekan Analyze Reviews, atau impor CSV dari ATLAS Google Reviews Exporter.' : 'Impor CSV dari ATLAS Google Reviews Exporter lewat tombol Import CSV.')
                    : 'Belum ada data yang diimpor.')}
                </Empty>
              </section>
            ) : (
              <>
                <Overview business={dash.business} coverage={dash.coverage} sentiment={dash.sentiment} />

                <div className="gr-grid-2">
                  <section className="soft-card gr-card" aria-labelledby="gr-dist-title" data-feature="gr-sentiment">
                    <header className="gr-card-head">
                      <div>
                        <h2 id="gr-dist-title">Sentiment Distribution</h2>
                        <p>Dari {fmtInt(dash.sentiment.analyzed)} ulasan teks yang berhasil dianalisis. Rating only ({fmtInt(dash.sentiment.ratingOnly)}) dan yang gagal ({fmtInt(dash.sentiment.failed)}) tidak dihitung.</p>
                      </div>
                    </header>
                    {dash.sentiment.analyzed ? <SentimentDonut distribution={dash.sentiment} /> : <Empty title="Belum ada ulasan teks yang dianalisis." />}
                  </section>
                  <section className="soft-card gr-card" aria-labelledby="gr-rating-title">
                    <header className="gr-card-head">
                      <div>
                        <h2 id="gr-rating-title">Rating Distribution</h2>
                        <p>{fmtInt(dash.ratings.rated)} ulasan terkumpul yang memiliki rating{dash.ratings.average != null ? ` · rata-rata ${dash.ratings.average.toLocaleString('id-ID')}★` : ''}. Terpisah dari sentimen.</p>
                      </div>
                    </header>
                    {dash.ratings.rated ? <RatingBars ratings={dash.ratings} /> : <Empty title="Belum ada rating." />}
                  </section>
                </div>

                <section className="soft-card gr-card" aria-labelledby="gr-cloud-title" data-feature="gr-wordcloud">
                  <header className="gr-card-head">
                    <div>
                      <h2 id="gr-cloud-title">Customer Language</h2>
                      <p>Kata & frasa yang paling banyak dipakai — ukuran = jumlah ulasan yang menyebutnya. {cloudMode === 'overall' ? 'Warna: hijau cenderung positif, merah cenderung negatif, biru campuran. ' : ''}Klik untuk melihat ulasannya.</p>
                    </div>
                    <Segmented label="Jenis word cloud" value={cloudMode} onChange={setCloudMode} options={CLOUD_MODES} />
                  </header>
                  {words.length
                    ? <WordCloud words={words} mode={cloudMode} onPick={pickTerm} activeTerm={term} />
                    : <Empty title={`Belum ada kata yang cukup sering muncul${cloudMode !== 'overall' ? ` di ulasan ${cloudMode === 'positive' ? 'positif' : 'negatif'}` : ''}.`} />}
                </section>

                <TrendSection businessId={businessId} initial={dash.trend} version={version} method={method} earliest={dash.coverage.earliest} latest={dash.coverage.latest} />

                <InsightsSection topics={dash.topics} love={dash.love} improve={dash.improve} onTopic={pickTopic} summaryReady={Boolean(dash.summary)} />

                <ExecutiveSummary summary={dash.summary} method={method} />

                <ReviewsExplorer
                  ref={explorerRef}
                  businessId={businessId}
                  method={method}
                  earliest={dash.coverage.earliest}
                  latest={dash.coverage.latest}
                  term={term}
                  topic={topic}
                  onClearTerm={() => setTerm('')}
                  onClearTopic={() => setTopic('')}
                  version={version}
                />
              </>
            )}
            <ImportHistory businessId={businessId} version={importVersion + version} />
          </>
        )}

        {run?.status === 'done' && !running && dash?.run?.id === run.id && (
          <p className="gr-done"><CheckCircle2 size={14} aria-hidden="true" /> Analisis selesai {fmtDateTime(run.finishedAt)}.</p>
        )}
      </div>
    </div>
  );
}
