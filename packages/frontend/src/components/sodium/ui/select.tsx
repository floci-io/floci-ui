'use client';

import * as React from 'react';
import {Input as InputPrimitive} from '@base-ui/react/input';
import {Select as SelectPrimitive} from '@base-ui/react/select';
import {Icon, Checkmark, ChevronDown, ChevronSort, ChevronUp} from '@/components/sodium/icon';
import {menuLabelClass, menuPopupClass, menuSeparatorClass, optionCheckClass, optionItemClass} from '@/lib/sodium/overlay';
import {useSodiumPortal} from '@/lib/sodium/portal';
import {cn, controlHeight, mergeClass} from '@/lib/sodium/utils';
import {useFieldDisabled} from '@/components/sodium/ui/field';

// Sodium's select, on Base UI's Select: one choice from a list in a popup.
//
// The trigger is Input's field (styles.css, field): square, the secondary's hair-off-white body with a 1px --line
// edge, 32px tall, 26 small, 36 large, the chosen value as written in the sans and an up-down caret in text-3 at the
// end. Under the pointer it lifts toward white, as a field does; focus or an open popup turn it white with the --focus
// edge doubled inward and the pale yellow halo. Invalid is the red edge and halo; disabled sits on the well. The text
// starts on the field's text inset and the caret's ink sits as far from the end as from the top and bottom.
//
// The popup is the list every Sodium list shares (lib/overlay.ts): the overlay surface, rows edge to edge at 32px, at
// least as wide as the trigger, the option text on the trigger's own inset so the two line up. The highlighted row
// lifts to white; the chosen row carries an ink check in its trailing column and no fill.
//
// Options are values, not actions, so they read as written in the sans, the words the trigger shows once chosen.
// A menu's items are actions and take mono capitals; that is the dropdown menu, not this.
//
// native renders the platform <select> on the same field: the phone's own picker and no popup.

type SelectSize = 'sm' | 'default' | 'lg';

/**
 * The field as a button: Select's trigger, and any later picker's. The field recipe draws every state: the lift under
 * the pointer, and focus, which an open popup keeps while focus is in the list.
 */
const fieldTriggerClass = cn(
  'field group/trigger w-full cursor-default justify-between text-start select-none',
  'data-disabled:cursor-not-allowed',
  '[&_svg]:pointer-events-none [&_svg]:size-(--field-icon) [&_svg]:shrink-0 [&_svg]:text-text-3 data-disabled:[&_svg]:text-text-disabled',
  'forced-colors:border-[ButtonText]',
);

/** The caret's size, as Input's slots: 16px beside 14 and 15px text, 14px (--icon-sm) beside the small field's 13px. */
const fieldIcon: Record<SelectSize, string> = {sm: '[--field-icon:var(--icon-sm)]', default: '[--field-icon:var(--icon)]', lg: '[--field-icon:var(--icon)]'};

/** The size the field recipe measures its insets by: the height token and the text inset. */
const fieldInset: Record<SelectSize, string> = {
  sm: '[--field-size:var(--control-sm)] [--field-px:var(--field-inset-sm)]',
  default: '[--field-size:var(--control)] [--field-px:var(--field-inset)]',
  lg: '[--field-size:var(--control-lg)] [--field-px:var(--field-inset-lg)]',
};

/** The field's size: its height token, its insets, the text inside it, the caret's size. */
const fieldTriggerSize: Record<SelectSize, string> = {
  sm: `${controlHeight.sm} [--field-h:auto] ${fieldInset.sm} type-caption ${fieldIcon.sm}`,
  default: `${controlHeight.default} [--field-h:auto] ${fieldInset.default} type-body-sm ${fieldIcon.default}`,
  lg: `${controlHeight.lg} [--field-h:auto] ${fieldInset.lg} type-body ${fieldIcon.lg}`,
};

type SelectItemDef = {value: string; label: React.ReactNode; disabled?: boolean};
type SelectItems = readonly SelectItemDef[] | Record<string, React.ReactNode>;

