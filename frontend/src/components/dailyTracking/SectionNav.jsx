const SECTIONS = [
  { id: 'dt-section-revenue', label: 'Revenue Data' },
  { id: 'dt-section-spending', label: 'Spending Data' },
  { id: 'dt-section-summary', label: 'Ringkasan per Channel' },
];

// Quick-jump pills, always visible inside the sticky head — scrollIntoView
// respects each target's `scroll-margin-top` (set from measured sticky-head
// height in DailyTrackingPage) so the section title never lands hidden
// behind this same sticky head.
export default function SectionNav() {
  const jumpTo = (e, id) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="dt-section-nav" aria-label="Lompat ke bagian">
      {SECTIONS.map((s) => (
        <a key={s.id} href={`#${s.id}`} className="dt-section-nav-link" onClick={(e) => jumpTo(e, s.id)}>
          {s.label}
        </a>
      ))}
    </nav>
  );
}
