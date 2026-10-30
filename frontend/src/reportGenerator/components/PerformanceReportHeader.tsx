import type { ReactNode } from 'react';
import './PerformanceReportHeader.css';

interface PerformanceReportHeaderProps {
  platform: string;
  oldPeriod: string;
  currentPeriod: string;
  generatedAt?: string;
  description?: string;
  children?: ReactNode;
}

// Keep report-top on the root so PDF export still captures the header.
export function PerformanceReportHeader({ platform, oldPeriod, currentPeriod, generatedAt, description, children }: PerformanceReportHeaderProps) {
  return (
    <header className="report-top performance-report-header">
      <div className="prh-heading">
        <div className="prh-identity">
          <p className="prh-platform">{platform}</p>
          <h2 className="prh-title">Performance Report</h2>
        </div>
        {generatedAt && (
          <p className="prh-generated">
            <span className="prh-generated-label">Dibuat pada</span>
            <span className="prh-date">{generatedAt}</span>
          </p>
        )}
      </div>
      <dl className="prh-periods" aria-label="Perbandingan periode laporan">
        <div className="prh-period">
          <dt>Periode sebelumnya</dt>
          <dd>{oldPeriod}</dd>
        </div>
        <div className="prh-period prh-period-current">
          <dt>Periode saat ini</dt>
          <dd>{currentPeriod}</dd>
        </div>
      </dl>
      {(description || children) && (
        <div className="prh-details">
          {description && <p>{description}</p>}
          {children}
        </div>
      )}
    </header>
  );
}
