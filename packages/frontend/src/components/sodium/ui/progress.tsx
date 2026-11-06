'use client';

import {createContext, useContext, type ReactNode} from 'react';
import {Progress as ProgressPrimitive} from '@base-ui/react/progress';
import {cn, mergeClass} from '@/lib/sodium/utils';

// How far a task got: a backfill over 1,240 partitions, an export, an index build. On Base UI Progress
// (role="progressbar"). For a level inside a range, use Meter.
//
// The bar is a row of square cells, 4px wide with 2px between, like a terminal's [#####-----]: the empty cells in the
// rule colour, the done cells in ink (text-1). A task is work, not data, so it is ink and never the sodium yellow,
// and the cells tell it apart from a meter's continuous fill at a glance. The fill wipes to its new width, linear.
//
// status="fail" turns the done cells red and the reading says "Failed"; "warn" turns them orange with "Slow". Never
// hue alone. Indeterminate (value null) leaves every cell empty and puts the pending mark where the reading goes:
// Sodium has one loop, and it is the pending mark, so the bar never sweeps.
//
// Two sizes: 8px (--meter) and 4px. The label is a stat label (type-label-sm, text-2); the reading at the end is a
// stat value (type-code, as written, tabular), the same pair as a meter.

type ProgressStatus = 'warn' | 'fail';

const statusWords: Record<ProgressStatus, string> = {warn: 'Slow', fail: 'Failed'};

const ProgressContext = createContext<{status?: ProgressStatus; indeterminate: boolean; statusLabel?: ReactNode}>({indeterminate: false});

type ProgressProps = Omit<ProgressPrimitive.Root.Props, 'value'> & {
  /** min to max. null or left out is indeterminate. */
  value?: number | null;
  /** The bar's thickness: 8px by default, 4px small. */
  size?: 'default' | 'sm';
  /** A task in trouble: its failures pass a limit (fail) or it runs behind (warn). */
  status?: ProgressStatus;
  /** The words after the reading when status is set. "Slow" and "Failed" by default. */
  statusLabel?: ReactNode;
};

/** The cell pattern: 4px of cell, 2px of gap, from the start edge. A mask paints nothing; the fills are roles. */
const cells = cn(
  '[mask-image:repeating-linear-gradient(to_right,currentColor_0_var(--space-1),transparent_var(--space-1)_calc(var(--space-1)+var(--space-0-5)))]',
  'rtl:[mask-image:repeating-linear-gradient(to_left,currentColor_0_var(--space-1),transparent_var(--space-1)_calc(var(--space-1)+var(--space-0-5)))]',
);

function Progress({className, children, value = null, min = 0, max = 100, size = 'default', status, statusLabel, ...props}: ProgressProps) {
  const indeterminate = value === null;
  return <ProgressContext.Provider value={{status, indeterminate, statusLabel}}>
    <ProgressPrimitive.Root
      data-slot="progress"
      data-size={size}
      data-status={status}
      data-indeterminate={indeterminate || undefined}
      value={value}
      min={min}
      max={max}
      locale="en-US"
      getAriaValueText={(formatted: string | null) => [formatted ?? (indeterminate ? 'In progress' : ''), status ? (typeof statusLabel === 'string' ? statusLabel : statusWords[status]) : ''].filter(Boolean).join(', ')}
      className={mergeClass('group/progress flex w-full min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2', className)}
      {...props}
    >
      {children}
      <ProgressPrimitive.Track
        data-slot="progress-track"
        className={cn('relative block w-full basis-full overflow-hidden bg-line forced-colors:bg-[GrayText]', cells, size === 'sm' ? 'h-1' : 'h-(--meter)')}
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className={cn(
            'block h-full bg-text-1 transition-[width] duration-(--dur-wipe) ease-linear forced-colors:bg-[CanvasText]',
            'group-data-[status=warn]/progress:bg-warn group-data-[status=fail]/progress:bg-fail group-data-indeterminate/progress:hidden',
          )}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  </ProgressContext.Provider>;
}

/** What is progressing, in mono capitals at the start of the row above the bar. */
function ProgressLabel({className, ...props}: ProgressPrimitive.Label.Props) {
  return <ProgressPrimitive.Label data-slot="progress-label" className={mergeClass('min-w-0 flex-1 truncate type-label-sm text-text-2', className)} {...props}/>;
}

type ProgressValueProps = Omit<ProgressPrimitive.Value.Props, 'children'> & {
  /** Formats the reading: {(formatted, value) => `${value} of 1,240`}. */
  children?: ((formattedValue: string, value: number) => ReactNode) | null;
};

/** The reading at the end of the row. With a status the word comes first; while indeterminate, the pending mark. */
function ProgressValue({className, children, ...props}: ProgressValueProps) {
  const {status, indeterminate, statusLabel} = useContext(ProgressContext);
  const cls = cn('ms-auto inline-flex shrink-0 items-baseline gap-2 type-code text-text-1', className as string);
  if (indeterminate) return <span data-slot="progress-value" className={cn(cls, 'items-center self-center text-text-2')}><span className="pending"/></span>;
  return <span className={cls}>
    {status && <span data-slot="progress-status" className={cn('type-label-sm', status === 'fail' ? 'text-fail-text' : 'text-warn-text')}>{statusLabel ?? statusWords[status]}</span>}
    <ProgressPrimitive.Value data-slot="progress-value" {...props}>
      {children ? (formatted: string | null, value: number | null) => children(formatted ?? '', value ?? 0) : undefined}
    </ProgressPrimitive.Value>
  </span>;
}

export {Progress, ProgressLabel, ProgressValue, type ProgressProps, type ProgressValueProps, type ProgressStatus};
