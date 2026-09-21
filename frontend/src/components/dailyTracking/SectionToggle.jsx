import { ChevronDown } from 'lucide-react';

// Section title that doubles as the expand/collapse control.
export default function SectionToggle({ title, open, onToggle, as: Tag = 'h2', bodyId }) {
  return (
    <Tag className="dt-section-toggle-title">
      <button
        type="button" className="dt-section-toggle"
        aria-expanded={open} aria-controls={bodyId}
        onClick={onToggle}
      >
        <ChevronDown size={16} className={`dt-section-chevron${open ? '' : ' is-collapsed'}`} aria-hidden="true" />
        {title}
      </button>
    </Tag>
  );
}
