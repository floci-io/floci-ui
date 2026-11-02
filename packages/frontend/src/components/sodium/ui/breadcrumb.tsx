'use client';

import * as React from 'react';
import {mergeProps} from '@base-ui/react/merge-props';
import {useRender} from '@base-ui/react/use-render';
import {Icon, OverflowMenuHorizontal} from '@/components/sodium/icon';
import {cn} from '@/lib/sodium/utils';
import {Button} from '@/components/sodium/ui/button';
import {DropdownMenu, DropdownMenuContent, DropdownMenuLinkItem, DropdownMenuTrigger} from '@/components/sodium/ui/dropdown-menu';

// Where the page sits, written as a path: PIPELINES / ingest-events / RUNS / 4812. The places are mono labels in
// capitals; a name a person gave a thing (a pipeline, a table, a run ID) is a value, so BreadcrumbValue sets it in mono
// as written, never capitalised. Between them a slash in text-3, because a trail of places in a data tool is a path.
// Ancestors are text-2 links that turn text-1 and underline under the pointer; the current page is text-1 and not a
// link. One line, on a 26px row so the fold button fits it.
//
// BreadcrumbTrail is the trail from data. It measures itself against its container and gives ground in a fixed order:
// middle crumbs fold into a ghost More button's menu from the left, then the current page truncates with its full text
// as a title, then the root joins the menu. The current page goes last and never to nothing, and every ancestor stays
// one press away.

function Breadcrumb({className, ...props}: React.ComponentProps<'nav'>) {
  return <nav aria-label="Breadcrumb" data-slot="breadcrumb" className={cn('min-w-0', className)} {...props}/>;
}

function BreadcrumbList({className, ...props}: React.ComponentProps<'ol'>) {
  return <ol
    data-slot="breadcrumb-list"
    className={cn('flex min-h-(--control-sm) min-w-0 flex-wrap items-center gap-x-2 gap-y-1 type-label text-text-2 wrap-break-word', className)}
    {...props}
  />;
}

function BreadcrumbItem({className, ...props}: React.ComponentProps<'li'>) {
  return <li data-slot="breadcrumb-item" className={cn('inline-flex min-w-0 items-center gap-1.5', className)} {...props}/>;
}

/** An ancestor: a link. Pass render={<Link href="…"/>} for a router's link. */
function BreadcrumbLink({className, render, ...props}: useRender.ComponentProps<'a'>) {
  return useRender({
    defaultTagName: 'a',
    props: mergeProps<'a'>({
      className: cn(
        'inline-flex min-w-0 items-center gap-1.5 text-text-2 decoration-line-control underline-offset-4',
        'hover:text-text-1 hover:underline [&_svg]:size-(--icon) [&_svg]:shrink-0',
        className,
      ),
      'data-slot': 'breadcrumb-link',
    } as React.ComponentProps<'a'>, props),
    render,
  });
}

/** The current page: text-1, not a link, aria-current="page". */
function BreadcrumbPage({className, ...props}: React.ComponentProps<'span'>) {
  return <span
    data-slot="breadcrumb-page"
    aria-current="page"
    className={cn('inline-flex min-w-0 items-center gap-1.5 text-text-1 [&_svg]:size-(--icon) [&_svg]:shrink-0', className)}
    {...props}
  />;
}

/** The slash between two places, in text-3. A path reads the same way in either direction, so it never mirrors. */
function BreadcrumbSeparator({children, className, ...props}: React.ComponentProps<'li'>) {
  return <li
    data-slot="breadcrumb-separator"
    role="presentation"
    aria-hidden="true"
    className={cn('inline-flex shrink-0 items-center text-text-3 select-none', className)}
    {...props}
  >{children ?? '/'}</li>;
}

/** The folded crumbs as a still mark, for a hand-built trail. BreadcrumbTrail puts a menu in its place. */
function BreadcrumbEllipsis({className, ...props}: React.ComponentProps<'span'>) {
  return <span data-slot="breadcrumb-ellipsis" className={cn('inline-flex size-(--control-sm) items-center justify-center text-text-2', className)} {...props}>
    <Icon icon={OverflowMenuHorizontal}/>
    <span className="sr-only">More</span>
  </span>;
}

/** Cuts a long value in the middle and keeps its type prefix: run_8f2a91c0d4e5b6a7 reads run_8f2a…e5b6a7. */
function shortValue(value: string) {
  if (value.length <= 22) return null;
  const prefix = value.indexOf('_');
  const headLength = prefix > 0 && prefix < 10 ? prefix + 5 : 10;
  return {head: value.slice(0, headLength), tail: value.slice(-6)};
}

/**
 * A name a person gave a thing, inside a link or the page: mono as written, at the label's size, never capitalised.
 * Past 22 characters the middle is cut, the type prefix kept, and the whole value is the accessible name.
 */
function BreadcrumbValue({children, className, ...props}: Omit<React.ComponentProps<'span'>, 'children'> & {children: string}) {
  const cut = shortValue(children);
  return <span data-slot="breadcrumb-value" title={cut ? children : undefined} className={cn('normal-case type-code [overflow-wrap:anywhere]', className)} {...props}>
    {cut ? <><span aria-hidden>{cut.head}…{cut.tail}</span><span className="sr-only">{children}</span></> : children}
  </span>;
}

type Crumb = {
  label: string;
  href?: string;
  /** A name a person gave a thing: set as written in mono (BreadcrumbValue), not as a label in capitals. */
  value?: boolean;
};

type BreadcrumbTrailProps = Omit<React.ComponentProps<'nav'>, 'children'> & {
  /** Root first, current page last. The last item is the current page and is not a link. */
  items: Crumb[];
  /** Renders each link, for a router's Link: renderLink={href => <Link href={href}/>}. */
  renderLink?: (href: string) => React.ReactElement;
};