const listOf = (items?: SelectItems): SelectItemDef[] => !items ? [] : Array.isArray(items) ? [...items] : Object.entries(items).map(([value, label]) => ({value, label}));

type SelectProps = Omit<SelectPrimitive.Root.Props<string>, 'items' | 'onValueChange'> & {
  /** The options, so the trigger shows the chosen label before the popup has opened. Required with native. */
  items?: SelectItems;
  onValueChange?: (value: string | null) => void;
  /** Renders the platform <select> from items on the same field. */
  native?: boolean;
  /** native: 26, 32 or 36px. The popup trigger takes its size on SelectTrigger. */
  size?: SelectSize;
  /** native: the empty first option, shown in text-3. */
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

function Select({items, native, size = 'default', placeholder, className, children, onValueChange, ...props}: SelectProps) {
  const list = React.useMemo(() => listOf(items), [items]);
  const inField = useFieldDisabled();
  if (native) {
    const {value, defaultValue, disabled, name, required, id, inputRef: _ref, ...rest} = props as Record<string, unknown> & {value?: string | null; defaultValue?: string | null};
    const aria = Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('aria-') || k.startsWith('data-')));
    return <NativeSelect
      size={size}
      className={className}
      value={value === undefined ? undefined : value ?? ''}
      defaultValue={defaultValue === undefined ? undefined : defaultValue ?? ''}
      disabled={!!disabled || inField}
      name={name as string | undefined}
      required={required as boolean | undefined}
      id={id as string | undefined}
      onChange={e => onValueChange?.(e.currentTarget.value || null)}
      {...aria}
    >
      {placeholder !== undefined && <option value="" disabled>{placeholder}</option>}
      {list.map(i => <option key={i.value} value={i.value} disabled={i.disabled}>{typeof i.label === 'string' ? i.label : i.value}</option>)}
    </NativeSelect>;
  }
  return <SelectPrimitive.Root
    data-slot="select"
    items={items === undefined ? undefined : list.map(i => ({value: i.value, label: i.label}))}
    onValueChange={onValueChange as SelectPrimitive.Root.Props<string>['onValueChange']}
    {...props}
    disabled={props.disabled || inField}
  >{children}</SelectPrimitive.Root>;
}

type SelectTriggerProps = SelectPrimitive.Trigger.Props & {
  /** 26, 32 or 36px. Match the buttons and fields beside it. */
  size?: SelectSize;
  'aria-invalid'?: boolean;
};

function SelectTrigger({className, size = 'default', children, 'aria-invalid': invalid, ...props}: SelectTriggerProps) {
  return <SelectPrimitive.Trigger
    data-slot="select-trigger"
    data-size={size}
    aria-invalid={invalid || undefined}
    className={mergeClass([fieldTriggerClass, fieldTriggerSize[size]], className)}
    {...props}
  >
    {children}
    {/* The caret's ink, not its box, sits as far from the end as from the top and bottom. */}
    <SelectPrimitive.Icon className="flex me-(--field-pull-chevron)"><Icon icon={ChevronSort}/></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>;
}

/** The chosen label, or the placeholder in text-3. A block, so a long label ends in an ellipsis. */
function SelectValue({className, ...props}: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" className={mergeClass('block min-w-0 flex-1 truncate data-placeholder:text-text-3', className)} {...props}/>;
}

type SelectContentProps = SelectPrimitive.Popup.Props & Pick<SelectPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'alignItemWithTrigger' | 'collisionAvoidance'> & {
  /** sm: 26px rows in the 13px caption, for a select opened from a small trigger. */
  size?: 'default' | 'sm';
};

