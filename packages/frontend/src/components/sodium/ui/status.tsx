import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/sodium/utils';
import {RunningMark} from '@/components/sodium/ui/running-mark';

// Where a job, a run or a partition stands: a square mark and a word in mono capitals. The word is the status; the
// mark is how the eye finds it down a column. Never a dot: Sodium is square, and a dot says only "something".
//
// Each mark is an 8px square drawn from cells and lines, and each has its own silhouette, so the set reads in
// grayscale, in forced colours and at a glance:
//   idle     a hollow square, text-3: nothing is happening
//   queued   a hollow square holding one 2px cell: something is waiting inside
//   running  four 3px cells in a 2x2 square, one lit and stepping round: the pending mark folded into a square
//   paused   two upright bars
//   ok       a solid square
//   warn     a square filled to half
//   fail     a solid square turned on its corner: the one silhouette that breaks the grid
//
// Colour means an outcome, so only ok, warn and fail take it, mark and word in one colour. idle and queued are
// text-2 words (the marks text-3 and text-2), running and paused are ink.
//
// The mark sits in a cell one line tall, so it centres on the capitals of the first line and stays there when the
// word wraps. live speaks once when the status settles (ok, warn, fail, paused) through a hidden status region.

type StatusValue = 'idle' | 'queued' | 'running' | 'paused' | 'ok' | 'warn' | 'fail';

const statuses = ['idle', 'queued', 'running', 'paused', 'ok', 'warn', 'fail'] as const satisfies readonly StatusValue[];

const statusLabels: Record<StatusValue, string> = {
  idle: 'Idle',
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  ok: 'Succeeded',
  warn: 'Warning',
  fail: 'Failed',
};

/** Severity for sorting a status column: failures first, idle last. Higher is worse. */
const statusRank: Record<StatusValue, number> = {fail: 6, warn: 5, paused: 4, running: 3, queued: 2, ok: 1, idle: 0};

/** ok, warn and fail end a piece of work, and paused stops it; the others are on the way. */
const settled = (status: StatusValue) => status === 'ok' || status === 'warn' || status === 'fail' || status === 'paused';

const statusVariants = cva('inline-flex max-w-full min-w-0 items-start gap-2', {
  variants: {
    size: {
      default: 'type-label',
      sm: 'type-label-sm',
    },
    status: {
      idle: 'text-text-2',
      queued: 'text-text-2',
      running: 'text-text-1',
      paused: 'text-text-1',
      ok: 'text-ok-text',
      warn: 'text-warn-text',
      fail: 'text-fail-text',
    },
  },
  defaultVariants: {size: 'default', status: 'idle'},
});

/** The mark's own colour, where it differs from the word's. */
const markColor: Record<StatusValue, string> = {
  idle: 'text-text-3', queued: 'text-text-2', running: 'text-text-1', paused: 'text-text-1', ok: 'text-ok', warn: 'text-warn', fail: 'text-fail',
};

type StatusProps = Omit<React.ComponentProps<'span'>, 'children'> & Omit<VariantProps<typeof statusVariants>, 'status'> & {
  status?: StatusValue;
  /** Speak once when the status settles on ok, warn, fail or paused; stay quiet on the way. */
  live?: boolean;
  /** Replaces the default word. One to three words that keep the outcome: "Load failed". */
  children?: React.ReactNode;
};

function Status({status = 'idle', size = 'default', live, className, children, ...props}: StatusProps) {
  const word = children ?? statusLabels[status];
  return <span
    data-slot="status"
    data-status={status}
    data-size={size}
    className={cn(statusVariants({size, status}), className)}
    {...props}
  >
    <StatusMark status={status}/>
    <span data-slot="status-word" aria-hidden={live && settled(status) ? true : undefined} className="min-w-0 [overflow-wrap:anywhere]">{word}</span>
    {/* The region is always in the DOM, so the change from empty to the word is what gets announced. */}
    {live && <span role="status" className="sr-only">{settled(status) ? (typeof word === 'string' ? word : statusLabels[status]) : ''}</span>}
  </span>;
}

/**
 * The mark on its own, one line tall, for a dense spot where a word beside it already names the status (a status
 * strip cell, an alert's title). Pass label when nothing beside it does; without one it is hidden from assistive tech.
 */
function StatusMark({status = 'idle', label, className, ...props}: Omit<React.ComponentProps<'span'>, 'children'> & {status?: StatusValue; label?: string}) {
  return <span
    data-slot="status-mark"
    data-status={status}
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    className={cn('flex h-lh shrink-0 items-center forced-colors:text-[CanvasText]', markColor[status], className)}
    {...props}
  >
    <MarkShape status={status}/>
  </span>;
}

function MarkShape({status}: {status: StatusValue}) {
  const box = 'relative flex size-(--marker) shrink-0';
  switch (status) {
    case 'idle': return <span className={cn(box, 'border border-current')}/>;
    case 'queued': return <span className={cn(box, 'items-center justify-center border border-current')}><span className="size-0.5 bg-current"/></span>;
    case 'running': return <RunningMark/>;
    case 'paused': return <span className={cn(box, 'justify-between px-px')}><span className="w-0.5 bg-current"/><span className="w-0.5 bg-current"/></span>;
    case 'ok': return <span className={cn(box, 'bg-current')}/>;
    case 'warn': return <span className={cn(box, 'items-end border border-current')}><span className="h-1/2 w-full bg-current"/></span>;
    case 'fail': return <span className={cn(box, 'items-center justify-center')}><span className="size-1.5 rotate-45 bg-current"/></span>;
  }
}

export {Status, StatusMark, statusVariants, statuses, statusLabels, statusRank, type StatusProps, type StatusValue};
