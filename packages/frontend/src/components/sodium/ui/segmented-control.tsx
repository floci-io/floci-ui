'use client';

import {createContext, useContext, useId, useRef, type ReactNode} from 'react';
import {Radio as RadioPrimitive} from '@base-ui/react/radio';
import {RadioGroup as RadioGroupPrimitive} from '@base-ui/react/radio-group';
import {Toggle as TogglePrimitive} from '@base-ui/react/toggle';
import {ToggleGroup as ToggleGroupPrimitive} from '@base-ui/react/toggle-group';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn, controlHeight} from '@/lib/sodium/utils';

// Sodium's segmented control: two to five views of the same thing, as one ruled row of cells. Each segment is a square
// cell with a 1px --line edge, the rule a card draws; neighbours overlap by a pixel, so they share one seam, as a button group does.
// The others are mono labels in text-2 on the hair-off-white body (--check-off), which lifts to white as the label
// turns text-1 under the pointer. The chosen segment takes the checked
// recipe: yellow with a gold edge and an ink label in light, the dark yellow tint with a yellow edge and a yellow label
// in dark, lit from below, and it rises over its neighbours so its whole edge shows. 32px tall by default, 26 small,
// 36 large, like Button.
//
// A change of choice crossfades the fills on light-motion, as a button lights; nothing slides.
//
// The track sizes by its labels. The control takes its items' type role, so its height's one line is the label's own
// line, and each segment is as wide as its label plus 12px each side; nothing sets a fixed width, so a longer label
// never clips. fill stretches it to its container with equal segments.
//
// single (the default) picks one, on Base UI's RadioGroup: the arrow keys move and select, Tab leaves. A radio cannot
// be cleared back to none, so pass value or defaultValue. multiple turns any number on, on Base UI's ToggleGroup with
// aria-pressed, for filters such as errors and warnings shown together; there each pressed segment is checked.
//
// A segment can carry a count of what its view holds, in tabular figures after the label, read to a screen reader as
// the segment's description so its name stays "Errors" while the number ticks. The count's slot reserves the widest
// value it has shown, or countMax, so a live count that goes from 99 to 100 never moves the segments.

// Joined cells: each segment after the first overlaps its neighbour by the edge, so two edges make one seam.
const segmentedVariants = cva('inline-flex w-fit max-w-full items-stretch [&>[data-slot=segmented-control-item]~[data-slot=segmented-control-item]]:-ms-px', {
  variants: {
    size: {
      sm: `${controlHeight.sm} type-label-sm`,
      default: `${controlHeight.default} type-label`,
      lg: `${controlHeight.lg} type-label-lg`,
    },
    fill: {
      true: 'flex w-full *:flex-1',
      false: '',
    },
  },
  defaultVariants: {size: 'default', fill: false},
});

type Size = 'sm' | 'default' | 'lg';
type Mode = {size: Size; countMax?: number; multiple: boolean};
const ModeContext = createContext<Mode>({size: 'default', multiple: false});

type Common = VariantProps<typeof segmentedVariants> & {
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  /** Names the control when no visible label points at it. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** The widest count any segment is expected to show. Its width is reserved, so counts never move the segments. */
  countMax?: number;
};

