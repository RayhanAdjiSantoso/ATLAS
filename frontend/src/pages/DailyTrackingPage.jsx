import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { BadgeDollarSign, CheckCircle2, Eye, Loader2, MessagesSquare, PencilLine, PieChart, Receipt, Target, TriangleAlert, UsersRound } from 'lucide-react';
import api from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import useSessionState from '../hooks/useSessionState.js';
import useActiveBrand from '../hooks/useActiveBrand.js';
import DashboardBrandPicker from '../components/dashboard/DashboardBrandPicker.jsx';
import BrandAvatar from '../components/common/BrandAvatar.jsx';
import MonthPillNav from '../components/dailyTracking/MonthPillNav.jsx';
import TrackingKpis from '../components/dailyTracking/TrackingKpis.jsx';
import TrackingPulse from '../components/dailyTracking/TrackingPulse.jsx';
import CoverageMap from '../components/dailyTracking/CoverageMap.jsx';
import { ChannelMix, PaceChart, WeekdayChart, defaultMetric } from '../components/dailyTracking/TrackingInsights.jsx';
import TrackingCompare from '../components/dailyTracking/TrackingCompare.jsx';
import TargetBudget from '../components/dailyTracking/TargetBudget.jsx';
import AnnualPlan from '../components/annualTarget/AnnualPlan.jsx';
import ChannelRail from '../components/dailyTracking/ChannelRail.jsx';
import ChannelInsight from '../components/dailyTracking/ChannelInsight.jsx';
import DailyEntryTable from '../components/dailyTracking/DailyEntryTable.jsx';
import AddCustomChannelModal from '../components/dailyTracking/AddCustomChannelModal.jsx';
import MetaSyncButton from '../components/dailyTracking/MetaSyncButton.jsx';
import ImportFileButton from '../components/dailyTracking/ImportFileButton.jsx';
import DeleteMonthButton from '../components/dailyTracking/DeleteMonthButton.jsx';
import ChannelActions from '../components/dailyTracking/ChannelActions.jsx';
import DeleteChannelButton from '../components/dailyTracking/DeleteChannelButton.jsx';
import MinutesOfMeeting from '../components/mom/MinutesOfMeeting.jsx';
import useAutoSave from '../dailyTracking/lib/useAutoSave.js';
import { coverage, monthName, shiftMonth, sliceGrid, todayIso } from '../dailyTracking/lib/daily.js';
import { channelTotal, fmtNum, fmtRp, fmtRpShort, sumMaybe, totalForKind } from '../dailyTracking/lib/summary.js';
import { FIXED_SALES_CHANNELS, FIXED_SPEND_CHANNELS, NOTES_SALES_CHANNEL_KEYS } from '../dailyTracking/lib/constants.js';
import '../components/dailyTracking/dailyTracking.css';
import '../components/dailyTracking/brandTracking.css';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Brand Tracking — Brand Setting's third section, and a client's whole ATLAS:
// what a brand sold and spent, per channel, per day. Views under one brand
// and month: Performance Overview reads the month (six numbers against last
// month, any two periods side by side, the daily chart, pace, weekday
// pattern, channel mix); Input Daily Tracking is where the days are typed in,
// led by the map of which days are still empty; Minutes of Meeting keeps the
// brand's meeting notes beside those numbers. MoM carries MIL's internal to
// do list, so client accounts never get that view.
// The frame and masthead are BrandSettingLayout's.
// Session keys keep their old "daily-tracking:" names so nobody's open brand
// and month are lost by the rename.

const VIEWS = [
  { id: 'overview', label: 'Performance Overview', hint: 'Grafik & pembacaan bulan ini', Icon: PieChart },
  { id: 'target', label: 'Target & Budget', hint: 'Target, alokasi & pencapaian', Icon: Target },
  { id: 'input', label: 'Input Daily Tracking', hint: 'Isi revenue & spend harian', Icon: PencilLine },
  { id: 'mom', label: 'Minutes of Meeting', hint: 'Recap & to do list', Icon: UsersRound, internal: true },
];

