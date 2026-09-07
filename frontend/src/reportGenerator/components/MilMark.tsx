// The MIL mark on its own — the bar-chart glyph from public/mil-logo.svg
// without the rounded tile around it. Inlined rather than <img src>, because
// the shipped asset is a blue tile with a white mark inside: as a watermark
// the tile is the part you would see, and filtering it to one colour just
// gives a solid square. Takes its colour from `currentColor`.
export function MilMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="96 50 328 358" fill="currentColor" aria-hidden focusable="false">
      <rect x="120" y="300" width="52" height="92" rx="20" />
      <rect x="196" y="244" width="52" height="148" rx="20" />
      <rect x="272" y="188" width="52" height="204" rx="20" />
      <rect x="348" y="132" width="52" height="260" rx="20" />
      <circle cx="374" cy="96" r="30" />
    </svg>
  );
}
