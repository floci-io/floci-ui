'use client';

import {Checkbox as CheckboxPrimitive} from '@base-ui/react/checkbox';
import {CheckboxGroup as CheckboxGroupPrimitive} from '@base-ui/react/checkbox-group';
import {cn} from '@/lib/sodium/utils';

// Sodium's checkbox, on Base UI's Checkbox. A 16px square. Unticked is the hair-off-white body (--check-off) with a
// 1px --line-control edge, the 3:1 edge a control needs; under the pointer the body lifts to white. Ticked and mixed
// take the checked recipe: sodium yellow with a gold edge and an ink mark in light (12.8:1), the dark yellow tint with
// a yellow edge and a yellow mark in dark, lit from below and brighter under the pointer. Fill, edge and light change
// on light-motion. Invalid turns an unticked box's edge red. Disabled sits on the well with a rule edge, unlit.
//
// The tick is drawn, not an icon: Sodium's icons start at 16, which is the whole box. It is a square-ended 1.5px
// stroke on a 10px grid, so it stays crisp beside 1px rules. Mixed is a 8 by 2 bar.
//
// The hit area grows past the box with ::after, so a 16px box still takes a 28px target. The box stops its click from
// bubbling, so ticking a checkbox inside a clickable row never opens the row.
//
// Select-all: inside a CheckboxGroup with allValues, a Checkbox with parent takes its state from the rest: all ticked is
// checked, some is mixed, none is clear. Pressed from mixed it ticks all, then clears all, then brings back the set the
// person picked, so select-all never destroys a hand-made selection.

type CheckboxProps = CheckboxPrimitive.Root.Props & {'aria-invalid'?: boolean | 'true' | 'false'};

const base = [
  'peer relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center [-webkit-tap-highlight-color:transparent]',
  'after:absolute after:-inset-1.5',
  'data-disabled:cursor-not-allowed data-readonly:cursor-default',
  'light-motion',
].join(' ');

const ticked = 'checked data-disabled:border-line data-disabled:bg-well data-disabled:text-text-disabled forced-colors:[forced-color-adjust:none] forced-colors:border-[Highlight] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]';
const clear = [
  'border border-line-control bg-check-off',
  'hover:not-data-disabled:not-data-readonly:bg-check-off-hover active:not-data-disabled:not-data-readonly:bg-check-off',
  'aria-invalid:border-fail',
  'data-disabled:border-line data-disabled:bg-well',
  'forced-colors:border-[CanvasText]',
].join(' ');

/** The tick: a square-ended stroke on a 10px grid. */
function Tick() {
  return <svg data-slot="checkbox-tick" viewBox="0 0 10 10" className="size-2.5" aria-hidden fill="none">
    <path d="M1.5 5.25 4 7.75 8.75 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
  </svg>;
}

function Checkbox({className, 'aria-invalid': invalid, onClick, ...props}: CheckboxProps) {
  const isInvalid = invalid === true || invalid === 'true';
  return <CheckboxPrimitive.Root
    data-slot="checkbox"
    aria-invalid={isInvalid || undefined}
    onClick={event => { onClick?.(event); event.stopPropagation(); }}
    className={state => cn(base, state.checked || state.indeterminate ? ticked : clear, typeof className === 'function' ? className(state) : className)}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      data-slot="checkbox-indicator"
      className="grid place-content-center text-current"
      render={(indicatorProps, state) => <span {...indicatorProps}>
        {state.indeterminate
          ? <span data-slot="checkbox-dash" className="block h-0.5 w-2 bg-current"/>
          : <Tick/>}
      </span>}
    />
  </CheckboxPrimitive.Root>;
}

/** A set of checkboxes with one value array. Give it allValues to let a parent Checkbox select all. */
function CheckboxGroup({className, ...props}: CheckboxGroupPrimitive.Props) {
  return <CheckboxGroupPrimitive
    data-slot="checkbox-group"
    className={state => cn('flex flex-col gap-2', typeof className === 'function' ? className(state) : className)}
    {...props}
  />;
}

export {Checkbox, CheckboxGroup, type CheckboxProps};