function SelectContent({className, children, side = 'bottom', sideOffset = 4, align = 'start', alignOffset = 0, alignItemWithTrigger = false, collisionAvoidance, size = 'default', ...props}: SelectContentProps) {
  const container = useSodiumPortal();
  return <SelectPrimitive.Portal container={container}>
    <SelectPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} alignOffset={alignOffset} alignItemWithTrigger={alignItemWithTrigger} collisionPadding={8} collisionAvoidance={collisionAvoidance} className="isolate z-(--z-overlay) outline-none">
      <SelectPrimitive.Popup
        data-slot="select-content"
        data-size={size}
        // The list recipe, but the list scrolls inside, between the scroll arrows, not the popup.
        className={mergeClass([menuPopupClass, 'min-w-(--anchor-width) max-w-[min(var(--popover),var(--available-width))] overflow-hidden'], className)}
        {...props}
      >
        <SelectScrollUpButton/>
        <SelectPrimitive.List className="max-h-[min(var(--popup-max),var(--available-height))] overflow-y-auto overscroll-contain">{children}</SelectPrimitive.List>
        <SelectScrollDownButton/>
      </SelectPrimitive.Popup>
    </SelectPrimitive.Positioner>
  </SelectPrimitive.Portal>;
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props}/>;
}

function SelectLabel({className, ...props}: SelectPrimitive.GroupLabel.Props) {
  return <SelectPrimitive.GroupLabel data-slot="select-label" className={mergeClass(menuLabelClass, className)} {...props}/>;
}

/** One option: the value after a 36px column that holds the check once it is chosen. */
function SelectItem({className, children, ...props}: SelectPrimitive.Item.Props) {
  return <SelectPrimitive.Item data-slot="select-item" className={mergeClass(optionItemClass, className)} {...props}>
    <SelectPrimitive.ItemIndicator render={<span className={optionCheckClass}/>}>
      <Icon icon={Checkmark}/>
    </SelectPrimitive.ItemIndicator>
    <SelectPrimitive.ItemText className="block min-w-0 flex-1 truncate">{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>;
}

function SelectSeparator({className, ...props}: SelectPrimitive.Separator.Props) {
  return <SelectPrimitive.Separator data-slot="select-separator" className={mergeClass(menuSeparatorClass, className)} {...props}/>;
}

const arrowClass = 'z-(--z-raised) flex h-(--control-sm) w-full shrink-0 cursor-default items-center justify-center bg-panel text-text-3 [&_svg]:size-(--icon)';

function SelectScrollUpButton({className, ...props}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return <SelectPrimitive.ScrollUpArrow data-slot="select-scroll-up" className={mergeClass(['top-0', arrowClass], className)} {...props}><Icon icon={ChevronUp}/></SelectPrimitive.ScrollUpArrow>;
}

function SelectScrollDownButton({className, ...props}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return <SelectPrimitive.ScrollDownArrow data-slot="select-scroll-down" className={mergeClass(['bottom-0', arrowClass], className)} {...props}><Icon icon={ChevronDown}/></SelectPrimitive.ScrollDownArrow>;
}

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  /** 26, 32 or 36px tall. */
  size?: SelectSize;
};

/** The platform select on the field. Prefer `<Select native items/>`; this is the free-form part. */
function NativeSelect({className, size = 'default', ...props}: NativeSelectProps) {
  const primitive = props as unknown as Omit<InputPrimitive.Props, 'className' | 'size'>;
  return <div data-slot="native-select" data-size={size} className={cn('group/native relative w-full min-w-0', fieldIcon[size], fieldInset[size], className)}>
    <InputPrimitive
      data-slot="native-select-control"
      render={<select/>}
      className={cn(
        fieldTriggerClass, fieldTriggerSize[size],
        // The platform's own arrow goes; the caret below takes its place, its ink on the glyph inset, the text clear of it.
        'cursor-pointer appearance-none pe-[calc((var(--field-size)-var(--field-icon))/2-var(--field-icon)/8+var(--field-icon)+var(--space-2))] disabled:cursor-not-allowed',
        '[&>option]:bg-page [&>option]:text-text-1',
      )}
      {...primitive}
    />
    <Icon icon={ChevronSort} className="pointer-events-none absolute end-[calc((var(--field-size)-var(--field-icon))/2-var(--field-icon)/8)] top-1/2 size-(--field-icon) -translate-y-1/2 text-text-3 group-has-disabled/native:text-text-disabled"/>
  </div>;
}

export {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue,
  NativeSelect, fieldTriggerClass, fieldTriggerSize,
  type NativeSelectProps, type SelectItemDef, type SelectProps, type SelectSize,
};
