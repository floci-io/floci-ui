'use client';

import * as React from 'react';
import {Icon, ArrowDown, ArrowUp, ChevronSort} from '@/components/sodium/icon';
import {useScrollTabStop} from '@/lib/sodium/scroll';
import {cn} from '@/lib/sodium/utils';
import {Button, type ButtonProps} from '@/components/sodium/ui/button';
import {Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyIcon, EmptyTitle, type EmptyReason} from '@/components/sodium/ui/empty-state';
import {Skeleton} from '@/components/sodium/ui/skeleton';

// Sodium's table: records that share the same fields, the screen Sodium is for. It is one frame: an optional head
// row on the panel (the title as written, a count, quiet icon actions at the end), an optional toolbar row, the column
// heads on the page under a rule, the rows on the page, then an optional footer row on the panel. Nothing inside is
// boxed again; parts are divided by rules. Every part starts 12px in (--inset), the head row's inset, so the title,
// the toolbar, a column head and its cells, the selected row included, start on one edge. Columns stay 12px apart
// (--space-3), the same 12px as the inset at the frame's edges. The head row is --head (38px).
//
// Rows are --row (40px), or --row-sm (32px) at size="sm", split by the faint rule (a cell's bottom edge, so it holds
// under a sticky head); the last row drops it because the frame's edge is right below. Heads are --row-sm tall in
// type-label-sm, mono capitals in text-3, which is 5.6:1 or more on the page: column heads are read on a dense table, not
// glanced at. A sorted head turns text-1.
//
// Cells are the sans at 14px. An ID, a key, a path (mono) and a column of numbers (numeric) are Commit Mono through
// type-code, 13px as written: its x-height is 7.0px against the sans's 7.2px, so the two sit level in one row, and a
// mono figure column lines up digit by digit with no extra feature. A number is right-aligned.
//
// Hover is the hover wash. A selected row (its checkbox ticked) and the one open row take the selection wash, a place
// you are, like a terminal selection. Colour stays out of the rows: a failure is a status word in its cell.
//
// A sortable head is a button inside the th: the label, then an arrow that says the direction; unsorted, a quiet
// up-down mark shows on hover and focus. A numeric head puts the arrow first so the label stays over its numbers.
// Empty and loading are rows of the table, so the heads stay and nothing jumps. The empty row is the display batch's
// Empty, plain and small, at the start of the row where the first cell would be; the loading rows are its Skeleton.

type TableSize = 'default' | 'sm';

/** The head row, the region header every Sodium region opens with: the title as written, the count, then actions at the end, on the panel under a rule. */
function TableTitle({title, count, actions, id, className}: {title: React.ReactNode; count?: React.ReactNode; actions?: React.ReactNode; id?: string; className?: string}) {
  return <div data-slot="table-title" className={cn('panel-head shrink-0', className)}>
    <span id={id} className="min-w-0 truncate text-text-1">{title}</span>
    {count != null && <span data-slot="table-count" className="shrink-0 type-code-sm text-text-2">{count}</span>}
    {actions != null && <div data-slot="table-actions" className="panel-head-actions">{actions}</div>}
  </div>;
}

