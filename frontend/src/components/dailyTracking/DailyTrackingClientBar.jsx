import SearchableSelect from '../common/SearchableSelect.jsx';
import BrandStatusFilter, { matchesBrandStatus } from '../common/BrandStatusFilter.jsx';
import MonthPillNav from './MonthPillNav.jsx';

// Sticky top:0 — brand + month are the axes every number below is read
// against, same reasoning as Dashboard's .con-bar.
export default function DailyTrackingClientBar({
  brands, brandId, onBrandChange, locked,
  brandStatus, onBrandStatusChange,
  month, onMonthChange,
}) {
  const options = brands
    .filter((b) => matchesBrandStatus(b, brandStatus))
    .map((b) => ({ value: b.brand_id, label: b.brand_name }));

  return (
    <div className="dt-bar">
      <div className="dt-bar-row">
        <div className="dt-bar-field">
          <label htmlFor="dt-brand">Klien</label>
          <SearchableSelect
            id="dt-brand"
            options={options}
            value={brandId}
            onChange={onBrandChange}
            placeholder="Pilih klien..."
            disabled={locked}
          />
        </div>
        {!locked && <BrandStatusFilter value={brandStatus} onChange={onBrandStatusChange} />}
      </div>
      <MonthPillNav month={month} onChange={onMonthChange} />
    </div>
  );
}
