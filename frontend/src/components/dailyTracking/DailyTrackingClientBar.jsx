import DashboardBrandPicker from '../dashboard/DashboardBrandPicker.jsx';
import MonthPillNav from './MonthPillNav.jsx';

// Sticky top:0 — brand + month are the axes every number below is read
// against, same reasoning as Dashboard's .con-bar.
export default function DailyTrackingClientBar({
  brands, brandId, onBrandChange, locked,
  brandStatus, onBrandStatusChange,
  month, onMonthChange,
}) {
  return (
    <div className="dt-bar">
      <div className="dt-bar-row">
        <div className="dt-bar-field">
          <label htmlFor="dt-brand">Klien</label>
          <DashboardBrandPicker
            id="dt-brand"
            brands={brands}
            value={brandId}
            onChange={onBrandChange}
            status={brandStatus}
            onStatusChange={onBrandStatusChange}
            placeholder="Pilih klien…"
            resultHint="Pilih untuk membuka Daily Tracking"
            disabled={locked}
          />
        </div>
      </div>
      <MonthPillNav month={month} onChange={onMonthChange} />
    </div>
  );
}
