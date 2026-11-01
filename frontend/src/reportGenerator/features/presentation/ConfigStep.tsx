import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { fetchOverview } from '../google/googleAds';
import { getClients, getReports } from '../reports/api';
import type { ReportListItem } from '../reports/types';
import { periodLabelFromDates } from './format';
import { CHANNEL_KEYS, type ChannelKey, type Currency, type Lang, type PresentationConfig, type TemplateKey, type Tone } from './types';

// Step 1. Reports are chosen from what this brand has already saved, the same
// runs Riwayat Laporan lists; a channel with no report for the period says so and
// links to the tab that makes one, instead of showing empty slides later.

const CHANNEL_LABEL: Record<ChannelKey, string> = { meta: 'Meta Ads', shopee: 'Shopee Ads', tiktok: 'TikTok GMV Max', google: 'Google Ads' };
type RunsByChannel = Partial<Record<ChannelKey, ReportListItem[]>>;

interface PeriodOption {
  key: string;
  curStart: string;
  curEnd: string;
  oldStart: string;
  oldEnd: string;
  label: string;
}

function periodKey(r: Pick<ReportListItem, 'periodCurStart' | 'periodCurEnd' | 'periodOldStart' | 'periodOldEnd'>): string {
  return [r.periodCurStart, r.periodCurEnd, r.periodOldStart, r.periodOldEnd].join('|');
}

function matchRun(runs: ReportListItem[] | undefined, c: Pick<PresentationConfig['period'], 'curStart' | 'curEnd' | 'oldStart' | 'oldEnd'>): ReportListItem | undefined {
  return runs?.find((r) => r.periodCurStart === c.curStart && r.periodCurEnd === c.curEnd && r.periodOldStart === c.oldStart && r.periodOldEnd === c.oldEnd);
}

function lastFinishedMonths(today: Date) {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const month = (back: number) => [new Date(today.getFullYear(), today.getMonth() - back, 1), new Date(today.getFullYear(), today.getMonth() - back + 1, 0)];
  const [curStart, curEnd] = month(1);
  const [oldStart, oldEnd] = month(2);
  return { curStart: iso(curStart), curEnd: iso(curEnd), oldStart: iso(oldStart), oldEnd: iso(oldEnd) };
}

function runLabel(r: ReportListItem): string {
  return `${r.periodCurLabel ?? '?'} vs ${r.periodOldLabel ?? '?'}`;
}