const crumbLabel = (c: Crumb) => c.value ? <BreadcrumbValue>{c.label}</BreadcrumbValue> : c.label;

/** folded: middle crumbs in the menu, from the left. root: the root still shows. cut: the current page truncates. */
type Fit = {folded: number; root: boolean; cut: boolean};

function BreadcrumbTrail({items, renderLink, className, ...props}: BreadcrumbTrailProps) {
  const nav = React.useRef<HTMLElement>(null);
  const measureRef = React.useRef<HTMLOListElement>(null);
  const [fit, setFit] = React.useState<Fit>({folded: 0, root: true, cut: false});
  const last = items.length - 1;
  const middle = Math.max(0, last - 1);

  React.useLayoutEffect(() => {
    const el = nav.current;
    const r = measureRef.current;
    if (!el || !r) return;
    const measure = () => {
      const width = el.clientWidth;
      const w = (q: string) => (r.querySelector(q) as HTMLElement | null)?.getBoundingClientRect().width ?? 0;
      const crumbs = items.map((_, i) => w(`[data-crumb="${i}"]`));
      const sep = w('[data-sep]');
      const menu = w('[data-menu]');
      const floor = Math.min(crumbs[last] ?? 0, w('[data-floor]'));
      const gap = parseFloat(getComputedStyle(r).columnGap) || 0;
      const row = (folded: number, root: boolean, page: number) => {
        const parts: number[] = [];
        if (last > 0 && root) parts.push(crumbs[0]);
        if (folded > 0 || (last > 0 && !root)) parts.push(menu);
        for (let i = 1 + folded; i < last; i += 1) parts.push(crumbs[i]);
        parts.push(page);
        return parts.reduce((s, x) => s + x, 0) + (parts.length - 1) * (sep + 2 * gap);
      };
      const fits = (x: number) => x <= width + 0.5;
      let next: Fit = {folded: middle, root: false, cut: !fits(row(middle, false, crumbs[last]))};
      for (let n = 0; n <= middle; n += 1) {
        if (fits(row(n, true, crumbs[last]))) { next = {folded: n, root: true, cut: false}; break; }
      }
      if (!next.root && fits(row(middle, true, floor))) next = {folded: middle, root: true, cut: true};
      if (last === 0) next = {folded: 0, root: true, cut: !fits(crumbs[0])};
      setFit(f => f.folded === next.folded && f.root === next.root && f.cut === next.cut ? f : next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items, last, middle]);

  const link = (c: Crumb) => <BreadcrumbLink href={c.href ?? '#'} render={c.href && renderLink ? renderLink(c.href) : undefined}>{crumbLabel(c)}</BreadcrumbLink>;
  const hidden = [...(fit.root || last === 0 ? [] : [items[0]]), ...items.slice(1, 1 + fit.folded)];
  const page = items[last];

  return <Breadcrumb ref={nav} data-folded={hidden.length || undefined} data-cut={fit.cut || undefined} className={cn('relative', className)} {...props}>
    <BreadcrumbList className="flex-nowrap">
      {last > 0 && fit.root && <>
        <BreadcrumbItem className="shrink-0">{link(items[0])}</BreadcrumbItem>
        <BreadcrumbSeparator/>
      </>}
      {hidden.length > 0 && <>
        <BreadcrumbItem className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger
              data-slot="breadcrumb-fold"
              aria-label={`${hidden.length} more ${hidden.length === 1 ? 'level' : 'levels'}`}
              render={<Button variant="ghost" size="icon-sm"/>}
            ><Icon icon={OverflowMenuHorizontal}/></DropdownMenuTrigger>
            <DropdownMenuContent data-slot="breadcrumb-fold-menu" size="sm" className="max-w-(--popover)">
              {hidden.map((h, i) => <DropdownMenuLinkItem
                key={h.label + i}
                render={h.href && renderLink ? renderLink(h.href) : <a href={h.href ?? '#'}/>}
                className="min-w-0"
              ><span className="truncate">{crumbLabel(h)}</span></DropdownMenuLinkItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </BreadcrumbItem>
        <BreadcrumbSeparator/>
      </>}
      {items.slice(1 + fit.folded, last).map((c, i) => <React.Fragment key={c.label + i}>
        <BreadcrumbItem className="shrink-0">{link(c)}</BreadcrumbItem>
        <BreadcrumbSeparator/>
      </React.Fragment>)}
      {page && <BreadcrumbItem className="min-w-0">
        <BreadcrumbPage className="min-w-0" title={fit.cut ? page.label : undefined}><span dir="auto" className="truncate">{crumbLabel(page)}</span></BreadcrumbPage>
      </BreadcrumbItem>}
    </BreadcrumbList>
    {/* The measure: every crumb at its natural width, out of sight and clipped to nothing, so it never widens the page. */}
    <div aria-hidden inert className="pointer-events-none invisible absolute start-0 top-0 size-0 overflow-hidden">
      <ol ref={measureRef} className="flex w-max flex-nowrap items-center gap-x-2 type-label">
        {items.map((c, i) => <li key={c.label + i} data-crumb={i} className="inline-flex shrink-0 items-center whitespace-nowrap">{crumbLabel(c)}</li>)}
        <li data-sep className="inline-flex shrink-0">/</li>
        <li data-menu className="size-(--control-sm) shrink-0"/>
        <li data-floor className="w-20 shrink-0"/>
      </ol>
    </div>
  </Breadcrumb>;
}

export {Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis, BreadcrumbValue, BreadcrumbTrail, type Crumb, type BreadcrumbTrailProps};
