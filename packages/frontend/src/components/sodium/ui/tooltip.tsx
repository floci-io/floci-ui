'use client';

import * as React from 'react';
import {Tooltip as TooltipPrimitive} from '@base-ui/react/tooltip';
import {cn, mergeClass} from '@/lib/sodium/utils';
import {useSodiumPortal} from '@/lib/sodium/portal';
import {overlaySurface} from '@/lib/sodium/overlay';
import {Kbd} from '@/components/sodium/ui/kbd';

// Sodium's tooltip, on Base UI's Tooltip. It holds a label and nothing else: the content takes a string and optional
// shortcut keys, so a link, a button or a paragraph cannot get in. It never holds anything essential, because it does
// not open on touch and a screen reader may never meet it; essential text belongs on the page or in a PopoverInfo.
//
// The label also names its trigger: a trigger with no text of its own and no aria-label takes the tooltip's string as
// its aria-label, so what the eye reads and what the screen reader hears are one string and cannot drift.
//
// The look is every other overlay's: the panel fill, a 1px --line edge, square, no arrow and no shadow, 24px
// tall, the label in mono capitals at 12px (it names an action, like a button does). Not an ink chip: on a white page a
// solid block draws the eye like the yellow slab does, and in dark it would be the one bright thing on the screen. It
// opens after 500ms of hover and at once on keyboard focus; inside a TooltipProvider the next trigger in a toolbar
// opens at once.

function TooltipProvider({delay = 500, closeDelay = 0, ...props}: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} closeDelay={closeDelay} {...props}/>;
}

// The label, read from the TooltipContent child at render, so the trigger can be named on the server and on the first
// client render.
const LabelContext = React.createContext<string | null>(null);

/** True when `node` is an element of `component`. */
function isPart<P>(node: unknown, component: React.ComponentType<P>): node is React.ReactElement<P> {
  return React.isValidElement(node) && node.type === component;
}

function Tooltip({children, ...props}: TooltipPrimitive.Root.Props) {
  let label: string | null = null;
  React.Children.forEach(children as React.ReactNode, child => {
    if (isPart(child, TooltipContent)) label = readLabel(child.props.children, false).text || null;
  });
  return <LabelContext.Provider value={label}>
    <TooltipPrimitive.Root data-slot="tooltip" {...props}>{children}</TooltipPrimitive.Root>
  </LabelContext.Provider>;
}

/** The text a node would render, from its string children, without rendering it. */
function textOf(node: React.ReactNode): string {
  let text = '';
  React.Children.forEach(node, child => {
    if (typeof child === 'string' || typeof child === 'number') text += child;
    else if (React.isValidElement<{children?: React.ReactNode; 'aria-hidden'?: unknown}>(child) && !child.props['aria-hidden']) text += textOf(child.props.children);
  });
  return text.trim();
}

// As a wrapper around a disabled control, the wrapper takes the pointer and the focus ring.
const wrapperClass = '[&>:disabled]:pointer-events-none [&>[data-disabled]]:pointer-events-none';

function TooltipTrigger({className, render, children, ...props}: TooltipPrimitive.Trigger.Props) {
  const label = React.useContext(LabelContext);
  // Name a nameless trigger from the label. A caller's own name always wins.
  const el = React.isValidElement<Record<string, unknown>>(render) ? render : null;
  const named = props['aria-label'] || props['aria-labelledby'] || el?.props['aria-label'] || el?.props['aria-labelledby']
    || textOf(children as React.ReactNode) || textOf(el?.props.children as React.ReactNode);
  const naming = !named && label ? {'aria-label': label, 'data-tooltip-named': ''} : undefined;
  return <TooltipPrimitive.Trigger
    data-slot="tooltip-trigger"
    render={render}
    className={mergeClass(wrapperClass, className)}
    {...naming}
    {...props}
  >{children}</TooltipPrimitive.Trigger>;
}