export function ConfigStep({ clientId, busy, onBuild }: { clientId: number; busy: boolean; onBuild: (config: PresentationConfig, name: string) => void }) {
  const [brandName, setBrandName] = useState('');
  const [runs, setRuns] = useState<RunsByChannel | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [lang, setLang] = useState<Lang>('id');
  const [tone, setTone] = useState<Tone>('professional');
  const [template, setTemplate] = useState<TemplateKey>('mil-blue');
  const [currency, setCurrency] = useState<Currency>('IDR');
  const [curStart, setCurStart] = useState('');
  const [curEnd, setCurEnd] = useState('');
  const [oldStart, setOldStart] = useState('');
  const [oldEnd, setOldEnd] = useState('');
  const [enabled, setEnabled] = useState<Record<ChannelKey, boolean>>({ meta: false, shopee: false, tiktok: false, google: false });
  const [picked, setPicked] = useState<Partial<Record<ChannelKey, number | null>>>({});
  const [includeBusiness, setIncludeBusiness] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRuns(null);
    Promise.all([
      getClients().then((list) => list.find((c) => c.id === clientId)?.name ?? ''),
      Promise.all((['meta', 'shopee', 'tiktok'] as const).map(async (k) => [k, await getReports(clientId, k)] as const)),
      fetchOverview(clientId).catch(() => null),
    ]).then(([name, lists, google]) => {
      if (!alive) return;
      setBrandName(name);
      setRuns(Object.fromEntries(lists));
      const accounts = (google?.accounts ?? []) as { currency_code?: string | null }[];
      setGoogleConnected(accounts.length > 0);
      // ATLAS records a currency only on Google Ads accounts; other brands start
      // on rupiah and can change it here.
      if (accounts.some((a) => a.currency_code === 'MYR')) setCurrency('MYR');
    }).catch((err) => alive && setLoadError((err as Error).message));
    return () => { alive = false; };
  }, [clientId]);

  const options = useMemo<PeriodOption[]>(() => {
    const seen = new Map<string, PeriodOption>();
    for (const list of Object.values(runs ?? {})) {
      for (const r of list ?? []) {
        if (!r.periodCurStart || !r.periodCurEnd || !r.periodOldStart || !r.periodOldEnd) continue;
        const key = periodKey(r);
        if (!seen.has(key)) seen.set(key, { key, curStart: r.periodCurStart, curEnd: r.periodCurEnd, oldStart: r.periodOldStart, oldEnd: r.periodOldEnd, label: runLabel(r) });
      }
    }
    return [...seen.values()].sort((a, b) => b.curEnd.localeCompare(a.curEnd));
  }, [runs]);

  function applyPeriod(o: Pick<PeriodOption, 'curStart' | 'curEnd' | 'oldStart' | 'oldEnd'>) {
    setCurStart(o.curStart);
    setCurEnd(o.curEnd);
    setOldStart(o.oldStart);
    setOldEnd(o.oldEnd);
    setPicked({});
    setEnabled({
      meta: Boolean(matchRun(runs?.meta, o)),
      shopee: Boolean(matchRun(runs?.shopee, o)),
      tiktok: Boolean(matchRun(runs?.tiktok, o)),
      google: googleConnected,
    });
  }

  // Opens on the latest period the brand has a saved report for; a brand with none
  // (Google Ads only) opens on the last finished month against the one before.
  useEffect(() => {
    if (!runs || curStart) return;
    if (options[0]) applyPeriod(options[0]);
    else applyPeriod(lastFinishedMonths(new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, options]);

  const period = { curStart, curEnd, oldStart, oldEnd };
  const datesValid = Boolean(curStart && curEnd && oldStart && oldEnd && curStart <= curEnd && oldStart <= oldEnd);
  const selectedRun = (key: ChannelKey): number | null => {
    if (key === 'google') return null;
    if (picked[key] !== undefined) return picked[key] ?? null;
    return matchRun(runs?.[key], period)?.id ?? null;
  };
  const anySource = CHANNEL_KEYS.some((k) => enabled[k]) || includeBusiness;

  function submit() {
    const curLabel = periodLabelFromDates(curStart, curEnd, lang);
    const oldLabel = periodLabelFromDates(oldStart, oldEnd, lang);
    const channels = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, { enabled: enabled[k], runId: selectedRun(k) }])) as PresentationConfig['channels'];
    onBuild(
      { brandId: clientId, brandName, lang, tone, template, currency, period: { curStart, curEnd, curLabel, oldStart, oldEnd, oldLabel }, channels, includeBusiness },
      `${brandName} - Monthly Overview - ${curLabel}`,
    );
  }

  if (loadError) return <div className="prb-card prb-error">{loadError}</div>;
  if (!runs) return <div className="prb-card prb-loading"><Loader2 size={18} className="rg-spin" aria-hidden /> Memuat laporan tersimpan…</div>;

  return (
    <div className="prb-config">
      <section className="prb-card">
        <h3>Periode laporan</h3>
        {options.length > 0 && (
          <div className="prb-chips" role="group" aria-label="Periode dari laporan tersimpan">
            {options.slice(0, 8).map((o) => (
              <button key={o.key} type="button" className={`prb-chip${o.curStart === curStart && o.curEnd === curEnd && o.oldStart === oldStart && o.oldEnd === oldEnd ? ' is-on' : ''}`} onClick={() => applyPeriod(o)}>{o.label}</button>
            ))}
          </div>
        )}
        <div className="prb-grid2">
          <fieldset className="prb-range">
            <legend>Report period</legend>
            <input type="date" aria-label="Report period mulai" value={curStart} onChange={(e) => setCurStart(e.target.value)} />
            <span>s.d.</span>
            <input type="date" aria-label="Report period selesai" value={curEnd} onChange={(e) => setCurEnd(e.target.value)} />
          </fieldset>
          <fieldset className="prb-range">
            <legend>Comparison period</legend>
            <input type="date" aria-label="Comparison period mulai" value={oldStart} onChange={(e) => setOldStart(e.target.value)} />
            <span>s.d.</span>
            <input type="date" aria-label="Comparison period selesai" value={oldEnd} onChange={(e) => setOldEnd(e.target.value)} />
          </fieldset>
        </div>
      </section>

      <section className="prb-card">
        <h3>Channel & sumber data</h3>
        <ul className="prb-channels">
          {CHANNEL_KEYS.map((key) => {
            const list = runs[key] ?? [];
            const run = selectedRun(key);
            const chosen = list.find((r) => r.id === run);
            const exact = chosen ? periodKey(chosen) === [curStart, curEnd, oldStart, oldEnd].join('|') : false;
            return (
              <li key={key} className={enabled[key] ? 'is-on' : ''}>
                <label className="prb-check">
                  <input type="checkbox" checked={enabled[key]} onChange={(e) => setEnabled((p) => ({ ...p, [key]: e.target.checked }))} />
                  {CHANNEL_LABEL[key]}
                </label>
                {key === 'google' ? (
                  <span className={`prb-status ${googleConnected ? 'ok' : 'warn'}`}>
                    {googleConnected ? <><CheckCircle2 size={14} aria-hidden /> Akun terhubung, data mengikuti tanggal di atas</> : <><AlertTriangle size={14} aria-hidden /> Belum ada akun Google Ads terhubung</>}
                  </span>
                ) : (
                  <>
                    <select aria-label={`Laporan ${CHANNEL_LABEL[key]}`} value={run ?? ''} onChange={(e) => setPicked((p) => ({ ...p, [key]: e.target.value ? Number(e.target.value) : null }))}>
                      <option value="">{list.length ? 'Tidak memakai laporan' : 'Belum ada laporan tersimpan'}</option>
                      {list.map((r) => <option key={r.id} value={r.id}>{runLabel(r)} · #{r.id}</option>)}
                    </select>
                    {enabled[key] && !run && <span className="prb-status warn"><AlertTriangle size={14} aria-hidden /> Data not available. <a href={`/report-generator/${key}`}>Buat laporannya</a></span>}
                    {enabled[key] && run && !exact && <span className="prb-status warn"><AlertTriangle size={14} aria-hidden /> Periodenya berbeda dari periode presentasi</span>}
                    {enabled[key] && run && exact && <span className="prb-status ok"><CheckCircle2 size={14} aria-hidden /> Periode cocok</span>}
                  </>
                )}
              </li>
            );
          })}
          <li className={includeBusiness ? 'is-on' : ''}>
            <label className="prb-check">
              <input type="checkbox" checked={includeBusiness} onChange={(e) => setIncludeBusiness(e.target.checked)} />
              Sales & Channel Revenue
            </label>
            <span className="prb-status">Dari Brand Tracking › Revenue Data, bila sudah diisi</span>
          </li>
        </ul>
      </section>

      <section className="prb-card">
        <h3>Format</h3>
        <div className="prb-grid4">
          <label className="prb-field">Bahasa laporan
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}><option value="id">Bahasa Indonesia</option><option value="en">English</option></select>
          </label>
          <label className="prb-field">Template
            <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateKey)}><option value="mil-blue">MIL Digital · Blue</option><option value="mil-light">MIL Digital · Light</option></select>
          </label>
          <label className="prb-field">Mata uang
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}><option value="IDR">IDR (Rp)</option><option value="MYR">MYR (RM)</option></select>
          </label>
          <label className="prb-field">Nada narasi AI
            <select value={tone} onChange={(e) => setTone(e.target.value as Tone)}><option value="professional">Professional</option><option value="concise">Concise</option><option value="analytical">Analytical</option></select>
          </label>
        </div>
        <p className="prb-hint">Mata uang hanya mengganti simbol dan format angka. Nilainya tidak dikonversi.</p>
      </section>

      <div className="prb-actions-row">
        {!datesValid && <span className="prb-status warn"><AlertTriangle size={14} aria-hidden /> Lengkapi kedua periode.</span>}
        <button type="button" className="btn btn-primary" disabled={!datesValid || !anySource || busy || !brandName} onClick={submit}>
          {busy ? <><Loader2 size={15} className="rg-spin" aria-hidden /> Mengambil data ATLAS…</> : 'Susun presentasi'}
        </button>
      </div>
    </div>
  );
}
