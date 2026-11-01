import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { fetchOverview } from '../google/googleAds';
import { getClients, getReports } from '../reports/api';
import type { ReportListItem } from '../reports/types';
import { periodLabelFromDates } from './format';
import { describePeriod, differingPeriods, lastFinishedMonths, mostCommonPeriod, newestRun, periodKey, runPeriod, samePeriod, validPeriod, type PeriodRange } from './periods';
import type { ChannelKey, Currency, Lang, PresentationConfig, TemplateKey } from './types';

// Step 1. Each channel carries its own period, and is in the deck when it has data.
// Meta, Shopee and TikTok read reports already generated, so their periods are the
// ones listed; Google Ads and Revenue Data are live, so theirs are typed. The deck's
// own period (cover, footer, file name) is whichever most channels use.

type RunChannel = 'meta' | 'shopee' | 'tiktok';
const RUN_CHANNELS: { key: RunChannel; label: string }[] = [
  { key: 'meta', label: 'Meta Ads' },
  { key: 'shopee', label: 'Shopee Ads' },
  { key: 'tiktok', label: 'TikTok GMV Max' },
];

function runLabel(r: ReportListItem): string {
  return `${r.periodCurLabel ?? '?'} vs ${r.periodOldLabel ?? '?'}`;
}

function DateRanges({ name, value, onChange }: { name: string; value: PeriodRange; onChange: (p: PeriodRange) => void }) {
  const input = (key: keyof PeriodRange, label: string) => (
    <input type="date" aria-label={`${name} ${label}`} value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} />
  );
  return (
    <div className="prb-channel-dates">
      <fieldset className="prb-range">
        <legend>Periode laporan</legend>
        {input('curStart', 'periode laporan mulai')}<span>s.d.</span>{input('curEnd', 'periode laporan selesai')}
      </fieldset>
      <fieldset className="prb-range">
        <legend>Pembanding</legend>
        {input('oldStart', 'pembanding mulai')}<span>s.d.</span>{input('oldEnd', 'pembanding selesai')}
      </fieldset>
    </div>
  );
}

