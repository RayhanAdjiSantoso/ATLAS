import type { SaveStatusValue } from './useAutoSave';

export function SaveStatus({ status, message }: { status: SaveStatusValue; message: string }) {
  if (status === 'idle') return null;
  return <div className={`save-report-status ${status === 'error' ? 'err' : 'ok'}`}>{status === 'saving' ? '⏳ Menyimpan…' : message}</div>;
}
