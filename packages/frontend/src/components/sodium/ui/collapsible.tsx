'use client';

import {createContext, useContext, type ReactNode} from 'react';
import {Collapsible as CollapsiblePrimitive} from '@base-ui/react/collapsible';
import {Accordion as AccordionPrimitive} from '@base-ui/react/accordion';
import {cn} from '@/lib/sodium/utils';
import {Icon, ChevronRight} from '@/components/sodium/icon';

// Shows and hides one region, or a stack of them. One set of parts for both:
//   <Collapsible>                      one trigger, one region (Base UI Collapsible)
//   <CollapsibleGroup><Collapsible>    a stack where one or many are open (Base UI Accordion)
// Inside a group, Collapsible, CollapsibleTrigger and CollapsibleContent render the accordion's item, header and
// trigger, and panel, so going from one to many changes one wrapper.
//
// A standalone trigger is a quiet control: no edge, a mono label in capitals, the hover wash, 32px tall (26 small). In
// a group each trigger is a 40px row and the rows are split by the faint rule; variant="framed" boxes the stack once
// with a frame, variant="plain" leaves only the rules, for a stack already inside a frame. Never a frame per row.
//
// A closed section can say what it holds without opening: `summary` ("2 of 14 partitions failed") sits after the
// label as a sentence in the caption role while the region is closed and goes when it opens. summaryStatus="fail" or
// "warn" sets it in that status's word, because a failure inside is the reason to open. The caret turns a quarter and
// the region cuts open: a state flip in Sodium happens at once.

type GroupContextValue = {variant: 'framed' | 'plain'};
const GroupContext = createContext<GroupContextValue | null>(null);

type CollapsibleProps = CollapsiblePrimitive.Root.Props & {
  /** Inside a group: the item's value. Defaults to its index. */
  value?: AccordionPrimitive.Item.Props['value'];
};

function Collapsible({className, value, ...props}: CollapsibleProps) {
  const group = useContext(GroupContext);
  if (group) return <AccordionPrimitive.Item
    data-slot="collapsible"
    value={value}
    className={cn('rule-row', className as string)}
    {...(props as AccordionPrimitive.Item.Props)}
  />;
  return <CollapsiblePrimitive.Root data-slot="collapsible" className={cn('flex flex-col', className as string)} {...props}/>;
}

type GroupProps = Omit<AccordionPrimitive.Root.Props, 'multiple'> & {
  /** framed: the rows boxed once by a frame (settings, an inspector). plain: rules only, for a stack already inside a frame. */
  variant?: 'framed' | 'plain';
  /** More than one open at once. */
  multiple?: boolean;
};

/** A stack of Collapsibles; one open at a time unless multiple. */
function CollapsibleGroup({className, variant = 'framed', multiple = false, ...props}: GroupProps) {
  return <GroupContext.Provider value={{variant}}>
    <AccordionPrimitive.Root
      data-slot="collapsible-group"
      data-variant={variant}
      multiple={multiple}
      className={cn('group/collapsible-group flex w-full flex-col', variant === 'framed' && 'frame', className as string)}
      {...props}
    />
  </GroupContext.Provider>;
}

type TriggerProps = CollapsiblePrimitive.Trigger.Props & {
  /** Hides the caret, for triggers that bring their own indicator. */
  caret?: boolean;
  /** Standalone only: 26px (sm) or 32px (default). */
  size?: 'sm' | 'default';
  /** What the closed region holds, in a few words: "2 of 14 failed". Hidden while open. */
  summary?: ReactNode;
  /** The summary reports a problem: the warn or fail word colour instead of text-2. */
  summaryStatus?: 'warn' | 'fail';
};

/** The summary, after the label: a sentence in the caption role. A status sets it in that status's word colour. */
function Summary({children, status}: {children: ReactNode; status?: 'warn' | 'fail'}) {
  return <span
    data-slot="collapsible-summary"
    data-status={status}
    className={cn('min-w-0 truncate normal-case type-caption group-data-panel-open/collapsible-trigger:hidden', status === 'fail' ? 'text-fail-text' : status === 'warn' ? 'text-warn-text' : 'text-text-2')}
  >{children}</span>;
}