/** A row under the head row for filters: one row of 26px controls on the page, over a rule. */
function TableToolbar({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="table-toolbar" className={cn('flex min-h-(--row) min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-line px-inset py-1.5', className)} {...props}/>;
}

type TableProps = Omit<React.ComponentProps<'table'>, 'title'> & {
  /** default: 40px rows. sm: 32px rows, for a dense list beside other regions. */
  size?: TableSize;
  /** The head row's title. With it, the table is named by the title unless aria-label is set. */
  title?: React.ReactNode;
  /** After the title: "48", "3 of 12". */
  count?: React.ReactNode;
  /** At the end of the head row: 26px ghost icon buttons (icon-sm) named with aria-label, 8px apart, in the header order: search, refresh, run, copy last. */
  actions?: React.ReactNode;
  /** A row under the head row for filters: a FilterBar. */
  toolbar?: React.ReactNode;
  /** The footer row on the panel: pagination, totals. */
  footer?: React.ReactNode;
  /** Keep the column heads at the top while the rows scroll. Needs maxHeight. */
  stickyHeader?: boolean;
  /** The rows' scroll box height, px or a CSS length. The heads stick inside it. */
  maxHeight?: number | string;
  /** Classes for the frame: width and placement go here. */
  frameClassName?: string;
  /** Classes for the scroll box. */
  containerClassName?: string;
};

function Table({className, size = 'default', title, count, actions, toolbar, footer, stickyHeader = false, maxHeight, frameClassName, containerClassName, ...props}: TableProps) {
  const box = React.useRef<HTMLDivElement>(null);
  const tab = useScrollTabStop(box);
  const titleId = React.useId();
  const name = props['aria-label'];
  const labelledBy = !name && title ? titleId : undefined;
  return <div data-slot="table-frame" data-size={size} className={cn('frame flex flex-col overflow-hidden text-text-1', frameClassName)}>
      {title != null && <TableTitle id={titleId} title={title} count={count} actions={actions}/>}
      {toolbar != null && <TableToolbar>{toolbar}</TableToolbar>}
      <div
        ref={box}
        data-slot="table-container"
        data-sticky-header={stickyHeader || undefined}
        tabIndex={tab}
        role={tab === 0 && (name || labelledBy) ? 'region' : undefined}
        aria-label={tab === 0 && name ? name : undefined}
        aria-labelledby={tab === 0 ? labelledBy : undefined}
        className={cn('group/table relative w-full min-w-0 overflow-auto overscroll-contain focus-visible:focus-ring-inset', containerClassName)}
        // value-ok: the scroll box's height is the caller's, a number of px or any length, so it can only live inline.
        style={maxHeight !== undefined ? {maxHeight} : undefined}
      >
        <table data-slot="table" aria-labelledby={labelledBy} className={cn(tableClassName, className)} {...props}/>
      </div>
      {footer != null && <div data-slot="table-footer-row" className="flex min-w-0 flex-wrap items-center gap-2 border-t border-line bg-panel p-inset type-caption text-text-2 [&>:first-child]:me-auto">{footer}</div>}
  </div>;
}

/** The table element: separate borders, so a cell's rule holds under a sticky head. */
const tableClassName = 'w-full caption-bottom border-separate border-spacing-0 text-start type-body-sm text-text-1';

function TableHeader({className, ...props}: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={className} {...props}/>;
}

/** The body: every row but the last carries the faint rule on its cells. */
const bodyClassName = '[&>tr:not(:last-child)>td]:border-b [&>tr:not(:last-child)>td]:border-line-faint [&>tr:not(:last-child)>th]:border-b [&>tr:not(:last-child)>th]:border-line-faint';

function TableBody({className, ...props}: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn(bodyClassName, className)} {...props}/>;
}

/** Totals: the rule above, the sums in the cells' own roles. */
function TableFooter({className, ...props}: React.ComponentProps<'tfoot'>) {
  return <tfoot data-slot="table-footer" className={cn('bg-panel [&>tr>td]:border-t [&>tr>td]:border-line', className)} {...props}/>;
}

/** Hover, selected and open in one place: the hover wash, and the selection wash for a selected or open row. */
const rowClassName = cn(
  'group/row transition-colors duration-(--dur-state) ease-out',
  '[tbody>&]:hover:bg-hover',
  'data-selected:bg-selected data-selected:hover:bg-selected-strong data-open:bg-selected data-open:hover:bg-selected-strong',
  'forced-colors:data-selected:outline-1 forced-colors:data-selected:-outline-offset-1 forced-colors:data-selected:outline-[Highlight] forced-colors:data-open:outline-2 forced-colors:data-open:-outline-offset-2 forced-colors:data-open:outline-[Highlight]',
);

type TableRowProps = React.ComponentProps<'tr'> & {
  /** The row's checkbox is ticked: the selection wash and aria-selected. */
  selected?: boolean;
  /** The one row whose details are open: the selection wash and aria-current. */
  open?: boolean;
};

function TableRow({className, selected, open, ...props}: TableRowProps) {
  return <tr
    data-slot="table-row"
    data-selected={selected || undefined}
    data-open={open || undefined}
    aria-selected={selected === undefined ? undefined : selected}
    aria-current={open ? 'true' : undefined}
    className={cn(rowClassName, className)}
    {...props}
  />;
}

