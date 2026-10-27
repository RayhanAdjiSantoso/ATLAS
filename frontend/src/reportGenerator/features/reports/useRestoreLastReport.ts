import { useEffect, useRef, useState } from 'react';
import { getSavedPeriods } from './api';
import { forgetLastReport, readLastReport } from './lastReportStore';
import type { Platform, SavedPeriod } from './types';

// Reopens the report a tab last generated for the brand (lastReportStore.ts)
// after the page was left or refreshed — exactly as it looked: both periods
// of that saved run are put back into the tab the way picking them from
// Arsip would (`apply`), then the tab's own Generate runs again once its
// inputs are ready, without saving a second copy. Returns true while the
// periods are still being loaded.
export function useRestoreLastReport({
  platform,
  clientId,
  apply,
  ready,
  generate,
}: {
  platform: Platform;
  clientId: number | null;
  apply: (old: SavedPeriod, cur: SavedPeriod) => Promise<void>;
  ready: boolean;
  // `restoredAt`: when the report was first generated, for its "Generated" line.
  generate: (restoredAt: string) => void;
}): boolean {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'waiting'>(() => (readLastReport(platform, clientId) ? 'loading' : 'idle'));
  const savedAt = useRef('');

  // Once per mount — a tab remounts when the brand changes.
  useEffect(() => {
    const runId = readLastReport(platform, clientId);
    if (!runId || !clientId) return;
    let alive = true;
    getSavedPeriods(clientId, platform)
      .then(async (periods) => {
        const old = periods.find((p) => p.runId === runId && p.role === 'old');
        const cur = periods.find((p) => p.runId === runId && p.role === 'cur');
        // Deleted from Riwayat laporan since: nothing to reopen.
        if (!old || !cur) throw new Error('gone');
        if (!alive) return;
        await apply(old, cur);
        if (!alive) return;
        savedAt.current = cur.savedAt;
        setPhase('waiting');
      })
      .catch(() => {
        if (!alive) return;
        forgetLastReport(platform, clientId);
        setPhase('idle');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'waiting' || !ready) return;
    setPhase('idle');
    generate(savedAt.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ready]);

  return phase === 'loading';
}
