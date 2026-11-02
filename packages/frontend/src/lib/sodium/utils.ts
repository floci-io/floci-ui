import type * as React from 'react';
import {clsx, type ClassValue} from 'clsx';
import {extendTailwindMerge} from 'tailwind-merge';

// Sodium's own utilities, registered so tailwind-merge resolves conflicts between them: a later type-* role replaces
// an earlier one, a later button surface (slab, slab-fail, edged, quiet) replaces an earlier one, and text-text-2
// replaces text-text-1. The region's inset (p-inset, px-inset) is a spacing step, so a later p-0 replaces it.
const twMerge = extendTailwindMerge<'type-role' | 'surface'>({
  extend: {
    theme: {spacing: ['inset']},
    classGroups: {
      'type-role': [{type: ['display', 'title', 'heading', 'heading-sm', 'figure', 'body', 'body-sm', 'caption', 'label-lg', 'label', 'label-sm', 'micro', 'code', 'code-sm']}],
      'surface': ['slab', 'slab-fail', 'edged', 'quiet'],
    },
  },
});

/**
 * The height of a one-line control, one formula for every control of that size: the size's token, or one line plus
 * 8px of padding if the text grows past it (200% text zoom), so the label never spills out of the box.
 */
export const controlHeight = {
  sm: 'h-[max(var(--control-sm),calc(1lh+var(--space-2)))]',
  default: 'h-[max(var(--control),calc(1lh+var(--space-2)))]',
  lg: 'h-[max(var(--control-lg),calc(1lh+var(--space-2)))]',
} as const;

/**
 * Whether motion is reduced for this element: the media query, or a data-force-reduced-motion ancestor (the docs set it
 * on a specimen). Read it when a motion starts, in an effect; on the server it is false.
 */
export function reducedMotion(el?: Element | null): boolean {
  return typeof window !== 'undefined' && (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !!el?.closest('[data-force-reduced-motion]'));
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sodium's classes and the caller's, for a Base UI part whose className may be a function of its state (data-checked,
 * open, disabled ...). A function is composed, not passed through, so Sodium's classes stay either way.
 */
export function mergeClass<State>(base: ClassValue, className: string | ((state: State) => string | undefined) | undefined): string | ((state: State) => string) {
  return typeof className === 'function' ? (state: State) => cn(base, className(state)) : cn(base, className);
}

/**
 * One callback ref that sets every ref it is given, for a component that keeps its own ref and forwards the caller's.
 * Wrap it in useMemo or useCallback when the element should not be detached and attached again on every render.
 */
export function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return node => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.RefObject<T | null>).current = node;
    }
  };
}
