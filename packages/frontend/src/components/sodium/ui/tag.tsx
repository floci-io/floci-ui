import {mergeProps} from '@base-ui/react/merge-props';
import {useRender} from '@base-ui/react/use-render';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/sodium/utils';

// Sodium's tag: a short static label that names what something is (an environment, a region, an engine) or how it
// stands (Passed, Late, Failed), in mono capitals inside a square box. It is never pressed, so it never takes the
// hover or held wash a button has, and it is never yellow: yellow is the action, and a yellow tag beside the slab reads as
// a second one.
//
//   neutral  the well with a rule edge, ink capitals: the everyday tag
//   outline  the page with a rule edge, text-2 capitals: a quieter label beside other tags
//   ok, warn, fail  the status tint with its edge and its word colour, for status only, always with the word
//
// Two sizes: 20px with 11px capitals for a dense row, 24px with 12px capitals by default. A count shows tabular
// figures; past max it shows "99+" and keeps the exact number for a screen reader and the title.

const tagVariants = cva(
  [
    'inline-flex w-fit max-w-full shrink-0 items-center justify-center gap-1 overflow-hidden border whitespace-nowrap',
    '[&>svg]:pointer-events-none [&>svg]:size-(--icon) [&>svg]:shrink-0',
    'forced-colors:border-[CanvasText]',
  ],
  {
    variants: {
      variant: {
        neutral: 'border-line bg-well text-text-1',
        outline: 'border-line bg-page text-text-2',
        ok: 'border-ok bg-ok-tint text-ok-text',
        warn: 'border-warn bg-warn-tint text-warn-text',
        fail: 'border-fail bg-fail-tint text-fail-text',
      },
      size: {
        default: 'min-h-6 px-2 type-label-sm',
        sm: 'min-h-5 px-1.5 type-micro',
      },
    },
    defaultVariants: {variant: 'neutral', size: 'default'},
  },
);

type TagProps = useRender.ComponentProps<'span'> & VariantProps<typeof tagVariants> & {
  /** A count in place of the label. Past max it shows "max+"; the exact number stays the accessible name. */
  count?: number;
  /** The cap for count. 99 by default. */
  max?: number;
};

function Tag({className, variant = 'neutral', size = 'default', count, max = 99, render, children, ...props}: TagProps) {
  const capped = count !== undefined && count > max;
  const exact = count?.toLocaleString('en-US');
  const shown = count === undefined ? children : capped ? <><span aria-hidden>{max}+</span><span className="sr-only">{exact}</span></> : exact;
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {className: cn(tagVariants({variant, size}), className), children: shown},
      {'data-slot': 'tag', 'data-variant': variant, 'data-size': size, title: capped ? exact : undefined} as React.ComponentProps<'span'>,
      props,
    ),
    render,
    state: {slot: 'tag', variant},
  });
}

export {Tag, tagVariants, type TagProps};
