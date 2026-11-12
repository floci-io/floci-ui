'use client';

import * as React from 'react';
import {Menu as MenuPrimitive} from '@base-ui/react/menu';
import {Toggle as TogglePrimitive} from '@base-ui/react/toggle';
import {Icon, Checkmark, ChevronDown} from '@/components/sodium/icon';
import {menuLabelClass, menuPopupClass, menuSeparatorClass, optionCheckClass, optionItemClass} from '@/lib/sodium/overlay';
import {useSodiumPortal} from '@/lib/sodium/portal';
import {cn, controlHeight} from '@/lib/sodium/utils';
import {Button} from '@/components/sodium/ui/button';
import {Input, type SearchModeProps} from '@/components/sodium/ui/input';

// Sodium's filter bar: the one row above a table, a log or a list that narrows it. One row of 26px controls, 8px apart,
// every one with the same 1px --line edge, the rule a card draws: the search (Input's search mode, small; "/" focuses it from
// anywhere, Escape clears it), then the filters as cells, then the count and Clear at the row's end. The search takes
// the spare width; the filters and the count keep theirs. Under 28rem of bar the search takes a row of its own.
//
// A filter is a cell: its field as a mono label in text-2 (STATUS), then, once set, its value as written in mono
// (failed, eu-west-2), then a caret. A set filter, and a quick filter that is on (FilterToggle), take the selection
// wash under text-1 and keep their edge. They never take the slab or a yellow line: a row of filters has no
// lead, and in dark a tint with a yellow line is the primary button.
//
// Each option in a filter's menu shows how many rows it would leave, counted against the search, every other filter
// and every quick filter, not the whole list. An option that would leave nothing sinks below a rule under "None left",
// so the person sees before picking that it empties the list. useFilteredRows computes the rows and the counts in one
// pass.

/**
 * The row. role="search": name it with aria-label. Children sit in one row, 8px apart: the search, the filters, then
 * the count and Clear pinned to the end. Under 28rem of bar the search takes a row of its own; under 18rem the count
 * is only heard, not shown.
 */
function FilterBar({className, ...props}: React.ComponentProps<'div'>) {
  return <div
    role="search"
    data-slot="filter-bar"
    className={cn(
      '@container flex w-full min-w-0 flex-wrap items-center gap-2',
      '[&>[data-slot=filter-bar-count]]:ms-auto [&>[data-slot=filter-bar-clear]]:ms-auto [&>[data-slot=filter-bar-count]~[data-slot=filter-bar-clear]]:ms-0',
      '@max-2xs:[&>[data-slot=filter-bar-count]]:sr-only @max-2xs:[&>[data-slot=filter-bar-count]~[data-slot=filter-bar-clear]]:ms-auto',
      className,
    )}
    {...props}
  />;
}

// ---------- Search ----------

type FilterBarSearchProps = Omit<SearchModeProps, 'mode' | 'size' | 'value' | 'defaultValue' | 'onValueChange' | 'shortcut' | 'shortcutOwner'> & {
  value: string;
  onValueChange: (value: string) => void;
  /** The key that focuses the search from anywhere outside a field, dialog or menu. null turns it off. */
  shortcut?: string | null;
};

/** The bar's search: Input's search mode at 26px, named by its placeholder, filling the row's spare width. */
function FilterBarSearch({shortcut = '/', placeholder = 'Search', className, 'aria-label': ariaLabel, ...props}: FilterBarSearchProps) {
  return <Input
    mode="search"
    size="sm"
    shortcut={shortcut ?? undefined}
    placeholder={placeholder}
    aria-label={ariaLabel ?? placeholder}
    aria-keyshortcuts={shortcut ?? undefined}
    className={cn('w-auto min-w-32 flex-1 basis-40 @max-md:basis-full', className)}
    {...props}
  />;
}

// ---------- Filter cells ----------

/**
 * The filter cell: 26px, in the field's light: the hair-off-white body and --line edge, the field in mono capitals.
 * Under the pointer it lifts toward white with the hover halo; on (a set filter, a quick filter pressed) is the
 * selection wash under text-1 with the same edge; an open menu turns it white with the --focus edge doubled inward and
 * the pale yellow halo, as a field with the cursor in it. Its capitals start on the small field's text inset.
 */
