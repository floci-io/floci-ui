import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/sodium/utils';

// Sodium's frame: a region's one outer edge, and the parts that divide it by rules. Box a region once with a Frame (a
// table, a log, a pipeline's page) and never box a part inside it again: a FrameHeader is the panel-head row, a
// FrameBody the region's content 12px in on all four sides, a FrameFooter a ruled row of meta and actions.
//
// Every region opens with the same header, read the way a product names a thing: its name in mono as written
// (FrameTitle: `orders-daily`, `Runs`), then at the end its state (FrameStatus: a Status or a live Activity), its meta
// (FrameValue meta: a time, a size) and its actions (FrameActions). No kind word before the name: the frame's
// aria-label carries the kind for assistive tech, and what the body shows says it to the eye. Header, body and footer
// share one 12px inset (--inset). The header is --head (38px) tall, so the name's ink has about 13px above and below
// it, the same as its first glyph's 12px plus the font's side bearing, and the name, the content and the footer's
// meta start on one edge.
//
// A body starts with its data. One that needs a word of explanation opens with FrameDescription, one sentence in
// type-body-sm and text-2, never a headline: the header already names the thing and its state. Two
// bodies in one frame are divided by a rule, drawn by the second, so a strip, a chart or a second part never needs a
// hand-drawn border.
//
//   variant="frame"  the page fill with a 1px --line edge: a region on the page.
//   variant="panel"  the panel fill, a hair warmer than the page: a raised region standing on its own, not inside a
//                    frame. A setting group, a side summary.

const frameVariants = cva('relative flex min-w-0 flex-col text-text-1 forced-colors:border-[CanvasText]', {
  variants: {
    variant: {
      frame: 'frame',
      panel: 'panel',
    },
  },
  defaultVariants: {variant: 'frame'},
});

type FrameProps = React.ComponentProps<'section'> & VariantProps<typeof frameVariants>;

function Frame({className, variant = 'frame', ...props}: FrameProps) {
  const v = variant ?? 'frame';
  return <section
    data-slot="frame"
    data-variant={v}
    className={cn(frameVariants({variant: v}), className)}
    {...props}
  />;
}

/** The header row: the panel fill, a rule under it, the region's name, then its state, meta and actions at the end. */
function FrameHeader({className, ...props}: React.ComponentProps<'header'>) {
  return <header data-slot="frame-header" className={cn('panel-head justify-between', className)} {...props}/>;
}

/** The region's name, first in the header, in mono as written: `orders-daily`, never ORDERS-DAILY. It takes the room and truncates, so the state and meta at the end always show. */
function FrameTitle({className, ...props}: React.ComponentProps<'h2'>) {
  return <h2 data-slot="frame-title" className={cn('me-auto min-w-0 truncate text-text-1 [&:has(+[data-slot=frame-value])]:me-0', className)} {...props}/>;
}

/** The region's state, at the header's end before its meta: a Status (size sm) or a live Activity (size sm). */
function FrameStatus({className, ...props}: React.ComponentProps<'span'>) {
  return <span data-slot="frame-status" className={cn('flex min-w-0 shrink-0 items-center', className)} {...props}/>;
}

type FrameValueProps = React.ComponentProps<'span'> & {
  /** The header's meta at its end (a region, a size, a time) in text-2, where the name is text-1 and takes the room. */
  meta?: boolean;
};

/** The header's meta (a time, a size) at its end in text-2. Without meta, a second identifier right after the title, which then gives it the room. */
function FrameValue({className, meta = false, ...props}: FrameValueProps) {
  return <span data-slot={meta ? 'frame-header-meta' : 'frame-value'} className={cn('type-code-sm normal-case', meta ? 'shrink-0 text-text-2' : 'me-auto min-w-0 truncate text-text-1', className)} {...props}/>;
}

/** The header's actions, at its end, 8px apart: 26px buttons (sm, icon-sm), in the 38px header, the last glyph 12px from the edge (panel-head-actions). Icon-only buttons named with aria-label, quiet (ghost), never the slab. In order: search, refresh, wrap, then navigation such as next failure, then the run action, then copy last. */
function FrameActions({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="frame-actions" className={cn('panel-head-actions', className)} {...props}/>;
}

type FrameBodyProps = React.ComponentProps<'div'> & {
  /** none: rows run to the frame's edge and split on rule-row (a list, a table). default: 12px in on all four sides, the header's inset. */
  padding?: 'default' | 'none';
};

/** What the region holds. Rows inside take rule-row; the last drops it, because the frame's edge is right under it. */
function FrameBody({className, padding = 'default', ...props}: FrameBodyProps) {
  return <div
    data-slot="frame-body"
    data-padding={padding}
    className={cn('flex min-w-0 flex-1 flex-col [[data-slot=frame-body]+&]:border-t [[data-slot=frame-body]+&]:border-line', padding === 'default' && 'gap-3 p-inset', className)}
    {...props}
  />;
}

/** The one sentence that opens a body: what happened or what this is, in type-body-sm and text-2, held to a readable measure. */
function FrameDescription({className, ...props}: React.ComponentProps<'p'>) {
  return <p data-slot="frame-description" className={cn('max-w-(--measure-hint) type-body-sm text-text-2', className)} {...props}/>;
}

/** The footer row: a rule over it, meta at its start, at most one primary at its end, 12px from every edge, so a button's box sits as far from the rules as from the side. */
function FrameFooter({className, ...props}: React.ComponentProps<'footer'>) {
  return <footer data-slot="frame-footer" className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-line p-inset', className)} {...props}/>;
}

/** The footer's meta: a count or a time at the row's start, as written in text-2, the same role as the header's meta. */
function FrameMeta({className, ...props}: React.ComponentProps<'span'>) {
  return <span data-slot="frame-meta" className={cn('me-auto min-w-0 truncate type-code-sm text-text-2', className)} {...props}/>;
}

export {Frame, FrameHeader, FrameTitle, FrameStatus, FrameValue, FrameActions, FrameBody, FrameDescription, FrameFooter, FrameMeta, frameVariants, type FrameProps, type FrameValueProps};
