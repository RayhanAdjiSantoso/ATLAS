import { Building2 } from 'lucide-react';

// The picked brand's logo (from Brand Setting), its initials when it has
// none, or an empty placeholder before a brand is picked. Same tile as the
// Report Generator's ClientAvatar; `brand` is a GET /brands row.
export default function BrandAvatar({ brand, className = '' }) {
  const cls = `brand-avatar${className ? ` ${className}` : ''}`;
  if (!brand?.brand_name) {
    return <span className={`${cls} is-empty`} aria-hidden="true"><Building2 size={24} /></span>;
  }
  const initials = brand.brand_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className={cls} aria-hidden="true">
      {brand.logo_version
        ? <img key={brand.brand_id} src={`/api/public/brand-logo/${brand.brand_id}?v=${brand.logo_version}`} alt="" />
        : initials}
    </span>
  );
}
