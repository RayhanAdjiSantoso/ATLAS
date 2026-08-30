import { DownloadPdfButton } from '../../components/DownloadPdfButton';
import { KpiTable } from '../../components/KpiTable';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { BIZ_INPUT_CHANNELS, bizAOV, bizAUR, bizBasket, fmtBizDec, fmtBizNum, fmtBizRp, formatBizInputValue, parseBizInputValue, type BizChannelMetrics, type BizMetricKey, type BizMetricPair, type BizPeriod, type BizRow, type BizState } from '../../lib/business';
import { buildCalcRows, buildChannelRows } from './businessRows';

function formatGeneratedDate(): string {
  return new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface BusinessTabProps {
  isActive: boolean;
  channelData: Record<string, BizChannelMetrics>;
  offlineStores: BizRow[];
  otherChannels: BizRow[];
  shopeeOmzet: BizMetricPair;
  onChannelDataChange: (chKey: string, metric: BizMetricKey, period: BizPeriod, v: number | null) => void;
  onOfflineStoresChange: (rows: BizRow[]) => void;
  onOtherChannelsChange: (rows: BizRow[]) => void;
  nextRowId: () => number;
}

// The "Channel" header spans both header rows visually via two stacked cells
// instead of a native `rowSpan` — html2canvas (used for PDF/PNG export) has a
// long-standing bug that corrupts column widths and text position on
// rowSpan'd cells, which was clipping the input values below it.
function BizInputTableHead() {
  return (
    <thead>
      <tr className="biz-group-row">
        <th>Channel</th>
        <th colSpan={2} className="biz-col-revenue">
          Revenue (Rp)
        </th>
        <th colSpan={2} className="biz-col-tx">
          Transaksi
        </th>
        <th colSpan={2} className="biz-col-qty">
          Qty Terjual
        </th>
      </tr>
      <tr className="biz-sub-row">
        <th></th>
        <th className="biz-col-revenue">Lalu</th>
        <th className="biz-col-revenue">Ini</th>
        <th className="biz-col-tx">Lalu</th>
        <th className="biz-col-tx">Ini</th>
        <th className="biz-col-qty">Lalu</th>
        <th className="biz-col-qty">Ini</th>
      </tr>
    </thead>
  );
}

const METRIC_GROUP_CLASS: Record<BizMetricKey, string> = { revenue: 'biz-col-revenue', transactions: 'biz-col-tx', qty: 'biz-col-qty' };

interface BizInputRowProps {
  name: string;
  nameEditable: boolean;
  onNameChange?: (v: string) => void;
  onRemove?: () => void;
  data: BizChannelMetrics;
  onChange: (metric: BizMetricKey, period: BizPeriod, v: number | null) => void;
  placeholders?: Partial<Record<BizMetricKey, BizMetricPair>>;
}

function BizInputRowView({ name, nameEditable, onNameChange, onRemove, data, onChange, placeholders }: BizInputRowProps) {
  const cell = (metric: BizMetricKey, period: BizPeriod) => {
    const auto = placeholders?.[metric]?.[period] != null;
    const ph = auto ? formatBizInputValue(placeholders![metric]![period]) : '0';
    return (
      <td className={METRIC_GROUP_CLASS[metric]}>
        <input
          className="biz-input"
          type="text"
          inputMode="numeric"
          value={formatBizInputValue(data[metric][period])}
          placeholder={ph}
          title={auto ? 'Otomatis dari Total Omzet Toko bila dikosongkan' : undefined}
          onChange={(e) => onChange(metric, period, parseBizInputValue(e.target.value))}
        />
      </td>
    );
  };
  return (
    <tr>
      {nameEditable ? (
        <td className="biz-row-name-cell">
          <input className="biz-input biz-row-name" type="text" value={name} onChange={(e) => onNameChange?.(e.target.value)} />
          <span className="biz-row-remove" title="Hapus baris" onClick={onRemove}>
            ✕
          </span>
        </td>
      ) : (
        <td>{name}</td>
      )}
      {cell('revenue', 'old')}
      {cell('revenue', 'cur')}
      {cell('transactions', 'old')}
      {cell('transactions', 'cur')}
      {cell('qty', 'old')}
      {cell('qty', 'cur')}
    </tr>
  );
}

// Ported from the original Business Overview tab: a manual per-channel input
// form (Shopee/TikTok/Tokopedia/Website/Chat, plus dynamic Offline
// Sales/Other Channel rows) feeding three "by Channel" tables and a set of
// calculated business metrics (AOV/AUR/Avg Basket Size) — all independent of
// whether any ads report has been generated.
export function BusinessTab({ isActive, channelData, offlineStores, otherChannels, shopeeOmzet, onChannelDataChange, onOfflineStoresChange, onOtherChannelsChange, nextRowId }: BusinessTabProps) {
  const state: BizState = { channelData, offlineStores, otherChannels, shopeeOmzet };

  function addRow(scope: 'offline' | 'other') {
    const arr = scope === 'offline' ? offlineStores : otherChannels;
    const prefix = scope === 'offline' ? 'Store' : 'Channel';
    const newRow: BizRow = { id: nextRowId(), name: `${prefix} ${arr.length + 1}`, revenue: { old: null, cur: null }, transactions: { old: null, cur: null }, qty: { old: null, cur: null } };
    (scope === 'offline' ? onOfflineStoresChange : onOtherChannelsChange)([...arr, newRow]);
  }
  function removeRow(scope: 'offline' | 'other', id: number) {
    const arr = scope === 'offline' ? offlineStores : otherChannels;
    if (arr.length <= 1) return;
    (scope === 'offline' ? onOfflineStoresChange : onOtherChannelsChange)(arr.filter((r) => r.id !== id));
  }
  function renameRow(scope: 'offline' | 'other', id: number, name: string) {
    const arr = scope === 'offline' ? offlineStores : otherChannels;
    (scope === 'offline' ? onOfflineStoresChange : onOtherChannelsChange)(arr.map((r) => (r.id === id ? { ...r, name: name || r.name } : r)));
  }
  function updateRow(scope: 'offline' | 'other', id: number, metric: BizMetricKey, period: BizPeriod, v: number | null) {
    const arr = scope === 'offline' ? offlineStores : otherChannels;
    (scope === 'offline' ? onOfflineStoresChange : onOtherChannelsChange)(arr.map((r) => (r.id === id ? { ...r, [metric]: { ...r[metric], [period]: v } } : r)));
  }

  return (
    <div className={`panel${isActive ? ' active' : ''}`}>
     <div id="business-container">
      <div className="report-top">
        <div className="report-title">Business Overview</div>
        <div className="report-period">Revenue, Transaksi &amp; Qty Sold — Seluruh Channel</div>
        <div className="report-meta">Data manual, independen dari status laporan ads · Generated {formatGeneratedDate()}</div>
      </div>
      <div className="sec-block">
        <div className="sec-heading business-heading">
          Input Data Business Overview<span className="sec-badge">Opsional</span>
          <SectionDownloadButton />
        </div>
        <div style={{ padding: '1.2rem 1.4rem 1.4rem' }}>
          <div className="empty-note" style={{ paddingTop: 0, paddingBottom: '.8rem' }}>
            Isi data per channel untuk periode lalu &amp; ini. Kosongkan field yang belum tersedia — metrik terkait akan tampil "—" tanpa error. Revenue Shopee otomatis mengikuti Total Omzet Toko dari tab Shopee Ads bila dikosongkan di sini.
          </div>
          <div className="tbl-scroll">
            <table className="kpi-table biz-input-table">
              <BizInputTableHead />
              <tbody>
                {BIZ_INPUT_CHANNELS.map((ch) => (
                  <BizInputRowView
                    key={ch.key}
                    name={ch.label}
                    nameEditable={false}
                    data={channelData[ch.key]}
                    placeholders={ch.key === 'shopee' ? { revenue: shopeeOmzet } : undefined}
                    onChange={(metric, period, v) => onChannelDataChange(ch.key, metric, period, v)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="biz-subgroup">
            <div className="biz-subgroup-label">Offline Sales — per toko (otomatis dijumlahkan jadi satu baris Offline Sales)</div>
            <div className="tbl-scroll">
              <table className="kpi-table biz-input-table">
                <BizInputTableHead />
                <tbody>
                  {offlineStores.map((r) => (
                    <BizInputRowView
                      key={r.id}
                      name={r.name}
                      nameEditable
                      onNameChange={(v) => renameRow('offline', r.id, v)}
                      onRemove={() => removeRow('offline', r.id)}
                      data={r}
                      onChange={(metric, period, v) => updateRow('offline', r.id, metric, period, v)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="biz-add-row">
              <span className="mpill mpill-add" onClick={() => addRow('offline')}>
                + Tambah Toko
              </span>
            </div>
          </div>

          <div className="biz-subgroup">
            <div className="biz-subgroup-label">Other Channel — per channel tambahan (otomatis dijumlahkan jadi satu baris Other Channel)</div>
            <div className="tbl-scroll">
              <table className="kpi-table biz-input-table">
                <BizInputTableHead />
                <tbody>
                  {otherChannels.map((r) => (
                    <BizInputRowView
                      key={r.id}
                      name={r.name}
                      nameEditable
                      onNameChange={(v) => renameRow('other', r.id, v)}
                      onRemove={() => removeRow('other', r.id)}
                      data={r}
                      onChange={(metric, period, v) => updateRow('other', r.id, metric, period, v)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="biz-add-row">
              <span className="mpill mpill-add" onClick={() => addRow('other')}>
                + Tambah Channel
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="sec-block">
        <div className="sec-heading business-heading">
          Revenue by Channel
          <SectionDownloadButton />
        </div>
        <div style={{ padding: '0 1.4rem 1.4rem' }}>
          <KpiTable rows={buildChannelRows(state, 'revenue', fmtBizRp)} p1="Periode Lalu" p2="Periode Ini" />
        </div>
      </div>
      <div className="sec-block">
        <div className="sec-heading business-heading">
          Transactions by Channel
          <SectionDownloadButton />
        </div>
        <div style={{ padding: '0 1.4rem 1.4rem' }}>
          <KpiTable rows={buildChannelRows(state, 'transactions', fmtBizNum)} p1="Periode Lalu" p2="Periode Ini" />
        </div>
      </div>
      <div className="sec-block">
        <div className="sec-heading business-heading">
          Qty Sold by Channel
          <SectionDownloadButton />
        </div>
        <div style={{ padding: '0 1.4rem 1.4rem' }}>
          <KpiTable rows={buildChannelRows(state, 'qty', fmtBizNum)} p1="Periode Lalu" p2="Periode Ini" />
        </div>
      </div>
      <div className="sec-block">
        <div className="sec-heading business-heading">
          Calculated Business Metrics
          <SectionDownloadButton />
        </div>
        <div style={{ padding: '1.2rem 1.4rem 1.4rem' }}>
          <div className="biz-calc-block">
            <div className="biz-subheading">AOV — Average Order Value (Revenue ÷ Transaksi)</div>
            <KpiTable rows={buildCalcRows(state, bizAOV, fmtBizRp)} p1="Periode Lalu" p2="Periode Ini" />
          </div>
          <div className="biz-calc-block">
            <div className="biz-subheading">AUR — Average Unit Revenue (Revenue ÷ Qty Sold)</div>
            <KpiTable rows={buildCalcRows(state, bizAUR, fmtBizRp)} p1="Periode Lalu" p2="Periode Ini" />
          </div>
          <div className="biz-calc-block">
            <div className="biz-subheading">Avg. Basket Size (Qty Sold ÷ Transaksi)</div>
            <KpiTable rows={buildCalcRows(state, bizBasket, fmtBizDec)} p1="Periode Lalu" p2="Periode Ini" />
          </div>
        </div>
      </div>
     </div>
     <div className="action-row" style={{ marginTop: '1rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
       <DownloadPdfButton targetId="business-container" filename="Business Overview.pdf" />
     </div>
    </div>
  );
}