export function ConfigStep({ clientId, busy, onBuild }: { clientId: number; busy: boolean; onBuild: (config: PresentationConfig, name: string) => void }) {
  const [brandName, setBrandName] = useState('');
  const [runs, setRuns] = useState<Partial<Record<RunChannel, ReportListItem[]>> | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleLastDate, setGoogleLastDate] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>('id');
  const [template, setTemplate] = useState<TemplateKey>('mil-blue');
  const [currency, setCurrency] = useState<Currency>('IDR');
  const [picked, setPicked] = useState<Partial<Record<RunChannel, number | null>>>({});
  // Null until edited: until then Google and Revenue Data follow the reports' period.
  const [googleOwn, setGoogleOwn] = useState<PeriodRange | null>(null);
  const [businessOwn, setBusinessOwn] = useState<PeriodRange | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRuns(null);
    Promise.all([
      getClients().then((list) => list.find((c) => c.id === clientId)?.name ?? ''),
      Promise.all(RUN_CHANNELS.map(async ({ key }) => [key, await getReports(clientId, key)] as const)),
      fetchOverview(clientId).catch(() => null),
    ]).then(([name, lists, google]) => {
      if (!alive) return;
      setBrandName(name);
      // A report saved without dates has no period to offer.
      setRuns(Object.fromEntries(lists.map(([k, list]) => [k, list.filter((r) => runPeriod(r) !== null).sort((a, b) => (runPeriod(b) as PeriodRange).curEnd.localeCompare((runPeriod(a) as PeriodRange).curEnd) || b.id - a.id)])));
      const accounts = (google?.accounts ?? []) as { currency_code?: string | null; coverage?: { last_date?: string } | null }[];
      setGoogleConnected(accounts.length > 0);
      setGoogleLastDate(accounts.map((a) => a.coverage?.last_date ?? '').sort().pop() || null);
      // ATLAS records a currency only on Google Ads accounts; only Petite Fleur KL
      // reports in ringgit, and its account says so.
      if (accounts.some((a) => a.currency_code === 'MYR')) setCurrency('MYR');
    }).catch((err) => alive && setLoadError((err as Error).message));
    return () => { alive = false; };
  }, [clientId]);

  // Opens on the newest report overall, and each channel on the report for those
  // same dates when it has one, so a fresh deck starts out on one period.
  const anchorRun = useMemo(() => newestRun(RUN_CHANNELS.flatMap(({ key }) => runs?.[key] ?? [])), [runs]);
  const selectedRun = (key: RunChannel): ReportListItem | null => {
    const list = runs?.[key] ?? [];
    const id = picked[key];
    if (id === null) return null;
    if (id !== undefined) return list.find((r) => r.id === id) ?? null;
    if (!list.length) return null;
    const anchor = anchorRun && runPeriod(anchorRun);
    return list.find((r) => anchor && samePeriod(runPeriod(r), anchor)) ?? newestRun(list);
  };

  const runPeriods = RUN_CHANNELS.flatMap(({ key, label }) => {
    const p = runPeriod(selectedRun(key) ?? { periodCurStart: null, periodCurEnd: null, periodOldStart: null, periodOldEnd: null });
    return p ? [{ name: label, period: p }] : [];
  });
  // With no report to follow, the last month Google Ads has complete.
  const fallback = useMemo(() => lastFinishedMonths(googleLastDate && new Date(`${googleLastDate}T00:00:00`) < new Date() ? new Date(new Date(`${googleLastDate}T00:00:00`).getTime() + 86400000) : new Date()), [googleLastDate]);
  const following = mostCommonPeriod(runPeriods.map((p) => p.period)) ?? fallback;
  const googlePeriod = googleOwn ?? following;
  const businessPeriod = businessOwn ?? following;

  const inDeck = [
    ...runPeriods,
    ...(googleConnected ? [{ name: 'Google Ads', period: googlePeriod }] : []),
  ];
  // Revenue Data may turn out empty, so it only counts when nothing else decides.
  const deckPeriod = mostCommonPeriod(inDeck.map((p) => p.period)) ?? businessPeriod;
  const differing = differingPeriods([...inDeck, { name: 'Sales & Channel Revenue', period: businessPeriod }]);
  const datesValid = validPeriod(deckPeriod) && validPeriod(businessPeriod) && (!googleConnected || validPeriod(googlePeriod));

  function submit() {
    const curLabel = periodLabelFromDates(deckPeriod.curStart, deckPeriod.curEnd, lang);
    const oldLabel = periodLabelFromDates(deckPeriod.oldStart, deckPeriod.oldEnd, lang);
    const channels: PresentationConfig['channels'] = {
      meta: { enabled: Boolean(selectedRun('meta')), runId: selectedRun('meta')?.id ?? null },
      shopee: { enabled: Boolean(selectedRun('shopee')), runId: selectedRun('shopee')?.id ?? null },
      tiktok: { enabled: Boolean(selectedRun('tiktok')), runId: selectedRun('tiktok')?.id ?? null },
      google: { enabled: googleConnected, runId: null, period: googlePeriod },
    } satisfies Record<ChannelKey, PresentationConfig['channels'][ChannelKey]>;
    onBuild(
      { brandId: clientId, brandName, lang, tone: 'professional', template, currency, period: { ...deckPeriod, curLabel, oldLabel }, channels, includeBusiness: true, businessPeriod },
      `${brandName} - Monthly Overview - ${curLabel}`,
    );
  }

  if (loadError) return <div className="prb-card prb-error">{loadError}</div>;
  if (!runs) return <div className="prb-card prb-loading"><Loader2 size={18} className="rg-spin" aria-hidden /> Memuat laporan tersimpan…</div>;

  const marks = (name: string) => differing.some((d) => d.name === name);

  return (
    <div className="prb-config">
      <section className="prb-card">
        <h3>Channel & periode</h3>
        <p className="prb-notice"><Info size={15} aria-hidden /> Pilihan periode Meta, Shopee, dan TikTok berasal dari laporan yang sudah pernah di-generate di tab masing-masing. Untuk periode baru, generate dulu laporannya di sana.</p>
        <ul className="prb-channels">
          {RUN_CHANNELS.map(({ key, label }) => {
            const list = runs[key] ?? [];
            const run = selectedRun(key);
            return (
              <li key={key}>
                <span className="prb-channel-name">{label}</span>
                {list.length > 0 ? (
                  <>
                    <select aria-label={`Laporan ${label}`} value={run?.id ?? ''} onChange={(e) => setPicked((p) => ({ ...p, [key]: e.target.value ? Number(e.target.value) : null }))}>
                      <option value="">Tidak dipakai</option>
                      {list.map((r) => <option key={r.id} value={r.id}>{runLabel(r)} · #{r.id}</option>)}
                    </select>
                    {run && marks(label) && <span className="prb-status warn"><AlertTriangle size={14} aria-hidden /> Periode berbeda</span>}
                    {run && !marks(label) && <span className="prb-status ok"><CheckCircle2 size={14} aria-hidden /> Dipakai</span>}
                    {!run && <span className="prb-status">Tidak masuk presentasi</span>}
                  </>
                ) : (
                  <span className="prb-status prb-span2">Belum ada laporan, jadi tidak masuk presentasi. <Link to={`/report-generator/${key}`}>Buat laporannya</Link></span>
                )}
              </li>
            );
          })}
          <li>
            <span className="prb-channel-name">Google Ads</span>
            {googleConnected ? (
              <>
                <DateRanges name="Google Ads" value={googlePeriod} onChange={setGoogleOwn} />
                {marks('Google Ads') ? <span className="prb-status warn"><AlertTriangle size={14} aria-hidden /> Periode berbeda</span> : <span className="prb-status ok"><CheckCircle2 size={14} aria-hidden /> Dipakai</span>}
              </>
            ) : (
              <span className="prb-status prb-span2">Belum ada akun Google Ads terhubung, jadi tidak masuk presentasi.</span>
            )}
          </li>
          <li>
            <span className="prb-channel-name">Sales & Channel Revenue</span>
            <DateRanges name="Sales" value={businessPeriod} onChange={setBusinessOwn} />
            {marks('Sales & Channel Revenue') ? <span className="prb-status warn"><AlertTriangle size={14} aria-hidden /> Periode berbeda</span> : <span className="prb-status">Dipakai bila Revenue Data terisi</span>}
          </li>
        </ul>
        {differing.length > 0 && (
          <div className="prb-period-warning" role="alert">
            <AlertTriangle size={16} aria-hidden />
            <div>
              <b>Periode antarchannel berbeda.</b> Angkanya tidak sebanding satu sama lain, dan total ad spend tidak dihitung.
              <ul>{differing.map((d) => <li key={d.name + periodKey(d.period)}>{d.name}: {describePeriod(d.period)}</li>)}</ul>
            </div>
          </div>
        )}
      </section>

      <section className="prb-card">
        <h3>Format</h3>
        <div className="prb-grid3">
          <label className="prb-field">Bahasa laporan
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}><option value="id">Bahasa Indonesia</option><option value="en">English</option></select>
          </label>
          <label className="prb-field">Template
            <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateKey)}><option value="mil-blue">MIL Digital · Blue</option><option value="mil-light">MIL Digital · Light</option></select>
          </label>
          <label className="prb-field">Mata uang
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}><option value="IDR">IDR (Rp)</option><option value="MYR">MYR (RM)</option></select>
          </label>
        </div>
        <p className="prb-hint">Mata uang hanya mengganti simbol dan format angka. Nilainya tidak dikonversi.</p>
      </section>

      <div className="prb-actions-row">
        {validPeriod(deckPeriod) && <span className="prb-status">Periode presentasi: {describePeriod(deckPeriod)}</span>}
        {!datesValid && <span className="prb-status warn"><AlertTriangle size={14} aria-hidden /> Lengkapi tanggal periode.</span>}
        <button type="button" className="btn btn-primary" disabled={!datesValid || busy || !brandName} onClick={submit}>
          {busy ? <><Loader2 size={15} className="rg-spin" aria-hidden /> Mengambil data ATLAS…</> : 'Susun presentasi'}
        </button>
      </div>
    </div>
  );
}