/** A head cell: --row-sm tall, mono capitals in text-3 on the page (only the region header takes the panel fill), the rule under it, sticky in a sticky table. */
const headClassName = cn(
  'h-(--row-sm) border-b border-line bg-page ps-3 first:ps-inset pe-0 last:pe-inset text-start align-middle type-label-sm whitespace-nowrap text-text-3',
  '[&:has([role=checkbox])]:w-10 [&:has([role=checkbox])]:pe-0',
  'group-data-sticky-header/table:sticky group-data-sticky-header/table:top-0 group-data-sticky-header/table:z-(--z-raised)',
);

/** A body cell: one --row tall (--row-sm small), its text 12px in like the head row, text-1. The first cell starts 12px in and the last ends 12px short of the edge, the region's inset; every other cell starts 12px after the one before, so columns are 12px apart, not 24. A Status, Tag or Checkbox in it sits on the cell's middle, not the sans line's baseline, which dropped a status word 3.5px. */
const cellClassName = 'h-(--row) ps-3 first:ps-inset pe-0 last:pe-inset align-middle whitespace-nowrap *:align-middle text-text-1 in-data-[size=sm]:h-(--row-sm) [&:has([role=checkbox])]:pe-0';

type TableHeadProps = React.ComponentProps<'th'> & {
  /** A column of numbers: right-aligned. */
  numeric?: boolean;
  /** The column's sort: asc, desc or false. Set (even false) or with onSort, the head is a sort button. */
  sort?: 'asc' | 'desc' | false;
  /** Called when the head is pressed. Shift is passed so a caller can add a second sort. */
  onSort?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

function TableHead({className, numeric, sort, onSort, children, ...props}: TableHeadProps) {
  // A head with a sort, or a handler, is a sort button; a server page can show one by passing sort alone.
  const sortable = !!onSort || sort !== undefined;
  return <th
    data-slot="table-head"
    scope="col"
    aria-sort={sortable ? (sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none') : undefined}
    className={cn(headClassName, numeric && 'text-end', sort && 'text-text-1', className)}
    {...props}
  >
    {sortable ? <TableSortButton sort={sort ?? false} numeric={numeric} onClick={onSort}>{children}</TableSortButton> : children}
  </th>;
}

/**
 * The sort button inside a head: the label and the arrow, -6px into the cell's inset so the label stays on the
 * column's edge. The arrow shows the direction; while unsorted, a quiet up-down mark shows on hover and focus.
 */
function TableSortButton({sort, numeric, className, children, ...props}: React.ComponentProps<'button'> & {sort: 'asc' | 'desc' | false; numeric?: boolean}) {
  const icon = sort === 'asc' ? ArrowUp : sort === 'desc' ? ArrowDown : ChevronSort;
  return <button
    type="button"
    data-slot="table-sort"
    data-sorted={sort || undefined}
    className={cn(
      'group/sort -mx-1.5 inline-flex h-(--control-sm) items-center gap-1 px-1.5 type-label-sm text-text-3',
      'transition-colors duration-(--dur-state) ease-out hover:bg-hover hover:text-text-1 data-sorted:text-text-1 focus-visible:focus-ring-inset',
      numeric && 'flex-row-reverse',
      className,
    )}
    {...props}
  >
    <span className="whitespace-nowrap">{children}</span>
    <Icon icon={icon} className={cn('shrink-0', !sort && 'opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100 pointer-coarse:opacity-100')}/>
  </button>;
}

type TableCellProps = React.ComponentProps<'td'> & {
  /** A number: right-aligned, in Commit Mono, so the digits stack by place. */
  numeric?: boolean;
  /** An ID, a key or a path: Commit Mono through type-code, as written. */
  mono?: boolean;
};

function TableCell({className, numeric, mono, ...props}: TableCellProps) {
  return <td data-slot="table-cell" className={cn(cellClassName, (numeric || mono) && 'type-code', numeric && 'text-end', className)} {...props}/>;
}

function TableCaption({className, ...props}: React.ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn('border-t border-line px-inset py-2 text-start type-caption text-text-2', className)} {...props}/>;
}

type TableEmptyProps = Omit<React.ComponentProps<'td'>, 'title'> & {
  /** How many columns the row spans: every column of the table. */
  colSpan: number;
  /** What is missing, as a sentence: "No jobs match timeout." */
  title: React.ReactNode;
  /** One line: why, and what the action does. */
  description?: React.ReactNode;
  /** The one way out: clear the filter, run the pipeline. */
  action?: React.ReactNode;
  /** Why it is empty, for the glyph: no-results after a search or filter. */
  reason?: EmptyReason;
};

/** The body's one row when it has no records: Empty at the start of the row, with a sentence, a reason and one action. */
function TableEmpty({colSpan, title, description, action, reason = 'empty', className, ...props}: TableEmptyProps) {
  return <tr data-slot="table-empty">
    <td colSpan={colSpan} className={cn('p-0 whitespace-normal', className)} {...props}>
      <Empty variant="plain" size="sm" reason={reason}>
        <EmptyIcon/>
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          {description != null && <EmptyDescription>{description}</EmptyDescription>}
        </EmptyHeader>
        {action != null && <EmptyContent>{action}</EmptyContent>}
      </Empty>
    </td>
  </tr>;
}

type TableLoadingProps = {
  /** Placeholder rows. */
  rows?: number;
  /** The table's columns, one bar each. A numeric column's bar sits at the end. */
  columns: number | {numeric?: boolean; checkbox?: boolean}[];
};

/** Still placeholder rows the shape of the cells: Skeleton bars, half a line tall, no sweep. Mark the table aria-busy. */
function TableLoading({rows = 5, columns}: TableLoadingProps) {
  const cols = typeof columns === 'number' ? Array.from({length: columns}, () => ({})) as {numeric?: boolean; checkbox?: boolean}[] : columns;
  const widths = ['w-3/4', 'w-1/2', 'w-2/3'];
  return <>{Array.from({length: rows}, (_, r) => <tr key={r} aria-hidden data-slot="table-loading-row">
    {cols.map((col, c) => <td key={c} className={cn(cellClassName, col.checkbox && 'w-10 pe-0')}>
      <Skeleton className={col.checkbox ? 'size-4' : cn('h-2', col.numeric ? 'ms-auto w-1/3' : widths[(r + c) % 3])}/>
    </td>)}
  </tr>)}</>;
}

type TableRowActionsProps = React.ComponentProps<'div'> & {
  /** Shown in the same place while the actions are hidden: "4m ago". */
  indicator?: React.ReactNode;
  /** false shows the actions all the time. */
  revealOnHover?: boolean;
};

/**
 * Actions at the end of a row that show on row hover or focus. They fade, never unmount, so Tab still reaches them.
 * On a touch screen, where nothing hovers, they always show.
 */
function TableRowActions({indicator, revealOnHover = true, className, children, 'aria-label': ariaLabel = 'Row actions', ...props}: TableRowActionsProps) {
  return <div data-slot="table-row-actions" className={cn("grid shrink-0 items-center justify-items-end [grid-template-areas:'stack']", className)} {...props}>
    {indicator != null && <span className={cn('[grid-area:stack] type-code-sm whitespace-nowrap text-text-3 transition-opacity duration-(--dur-state)', revealOnHover && 'group-hover/row:opacity-0 group-focus-within/row:opacity-0 pointer-coarse:opacity-0')}>{indicator}</span>}
    <div role="group" aria-label={ariaLabel} className={cn('flex items-center gap-0.5 [grid-area:stack] transition-opacity duration-(--dur-state)', revealOnHover && 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100')}>{children}</div>
  </div>;
}

/** One icon action in a row: a 26px ghost icon button. Name it with the row: "Retry job_4f2a". */
function TableRowAction({size = 'icon-sm', variant = 'ghost', ...props}: ButtonProps) {
  return <Button data-slot="table-row-action" variant={variant} size={size} {...props}/>;
}

export {
  Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption, TableEmpty, TableLoading,
  TableTitle, TableToolbar, TableSortButton, TableRowActions, TableRowAction,
  tableClassName, bodyClassName, rowClassName, headClassName, cellClassName,
  type TableProps, type TableRowProps, type TableHeadProps, type TableCellProps, type TableEmptyProps, type TableLoadingProps, type TableRowActionsProps, type TableSize,
};
