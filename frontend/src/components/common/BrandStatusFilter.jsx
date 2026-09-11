export const BRAND_STATUS_LABELS = { active: 'Aktif', off: 'Nonaktif', freeze: 'Dibekukan', unknown: 'Belum diatur' };
export function matchesBrandStatus(brand, status) {
  return status === 'all' || (status === 'unknown' ? !brand.status : brand.status === status);
}
export default function BrandStatusFilter({ value, onChange }) {
  return <div className="brand-status-filter" role="group" aria-label="Filter status klien">
    {[['all', 'Semua'], ...Object.entries(BRAND_STATUS_LABELS)].map(([key, label]) =>
      <button key={key} type="button" aria-pressed={value === key} className={value === key ? 'is-selected' : ''} onClick={() => onChange(key)}>
        {key !== 'all' && <span className={`brand-status-dot is-${key}`} aria-hidden="true"/>}{label}
      </button>)}
  </div>;
}
