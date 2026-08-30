// Fase 1: shown when the old/cur periods being compared aren't the same
// length, so a %Change reader doesn't mistake it for a like-for-like
// month-over-month comparison.
export function PeriodWarningBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="period-warning">{message}</div>;
}
