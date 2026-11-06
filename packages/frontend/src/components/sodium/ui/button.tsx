'use client';

import {Button as ButtonPrimitive} from '@base-ui/react/button';
import {cva, type VariantProps} from 'class-variance-authority';
import {useEffect, useMemo, useRef, type ReactNode, type Ref} from 'react';
import {cn, controlHeight, mergeClass, mergeRefs} from '@/lib/sodium/utils';

// Sodium's button on Base UI's Button. Square, a mono label in capitals, 32px tall by default, 26 small, 36 large.
//
// The surfaces are the recipes in styles.css, one per job:
//   primary      slab: the one solid sodium yellow on a light screen, ink label, a 1px gold edge so its corner holds
//                on white. In dark it turns into the dark yellow tint with a 1px yellow line and a yellow label.
//   destructive  slab-fail: the failure tint with a failure edge and the failure word. It is a group's primary too.
//   secondary    edged: a body a hair off the page with a 1px --line edge and a text-1 label.
//   ghost        quiet: no edge, a text-2 label that turns text-1 with a wash under the pointer.
// A group leads with one primary or one destructive and nothing else from that family; the lint counts both.
//
// The primary and the secondary are lit from below (--k in styles.css): hover lightens the fill, the edge and the
// light and draws a 1px halo flush outside the edge, and held settles them back to rest and puts the light out.
// Light never darkens a face, and nothing scales: a square that shrinks pulls away from the rules beside it. Ghost and
// destructive are flat. Disabled drops every surface to the well with the disabled label, unlit.
//
// pending: waiting on the action it started. The idle label and the pending layer share one grid cell, so the box
// never changes size, and the idle label stays the accessible name; aria-busy says it is working. The pending layer
// shows Sodium's pending mark, four square cells with one lit stepping across, alone and centred in the label's place,
// or followed by the pendingLabel when one is given. Alone, the mark is narrower than any label, so the box is the
// label's own width and its padding is even; with a pendingLabel the box also holds the mark and that label.
//
// Height is max(the size's token, one line plus 8px), so a label at 200% text zoom grows the box instead of spilling,
// while the box keeps an explicit height a flex row cannot stretch. The label centres on its capitals with no nudge.

const buttonVariants = cva(
  [
    'group/button relative inline-flex max-w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap select-none',
    'disabled:cursor-not-allowed data-disabled:cursor-not-allowed aria-busy:cursor-progress',
    '[&_svg]:pointer-events-none [&_svg]:size-(--icon) [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'slab',
        destructive: 'slab-fail',
        secondary: 'edged',
        ghost: 'quiet',
      },
      size: {
        // A trailing glyph (a menu caret) has side bearing the label lacks, so the end pads 2 to 3px less and the ink sits as far
        // from the edge as the label's first letter.
        sm: `${controlHeight.sm} px-2.5 has-[>svg:last-child]:pe-2 type-label-sm`,
        default: `${controlHeight.default} px-3 has-[>svg:last-child]:pe-2.5 type-label`,
        lg: `${controlHeight.lg} px-4 has-[>svg:last-child]:pe-3.5 type-label-lg`,
        'icon-sm': 'size-(--control-sm) px-0',
        icon: 'size-(--control) px-0',
        'icon-lg': 'size-(--control-lg) px-0',
      },
    },
    defaultVariants: {variant: 'primary', size: 'default'},
  },
);

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & {
  /**
   * Waiting on the action this button started. The button refuses repeat presses but keeps focus, sets aria-busy and
   * shows the pending mark. Pass it (true or false) from the first render on any button that can pend, so the box is
   * measured with the pending layer from the start and never changes size.
   */
  pending?: boolean;
  /** An optional pending verb ("Running"), shown while pending, never announced. Both labels share one cell. */
  pendingLabel?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

/** The text a screen reader would name the button by, roughly: text outside aria-hidden parts. */
function visibleName(el: HTMLElement): string {
  const label = el.getAttribute('aria-label') ?? '';
  if (label.trim() || el.getAttribute('aria-labelledby')) return label || 'labelledby';
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { text += node.textContent ?? ''; return; }
    if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return;
    if (node instanceof Element && node.getAttribute('role') === 'img') { text += node.getAttribute('aria-label') ?? ''; return; }
    node.childNodes.forEach(walk);
  };
  walk(el);
  return text.trim();
}

/**
 * Development only: a button with no accessible name (an icon size with no aria-label) is announced as just
 * "button". Report it with the element, so the call site can be found from the console.
 */
function useNameCheck() {
  const node = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || !node.current) return;
    if (!visibleName(node.current)) {
      node.current.setAttribute('data-unnamed', '');
      console.error('Sodium Button has no accessible name. Give it text children, or aria-label on an icon size.', node.current);
    } else node.current.removeAttribute('data-unnamed');
  });
  return node;
}

function Button({className, variant, size, pending, pendingLabel, disabled, focusableWhenDisabled, children, ref, ...props}: ButtonProps) {
  const v = variant ?? 'primary';
  const s = size ?? 'default';
  const iconOnly = s.startsWith('icon');
  const canPend = pending !== undefined;
  const named = useNameCheck();
  const mergedRef = useMemo(() => mergeRefs(ref as Ref<HTMLElement> | undefined, named), [ref, named]);

  // A text label never wraps; a label too long for its container ends in an ellipsis and stays the accessible name.
  const label = typeof children === 'string' ? <span data-slot="button-text" className="min-w-0 truncate">{children}</span> : children;
  const content = canPend
    ? <span data-slot="button-stack" className="grid min-w-0 place-items-center [grid-template-areas:'stack']">
        <span data-slot="button-idle" className={cn('inline-flex max-w-full min-w-0 items-center gap-1.5 [grid-area:stack]', pending && 'invisible')}>{label}</span>
        <span data-slot="button-pending" aria-hidden className={cn('inline-flex max-w-full min-w-0 items-center gap-2 [grid-area:stack]', !pending && 'invisible')}>
          <span data-slot="button-pending-mark" className={cn('pending', !pending && '[animation-play-state:paused]')}/>
          {iconOnly || pendingLabel === undefined ? null : typeof pendingLabel === 'string' ? <span className="min-w-0 truncate">{pendingLabel}</span> : pendingLabel}
        </span>
      </span>
    : label;

  return <ButtonPrimitive
    data-slot="button"
    data-variant={v}
    data-size={s}
    ref={mergedRef}
    disabled={disabled || pending}
    focusableWhenDisabled={pending || focusableWhenDisabled}
    aria-busy={pending || undefined}
    className={mergeClass(buttonVariants({variant: v, size: s}), className)}
    {...props}
  >{content}</ButtonPrimitive>;
}

export {Button, buttonVariants, type ButtonProps};
