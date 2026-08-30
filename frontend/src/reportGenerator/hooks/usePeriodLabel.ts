import { useState } from 'react';

// Ported from the original per-tab period-label pair (shopeePeriodOld/Cur,
// tiktokPeriodOld/Cur) + updateShopeePeriod/setShopeePeriodInput: the visible
// text input can be freely edited (including cleared) by the user, while the
// "effective" label used in the report only updates when the input holds a
// non-empty value — clearing the box does not reset the effective label back
// to the default.
//
// Auto-fill from a detected file period must keep applying every time a new
// file is uploaded into the same slot, but must never clobber a label the
// user actually typed themselves. Both cases look identical from just
// `inputValue` (it's non-empty either way), so `isAutoFilled` tracks *why*
// the box holds its current value: re-uploading a different file re-fires
// autoFill and correctly replaces a previously auto-filled label, while any
// manual keystroke flips isAutoFilled to false and permanently protects that
// label from being overwritten by a later autoFill call.
export function usePeriodLabel(defaultLabel: string) {
  const [inputValue, setInputValue] = useState('');
  const [label, setLabel] = useState(defaultLabel);
  const [isAutoFilled, setIsAutoFilled] = useState(true);

  function onInput(v: string) {
    setInputValue(v);
    setIsAutoFilled(false);
    const trimmed = v.trim();
    if (trimmed) setLabel(trimmed);
  }

  function autoFill(detected: string | undefined | null) {
    if (!detected) return;
    if (!inputValue || isAutoFilled) {
      setInputValue(detected);
      setLabel(detected);
      setIsAutoFilled(true);
    }
  }

  function reset() {
    setInputValue('');
    setLabel(defaultLabel);
    setIsAutoFilled(true);
  }

  return { inputValue, label, onInput, autoFill, reset };
}