type TooltipPart = string | number | React.ReactElement | false | null | undefined;
type TooltipChildren = TooltipPart | TooltipPart[];

/** Splits children into the label text and the shortcut, dropping anything else. */
function readLabel(children: TooltipChildren, warn = true) {
  let text = '';
  let shortcut: React.ReactElement | null = null;
  for (const child of React.Children.toArray(children)) {
    if (typeof child === 'string' || typeof child === 'number') text += child;
    else if (isPart(child, TooltipShortcut)) shortcut = child;
    else if (warn && child && process.env.NODE_ENV !== 'production') console.error('Tooltip holds a label and a TooltipShortcut only. Move links, buttons and longer text into a Popover.');
  }
  return {text: text.trim(), shortcut};
}

type TooltipContentProps = Omit<TooltipPrimitive.Popup.Props, 'children'> & Pick<TooltipPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'collisionPadding'> & {
  /** The label, in sentence case: a verb and its object for an icon button ("Replay run"). Text, plus at most a TooltipShortcut. */
  children: TooltipChildren;
  /** The action's shortcut, as Kbd writes it: "shift+r". */
  shortcut?: string;
};

/** The chip: the overlay surface, 24px tall, the 12px mono label, 4px of room before a shortcut. */
const tooltipPopupClass = cn(
  'inline-flex min-h-6 w-max max-w-(--tooltip-max) items-center gap-2 px-2 py-1 type-label-sm text-text-1 break-words',
  overlaySurface,
  'has-data-[slot=tooltip-shortcut]:pe-1',
);

/** How it appears: the overlay recipe, travelling --overlay-shift from its trigger; instant inside a group. */
const tooltipMotionClass = 'overlay-motion data-instant:duration-0 data-instant:data-ending-style:duration-0';

/**
 * The chip rendered in place, with the popup's look and none of its behaviour: no portal, no timers. Base UI keeps one
 * tooltip open at a time, so a page that shows several together draws this instead. It is for specimens.
 */
function TooltipChip({className, children, shortcut, ...props}: Omit<React.ComponentProps<'div'>, 'children'> & {children: string; shortcut?: string}) {
  return <div data-slot="tooltip-content" role="presentation" className={cn(tooltipPopupClass, className)} {...props}>
    <span className="min-w-0">{children}</span>
    {shortcut && <TooltipShortcut keys={shortcut}/>}
  </div>;
}

function TooltipContent({className, side = 'top', sideOffset = 6, align = 'center', alignOffset = 0, collisionPadding = 8, children, shortcut, ...props}: TooltipContentProps) {
  const container = useSodiumPortal();
  const {text, shortcut: shortcutChild} = readLabel(children);
  // Nothing to say: no chip at all, rather than an empty one on hover.
  if (!text && !shortcut && !shortcutChild) return null;
  return <TooltipPrimitive.Portal container={container}>
    <TooltipPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className="isolate z-(--z-overlay)"
    >
      <TooltipPrimitive.Popup
        data-slot="tooltip-content"
        className={mergeClass([tooltipPopupClass, tooltipMotionClass], className)}
        {...props}
      >
        <span className="min-w-0">{text}</span>
        {shortcut ? <TooltipShortcut keys={shortcut}/> : shortcutChild}
      </TooltipPrimitive.Popup>
    </TooltipPrimitive.Positioner>
  </TooltipPrimitive.Portal>;
}

/** The shortcut in a tooltip, as Kbd writes it for the reader's platform. */
function TooltipShortcut({keys, className}: {keys: string; className?: string}) {
  return <span data-slot="tooltip-shortcut" className={cn('inline-flex shrink-0', className)}><Kbd keys={keys}/></span>;
}

export {Tooltip, TooltipTrigger, TooltipContent, TooltipChip, TooltipProvider, TooltipShortcut, tooltipPopupClass, tooltipMotionClass, type TooltipContentProps};