function SaveState({ status, readOnly }) {
  const values = Object.values(status);
  if (readOnly) return <span className="bt-save is-read"><Eye size={14} aria-hidden="true" /> Mode baca</span>;
  if (values.includes('error')) return <span className="bt-save is-error" role="alert"><TriangleAlert size={14} aria-hidden="true" /> Ada isian yang gagal disimpan</span>;
  if (values.includes('saving')) return <span className="bt-save is-busy" role="status"><Loader2 size={14} className="dt-spin" aria-hidden="true" /> Menyimpan…</span>;
  return <span className="bt-save" role="status"><i aria-hidden="true" /> Tersimpan otomatis</span>;
}

export default function DailyTrackingPage() {
  const { allowedBrandId, isAdmin, isClient, isViewOnly } = useAuth();
  // A client fills in its own revenue; ad spend, import and month deletion
  // stay with the team. Any other view-only account only reads.
  const canEditSales = isClient || !isViewOnly;
  const canEditSpend = !isClient && !isViewOnly;
  // A saved annual split changes this month's target: the monthly view reloads.
  const [targetRefresh, setTargetRefresh] = useState(0);
  const locked = !!allowedBrandId;

  const reduced = useReducedMotion();
  const views = VIEWS.filter((v) => !v.internal || !isClient);
  const [storedView, setView] = useSessionState('daily-tracking:view', 'overview');
  const view = views.some((v) => v.id === storedView) ? storedView : 'overview';
  const [activeTab, setActiveTab] = useSessionState('daily-tracking:tab', 'sales');
  const [brands, setBrands] = useState([]);
  const [storedBrandId, setBrandId] = useActiveBrand();
  // A client account is pinned to its own brand from the first request on,
  // whatever an earlier session left behind.
  const brandId = locked ? allowedBrandId : storedBrandId;
  const [brandStatus, setBrandStatus] = useSessionState('daily-tracking:brand-status', 'active');
  const [month, setMonth] = useSessionState('daily-tracking:month', currentMonth());
  const [activeSalesTab, setActiveSalesTab] = useSessionState('daily-tracking:sales-tab', FIXED_SALES_CHANNELS[0].key);
  const [activeSpendTab, setActiveSpendTab] = useSessionState('daily-tracking:spend-tab', FIXED_SPEND_CHANNELS[0].key);
  const [channels, setChannels] = useState({ sales: [], spend: [] });
  const [grid, setGrid] = useState({ days: [], sales: {}, spend: {}, leads: {} });
  const [prevGrid, setPrevGrid] = useState({ days: [], sales: {}, spend: {} });
  const [loading, setLoading] = useState(false);
  const [modalKind, setModalKind] = useState(null); // 'sales' | 'spend' | null
  const [loadError, setLoadError] = useState('');
  const [focusDate, setFocusDate] = useState(null);
  const workRef = useRef(null);

  // Brands list — GET /brands already filters server-side by allowedBrandId
  // (brandService.listBrands), so a client account only ever sees its own.
  useEffect(() => {
    api.get('/brands').then((res) => {
      const list = res.data.brands || [];
      setBrands(list);
      if (locked) {
        setBrandId(allowedBrandId);
      } else {
        // A brand remembered from an earlier session that this account may no
        // longer open (its brand list changed) falls back like a first visit.
        setBrandId((prev) => (list.some((b) => b.brand_id === prev) ? prev : (list.find((b) => b.status === 'active') ?? list[0])?.brand_id ?? null));
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadChannels = useCallback(() => {
    if (!brandId) return;
    api.get('/daily-tracking/channels', { params: { brandId } })
      .then((res) => setChannels(res.data))
      .catch(() => {});
  }, [brandId]);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  const loadEntries = useCallback(() => {
    if (!brandId || !month) return;
    setLoading(true);
    api.get('/daily-tracking/entries', { params: { brandId, month } })
      .then((res) => { setGrid(res.data); setLoadError(''); })
      .catch(() => setLoadError('Gagal memuat data Brand Tracking'))
      .finally(() => setLoading(false));
  }, [brandId, month]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // Last month, for every comparison in Performance Overview. Read-only, so it
  // loads once per brand/month and never blocks the sheet.
  useEffect(() => {
    if (!brandId || !month) return undefined;
    let alive = true;
    setPrevGrid({ days: [], sales: {}, spend: {} });
    api.get('/daily-tracking/entries', { params: { brandId, month: shiftMonth(month, -1) } })
      .then((res) => alive && setPrevGrid(res.data))
      .catch(() => {});
    return () => { alive = false; };
  }, [brandId, month]);

  const saveRow = useCallback(async (_key, payload) => {
    await api.put('/daily-tracking/entries', payload);
  }, []);
  const { schedule, status: saveStatus } = useAutoSave(saveRow);

  const onCellChange = (kind, channelKey, date, field, value) => {
    // Leads Data is one row per day, no channels; the row is saved whole so
    // clearing a cell clears it in the database too.
    if (kind === 'leads') {
      setGrid((g) => {
        const row = { ...(g.leads?.[date] || {}), [field]: value };
        schedule(`leads:${channelKey}:${date}`, {
          brandId, entryDate: date,
          leads: { coldLeads: row.coldLeads ?? null, deals: row.deals ?? null, dealValue: row.dealValue ?? null },
        });
        return { ...g, leads: { ...(g.leads || {}), [date]: row } };
      });
      return;
    }
    setGrid((g) => {
      const kindGrid = { ...(g[kind] || {}) };
      const channelGrid = { ...(kindGrid[channelKey] || {}) };
      const row = { ...(channelGrid[date] || {}), [field]: value };
      channelGrid[date] = row;
      kindGrid[channelKey] = channelGrid;

      const saveKey = `${kind}:${channelKey}:${date}`;
      if (kind === 'sales') {
        schedule(saveKey, {
          brandId, entryDate: date,
          sales: [{
            channelKey, revenue: row.revenue, transaksi: row.transaksi, qtySold: row.qtySold,
            // Only channels that show a Notes cell send it, so saving any other
            // channel never touches stored notes.
            ...(NOTES_SALES_CHANNEL_KEYS.includes(channelKey) ? { notes: row.notes ?? null } : {}),
          }],
        });
      } else {
        schedule(saveKey, {
          brandId, entryDate: date,
          spend: [{ channelKey, amount: row.amount }],
        });
      }

      return { ...g, [kind]: kindGrid };
    });
  };

  // After a custom channel is deleted or moved: reload channels + this month,
  // and point the section that lost it at its first channel.
  // The channel that left its list falls back to the list's first (activeKey).
  const handleChannelChanged = ({ toKind, movedKey }) => {
    if (movedKey && toKind) {
      if (toKind === 'sales') setActiveSalesTab(movedKey); else setActiveSpendTab(movedKey);
    }
    loadChannels();
    loadEntries();
  };

  const handleAddChannel = async (kind, label) => {
    const res = await api.post('/daily-tracking/channels', { brandId, kind, label });
    setChannels((c) => ({ ...c, [kind]: [...c[kind], res.data.channel] }));
    if (kind === 'sales') setActiveSalesTab(res.data.channel.key);
    else setActiveSpendTab(res.data.channel.key);
  };

  // From the fill map: open that channel's sheet, and that day in it.
  const jump = (kind, key, date) => {
    setView('input');
    setActiveTab(kind);
    if (kind === 'sales') setActiveSalesTab(key); else setActiveSpendTab(key);
    if (date) setFocusDate(date);
    else workRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const clearFocus = useCallback(() => setFocusDate(null), []);

  const cov = useMemo(() => coverage(grid, channels, grid.days || [], todayIso()), [grid, channels]);

  // A running month is compared with the same days of the month before, up
  // to yesterday — today is still being sold and spend lands H-1.
  const today = todayIso();
  const running = month === today.slice(0, 7);
  const prevMonth = shiftMonth(month, -1);
  const upTo = Math.max(Number(today.slice(8)) - 1, 1);
  const prevSame = useMemo(() => (running ? sliceGrid(prevGrid, upTo) : prevGrid), [running, prevGrid, upTo]);
  const compareLabel = running ? `1–${upTo} ${monthName(prevMonth)}` : monthName(prevMonth);

  if (!brandId) {
    return <div className="bt-page dt-page"><p className="bt-wait"><Loader2 size={15} className="dt-spin" /> Memuat daftar klien…</p></div>;
  }

  const leadsTab = activeTab === 'leads';
  const sales = activeTab === 'sales';
  const kind = sales ? 'sales' : 'spend';
  // A remembered channel this brand no longer has (deleted, moved, or a
  // built-in one hidden) falls back to the first in the list.
  const pickedKey = sales ? activeSalesTab : activeSpendTab;
  const activeKey = channels[kind].length && !channels[kind].some((c) => c.key === pickedKey) ? channels[kind][0].key : pickedKey;
  const setActiveKey = sales ? setActiveSalesTab : setActiveSpendTab;
  const channel = channels[kind].find((c) => c.key === activeKey);
  const canEdit = sales ? canEditSales : canEditSpend;
  const brandName = brands.find((b) => b.brand_id === brandId)?.brand_name ?? 'klien ini';
  // The picked channel in four numbers, above its sheet.
  const chCov = cov.rows.find((r) => r.kind === kind && r.key === activeKey);
  const chTotal = (field) => channelTotal(grid, kind, activeKey, field);
  const filledLabel = cov.due ? `${chCov?.filledDue ?? 0}/${cov.due} hari` : '—';
  const filledTone = chCov?.used && cov.due && chCov.filledDue < cov.due ? 'gap' : undefined;
  const sheetStats = sales
    ? [
      { label: 'Total Revenue', value: fmtRp(chTotal('revenue')) },
      { label: 'Total Transactions', value: fmtNum(chTotal('transaksi')) },
      { label: 'Total Quantity Sold', value: fmtNum(chTotal('qtySold')) },
      { label: 'Terisi', value: filledLabel, tone: filledTone },
    ]
    : [
      { label: 'Total Ad Spend', value: fmtRp(chTotal('amount')) },
      { label: 'Avg. Daily Spend', value: chCov?.filled ? fmtRpShort(chTotal('amount') / chCov.filled) : '—' },
      { label: 'Terisi', value: filledLabel, tone: filledTone },
    ];
  // Leads Data: chats and deals of a brand that sells through leads.
  const leadTotal = (field) => sumMaybe((grid.days || []).map((d) => grid.leads?.[d]?.[field]));
  const leadStats = [
    { label: 'Cold Leads', value: fmtNum(leadTotal('coldLeads')) },
    { label: 'Deal', value: fmtNum(leadTotal('deals')) },
    { label: 'Message → Deal', value: leadTotal('coldLeads') ? `${((leadTotal('deals') ?? 0) / leadTotal('coldLeads') * 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%` : '—' },
    { label: 'Nilai Deal', value: leadTotal('dealValue') != null ? fmtRpShort(leadTotal('dealValue')) : '—' },
  ];
  const sectionTabs = [
    { kind: 'sales', label: 'Revenue Data', Icon: Receipt, sub: `${channels.sales.length} channel · ${fmtRpShort(totalForKind(grid, channels, 'sales', 'revenue'))}` },
    { kind: 'spend', label: 'Spending Data', Icon: BadgeDollarSign, sub: `${channels.spend.length} channel · ${fmtRpShort(totalForKind(grid, channels, 'spend', 'amount'))}` },
    { kind: 'leads', label: 'Leads Data', Icon: MessagesSquare, sub: `${fmtNum(leadTotal('coldLeads') ?? 0)} leads · ${fmtNum(leadTotal('deals') ?? 0)} deal` },
  ];

  return (
    <div className="bt-page dt-page">
      <section className="soft-card bp-command bt-command" aria-label="Brand dan periode">
        {/* Laid out like the Report Generator's brand field: the logo beside
            the label and the picker. */}
        <div className="bt-command-brand">
          <BrandAvatar brand={brands.find((b) => b.brand_id === brandId)} />
          <div className="bp-command-brand">
            <label className="bp-label" htmlFor="dt-brand">Brand</label>
            <DashboardBrandPicker
              id="dt-brand"
              brands={brands}
              value={brandId}
              onChange={setBrandId}
              status={brandStatus}
              onStatusChange={setBrandStatus}
              placeholder="Pilih klien…"
              resultHint="Pilih untuk membuka Brand Tracking"
              disabled={locked}
            />
          </div>
        </div>
        <div className="bt-command-month">
          <span className="bp-label">Periode</span>
          <MonthPillNav month={month} onChange={setMonth} />
        </div>
        <div className="bt-command-state">
          <SaveState status={saveStatus} readOnly={!canEditSales && !canEditSpend} />
          {cov.ratio === 1 && (
            <span className="bt-save is-complete" title="Setiap channel yang dipakai bulan ini sudah terisi sampai kemarin">
              <CheckCircle2 size={14} aria-hidden="true" /> Channel aktif terisi
            </span>
          )}
        </div>
      </section>

      {loadError && <div className="alert alert-error">{loadError}</div>}

      <nav className="soft-tabs bt-views" aria-label="Tampilan Brand Tracking" role="tablist">
        {views.map(({ id, label, hint, Icon }) => {
          const on = view === id;
          return (
            <button type="button" role="tab" key={id} data-view={id} aria-selected={on} className={`soft-tab${on ? ' is-on' : ''}`} onClick={() => setView(id)}>
              {on && (
                <motion.span
                  layoutId="bt-view-pill" className="soft-tab-pill" aria-hidden="true"
                  transition={reduced ? { duration: 0 } : { type: 'spring', duration: 0.4, bounce: 0.12 }}
                />
              )}
              <span className="soft-tab-ico" aria-hidden="true"><Icon size={17} /></span>
              <span className="soft-tab-text"><strong>{label}</strong><small>{hint}</small></span>
            </button>
          );
        })}
      </nav>

      {view === 'mom' ? (
        <div className="bt-view" key="mom">
          <MinutesOfMeeting brand={brands.find((b) => b.brand_id === brandId) ?? { brand_id: brandId }} />
        </div>
      ) : view === 'target' ? (
        <div className="bt-view" key="target">
          <AnnualPlan brandId={brandId} month={month} canEdit={canEditSpend} onSaved={() => setTargetRefresh((n) => n + 1)} />
          <TargetBudget brandId={brandId} month={month} grid={grid} channels={channels} canEdit={canEditSpend} refreshKey={targetRefresh} />
        </div>
      ) : view === 'overview' ? (
        <div className="bt-view" key="overview">
          <TrackingKpis grid={grid} channels={channels} loading={loading} prev={prevSame} compareLabel={compareLabel} />
          <p className="bt-compare-note">Perubahan dibanding <b>{compareLabel}</b>{running ? ' — rentang tanggal yang sama, karena bulan ini masih berjalan.' : '.'}</p>
          <TrackingCompare brandId={brandId} channels={channels} month={month} />
          <TrackingPulse grid={grid} channels={channels} loading={loading} />
          <div className="bt-duo">
            <PaceChart
              key={`pace:${brandId}:${month}:${defaultMetric(grid, channels)}`}
              grid={grid} prevGrid={prevGrid} channels={channels} month={month} prevMonth={prevMonth} running={running}
              initialMetric={defaultMetric(grid, channels)}
            />
            <WeekdayChart key={`week:${brandId}:${month}:${defaultMetric(grid, channels)}`} grid={grid} channels={channels} initialMetric={defaultMetric(grid, channels)} />
          </div>
          <ChannelMix grid={grid} prevSame={prevSame} channels={channels} prevMonth={prevMonth} />
        </div>
      ) : (
        <div className="bt-view" key="input">
          <CoverageMap grid={grid} channels={channels} onJump={jump} />
          <section className="soft-card bt-work" ref={workRef} aria-label="Input harian">
            <header className="bt-work-head">
              <div className="bt-seg" role="tablist" aria-label="Jenis data">
                {sectionTabs.map((t) => (
                  <button
                    key={t.kind}
                    type="button"
                    role="tab"
                    id={`dt-tab-${t.kind}`}
                    aria-selected={activeTab === t.kind}
                    aria-controls="dt-panel"
                    className={`bt-seg-btn${activeTab === t.kind ? ' is-on' : ''}`}
                    onClick={() => setActiveTab(t.kind)}
                  >
                    <span className="bt-seg-ico"><t.Icon size={16} aria-hidden="true" /></span>
                    <span className="bt-seg-text">
                      <strong>{t.label}</strong>
                      <small>{t.sub}</small>
                    </span>
                  </button>
                ))}
              </div>
              {canEditSpend && (
                <div className="bt-tools">
                  <ImportFileButton brandId={brandId} onImported={() => { loadChannels(); loadEntries(); }} />
                  <DeleteMonthButton brandId={brandId} brandName={brandName} month={month} onDeleted={loadEntries} />
                </div>
              )}
            </header>

            {leadsTab ? (
              <div className="bt-work-body is-leads" role="tabpanel" id="dt-panel" aria-labelledby="dt-tab-leads">
                <div className="bt-sheet">
                  <div className="bt-sheet-body">
                    <DailyEntryTable
                      kind="leads" channelKey="all" days={grid.days}
                      data={grid.leads}
                      onCellChange={(date, field, value) => onCellChange('leads', 'all', date, field, value)}
                      saveStatus={saveStatus}
                      readOnly={!canEditSales}
                      focusDate={focusDate}
                      onFocusDone={clearFocus}
                      header={(
                        <div className="bt-sheet-head">
                          <div className="bt-sheet-title">
                            <h3>Leads &amp; Deal</h3>
                            <span className="bt-sheet-hint">
                              {canEditSales
                                ? 'Cold Leads = chat masuk (Message Started). Nilai deal opsional — dipakai sebagai GMV di Root Cause Analysis Meta Non Retail.'
                                : 'Hanya dapat dibaca untuk akun ini'}
                            </span>
                          </div>
                          <dl className="bt-sheet-stats">
                            {leadStats.map((st) => (
                              <div key={st.label}>
                                <dt>{st.label}</dt>
                                <dd>{st.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="bt-work-body" role="tabpanel" id="dt-panel" aria-labelledby={`dt-tab-${activeTab}`}>
                <ChannelRail
                  kind={kind} grid={grid} channels={channels} coverage={cov}
                  activeKey={activeKey} onSelect={setActiveKey}
                  onAdd={canEdit ? () => setModalKind(kind) : undefined}
                  deleteAction={canEditSpend && <DeleteChannelButton brandId={brandId} kind={kind} channel={channel} onDeleted={handleChannelChanged} />}
                />
                <div className="bt-sheet">
                  <div className="bt-sheet-body">
                    <DailyEntryTable
                      kind={kind} channelKey={activeKey} days={grid.days}
                      data={grid[kind][activeKey]}
                      onCellChange={(date, field, value) => onCellChange(kind, activeKey, date, field, value)}
                      saveStatus={saveStatus}
                      readOnly={!canEdit}
                      focusDate={focusDate}
                      onFocusDone={clearFocus}
                      header={(
                        <div className="bt-sheet-head">
                          <div className="bt-sheet-title">
                            <h3>{channel?.label ?? 'Pilih channel'}</h3>
                            <span className="bt-sheet-hint">
                              {canEdit
                                ? <><kbd>Enter</kbd> turun · <kbd>Shift</kbd> <kbd>Enter</kbd> naik</>
                                : 'Hanya dapat dibaca untuk akun ini'}
                            </span>
                          </div>
                          <dl className="bt-sheet-stats">
                            {sheetStats.map((st) => (
                              <div key={st.label} className={st.tone ? `is-${st.tone}` : undefined}>
                                <dt>{st.label}</dt>
                                <dd>{st.value}</dd>
                              </div>
                            ))}
                          </dl>
                          {canEditSpend && <ChannelActions brandId={brandId} kind={kind} channel={channel} onChanged={handleChannelChanged} />}
                          {!sales && isAdmin && canEditSpend && <div className="bt-sheet-sync"><MetaSyncButton brandId={brandId} onSynced={loadEntries} /></div>}
                        </div>
                      )}
                    />
                    <ChannelInsight
                      kind={kind} channel={channel} days={grid.days}
                      data={grid[kind][activeKey]} prevData={prevSame[kind]?.[activeKey]}
                      prevMonthLabel={compareLabel} onFocusDate={setFocusDate}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {modalKind && (
        <AddCustomChannelModal
          kind={modalKind}
          onClose={() => setModalKind(null)}
          onSubmit={(label) => handleAddChannel(modalKind, label)}
        />
      )}
    </div>
  );
}
