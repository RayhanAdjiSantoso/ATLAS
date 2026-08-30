import { useState } from 'react';
import { saveReport } from './api';
import type { Platform, RawFileEntry, SaveReportPayload } from './types';

export type SaveStatusValue = 'idle' | 'saving' | 'saved' | 'error';

// Saving happens automatically right after Generate succeeds — the people
// using this tool don't need to understand "save to database" as a separate
// step, so there's no button for it, just a small status line.
export function useAutoSave(platform: Platform) {
  const [status, setStatus] = useState<SaveStatusValue>('idle');
  const [message, setMessage] = useState('');

  async function save(clientId: number | null, payload: Omit<SaveReportPayload, 'brandId' | 'platform'>, files: RawFileEntry[]) {
    if (!clientId) {
      setStatus('error');
      setMessage('Laporan belum tersimpan — pilih klien di bagian atas halaman.');
      return;
    }
    setStatus('saving');
    setMessage('');
    try {
      await saveReport({ ...payload, brandId: clientId, platform }, files);
      setStatus('saved');
      setMessage('Laporan tersimpan.');
    } catch (err) {
      setStatus('error');
      setMessage('Gagal menyimpan laporan: ' + (err as Error).message);
    }
  }

  return { status, message, save };
}
