import { useState, useEffect } from 'react';
import api from '../../api/client.js';
import DateRangePicker from './DateRangePicker.jsx';
import SearchableSelect from '../common/SearchableSelect.jsx';

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

  // The console's control bar. Brand, period and comparison are the axes every
  // number on the page is read against, so they sit in one sticky row rather
  // than a card that scrolls away — and the comparison controls appear in that
  // same row instead of opening a second block beneath it.
  return (
    <div className="con-controls">
      <div className="con-ctl con-ctl-brand">
        <label htmlFor="brand-select">Brand</label>
        <SearchableSelect
          id="brand-select"
          placeholder="Pilih brand..."
          value={filters.brandId}
          options={brands.map((b) => ({ value: b.brand_id, label: b.brand_name }))}
          onChange={(val) => handleChange('brandId', val)}
        />
      </div>

      <div className="con-ctl con-ctl-period">
        <label>Periode</label>
        <DateRangePicker
          startDate={filters.startDate}
          endDate={filters.endDate}
          onChange={handleRangeChange}
        />
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={showCompare}
        className={`con-switch${showCompare ? ' is-on' : ''}`}
        onClick={() => {
          const next = !showCompare;
          setShowCompare(next);
          handleChange('compare', next);
        }}
      >
        <span className="con-switch-track" aria-hidden><span className="con-switch-thumb" /></span>
        Bandingkan periode
      </button>

      {showCompare && (
        <>
          <div className="con-ctl">
            <label htmlFor="compare-type-select">Basis pembanding</label>
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

          <div className="con-ctl con-ctl-period">
            <label>Periode pembanding</label>
            {compareType === 'custom' ? (
              <DateRangePicker
                startDate={filters.compareStartDate}
                endDate={filters.compareEndDate}
                onChange={handleCompareRangeChange}
              />
            ) : (
              <div className="con-ctl-static">
                {formatDMY(filters.compareStartDate)} &ndash; {formatDMY(filters.compareEndDate)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
