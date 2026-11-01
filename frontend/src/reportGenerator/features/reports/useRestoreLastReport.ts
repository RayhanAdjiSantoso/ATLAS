import { useEffect, useRef, useState } from 'react';
import { getSavedPeriods } from './api';
import { forgetLastReport, readLastReport } from './lastReportStore';
import type { Platform, SavedPeriod } from './types';

// Offers to reopen the report a tab last generated for the brand
// (lastReportStore.ts) after the page was refreshed or the brand changed.
// Only offered: every platform tab mounts at once, and reopening on its own
// meant each one downloading and parsing its files and rebuilding its report
// before anyone asked — so nothing is fetched until `restore` is pressed.
// Then both periods of that saved run are put back into the tab the way
// picking them from Arsip would (`apply`), and the tab's own Generate runs
// once its inputs are ready, without saving a second copy.
//
// A new sign-in starts with nothing to offer (AuthContext clears the tab's
// session state).
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
}): { offered: boolean; restoring: boolean; restore: () => void; dismiss: () => void } {
  const [phase, setPhase] = useState<'idle' | 'offered' | 'loading' | 'waiting'>(() => (readLastReport(platform, clientId) ? 'offered' : 'idle'));
  const savedAt = useRef('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function restore() {
    const runId = readLastReport(platform, clientId);
    if (!runId || !clientId) {
      setPhase('idle');
      return;
    }
    setPhase('loading');
    getSavedPeriods(clientId, platform)
      .then(async (periods) => {
        const old = periods.find((p) => p.runId === runId && p.role === 'old');
        const cur = periods.find((p) => p.runId === runId && p.role === 'cur');
        // Deleted from Riwayat laporan since: nothing to reopen.
        if (!old || !cur) throw new Error('gone');
        if (!alive.current) return;
        await apply(old, cur);
        if (!alive.current) return;
        savedAt.current = cur.savedAt;
        setPhase('waiting');
      })
      .catch(() => {
        if (!alive.current) return;
        forgetLastReport(platform, clientId);
        setPhase('idle');
      });
  }

  function dismiss() {
    forgetLastReport(platform, clientId);
    setPhase('idle');
  }

  useEffect(() => {
    if (phase !== 'waiting' || !ready) return;
    setPhase('idle');
    generate(savedAt.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ready]);

  // Still offered only while the run is remembered: Reset forgets it.
  return { offered: phase === 'offered' && readLastReport(platform, clientId) !== null, restoring: phase === 'loading', restore, dismiss };
}
