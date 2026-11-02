'use client';

import {useEffect, useRef} from 'react';
import {reducedMotion} from '@/lib/sodium/utils';

/**
 * Running: four cells in a 2x2 square, the lit one stepping clockwise once per --dur-pending, in steps with no easing.
 * It runs on the Web Animations API, so the theme needs no keyframes for it. Reduced motion keeps it still, the first
 * cell lit.
 */
function RunningMark() {
  const lit = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = lit.current;
    if (!el || reducedMotion(el)) return;
    const step = (el.parentElement?.offsetWidth ?? 8) - el.offsetWidth;
    const raw = getComputedStyle(el).getPropertyValue('--dur-pending').trim();
    const duration = (parseFloat(raw) || 800) * (raw.endsWith('s') && !raw.endsWith('ms') ? 1000 : 1);
    const sign = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
    const at = (x: number, y: number) => ({translate: `${sign * x * step}px ${y * step}px`, easing: 'steps(1, end)'});
    const walk = el.animate([at(0, 0), at(1, 0), at(1, 1), at(0, 1), at(0, 0)], {duration, iterations: Infinity});
    // Every running mark on the page keeps one clock, so a column of them steps together instead of flickering.
    walk.startTime = 0;
    return () => walk.cancel();
  }, []);
  return <span data-slot="status-running" className="relative grid size-(--marker) shrink-0 grid-cols-2 content-between justify-between">
    {[0, 1, 2, 3].map(i => <span key={i} className="size-(--pending-cell) bg-current opacity-30"/>)}
    <span ref={lit} className="absolute start-0 top-0 size-(--pending-cell) bg-current"/>
  </span>;
}

export {RunningMark};
