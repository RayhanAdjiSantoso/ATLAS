import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import BrandStatusFilter, { BRAND_STATUS_LABELS, matchesBrandStatus } from '../common/BrandStatusFilter.jsx';
import usePopover from '../common/usePopover.js';
import './dashboardHeader.css';

export default function DashboardBrandPicker({ brands, value, onChange, status, onStatusChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const panelId = useId();
  const close = useCallback(({ restoreFocus } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  const position = usePopover({ open, onClose: close, triggerRef, panelRef });
  const selected = brands.find(b => String(b.brand_id) === String(value));
  const shown = brands.filter(b => matchesBrandStatus(b, status) && b.brand_name.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery('');
  }, [open]);
  const pick = (id) => { onChange(id); close({ restoreFocus: true }); };
  const navigateResults = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target === inputRef.current && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const items = [...panelRef.current.querySelectorAll('.dashboard-brand-result')];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? Math.min(index + 1, items.length - 1) : Math.max(index - 1, 0);
    items[next].focus();
  };
  return <>
    <button ref={triggerRef} id="brand-select" type="button" className="dashboard-brand-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(v => !v)}>
      <Search size={16} aria-hidden="true" /><span>{selected?.brand_name || 'Pilih brand…'}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={panelRef} id={panelId} role="dialog" aria-label="Pilih brand" className="dashboard-brand-menu" style={position} onKeyDown={navigateResults}>
      <label className="dashboard-brand-search"><Search size={17} aria-hidden="true" /><input ref={inputRef} type="search" aria-label="Cari brand" placeholder="Cari brand…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && shown.length) { e.preventDefault(); pick(shown[0].brand_id); } }} /></label>
      <BrandStatusFilter value={status} onChange={onStatusChange} />
      <div className="dashboard-brand-count" aria-live="polite">{shown.length} brand</div>
      <div className="dashboard-brand-results">
        {shown.map(b => <button type="button" key={b.brand_id} className="dashboard-brand-result" aria-pressed={String(b.brand_id) === String(value)} onClick={() => pick(b.brand_id)}><span>{b.brand_name}<small>{BRAND_STATUS_LABELS[b.status] || BRAND_STATUS_LABELS.unknown}</small></span>{String(b.brand_id) === String(value) && <Check size={17} aria-hidden="true" />}</button>)}
        {!shown.length && <p>Tidak ada brand yang cocok. Ubah pencarian atau status.</p>}
      </div>
    </div>, document.body)}
  </>;
}
