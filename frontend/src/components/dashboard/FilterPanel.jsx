import { useState, useEffect } from 'react';
import api from '../../api/client.js';
import DateRangePicker from './DateRangePicker.jsx';

const COMPARE_TYPES = [
  { value: 'previous_period', label: 'Periode sebelumnya' },
  { value: 'previous_month', label: 'Bulan sebelumnya' },
  { value: 'previous_year', label: 'Tahun sebelumnya' },
  { value: 'custom', label: 'Kustom' },
];

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const formatDMY = (iso) => {
  if (!iso) return '--/--/----';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

// Shift a date back by `months`, clamping to the last day of the target month
// (e.g. 31 Jul - 1 month = 30 Jun, not 1 Jul).
const shiftMonths = (date, months) => {
  const d = new Date(date);
  const originalDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, daysInMonth));
  return d;
};

const shiftYears = (date, years) => {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() - years);
  return d;
};

function computeCompareRange(type, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (type === 'previous_month') {
    return { compareStartDate: toISO(shiftMonths(start, 1)), compareEndDate: toISO(shiftMonths(end, 1)) };
  }
  if (type === 'previous_year') {
    return { compareStartDate: toISO(shiftYears(start, 1)), compareEndDate: toISO(shiftYears(end, 1)) };
  }

  // previous_period: equal-length period immediately preceding the selected range
  const diffDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;
  const compStart = new Date(start);
  compStart.setDate(start.getDate() - diffDays);
  const compEnd = new Date(end);
  compEnd.setDate(end.getDate() - diffDays);
  return { compareStartDate: toISO(compStart), compareEndDate: toISO(compEnd) };
}

export default function FilterPanel({ filters, onChange }) {
  const [brands, setBrands] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const [compareType, setCompareType] = useState('previous_period');

  useEffect(() => {
    // Fetch brands list
    api.get('/dashboard/filters')
      .then((res) => {
        setBrands(res.data.brands);
        // Set default brand if not set
        if (res.data.brands.length > 0 && !filters.brandId) {
          onChange({ ...filters, brandId: res.data.brands[0].brand_id });
        }
      })
      .catch(() => {});
  }, []);

  const handleChange = (key, value) => {
    const updated = { ...filters, [key]: value };

    if (key === 'compare' && value === false) {
      updated.compareStartDate = '';
      updated.compareEndDate = '';
    } else if (key === 'compare' && value === true) {
      setCompareType('previous_period');
      Object.assign(updated, computeCompareRange('previous_period', filters.startDate, filters.endDate));
    }
    onChange(updated);
  };

  const handleCompareTypeChange = (type) => {
    setCompareType(type);
    if (type === 'custom') return;
    onChange({ ...filters, ...computeCompareRange(type, filters.startDate, filters.endDate) });
  };

  const handleRangeChange = ({ startDate, endDate }) => {
    const updated = { ...filters, startDate, endDate };
    // Keep the comparison range in sync with the selected period, unless custom
    if (filters.compare && compareType !== 'custom') {
      Object.assign(updated, computeCompareRange(compareType, startDate, endDate));
    }
    onChange(updated);
  };

  const handleCompareRangeChange = ({ startDate, endDate }) => {
    onChange({ ...filters, compareStartDate: startDate, compareEndDate: endDate });
  };

  return (
    <div className="card filter-panel" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
      <div className="filter-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) minmax(200px, 1fr) auto', gap: '1rem', alignItems: 'end' }}>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="brand-select">Brand</label>
          <select
            id="brand-select"
            value={filters.brandId}
            onChange={(e) => handleChange('brandId', e.target.value)}
          >
            <option value="">Pilih Brand...</option>
            {brands.map((b) => (
              <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>
            ))}
          </select>
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Tanggal Mulai &amp; Tanggal Akhir</label>
          <DateRangePicker
            startDate={filters.startDate}
            endDate={filters.endDate}
            onChange={handleRangeChange}
          />
        </div>

        <div className="form-group" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', height: '100%' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', margin: 0, whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={showCompare}
              onChange={(e) => {
                setShowCompare(e.target.checked);
                handleChange('compare', e.target.checked);
              }}
            />
            Bandingkan Periode
          </label>
        </div>
      </div>

      {showCompare && (
        <div className="compare-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="compare-type-select">Periode Pembanding</label>
            <select
              id="compare-type-select"
              value={compareType}
              onChange={(e) => handleCompareTypeChange(e.target.value)}
            >
              {COMPARE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {compareType === 'custom' ? (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Tanggal Pembanding</label>
              <DateRangePicker
                startDate={filters.compareStartDate}
                endDate={filters.compareEndDate}
                onChange={handleCompareRangeChange}
              />
            </div>
          ) : (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Tanggal Pembanding</label>
              <div style={{ padding: '0.625rem 1rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                {formatDMY(filters.compareStartDate)} - {formatDMY(filters.compareEndDate)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
