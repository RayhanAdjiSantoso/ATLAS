import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

const pad = (n) => String(n).padStart(2, '0');
// Build a YYYY-MM-DD string from a Date's local calendar fields (never via
// toISOString, which converts through UTC and shifts the day in +offset zones).
const toLocalISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Parse a "YYYY-MM-DD" string as a local-time Date, avoiding the UTC-midnight
// parsing `new Date(str)` does for date-only strings.
const parseLocalDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const EMPTY_SET = new Set();

// Bright yellow for the "poor performing" (below-average) tier -- distinct
// from the design system's --warning token (a muted amber meant for
// text-on-light-background readability). Same value duplicated in
// DashboardTab.jsx and LineChart.jsx.
const POOR_PERFORMING_COLOR = '#eab308';

export default function CalendarHeatmap({ data = [], title = 'Sales Calendar — Total Penjualan (IDR) Harian', bestDates = EMPTY_SET, worstDates = EMPTY_SET, poorDates = EMPTY_SET, rangeStart = null, rangeEnd = null }) {
  const [hoveredDay, setHoveredDay] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const { panels, maxGmv } = useMemo(() => {
    if (data.length === 0) return { panels: [], maxGmv: 0 };

    const maxGmv = Math.max(...data.map(d => Number(d.gmv || 0)), 1);

    // Group data by YYYY-MM
    const groups = {};
    data.forEach(d => {
      if (!d.date) return;
      const date = parseLocalDate(d.date);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push({
        dateStr: d.date,
        dateObj: date,
        gmv: Number(d.gmv || 0)
      });
    });

    // Generate monthly grids
    const panels = Object.entries(groups).map(([monthKey, dayRecords]) => {
      const [year, monthStr] = monthKey.split('-').map(Number);
      const monthIdx = monthStr - 1;

      const recordMap = new Map();
      dayRecords.forEach(r => recordMap.set(r.dateStr, r.gmv));

      // First day of this month
      const firstDay = new Date(year, monthIdx, 1);
      const dayOfW = firstDay.getDay(); // 0 is Sunday, 1 is Monday...
      // Align start to Monday
      const diffToMonday = dayOfW === 0 ? 6 : dayOfW - 1;
      const start = new Date(firstDay);
      start.setDate(firstDay.getDate() - diffToMonday);

      // Last day of this month
      const lastDay = new Date(year, monthIdx + 1, 0);
      // Align end to Sunday
      const dayOfWLast = lastDay.getDay();
      const diffToSunday = dayOfWLast === 0 ? 0 : 7 - dayOfWLast;
      const end = new Date(lastDay);
      end.setDate(lastDay.getDate() + diffToSunday);

      const weeks = [];
      let current = new Date(start);
      let currentWeek = [];

      while (current <= end) {
        const dateStr = toLocalISODate(current);
        const inMonth = current.getMonth() === monthIdx;
        // A calendar cell can be in-month but outside the user's selected
        // date range (the month grid always shows full weeks/months even
        // when the analysis period only covers part of one). Those cells
        // have no data to show -- not a $0 day -- so gmv stays null instead
        // of silently defaulting to 0 like an in-range day with no record.
        const inRange = inMonth && (!rangeStart || !rangeEnd || (dateStr >= rangeStart && dateStr <= rangeEnd));
        const gmv = inRange ? (recordMap.get(dateStr) ?? 0) : null;

        currentWeek.push({
          dateStr,
          day: current.getDate(),
          gmv,
          inMonth,
          inRange
        });

        if (currentWeek.length === 7) {
          weeks.push(currentWeek);
          currentWeek = [];
        }
        current.setDate(current.getDate() + 1);
      }

      const monthName = new Date(year, monthIdx).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

      return {
        monthName,
        weeks
      };
    });

    return { panels, maxGmv };
  }, [data, rangeStart, rangeEnd]);

  // Analysis period changed → jump back to its first month.
  useEffect(() => {
    setActiveIndex(0);
  }, [data]);

  const activePanel = panels[activeIndex] ?? panels[panels.length - 1] ?? null;
  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex < panels.length - 1;

  const formatBrief = (val) => {
    if (val == null || val === 0) return '';
    if (val >= 1000000) return `${(val / 1000000).toFixed(1).replace('.', ',')}Jt`;
    if (val >= 1000) return `${(val / 1000).toFixed(0)}Rb`;
    return val;
  };

  const getCellStyles = (gmv, inMonth, ratio) => {
    if (!inMonth) {
      return {
        background: 'var(--bg-elevated)',
        color: 'transparent',
        cursor: 'default'
      };
    }
    if (gmv === null) {
      // In-month but outside the selected analysis period: no data, not $0.
      return {
        background: 'var(--bg-elevated)',
        color: 'var(--text-placeholder)',
        cursor: 'default'
      };
    }
    if (gmv === 0) {
      return {
        background: 'var(--border)',
        color: 'var(--text-muted)',
      };
    }

    // YlGnBu color scale approximation (Yellow-Green-Blue gradient mapping)
    // As ratio increases, it transitions from pale yellow/green to deep navy blue
    const opacity = 0.15 + ratio * 0.85;
    
    // Check contrast for text color
    const isDark = ratio > 0.55;
    
    return {
      background: `rgba(59, 130, 246, ${opacity})`,
      color: isDark ? '#ffffff' : 'var(--text)',
      border: '1px solid var(--border)',
      fontWeight: '600'
    };
  };

  if (data.length === 0) {
    return (
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--text-muted)' }}>
        Belum ada data transaksi untuk Kalender Penjualan
      </div>
    );
  }

  return (
    <div className="card heatmap-container" style={{ padding: '1.25rem' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '1.5rem', color: 'var(--text)' }}>{title}</h3>

      {/* Single month panel with Previous/Next navigation across the analysis period */}
      {activePanel && (
        <div className="month-panel" style={{ maxWidth: '420px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <NavBtn onClick={() => canGoPrev && setActiveIndex(i => i - 1)} disabled={!canGoPrev} label="Bulan sebelumnya">
              <ChevronLeft size={16} />
            </NavBtn>
            <h4 style={{ minWidth: '160px', textAlign: 'center', fontSize: '0.95rem', color: 'var(--primary)' }}>
              {activePanel.monthName}
            </h4>
            <NavBtn onClick={() => canGoNext && setActiveIndex(i => i + 1)} disabled={!canGoNext} label="Bulan berikutnya">
              <ChevronRight size={16} />
            </NavBtn>
          </div>

          {/* Day Header */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '6px', textAlign: 'center' }}>
            {DAYS.map(day => (
              <div key={day} style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)' }}>
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Weeks */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {activePanel.weeks.map((week, wIdx) => (
              <div key={wIdx} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                {week.map((day, dIdx) => {
                  const ratio = day.gmv ? day.gmv / maxGmv : 0;
                  const cellStyle = getCellStyles(day.gmv, day.inMonth, ratio);
                  const isBest = day.gmv !== null && bestDates.has(day.dateStr);
                  const isWorst = day.gmv !== null && worstDates.has(day.dateStr);
                  const isPoor = !isBest && !isWorst && day.gmv !== null && poorDates.has(day.dateStr);

                  return (
                    <div
                      key={dIdx}
                      style={{
                        height: '42px',
                        borderRadius: '4px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        padding: '3px 4px',
                        fontSize: '0.7rem',
                        position: 'relative',
                        transition: 'transform 0.15s, box-shadow 0.15s',
                        boxShadow: hoveredDay?.dateStr === day.dateStr ? '0 0 0 2px var(--primary)' : 'none',
                        transform: hoveredDay?.dateStr === day.dateStr ? 'scale(1.05)' : 'none',
                        zIndex: hoveredDay?.dateStr === day.dateStr ? 5 : 1,
                        ...cellStyle,
                        // Best/worst-day ring wins over the intensity-scale border so it
                        // stays visible regardless of GMV fill color underneath. "Poor"
                        // (relatively below this period's own average) gets its own
                        // bright-yellow ring, distinct from the single worst day's
                        // danger (red) ring.
                        border: isBest ? '2px solid var(--success)' : isWorst ? '2px solid var(--danger)' : isPoor ? `1.5px solid ${POOR_PERFORMING_COLOR}` : cellStyle.border,
                      }}
                      onMouseEnter={() => day.inMonth && day.gmv !== null && setHoveredDay(day)}
                      onMouseLeave={() => setHoveredDay(null)}
                    >
                      {day.inMonth && (
                        <>
                          <span style={{ fontSize: '0.75rem', fontWeight: '700', alignSelf: 'flex-start' }}>
                            {day.day}
                          </span>
                          <span style={{ fontSize: '0.65rem', alignSelf: 'center', opacity: 0.95 }}>
                            {formatBrief(day.gmv)}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail Tooltip */}
      {hoveredDay && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '0.4rem 0.75rem',
            pointerEvents: 'none',
            boxShadow: 'var(--shadow)',
            fontSize: '0.8rem',
            zIndex: 100,
            whiteSpace: 'nowrap',
            color: 'var(--text)'
          }}
        >
          <strong>{(() => {
            const [year, month, day] = hoveredDay.dateStr.split('-');
            const monthNames = [
              'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
              'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
            ];
            return `${parseInt(day)} ${monthNames[parseInt(month) - 1]} ${year}`;
          })()}</strong>
          <br />
          Total Penjualan: {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(hoveredDay.gmv)}
          {bestDates.has(hoveredDay.dateStr) && (
            <div style={{ color: 'var(--success)', fontWeight: 600, marginTop: '0.2rem' }}>Performa terbaik</div>
          )}
          {worstDates.has(hoveredDay.dateStr) && (
            <div style={{ color: 'var(--danger)', fontWeight: 600, marginTop: '0.2rem' }}>Performa terburuk</div>
          )}
          {!bestDates.has(hoveredDay.dateStr) && !worstDates.has(hoveredDay.dateStr) && poorDates.has(hoveredDay.dateStr) && (
            <div style={{ color: POOR_PERFORMING_COLOR, fontWeight: 600, marginTop: '0.2rem' }}>Di bawah rata-rata periode ini</div>
          )}
        </div>
      )}
    </div>
  );
}

function NavBtn({ onClick, disabled, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        border: 'none',
        background: 'transparent',
        color: disabled ? 'var(--border)' : 'var(--text-muted)',
        cursor: disabled ? 'default' : 'pointer',
        padding: '0.2rem',
        display: 'flex',
        alignItems: 'center',
        borderRadius: '4px',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}
