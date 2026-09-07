import type { ReactNode } from 'react';
import type { ReportKey } from '../app/reports';

// One clean line-icon per report type. Stroke = currentColor so the caller
// controls colour; 22×22 viewBox, 1.7 stroke. Purely presentational.
const PATHS: Record<ReportKey, ReactNode> = {
  meta: <path d="M4 14c0-3.7 1.7-6.6 4-6.6 3.4 0 4.5 8 8 8 2.3 0 4-2.9 4-6.6S18.3 6.6 16 6.6c-3.5 0-4.6 8-8 8-2.3 0-4-2.9-4-6.6" />,
  shopee: (
    <>
      <path d="M7 8V6.5a4 4 0 0 1 8 0V8" />
      <path d="M4.6 8h12.8l-.9 8.6a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8L4.6 8Z" />
    </>
  ),
  tiktok: (
    <>
      <path d="M9.5 4.5v9.7a3.2 3.2 0 1 1-3.2-3.2" />
      <path d="M9.5 4.5c.5 2.6 2.2 4.2 4.8 4.4" />
    </>
  ),
  business: (
    <>
      <path d="M4 17h14" />
      <rect x="5.5" y="10.5" width="3" height="5" rx="1" />
      <rect x="10.5" y="6.5" width="3" height="9" rx="1" />
      <rect x="15.5" y="12.5" width="1.5" height="3" rx=".7" />
    </>
  ),
  summary: (
    <>
      <path d="M11 3.4 18.5 7 11 10.6 3.5 7 11 3.4Z" />
      <path d="M3.9 11 11 14.4 18.1 11" />
      <path d="M3.9 15 11 18.4 18.1 15" />
    </>
  ),
  reports: (
    <>
      <circle cx="11" cy="11" r="7.2" />
      <path d="M11 6.8V11l3 1.9" />
    </>
  ),
  // No 'brands' entry: Pengaturan Brand is not ported (see app/reports.ts).
};

export function ReportIcon({ name, className }: { name: ReportKey; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