const filterCellClass = cn(
  controlHeight.sm, 'inline-flex max-w-full shrink-0 cursor-default items-center gap-1.5 border border-(--field-edge) bg-(--field-bg) px-(--field-inset-sm) type-label-sm text-text-2 select-none',
  'transition-[background-color,color,border-color,box-shadow] duration-(--dur-light) ease-soft [-webkit-tap-highlight-color:transparent]',
  'hover:not-data-disabled:bg-(--field-hover) hover:not-data-disabled:border-(--field-edge-hover) hover:not-data-disabled:ring-1 hover:not-data-disabled:ring-(--field-ring-hover) hover:not-data-disabled:text-text-1',
  'data-active:bg-selected data-active:text-text-1 data-pressed:bg-selected data-pressed:text-text-1',
  'hover:not-data-disabled:data-active:bg-selected-strong hover:not-data-disabled:data-pressed:bg-selected-strong',
  'data-popup-open:bg-(--field-focus-bg) data-popup-open:border-focus data-popup-open:inset-ring data-popup-open:inset-ring-focus data-popup-open:ring-1 data-popup-open:ring-(--field-ring-focus)',
  'data-disabled:cursor-not-allowed data-disabled:bg-well data-disabled:text-text-disabled',
  // The caret is --icon-sm, as in a small field: the cell's 12px capitals are shorter than a 16px glyph.
  '[&_svg]:size-(--icon-sm) [&_svg]:shrink-0 [&_svg]:text-text-3 [&_[data-slot=filter-caret]]:transition-[rotate] [&_[data-slot=filter-caret]]:duration-(--dur-state) data-popup-open:[&_[data-slot=filter-caret]]:rotate-180',
  'forced-colors:border-[ButtonText] forced-colors:data-active:outline-2 forced-colors:data-active:-outline-offset-2 forced-colors:data-pressed:outline-2 forced-colors:data-pressed:-outline-offset-2',
);

type FilterToggleProps = Omit<TogglePrimitive.Props, 'className'> & {className?: string};

/** A quick filter that sits pressed: "Failed only", "Mine". On, it takes the selection wash; the label never changes. */
function FilterToggle({className, ...props}: FilterToggleProps) {
  return <TogglePrimitive data-slot="filter-toggle" className={cn(filterCellClass, className)} {...props}/>;
}

/** Clears everything. Render it only while something is set; it hands focus to the search when it goes. */
function FilterBarClear({className, children = 'Clear', onClick, ...props}: Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return <Button
    variant="ghost"
    size="sm"
    data-slot="filter-bar-clear"
    onClick={event => {
      const bar = (event.currentTarget as HTMLElement).closest('[data-slot=filter-bar]');
      onClick?.(event);
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        bar?.querySelector<HTMLElement>('[data-mode=search] [data-control], [data-slot=filter-bar-select]')?.focus();
      });
    }}
    className={className}
    {...props}
  >{children}</Button>;
}

/**
 * "128 of 1,204 jobs", as a mono label: the shown figure in text-1, the rest in text-3. The visible count updates at
 * once; the announcement waits for typing to pause for 500ms, so a screen reader hears one count, not one per key.
 */
function FilterBarCount({shown, total, noun, className, ...props}: React.ComponentProps<'div'> & {shown: number; total: number; noun?: string}) {
  const f = (n: number) => n.toLocaleString('en-US');
  const tail = noun ? ` ${noun}` : '';
  const text = shown === total ? `${f(total)}${tail}` : `${f(shown)} of ${f(total)}${tail}`;
  const [said, setSaid] = React.useState(text);
  React.useEffect(() => {
    const id = window.setTimeout(() => setSaid(text), 500);
    return () => window.clearTimeout(id);
  }, [text]);
  return <div data-slot="filter-bar-count" className={cn('shrink-0 type-label-sm whitespace-nowrap text-text-3 [unicode-bidi:plaintext]', className)} {...props}>
    <span aria-hidden><span className="text-text-1">{f(shown)}</span>{shown === total ? tail : ` of ${f(total)}${tail}`}</span>
    <span role="status" className="sr-only">{said}</span>
  </div>;
}

// ---------- Select ----------

type FilterOption = {
  value: string;
  label: React.ReactNode;
  /** Plain text for the cell and the accessible name when label is not a string. */
  textValue?: string;
  /** How many rows this option leaves, against the other filters. From useFilteredRows. */
  count?: number;
  disabled?: boolean;
};