function CollapsibleTrigger({className, children, caret = true, size = 'default', summary, summaryStatus, ...props}: TriggerProps) {
  const group = useContext(GroupContext);
  if (group) return <AccordionPrimitive.Header data-slot="collapsible-header" className="flex">
    <AccordionPrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        'group/collapsible-trigger flex min-h-(--row) flex-1 items-center gap-2 px-3 py-2 text-start type-label text-text-1',
        'hover:not-data-disabled:bg-hover data-disabled:cursor-not-allowed data-disabled:text-text-disabled',
        'focus-visible:focus-ring-inset',
        'group-data-[variant=plain]/collapsible-group:px-0 group-data-[variant=plain]/collapsible-group:hover:not-data-disabled:bg-transparent',
        className as string,
      )}
      {...(props as AccordionPrimitive.Trigger.Props)}
    >
      {caret && <CollapsibleCaret/>}
      {/* Label and summary share one wrapping row, so a summary that does not fit drops under the label. */}
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="min-w-0">{children}</span>
        {summary && <Summary status={summaryStatus}>{summary}</Summary>}
      </span>
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>;
  return <CollapsiblePrimitive.Trigger
    data-slot="collapsible-trigger"
    data-size={size}
    className={cn(
      'group/collapsible-trigger inline-flex w-max max-w-full items-center gap-2 self-start text-start text-text-1',
      'hover:not-data-disabled:bg-hover active:not-data-disabled:bg-pressed data-disabled:cursor-not-allowed data-disabled:text-text-disabled',
      size === 'sm' ? 'min-h-(--control-sm) ps-1.5 pe-2.5 type-label-sm' : 'min-h-(--control) ps-2 pe-3 type-label',
      className as string,
    )}
    {...props}
  >
    {caret && <CollapsibleCaret/>}
    <span className="min-w-0 truncate">{children}</span>
    {summary && <Summary status={summaryStatus}>{summary}</Summary>}
  </CollapsiblePrimitive.Trigger>;
}

/** The caret that turns a quarter, at once, when its trigger's region is open. Points to the end in right to left. */
function CollapsibleCaret({className}: {className?: string}) {
  return <Icon
    icon={ChevronRight}
    data-slot="collapsible-caret"
    className={cn('size-(--icon) shrink-0 text-text-3 rtl:-scale-x-100 group-data-panel-open/collapsible-trigger:rotate-90 rtl:group-data-panel-open/collapsible-trigger:-rotate-90', className)}
  />;
}

/**
 * The region. className styles the box that holds the content: inside a group it is the text under the label, lined
 * up with it past the caret; standalone it is the panel itself, which has no padding of its own. Group panels stay in
 * the DOM as hidden="until-found", so find-in-page reaches a closed section and opens it.
 */
function CollapsibleContent({className, children, ...props}: CollapsiblePrimitive.Panel.Props) {
  const group = useContext(GroupContext);
  if (group) return <AccordionPrimitive.Panel
    hiddenUntilFound
    data-slot="collapsible-content"
    className="overflow-hidden"
    {...(props as AccordionPrimitive.Panel.Props)}
  >
    <div className={cn(
      'max-w-(--measure) ps-9 pe-3 pb-4 type-body-sm text-text-2 group-data-[variant=plain]/collapsible-group:ps-6',
      '[&_a]:text-text-1 [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-4 [&_p:not(:last-child)]:mb-2',
      className as string,
    )}>{children}</div>
  </AccordionPrimitive.Panel>;
  return <CollapsiblePrimitive.Panel
    data-slot="collapsible-content"
    className={cn('overflow-hidden', className as string)}
    {...props}
  >{children}</CollapsiblePrimitive.Panel>;
}

export {Collapsible, CollapsibleGroup, CollapsibleTrigger, CollapsibleCaret, CollapsibleContent, type CollapsibleProps, type TriggerProps as CollapsibleTriggerProps};
