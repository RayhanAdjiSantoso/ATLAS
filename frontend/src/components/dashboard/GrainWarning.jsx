import { TriangleAlert } from 'lucide-react';

// Caveat banner for figures the backend read from a monthly Product
// Performance snapshot rather than re-aggregating from daily/per-order data.
// `warning` is the object from utils/dateGrain.js's snapshotGrainWarning()
// (null when the selected range is exactly one calendar month) -- the
// component renders nothing in that case, so callers can drop it in
// unconditionally without disturbing sibling layout / comparison-split
// section counts.
export default function GrainWarning({ warning }) {
  if (!warning?.message) return null;
  return (
    <p className="grain-warn">
      <TriangleAlert size={13} strokeWidth={2.4} />
      <span>{warning.message}</span>
    </p>
  );
}
