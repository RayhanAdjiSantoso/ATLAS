import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

// Dependency-free scroll-in animation: a child fades + rises the first time
// it enters the viewport, then the observer disconnects (one-shot). The
// global `prefers-reduced-motion` rule in index.css neutralises the
// transition for users who ask for that, so no extra guard is needed here.
interface RevealProps {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'header' | 'footer';
}

export function Reveal({ children, delay = 0, className = '', as = 'div' }: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    // Safety net: never leave content permanently hidden if the observer
    // somehow never fires (odd viewport math, background tab throttling…).
    const fallback = window.setTimeout(() => setShown(true), 2500);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  const Tag = as as 'div';
  return (
    <Tag
      ref={ref as RefObject<HTMLDivElement>}
      className={`reveal${shown ? ' reveal-in' : ''}${className ? ' ' + className : ''}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
