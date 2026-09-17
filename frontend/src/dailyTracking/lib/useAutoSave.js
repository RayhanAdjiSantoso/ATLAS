import { useCallback, useEffect, useRef, useState } from 'react';

const SAVE_DELAY_MS = 600;
const SAVED_FLASH_MS = 1500;

// Debounces edits per-key (a key is one table row, e.g. `${kind}:${channelKey}:${date}`)
// so several cells edited in the same row within the debounce window collapse
// into one PUT /entries call, instead of one call per keystroke. `onSave(key,
// payload)` is called after the debounce settles; `status[key]` is
// 'saving' | 'saved' | 'error' for the duration a caller might want to show
// feedback, then clears itself.
export default function useAutoSave(onSave) {
  const timers = useRef({});
  const pending = useRef({});
  const [status, setStatus] = useState({});

  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout);
  }, []);

  const schedule = useCallback((key, payload) => {
    pending.current[key] = payload;
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(async () => {
      const toSave = pending.current[key];
      delete pending.current[key];
      setStatus((s) => ({ ...s, [key]: 'saving' }));
      try {
        await onSave(key, toSave);
        setStatus((s) => ({ ...s, [key]: 'saved' }));
        setTimeout(() => setStatus((s) => {
          if (s[key] !== 'saved') return s;
          const next = { ...s };
          delete next[key];
          return next;
        }), SAVED_FLASH_MS);
      } catch {
        setStatus((s) => ({ ...s, [key]: 'error' }));
      }
    }, SAVE_DELAY_MS);
  }, [onSave]);

  return { schedule, status };
}
