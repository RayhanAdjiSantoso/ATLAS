import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import BrandStatusFilter, { BRAND_STATUS_LABELS, matchesBrandStatus } from '../common/BrandStatusFilter.jsx';
import usePopover from '../common/usePopover.js';
import SearchField from '../common/SearchField.jsx';
import './dashboardHeader.css';

// The brand picker: search, status filter and the brand list. `multiple`
// turns it into a checklist — value is then an array of brand ids, a click
// toggles one brand and the panel stays open until dismissed.
export default function DashboardBrandPicker({
  brands, value, onChange, status, onStatusChange,
  id = 'brand-select', placeholder = 'Pilih brand…', resultHint = 'Pilih untuk membuka dashboard', disabled = false,
  multiple = false,
}) {
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
  const chosen = multiple ? new Set((value ?? []).map(String)) : null;
  const isChosen = (b) => (multiple ? chosen.has(String(b.brand_id)) : String(b.brand_id) === String(value));
  const selected = multiple ? brands.filter(isChosen) : brands.find(isChosen);
  const triggerLabel = multiple
    ? (selected.length === 0 ? placeholder : selected.length <= 2 ? selected.map((b) => b.brand_name).join(', ') : `${selected.length} brand dipilih`)
    : selected?.brand_name || placeholder;
  const shown = brands.filter(b => matchesBrandStatus(b, status) && b.brand_name.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery('');
  }, [open]);
  const pick = (brandId) => {
    if (!multiple) { onChange(brandId); close({ restoreFocus: true }); return; }
    const key = String(brandId);
    onChange(chosen.has(key) ? value.filter((v) => String(v) !== key) : [...(value ?? []), brandId]);
  };
  const shownChosen = multiple ? shown.filter(isChosen).length : 0;
  const toggleShown = () => {
    const ids = new Set(shown.map((b) => String(b.brand_id)));
    onChange(shownChosen === shown.length
      ? value.filter((v) => !ids.has(String(v)))
      : [...value, ...shown.filter((b) => !isChosen(b)).map((b) => b.brand_id)]);
  };
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
    <button ref={triggerRef} id={id} type="button" className="dashboard-brand-trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(v => !v)}>
      <Search size={16} aria-hidden="true" /><span>{triggerLabel}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={panelRef} id={panelId} role="dialog" aria-label="Pilih brand" className="dashboard-brand-menu" style={position} onKeyDown={navigateResults}>
      <div className="dashboard-brand-menu-head">
        <SearchField className="dashboard-brand-search" ref={inputRef} aria-label="Cari brand" placeholder="Cari nama brand…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && shown.length) { e.preventDefault(); pick(shown[0].brand_id); } }} />
        <span aria-live="polite">{multiple ? `${chosen.size} dipilih · ` : ''}{shown.length} brand ditemukan</span>
      </div>
      <div className="dashboard-brand-menu-body">
        <aside className="dashboard-brand-filters">
          <span className="dashboard-brand-section-label">Status klien</span>
          <BrandStatusFilter value={status} onChange={onStatusChange} />
        </aside>
        <section className="dashboard-brand-list" aria-label="Daftar brand">
          <header>
            <span className="dashboard-brand-section-label">Daftar brand</span>
            {multiple && shown.length > 0
              ? <button type="button" className="dashboard-brand-bulk" onClick={toggleShown}>{shownChosen === shown.length ? 'Batalkan yang tampil' : 'Pilih semua yang tampil'}</button>
              : <small>{resultHint}</small>}
          </header>
          <div className="dashboard-brand-results" role="listbox" aria-multiselectable={multiple || undefined}>
            {shown.map(b => {
              const on = isChosen(b);
              return <button type="button" role="option" aria-selected={on} key={b.brand_id} className={`dashboard-brand-result${multiple ? ' is-multi' : ''}`} onClick={() => pick(b.brand_id)}>
                {multiple && <span className="dashboard-brand-check" aria-hidden="true">{on && <Check size={12} strokeWidth={3} />}</span>}
                <i className={`brand-status-dot is-${b.status || 'unknown'}`} aria-hidden="true" />
                <span><strong>{b.brand_name}</strong><small>{BRAND_STATUS_LABELS[b.status] || BRAND_STATUS_LABELS.unknown}</small></span>
                {!multiple && on && <Check size={17} aria-hidden="true" />}
              </button>;
            })}
            {!shown.length && <p>Tidak ada brand yang cocok. Ubah pencarian atau status.</p>}
          </div>
          {multiple && <footer className="dashboard-brand-foot">
            <small>{resultHint}</small>
            <button type="button" className="dashboard-brand-done" onClick={() => close({ restoreFocus: true })}><Check size={15} aria-hidden="true" /> Selesai{chosen.size ? ` (${chosen.size})` : ''}</button>
          </footer>}
        </section>
      </div>
    </div>, document.body)}
  </>;
}
