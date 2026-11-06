'use client';

import {createContext, useContext} from 'react';
import {mergeProps} from '@base-ui/react/merge-props';
import {useRender} from '@base-ui/react/use-render';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/sodium/utils';

// The list row: a lead, a name and a sentence, then meta and actions on one line, 40px tall (--row) with one line and
// growing with a description. Rows live in an ItemGroup: a frame whose rows split on the faint rule-row, the last one
// dropping it at the frame's edge. Inside a frame that already draws the edge, use ItemGroup variant="plain".
//
// The name is an identifier more often than a phrase (orders_daily, eu-west-2, worker-07), so ItemTitle is mono as
// written (type-code), never capitals: capitals would change what it says. The sentence under it is the sans caption.
// Meta is mono too, in text-3, because it is a time, a size or a count that lines up down the list.
//
// A row that opens something puts ItemLink in its title: its hit area covers the row, the row takes the hover wash,
// its focus ring is drawn inside the row's edge (the frame would clip one outside it), and ItemActions sit above the
// link as their own buttons. Selected takes the yellow selection wash, like a terminal selection, never a bar on one
// edge.
//
// The row gives up parts as it narrows, by its own width: under 28rem the meta goes, the title truncates last, and
// actions never drop.

const ItemGroupContext = createContext(false);

const itemGroupVariants = cva('group/item-group flex w-full min-w-0 flex-col overflow-hidden', {
  variants: {
    variant: {
      framed: 'frame forced-colors:border-[CanvasText]',
      plain: '',
    },
  },
  defaultVariants: {variant: 'framed'},
});

type ItemGroupProps = React.ComponentProps<'div'> & VariantProps<typeof itemGroupVariants>;

/** The list: a frame of rows, or plain inside a frame. role="list"; each Item inside is a listitem. */
function ItemGroup({className, variant = 'framed', role = 'list', ...props}: ItemGroupProps) {
  return <ItemGroupContext.Provider value={true}>
    <div data-slot="item-group" data-variant={variant} role={role} className={cn(itemGroupVariants({variant}), className)} {...props}/>
  </ItemGroupContext.Provider>;
}

const itemVariants = cva(
  [
    'group/item @container/item relative flex w-full min-w-0 items-center gap-3 text-start text-text-1',
    'transition-[background-color] duration-(--dur-state) ease-out',
    'in-data-[slot=item-group]:rule-row',
    // A row with an ItemLink is one target: the wash under the pointer, the ring inside its edge on focus.
    'has-[[data-slot=item-link]:is(:hover,[data-force-hover])]:bg-hover has-[[data-slot=item-link]:is(:active,[data-force-active])]:bg-pressed',
    'has-[[data-slot=item-link]:is(:focus-visible,[data-force-focus-visible])]:focus-ring-inset',
    'data-selected:selected has-[[data-slot=item-link]:is(:hover,[data-force-hover])]:data-selected:bg-selected-strong',
    'forced-colors:data-selected:outline forced-colors:data-selected:outline-2 forced-colors:data-selected:-outline-offset-2',
    'data-disabled:text-text-disabled',
  ],
  {
    variants: {
      size: {
        default: 'min-h-(--row) px-inset py-1.5 has-data-[slot=item-description]:py-2.5',
        sm: 'min-h-(--row-sm) gap-2 px-inset py-1',
      },
    },
    defaultVariants: {size: 'default'},
  },
);

type ItemProps = useRender.ComponentProps<'div'> & VariantProps<typeof itemVariants> & {
  /** The chosen row in a list: the selection wash. Set aria-current on its link. */
  selected?: boolean;
  /** A row that cannot be opened now: its words go to the disabled grey. */
  disabled?: boolean;
};

function Item({className, size = 'default', selected, disabled, render, ...props}: ItemProps) {
  const inGroup = useContext(ItemGroupContext);
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {className: cn(itemVariants({size}), className)},
      {
        'data-slot': 'item',
        'data-size': size,
        'data-selected': selected ? '' : undefined,
        'data-disabled': disabled ? '' : undefined,
        role: inGroup ? 'listitem' : undefined,
      } as React.ComponentProps<'div'>,
      props,
    ),
    render,
    state: {slot: 'item', size},
  });
}

const itemMediaVariants = cva('flex shrink-0 items-center justify-center group-has-data-[slot=item-description]/item:self-start [&_svg]:pointer-events-none', {
  variants: {
    variant: {
      default: '',
      icon: 'size-8 border border-line bg-page text-text-2 group-data-disabled/item:text-text-disabled',
    },
  },
  defaultVariants: {variant: 'default'},
});

/** The lead: an Avatar, a StatusMark or an icon in a 32px ruled square (variant="icon"). */
function ItemMedia({className, variant = 'default', ...props}: React.ComponentProps<'div'> & VariantProps<typeof itemMediaVariants>) {
  return <div data-slot="item-media" data-variant={variant} className={cn(itemMediaVariants({variant}), className)} {...props}/>;
}

/** The title and description, taking the room left. */
function ItemContent({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="item-content" className={cn('flex min-w-0 flex-1 flex-col gap-0.5', className)} {...props}/>;
}

/** The name, as written, one line, truncated last. A Tag can follow it. */
function ItemTitle({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="item-title" className={cn('flex min-w-0 items-center gap-2 type-code [&>*:first-child]:min-w-0 [&>*:first-child]:truncate', className)} {...props}/>;
}

/** Up to two lines under the title, a sentence in text-2. */
function ItemDescription({className, ...props}: React.ComponentProps<'p'>) {
  return <p data-slot="item-description" className={cn('line-clamp-2 type-caption text-text-2 group-data-disabled/item:text-text-disabled', className)} {...props}/>;
}

/** A time, a size, a count. The first part the row drops: hidden when the row is under 28rem wide. */
function ItemMeta({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="item-meta" className={cn('shrink-0 type-code-sm text-text-3 @max-md/item:hidden', className)} {...props}/>;
}

/**
 * The row's link, inside ItemTitle. Its hit area covers the whole row, ItemActions stay their own buttons above it,
 * and the row takes one tab stop with its ring inside the row's edge.
 */
function ItemLink({className, ...props}: React.ComponentProps<'a'>) {
  return <a data-slot="item-link" data-control="" className={cn('min-w-0 truncate after:absolute after:inset-0 after:content-[""]', className)} {...props}/>;
}

/** Buttons at the end of the row: size="icon-sm" ghost, or one size="sm" secondary Button. They never drop. */
function ItemActions({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="item-actions" className={cn('relative z-(--z-raised) -me-1 flex shrink-0 items-center gap-1', className)} {...props}/>;
}

export {Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemMeta, ItemLink, ItemActions, itemVariants, itemGroupVariants, type ItemProps, type ItemGroupProps};