type FilterBarSelectBase = {
  /** The filter's field, on the cell in mono capitals and in the accessible name: "Status". */
  label: string;
  options: FilterOption[];
  /** An "All" row at the top that clears the filter. */
  showAllOption?: boolean;
  allLabel?: string;
  /** Sink options whose count is 0 below a rule. On when any option has a count. */
  sinkEmpty?: boolean;
  disabled?: boolean;
  className?: string;
  /** Opens with the menu open, for a still picture. */
  defaultOpen?: boolean;
};
type FilterBarSelectSingle = FilterBarSelectBase & {multiple?: false; value?: string | null; defaultValue?: string | null; onValueChange?: (value: string | null) => void};
type FilterBarSelectMultiple = FilterBarSelectBase & {multiple: true; value?: string[]; defaultValue?: string[]; onValueChange?: (value: string[]) => void};
type FilterBarSelectProps = FilterBarSelectSingle | FilterBarSelectMultiple;

const ALL = '__all__';
const optionText = (o: FilterOption) => o.textValue ?? (typeof o.label === 'string' ? o.label : o.value);

function useControllable<T>(value: T | undefined, defaultValue: T, onChange?: (v: T) => void) {
  const [inner, setInner] = React.useState<T>(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const set = (v: T) => { if (!controlled) setInner(v); onChange?.(v); };
  return [current, set] as const;
}

/** An option's row: the value as written, then how many rows it leaves in mono at the end. */
function OptionBody({option}: {option: FilterOption}) {
  return <>
    <span className="min-w-0 flex-1 truncate">{option.label}</span>
    {option.count !== undefined && <span data-slot="filter-option-count" className="ms-auto ps-3 type-code-sm text-text-3">{option.count.toLocaleString('en-US')}</span>}
  </>;
}

/**
 * A filter on a cell that opens a menu. It names its field while nothing is chosen (STATUS), adds the choice once one
 * is (STATUS failed, or a count for several), and takes the selection wash while it narrows the list. Single uses
 * radio rows and closes on a pick; multiple uses checkbox rows and stays open.
 */
function FilterBarSelect(props: FilterBarSelectProps) {
  const {label, options, showAllOption = false, allLabel = 'All', disabled, className, defaultOpen} = props;
  const container = useSodiumPortal();
  const [single, setSingle] = useControllable<string | null>(props.multiple ? undefined : props.value, props.multiple ? null : props.defaultValue ?? null, props.multiple ? undefined : props.onValueChange);
  const [many, setMany] = useControllable<string[]>(props.multiple ? props.value : undefined, props.multiple ? props.defaultValue ?? [] : [], props.multiple ? props.onValueChange : undefined);

  const chosen = props.multiple ? many : single ? [single] : [];
  const active = chosen.length > 0;
  const first = options.find(o => o.value === chosen[0]);
  const accessibleName = `${label}: ${!active ? allLabel : options.filter(o => chosen.includes(o.value)).map(optionText).join(', ')}`;

  const sink = props.sinkEmpty ?? options.some(o => o.count !== undefined);
  const live = sink ? options.filter(o => o.count !== 0 || chosen.includes(o.value)) : options;
  const empty = sink ? options.filter(o => o.count === 0 && !chosen.includes(o.value)) : [];

  const check = (indicator: 'radio' | 'checkbox') => indicator === 'radio'
    ? <MenuPrimitive.RadioItemIndicator render={<span className={optionCheckClass}/>}><Icon icon={Checkmark}/></MenuPrimitive.RadioItemIndicator>
    : <MenuPrimitive.CheckboxItemIndicator render={<span className={optionCheckClass}/>}><Icon icon={Checkmark}/></MenuPrimitive.CheckboxItemIndicator>;

  const row = (o: FilterOption, isEmpty = false) => props.multiple
    ? <MenuPrimitive.CheckboxItem
        key={o.value}
        data-slot="filter-option"
        disabled={o.disabled || isEmpty}
        checked={many.includes(o.value)}
        onCheckedChange={c => setMany(c ? [...many, o.value] : many.filter(v => v !== o.value))}
        closeOnClick={false}
        className={optionItemClass}
      >{check('checkbox')}<OptionBody option={o}/></MenuPrimitive.CheckboxItem>
    : <MenuPrimitive.RadioItem key={o.value} value={o.value} closeOnClick disabled={o.disabled || isEmpty} data-slot="filter-option" className={optionItemClass}>{check('radio')}<OptionBody option={o}/></MenuPrimitive.RadioItem>;

  const sunk = empty.length > 0 && <>
    <MenuPrimitive.Separator className={menuSeparatorClass}/>
    <MenuPrimitive.Group>
      <MenuPrimitive.GroupLabel className={menuLabelClass}>None left with the other filters</MenuPrimitive.GroupLabel>
      {empty.map(o => row(o, true))}
    </MenuPrimitive.Group>
  </>;

  const all = props.multiple
    ? <MenuPrimitive.CheckboxItem checked={!active} onCheckedChange={() => setMany([])} closeOnClick={false} className={optionItemClass}>{check('checkbox')}{allLabel}</MenuPrimitive.CheckboxItem>
    : <MenuPrimitive.RadioItem value={ALL} closeOnClick className={optionItemClass}>{check('radio')}{allLabel}</MenuPrimitive.RadioItem>;

  return <MenuPrimitive.Root defaultOpen={defaultOpen} modal={defaultOpen ? false : undefined}>
    <MenuPrimitive.Trigger
      disabled={disabled}
      aria-label={accessibleName}
      data-slot="filter-bar-select"
      data-filter={label}
      data-active={active || undefined}
      className={cn(filterCellClass, 'pe-1.5', className)}
    >
      <span className="shrink-0">{label}</span>
      {active && (chosen.length > 1
        ? <span className="type-code-sm normal-case text-text-1">{chosen.length}</span>
        : first && <span className="min-w-0 truncate type-code-sm normal-case text-text-1">{optionText(first)}</span>)}
      <Icon icon={ChevronDown} data-slot="filter-caret"/>
    </MenuPrimitive.Trigger>
    <MenuPrimitive.Portal container={container}>
      <MenuPrimitive.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} collisionAvoidance={defaultOpen ? {side: 'none', align: 'none', fallbackAxisSide: 'none'} : undefined} className="isolate z-(--z-overlay) outline-none">
        <MenuPrimitive.Popup data-slot="filter-bar-menu" data-size="sm" finalFocus={defaultOpen ? false : undefined} className={cn(menuPopupClass, 'max-w-[min(var(--available-width),var(--popover))]')}>
          {props.multiple
            ? <>
                {showAllOption && <>{all}<MenuPrimitive.Separator className={menuSeparatorClass}/></>}
                {live.map(o => row(o))}
                {sunk}
              </>
            : <MenuPrimitive.RadioGroup value={single ?? ALL} onValueChange={v => setSingle(v === ALL ? null : v as string)}>
                {showAllOption && <>{all}<MenuPrimitive.Separator className={menuSeparatorClass}/></>}
                {live.map(o => row(o))}
                {sunk}
              </MenuPrimitive.RadioGroup>}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  </MenuPrimitive.Root>;
}

