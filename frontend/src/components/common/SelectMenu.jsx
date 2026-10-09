import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import usePopover from './usePopover.js';
import SearchField from './SearchField.jsx';
import './fieldControls.css';

// The dropdown ATLAS draws everywhere else — brand picker trigger, result rows
// with a tick, a portalled glass panel — packaged for short option lists that
// were still native <select>s. `multiple` turns the rows into checkboxes and
// keeps the panel open, which is what the MOM recap picker needs.
// `searchable` adds a filter box above the rows for long lists; an option's
// `group` draws a small heading wherever the group changes.
export default function SelectMenu({
  value,
  onChange,
  options,
  multiple = false,
  placeholder = 'Pilih…',
  label,
  menuTitle,
  summary,
  icon: Icon,
  id,
  disabled = false,
  className = '',
  emptyText = 'Tidak ada pilihan.',
  searchable = false,
  searchPlaceholder = 'Cari…',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const listId = useId();

  const close = useCallback(({ restoreFocus } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);
  const position = usePopover({ open, onClose: close, triggerRef, panelRef, matchWidth: true });

  const selectedValues = multiple ? (value ?? []) : [value];
  const isSelected = (candidate) => selectedValues.some((item) => String(item) === String(candidate));
  const selectedOptions = options.filter((option) => isSelected(option.value));
  const display = summary ?? (multiple
    ? (selectedOptions.length ? `${selectedOptions.length} dipilih` : placeholder)
    : (selectedOptions[0]?.label ?? placeholder));

  const needle = query.trim().toLowerCase();
  const visibleOptions = searchable && needle
    ? options.filter((option) => `${option.label} ${option.group ?? ''} ${option.description ?? ''}`.toLowerCase().includes(needle))
    : options;

  // Land on the current choice, the way a native select opens. A searchable
  // menu lands in its search box instead, ready to type.
  useEffect(() => {
    if (!open) { setQuery(''); return; }
    if (searchable) { searchRef.current?.focus({ preventScroll: true }); return; }
    const panel = panelRef.current;
    (panel?.querySelector('[aria-selected="true"]') ?? panel?.querySelector('[role="option"]'))?.focus({ preventScroll: true });
  }, [open, searchable]);

  const pick = (candidate) => {
    if (!multiple) {
      onChange(candidate);
      close({ restoreFocus: true });
      return;
    }
    onChange(isSelected(candidate)
      ? selectedValues.filter((item) => String(item) !== String(candidate))
      : [...selectedValues, candidate]);
  };

  const onListKey = (event) => {
    const items = [...(panelRef.current?.querySelectorAll('[role="option"]') ?? [])];
    const index = items.indexOf(document.activeElement);
    const next = { ArrowDown: Math.min(items.length - 1, index + 1), ArrowUp: Math.max(0, index - 1), Home: 0, End: items.length - 1 }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
    } else if (event.key === 'Tab') {
      close();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`atlas-field-trigger${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label ? `${label}: ${display}` : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
        }}
      >
        {Icon && <Icon size={15} className="atlas-field-icon" aria-hidden="true" />}
        <span className={`atlas-field-value${selectedOptions.length ? '' : ' is-placeholder'}`}>{display}</span>
        <ChevronDown size={15} className="atlas-field-chev" aria-hidden="true" />
      </button>

      {open && createPortal(
        <div ref={panelRef} className="atlas-menu" style={position}>
          {(menuTitle || multiple) && (
            <div className="atlas-menu-head">
              <span>{menuTitle ?? label}</span>
              {multiple && options.length > 1 && (
                <span className="atlas-menu-bulk">
                  <button type="button" onClick={() => onChange(options.map((option) => option.value))}>Pilih semua</button>
                  <button type="button" onClick={() => onChange([])}>Kosongkan</button>
                </span>
              )}
            </div>
          )}
          {searchable && (
            <div className="atlas-menu-search">
              <SearchField
                ref={searchRef}
                value={query}
                placeholder={searchPlaceholder}
                aria-label={`Cari ${label ?? 'pilihan'}`}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') { event.preventDefault(); panelRef.current?.querySelector('[role="option"]')?.focus(); }
                  if (event.key === 'Enter' && visibleOptions.length) { event.preventDefault(); pick(visibleOptions[0].value); }
                  if (event.key === 'Escape') close({ restoreFocus: true });
                }}
              />
            </div>
          )}
          <ul id={listId} role="listbox" aria-multiselectable={multiple || undefined} aria-label={label} onKeyDown={onListKey}>
            {visibleOptions.map((option, index) => {
              const selected = isSelected(option.value);
              const groupStarts = option.group && option.group !== visibleOptions[index - 1]?.group;
              return (
                <Fragment key={option.value}>
                {groupStarts && <li role="presentation" className="atlas-menu-group">{option.group}</li>}
                <li role="presentation">
                  <button type="button" role="option" aria-selected={selected} className={selected ? 'is-active' : ''} onClick={() => pick(option.value)}>
                    {multiple && <span className="atlas-menu-check" aria-hidden="true">{selected && <Check size={11} strokeWidth={3} />}</span>}
                    <span className="atlas-menu-copy">
                      <strong>{option.label}</strong>
                      {option.description && <small>{option.description}</small>}
                    </span>
                    {!multiple && selected && <Check size={15} className="atlas-menu-tick" aria-hidden="true" />}
                  </button>
                </li>
                </Fragment>
              );
            })}
            {!options.length && <li className="atlas-menu-empty">{emptyText}</li>}
            {!!options.length && !visibleOptions.length && <li className="atlas-menu-empty">Tidak ada hasil.</li>}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
