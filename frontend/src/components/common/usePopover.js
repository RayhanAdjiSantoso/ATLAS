import { useEffect, useLayoutEffect, useState } from 'react';

// Placement and dismissal for a panel portalled to <body>. Portalling is not
// optional here: Pengaturan Brand's workspace and the dashboard's MOM card both
// clip with overflow:hidden, so an absolutely positioned menu inside them is
// cut off at the card edge. The placement math is DateRangePicker's, lifted so
// the single-date picker and the dropdown open exactly the way it does.
export default function usePopover({ open, onClose, triggerRef, panelRef, matchWidth = false, deps = [] }) {
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const width = matchWidth ? Math.max(anchor.width, panel.offsetWidth) : panel.offsetWidth;
      const height = panel.offsetHeight;
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
      const below = anchor.bottom + 6;
      const top = below + height <= window.innerHeight - 8
        ? below
        : Math.max(8, Math.min(anchor.top - height - 6, window.innerHeight - height - 8));
      setPosition(matchWidth ? { left, top, minWidth: anchor.width } : { left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matchWidth, ...deps]);

  useEffect(() => {
    if (!open) return undefined;
    const inside = (target) => triggerRef.current?.contains(target) || panelRef.current?.contains(target);
    const onPointer = (event) => { if (!inside(event.target)) onClose({ restoreFocus: false }); };
    const onFocus = (event) => { if (!inside(event.target)) onClose({ restoreFocus: false }); };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose({ restoreFocus: true }); }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, triggerRef, panelRef]);

  return position;
}
