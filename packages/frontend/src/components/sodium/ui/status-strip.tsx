'use client';

import {mergeProps} from '@base-ui/react/merge-props';
import {useRender} from '@base-ui/react/use-render';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/sodium/utils';

// Sodium's own piece: a ruled row of cells, each a mono label over its value, for the few numbers a person checks
// before anything else on a screen. A cluster's workers, a queue's depth, the warehouse's credits, the last load. It
// sits at the top of a frame or as a footer bar, like a terminal's status line.
//
// Cells share 1px rules with no gap, the frame's own rules carried through, and wrap into more rows when the strip
// narrows, each cell at least 160px (--label-col) wide, so a phone shows two columns and the rules still meet. The
// label is a stat label, type-label-sm in text-2, and the value a stat value, type-code in text-1, written as it is:
// values are compared, so they are never set in capitals. A data list and a meter use the same two roles.
//
// One cell may be selected: the place you are, or the number the view below is filtered by. It takes the yellow
// selection wash under ink, like a terminal selection, and aria-current. A cell that filters is a button (render),
// which adds the hover wash and the focus ring inside its rules.
//
// variant="framed" (default) draws the strip's own edge, for a strip standing on the page; plain leaves it to the
// frame around it, for a strip as the first or last row of a region.

const stripVariants = cva('@container/strip min-w-0 overflow-hidden', {
  variants: {
    variant: {
      framed: 'border border-line bg-page forced-colors:border-[CanvasText]',
      plain: '',
    },
  },
  defaultVariants: {variant: 'framed'},
});

type StatusStripProps = React.ComponentProps<'div'> & VariantProps<typeof stripVariants> & {
  /** Names the strip for a screen reader: "Cluster status". */
  label?: string;
};

function StatusStrip({className, variant = 'framed', label, children, ...props}: StatusStripProps) {
  return <div data-slot="status-strip" data-variant={variant} role="group" aria-label={label} className={cn(stripVariants({variant}), className)} {...props}>
    {/* The cells draw their end and bottom rules; the grid runs 1px past the box so the last ones are clipped away. */}
    <div data-slot="status-strip-cells" className="-me-px -mb-px grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--label-col)),1fr))]">
      {children}
    </div>
  </div>;
}

type StatusStripCellProps = useRender.ComponentProps<'div'> & {
  /** The place you are, or the number the view is filtered by: the selection wash and aria-current. One per strip. */
  selected?: boolean;
};

/** One cell: a StatusStripLabel over a StatusStripValue. Render it as a button when choosing it filters the view. */
function StatusStripCell({className, selected, render, ...props}: StatusStripCellProps) {
  const interactive = !!render || !!props.onClick;
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          'relative flex min-w-0 flex-col justify-center gap-0.5 border-e border-b border-line px-inset py-inset text-start text-text-1',
          'transition-[background-color] duration-(--dur-state) ease-out',
          interactive && 'cursor-pointer select-none hover:bg-hover active:bg-pressed focus-visible:focus-ring-inset',
          selected && 'selected hover:bg-selected-strong active:bg-selected-strong',
          'forced-colors:data-selected:outline forced-colors:data-selected:outline-2 forced-colors:data-selected:-outline-offset-2',
          className,
        ),
      },
      {'data-slot': 'status-strip-cell', 'data-selected': selected ? '' : undefined, 'aria-current': selected ? 'true' : undefined} as React.ComponentProps<'div'>,
      props,
    ),
    render,
    state: {slot: 'status-strip-cell', selected},
  });
}

/** What the number is, in small mono capitals: "Workers", "Queue depth". */
function StatusStripLabel({className, ...props}: React.ComponentProps<'span'>) {
  return <span data-slot="status-strip-label" className={cn('flex min-w-0 items-center gap-1.5 truncate type-label-sm text-text-2 [&_svg]:size-(--icon) [&_svg]:shrink-0', className)} {...props}/>;
}

/** The number or the word, as written, with a StatusMark or a unit beside it. A mark is drawn at the figures' cap
 *  height and sits on their baseline, 6px before them, so it reads as part of the value, not a bullet. */
function StatusStripValue({className, ...props}: React.ComponentProps<'span'>) {
  return <span data-slot="status-strip-value" className={cn(
    'flex min-w-0 items-baseline gap-1.5 truncate type-code text-text-1',
    '[&>[data-slot=status-mark]]:h-auto [&>[data-slot=status-mark]]:self-baseline [&>[data-slot=status-mark]]:[--marker:var(--cap)]',
    className,
  )} {...props}/>;
}

/** A unit or a delta after the value, in text-2: "/ 64", "+12%". */
function StatusStripUnit({className, ...props}: React.ComponentProps<'span'>) {
  return <span data-slot="status-strip-unit" className={cn('text-text-2', className)} {...props}/>;
}

export {StatusStrip, StatusStripCell, StatusStripLabel, StatusStripValue, StatusStripUnit, stripVariants, type StatusStripProps, type StatusStripCellProps};