// ---------- Facets ----------

type FacetField<T> = {
  /** The filter id: the key in `filters` and in the returned counts. */
  id: string;
  /** The row's value or values for this field. */
  value: (row: T) => string | readonly string[];
};

/**
 * Filters rows by a search, quick filters and any number of multi-value filters, and counts, for every option of
 * every field, how many rows it would leave given the search, the quick filters and the other filters.
 */
function useFilteredRows<T>(rows: readonly T[], {search = '', match, fields, filters, where}: {
  search?: string;
  /** Quick filters that are on, as row tests. Pass a stable array (useMemo); falsy entries are off. */
  where?: readonly (((row: T) => boolean) | false | null | undefined)[];
  /** Whether a row matches the lower-cased search. */
  match?: (row: T, query: string) => boolean;
  fields: FacetField<T>[];
  /** Field id to chosen values. An empty list or a missing field filters nothing. */
  filters: Record<string, readonly string[] | null | undefined>;
}) {
  return React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const values = (f: FacetField<T>, row: T) => { const v = f.value(row); return typeof v === 'string' ? [v] : v; };
    const passes = (f: FacetField<T>, row: T) => { const chosen = filters[f.id]; return !chosen?.length || values(f, row).some(v => chosen.includes(v)); };
    const counts: Record<string, Record<string, number>> = Object.fromEntries(fields.map(f => [f.id, {}]));
    const out: T[] = [];
    const tests = (where ?? []).filter((t): t is (row: T) => boolean => typeof t === 'function');
    for (const row of rows) {
      if (q && match && !match(row, q)) continue;
      if (!tests.every(t => t(row))) continue;
      const pass = fields.map(f => passes(f, row));
      if (pass.every(Boolean)) out.push(row);
      fields.forEach((f, i) => {
        // A row counts toward this field's options when it passes every other field.
        if (!pass.every((p, j) => j === i || p)) return;
        for (const v of values(f, row)) counts[f.id][v] = (counts[f.id][v] ?? 0) + 1;
      });
    }
    return {rows: out, counts};
  }, [rows, search, match, fields, filters, where]);
}

export {
  FilterBar, FilterBarSearch, FilterToggle, FilterBarSelect, FilterBarClear, FilterBarCount, useFilteredRows,
  type FilterBarSearchProps, type FilterBarSelectProps, type FilterToggleProps, type FilterOption, type FacetField,
};
