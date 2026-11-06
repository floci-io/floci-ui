'use client';

import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {cn} from '@/lib/sodium/utils';

// Holds the shape of content while it loads, so nothing moves when the content lands.
// - Skeleton is a square block on the well. Give it the size of the real thing (size-6 for an avatar,
//   h-(--control) w-24 for a button).
// - SkeletonText is lines of text. Pass the type role of the real text: each line is one line box of that role, so a
//   three-line paragraph and its skeleton are the same height to the pixel. The bar is half the line tall, which for a
//   13px mono label on its 16px line is within a pixel of the capitals it stands in for.
// - SkeletonRows is a list's rows on their faint rules, 40px each, for a frame that is waiting on its first page.
// - SkeletonSwap decides when to show it.
//
// The fill is the well, still: no sweep, no pulse. Sodium has one loop, the pending mark, and a moving skeleton is a
// second one that says nothing the block does not.
//
// SkeletonSwap never flashes. On a first load it holds the skeleton's space but keeps it invisible for 150ms, so a
// fast response swaps straight to content; once shown, the skeleton stays at least 400ms, so a response at 170ms does
// not blink it on and off. On a refresh the content on screen stays as it is and the region says aria-busy: a skeleton
// stands in for missing content, never for content being refreshed.

const WAIT_SHOW = 150;
const WAIT_HOLD = 400;

function Skeleton({className, ...props}: React.ComponentProps<'div'>) {
  return <div
    data-slot="skeleton"
    aria-hidden
    className={cn('shrink-0 bg-well forced-colors:bg-[GrayText]', className)}
    {...props}
  />;
}

type TextRole = 'heading' | 'heading-sm' | 'body' | 'body-sm' | 'caption' | 'label' | 'label-sm' | 'micro' | 'code' | 'code-sm';

const roles: Record<TextRole, string> = {
  heading: 'type-heading', 'heading-sm': 'type-heading-sm', body: 'type-body', 'body-sm': 'type-body-sm', caption: 'type-caption',
  label: 'type-label', 'label-sm': 'type-label-sm', micro: 'type-micro', code: 'type-code', 'code-sm': 'type-code-sm',
};

type SkeletonTextProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** The type role of the text it stands in for. Sets the line height, so the heights match. */
  type?: TextRole;
  /** Number of lines. */
  lines?: number;
  /** Width of the last line, as a fraction of the full width. */
  last?: number;
};

/** Lines of text: each one line box of the role tall, the last line shorter. */
function SkeletonText({className, type = 'body', lines = 1, last = 0.6, ...props}: SkeletonTextProps) {
  const count = Math.max(1, Math.floor(lines));
  return <div data-slot="skeleton-text" data-type={type} aria-hidden className={cn('flex w-full flex-col', roles[type], className)} {...props}>
    {Array.from({length: count}, (_, i) => <div key={i} className="flex h-lh items-center">
      <Skeleton
        className="h-1/2 w-full data-last:w-(--last)"
        data-last={count > 1 && i === count - 1 ? '' : undefined}
        style={{'--last': `${Math.min(1, Math.max(0.1, last)) * 100}%`} as CSSProperties}
      />
    </div>)}
  </div>;
}

type SkeletonRowsProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** How many rows. Match the page size, so the frame keeps its height when the rows land. */
  rows?: number;
};

/** A list's rows waiting on their first page: a name bar and a meta bar on each 40px row, on the faint rules. */
function SkeletonRows({className, rows = 4, ...props}: SkeletonRowsProps) {
  const widths = ['w-2/5', 'w-1/2', 'w-1/3', 'w-2/5', 'w-1/4'];
  return <div data-slot="skeleton-rows" aria-hidden className={cn('flex w-full min-w-0 flex-col', className)} {...props}>
    {Array.from({length: Math.max(1, rows)}, (_, i) => <div key={i} className="flex min-h-(--row) items-center gap-3 px-inset rule-row">
      <Skeleton className="size-(--marker)"/>
      <Skeleton className={cn('h-2.5', widths[i % widths.length])}/>
      <Skeleton className="ms-auto h-2 w-12"/>
    </div>)}
  </div>;
}

type SkeletonSwapProps = {
  /** True while the content is loading. */
  loading: boolean;
  /** The skeleton, shaped like the content. */
  fallback: ReactNode;
  children: ReactNode;
  /** ms the skeleton stays invisible before it shows. A response inside it swaps straight to content. */
  delay?: number;
  /** ms the skeleton stays once shown. */
  minDuration?: number;
  /** Names what is loading for a screen reader: "Loading runs". */
  label?: string;
  className?: string;
};

/**
 * Shows fallback on a first load without a flash: invisible for delay (its space held), then shown for at least
 * minDuration. On a refresh the content stays and the region is marked busy.
 */
function SkeletonSwap({loading, fallback, children, delay = WAIT_SHOW, minDuration = WAIT_HOLD, label = 'Loading', className}: SkeletonSwapProps) {
  const [phase, setPhase] = useState<'hidden' | 'shown' | 'done'>(loading ? 'hidden' : 'done');
  const [hasContent, setHasContent] = useState(!loading);
  const shownAt = useRef(0);

  useEffect(() => {
    if (loading) {
      if (hasContent) return;
      setPhase('hidden');
      const t = setTimeout(() => { shownAt.current = Date.now(); setPhase('shown'); }, delay);
      return () => clearTimeout(t);
    }
    setPhase(p => (p === 'shown' ? p : 'done'));
  }, [loading, delay, hasContent]);

  // Once shown, hold until minDuration has passed, even if loading already ended.
  useEffect(() => {
    if (loading || phase !== 'shown') return;
    const t = setTimeout(() => setPhase('done'), Math.max(0, minDuration - (Date.now() - shownAt.current)));
    return () => clearTimeout(t);
  }, [loading, phase, minDuration]);

  useEffect(() => { if (phase === 'done' && !loading) setHasContent(true); }, [phase, loading]);

  const refreshing = loading && hasContent;
  const holding = !refreshing && phase !== 'done';
  return <div
    data-slot="skeleton-swap"
    data-phase={refreshing ? 'stale' : phase}
    aria-busy={holding || refreshing || undefined}
    className={className}
  >
    {holding
      ? <><div className={cn(phase === 'hidden' && 'invisible')}>{fallback}</div><span className="sr-only" role="status">{phase === 'shown' ? label : ''}</span></>
      : children}
  </div>;
}

export {Skeleton, SkeletonText, SkeletonRows, SkeletonSwap, type SkeletonTextProps, type SkeletonRowsProps, type SkeletonSwapProps, type TextRole};