type SingleProps = Common & Omit<RadioGroupPrimitive.Props, 'value' | 'defaultValue' | 'onValueChange' | 'className' | 'children'> & {
  multiple?: false;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

type MultipleProps = Common & Omit<ToggleGroupPrimitive.Props, 'value' | 'defaultValue' | 'onValueChange' | 'className' | 'children' | 'multiple'> & {
  /** Any number of segments on, none included. */
  multiple: true;
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
};

type SegmentedControlProps = SingleProps | MultipleProps;

function SegmentedControl(props: SegmentedControlProps) {
  const {className, size = 'default', fill = false, children} = props;
  const classes = cn(segmentedVariants({size, fill}), className);
  const ctx: Mode = {size: size ?? 'default', countMax: props.countMax, multiple: !!props.multiple};
  if (props.multiple) {
    const {multiple: _m, onValueChange, size: _s, fill: _f, className: _c, children: _ch, countMax: _cm, ...rest} = props;
    return <ToggleGroupPrimitive data-slot="segmented-control" data-size={size} data-multiple="" multiple onValueChange={value => onValueChange?.(value as string[])} className={classes} {...rest}>
      <ModeContext.Provider value={ctx}>{children}</ModeContext.Provider>
    </ToggleGroupPrimitive>;
  }
  const {multiple: _m, onValueChange, size: _s, fill: _f, className: _c, children: _ch, countMax: _cm, ...rest} = props;
  return <RadioGroupPrimitive data-slot="segmented-control" data-size={size} onValueChange={value => onValueChange?.(value as string)} className={classes} {...rest}>
    <ModeContext.Provider value={ctx}>{children}</ModeContext.Provider>
  </RadioGroupPrimitive>;
}

type SegmentedControlItemProps = {
  value: string;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  /** How many things the segment's view holds, in tabular figures after the label. */
  count?: number;
  /** The widest count this segment is expected to show; overrides the control's countMax. */
  countMax?: number;
  'aria-label'?: string;
};

const fmt = new Intl.NumberFormat('en-US');

const itemBase = [
  'relative inline-flex min-w-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap select-none [-webkit-tap-highlight-color:transparent]',
  'light-motion',
  'hover:z-(--z-raised) focus-visible:z-(--z-raised)',
  '[&_svg]:pointer-events-none [&_svg]:size-(--icon) [&_svg]:shrink-0',
  'data-disabled:cursor-not-allowed',
].join(' ');
// Each segment takes the label role itself: a toggle is a <button>, which drops the capitals it would inherit.
const itemSize: Record<Size, string> = {sm: 'px-2.5 type-label-sm', default: 'px-3 type-label', lg: 'px-4 type-label-lg'};
// The chosen segment: the checked recipe, over its neighbours so its whole edge shows.
const on = 'checked z-(--z-raised) data-disabled:border-line data-disabled:bg-well data-disabled:text-text-disabled forced-colors:[forced-color-adjust:none] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]';
const off = 'border border-line bg-check-off text-text-2 hover:not-data-disabled:bg-check-off-hover hover:not-data-disabled:text-text-1 active:not-data-disabled:bg-check-off data-disabled:bg-well data-disabled:text-text-disabled forced-colors:border-[ButtonText] forced-colors:data-disabled:text-[GrayText]';

function SegmentedControlItem({className, children, count, countMax: itemMax, ...props}: SegmentedControlItemProps) {
  const {size, countMax: groupMax, multiple} = useContext(ModeContext);
  const countId = useId();
  // Without countMax, the slot keeps the widest count it has shown, so it never shrinks back and jitters.
  const seen = useRef(0);
  if (count !== undefined) seen.current = Math.max(seen.current, count);
  const reserve = itemMax ?? groupMax ?? seen.current;
  const title = typeof children === 'string' ? children : undefined;
  const content = <>
    <span data-slot="segmented-control-label" className="inline-flex min-w-0 items-center gap-1.5"><span className="min-w-0 truncate">{children}</span></span>
    {count !== undefined && <span data-slot="segmented-control-count" aria-hidden className="grid shrink-0 justify-items-start opacity-70 [grid-template-areas:'c']">
      <span className="invisible [grid-area:c]">{fmt.format(Math.max(reserve, count))}</span>
      <span id={countId} className="[grid-area:c]">{fmt.format(count)}</span>
    </span>}
  </>;
  const shared = {'data-slot': 'segmented-control-item', title, 'aria-describedby': count !== undefined ? countId : undefined};
  if (multiple) return <TogglePrimitive {...shared} {...props} className={state => cn(itemBase, itemSize[size], state.pressed ? on : off, className)}>{content}</TogglePrimitive>;
  return <RadioPrimitive.Root {...shared} {...props} className={state => cn(itemBase, itemSize[size], state.checked ? on : off, className)}>{content}</RadioPrimitive.Root>;
}

export {SegmentedControl, SegmentedControlItem, segmentedVariants, type SegmentedControlProps, type SegmentedControlItemProps};
