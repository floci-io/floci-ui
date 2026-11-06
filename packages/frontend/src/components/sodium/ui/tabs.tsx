'use client';

import {createContext, useContext, useEffect, useMemo, useRef} from 'react';
import {Tabs as TabsPrimitive} from '@base-ui/react/tabs';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn, controlHeight, mergeClass, mergeRefs} from '@/lib/sodium/utils';

// Panels of one view, on Base UI Tabs. A row of mono capital labels standing on one rule that runs the width of the
// list. The selected tab is text-1 with a 2px ink bar on that rule; the others are text-2 and turn text-1 under the
// pointer, with no wash. Ink, not yellow: plain tabs are a place you are, and the yellow is spent on the one action.
// NumberedTabs is the one tab row that takes yellow, for a page's few numbered sections.
//
// The selection is a cut, not a slide: a state flip in Sodium happens at once. The list never wraps; when the tabs do
// not fit it scrolls sideways with no bar, and the selected tab scrolls itself into view when it changes. Tabs are 32px
// tall, 26 small. A count after a label takes TabsCount, in tabular figures and text-3.

type Size = 'sm' | 'default';
const ListContext = createContext<{size: Size}>({size: 'default'});

function Tabs({className, ...props}: Omit<TabsPrimitive.Root.Props, 'orientation'>) {
  return <TabsPrimitive.Root data-slot="tabs" className={mergeClass('flex max-w-full min-w-0 flex-col gap-4', className)} {...props}/>;
}

const tabsListVariants = cva(
  // The rule the tabs stand on spans the list: each tab draws its piece and a filler after the last draws the rest, so
  // the rule scrolls with the tabs and the selected tab's bar, drawn over its piece, is never clipped by the scroller.
  'relative flex w-full max-w-full min-w-0 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden after:min-w-0 after:flex-1 after:border-b after:border-line',
  {
    variants: {size: {sm: '', default: ''}},
    defaultVariants: {size: 'default'},
  },
);

type TabsListProps = TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>;

/** Keeps the selected tab in view, on mount and whenever it changes. */
function useActiveInView(list: React.RefObject<HTMLElement | null>, slot: string) {
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const show = () => {
      const tab = el.querySelector<HTMLElement>(`[data-slot=${slot}][data-active]`);
      if (!tab) return;
      const box = el.getBoundingClientRect(), t = tab.getBoundingClientRect();
      if (t.left < box.left) el.scrollBy({left: t.left - box.left});
      else if (t.right > box.right) el.scrollBy({left: t.right - box.right});
    };
    show();
    const mo = new MutationObserver(records => { if (records.some(r => (r.target as HTMLElement).hasAttribute('data-active'))) show(); });
    mo.observe(el, {subtree: true, attributes: true, attributeFilter: ['data-active']});
    return () => mo.disconnect();
  }, [list, slot]);
}

function TabsList({className, size = 'default', ref, ...props}: TabsListProps) {
  const list = useRef<HTMLDivElement>(null);
  const refs = useMemo(() => mergeRefs(list, ref), [ref]);
  const s = size ?? 'default';
  useActiveInView(list, 'tabs-trigger');
  const ctx = useMemo(() => ({size: s}), [s]);
  return <ListContext.Provider value={ctx}>
    <TabsPrimitive.List ref={refs} data-slot="tabs-list" data-size={s} className={mergeClass(tabsListVariants({size: s}), className)} {...props}/>
  </ListContext.Provider>;
}

/** What every tab shares, plain or numbered: the label, the hover, the inset ring a scrolling list cannot clip, the bar. */
const tabBase = cn(
  'relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 border-b border-line whitespace-nowrap select-none [-webkit-tap-highlight-color:transparent]',
  'text-text-2 hover:not-data-disabled:text-text-1 focus-visible:focus-ring-inset',
  '[&_svg]:pointer-events-none [&_svg]:size-(--icon) [&_svg]:shrink-0',
  'data-disabled:cursor-not-allowed data-disabled:text-text-disabled forced-colors:data-disabled:text-[GrayText]',
  // The bar: 2px on the list's rule, under the selected tab only, covering the tab's piece of the rule.
  'after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-transparent',
  'data-active:text-text-1 forced-colors:data-active:after:bg-[Highlight]',
);

const tabSize: Record<Size, string> = {
  sm: `${controlHeight.sm} px-2.5 type-label-sm`,
  default: `${controlHeight.default} px-3 type-label`,
};

function TabsTrigger({className, ...props}: TabsPrimitive.Tab.Props) {
  const {size} = useContext(ListContext);
  return <TabsPrimitive.Tab
    data-slot="tabs-trigger"
    className={mergeClass([tabBase, tabSize[size], 'data-active:after:bg-text-1'], className)}
    {...props}
  />;
}

function TabsContent({className, ...props}: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel
    data-slot="tabs-content"
    className={mergeClass('min-w-0 flex-1 type-body-sm text-text-1 focus-visible:focus-ring-inset', className)}
    {...props}
  />;
}

/** How many things a tab's panel holds, after its label, in tabular figures and text-3. */
function TabsCount({className, ...props}: React.ComponentProps<'span'>) {
  return <span data-slot="tabs-count" className={cn('data text-text-3', className)} {...props}/>;
}

export {Tabs, TabsList, TabsTrigger, TabsContent, TabsCount, tabsListVariants, tabBase, useActiveInView, type TabsListProps};
