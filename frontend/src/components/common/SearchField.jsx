import { forwardRef } from 'react';
import { Search } from 'lucide-react';
import './fieldControls.css';

// One search treatment for page toolbars and searchable popovers. Keeping the
// icon inside the component prevents individual pages from drifting back to
// differently-sized inputs or losing the visual cue altogether.
const SearchField = forwardRef(function SearchField({ className = '', children, type = 'search', style, ...inputProps }, ref) {
  return (
    <label className={`atlas-search-field${className ? ` ${className}` : ''}`} style={style}>
      <Search size={19} strokeWidth={2} aria-hidden="true" />
      <input ref={ref} type={type} {...inputProps} />
      {children}
    </label>
  );
});

export default SearchField;
