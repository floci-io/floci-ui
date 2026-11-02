'use client';

import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentProps} from 'react';
import {Input as InputPrimitive} from '@base-ui/react/input';
import {cn, mergeRefs} from '@/lib/sodium/utils';

// Sodium's textarea: lines of text in the field's edge, on Base UI's Input rendered as a <textarea>, so a Field
// labels and validates it. Square, in the field's light (styles.css, field-surface): the secondary's hair-off-white
// body and a 1px --line edge, lifted toward white under the pointer, white with the --focus edge doubled inward and a
// pale yellow halo with the cursor in it; invalid is the red edge and halo; disabled sits flat on the well; read-only
// does not lift. 14px sans on a 20px line, --field-inset (10px) at the sides and 6px above and below, so the first
// line's capitals sit about as far under the top edge as its first glyph is from the side (measured).
//
// rows sets a fixed height. autoGrow lets it grow with its text from minRows to maxRows and then scroll, through
// field-sizing where the browser has it (the width stays pinned, so only the height follows), and by measuring
// scrollHeight on input where it does not.
//
// limit is a soft character limit that never cuts the text. The counter is a mono label that stays quiet until 80% of
// the limit, then counts the characters left in tabular figures; past it, it counts how far over in the failure word
// and the field turns invalid. A paste over the limit keeps every character, so nothing the person wrote is lost,
// where a native maxLength cuts the paste without a word.

type TextareaProps = ComponentProps<'textarea'> & {
  /** Grows with its text from minRows to maxRows, then scrolls. */
  autoGrow?: boolean;
  /** Lines at rest with autoGrow. Default 3, or rows. */
  minRows?: number;
  /** Lines before it scrolls with autoGrow. Default 10. */
  maxRows?: number;
  /** Lets the person drag the corner to resize. Off by default; with autoGrow it is never needed. */
  resizable?: boolean;
  /** A soft character limit with a counter. The text is never cut; past it the field is invalid. */
  limit?: number;
  /** Fires with the plain value, as Input's onValueChange does. */
  onValueChange?: (value: string) => void;
};

const supportsFieldSizing = () => typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');
const fmt = new Intl.NumberFormat('en-US');

function Textarea({className, autoGrow = false, rows, minRows = rows ?? 3, maxRows = 10, resizable = false, limit, style, value, defaultValue, onChange, onValueChange, ref: callerRef, ...props}: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const setRef = useMemo(() => mergeRefs(ref, callerRef), [callerRef]);
  const counterId = useId();
  const [length, setLength] = useState(() => String(value ?? defaultValue ?? '').length);
  const [fallback, setFallback] = useState(false);

  useEffect(() => { setFallback(autoGrow && !supportsFieldSizing()); }, [autoGrow]);
  useEffect(() => { if (value !== undefined) setLength(String(value).length); }, [value]);

  // Without field-sizing, grow by measuring: reset to auto, then take the content's height.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!fallback || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  });

  const over = limit !== undefined && length > limit;
  const near = limit !== undefined && length >= Math.floor(limit * 0.8);
  const left = limit !== undefined ? limit - length : 0;
  const invalid = over || props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  const primitiveProps = props as unknown as Omit<InputPrimitive.Props, 'className' | 'style'>;

  const textarea = <InputPrimitive
    // The caller's props first, so the counter's describedby, the limit's invalid state and the sizing below stay.
    {...primitiveProps}
    data-slot="textarea"
    data-control=""
    data-auto-grow={autoGrow || undefined}
    render={<textarea ref={setRef} rows={minRows}/>}
    value={value as string | undefined}
    defaultValue={defaultValue as string | undefined}
    onChange={(e: ChangeEvent<HTMLInputElement>) => {
      const el = e.target as unknown as HTMLTextAreaElement;
      setLength(el.value.length);
      onChange?.(e as unknown as ChangeEvent<HTMLTextAreaElement>);
      onValueChange?.(el.value);
    }}
    aria-invalid={invalid || undefined}
    aria-describedby={cn(props['aria-describedby'], limit !== undefined && counterId) || undefined}
    // Heights in lines plus the 6px inset and the line, so rows={2} shows two whole lines in the border box.
    style={autoGrow
      ? {minHeight: `calc(${minRows}lh + 2 * var(--space-1-5) + 2 * var(--line-width))`, maxHeight: `calc(${maxRows}lh + 2 * var(--space-1-5) + 2 * var(--line-width))`, ...style}
      : {height: `calc(${minRows}lh + 2 * var(--space-1-5) + 2 * var(--line-width))`, ...style}}
    className={cn(
      // The field's states from the recipe; the box never grows on focus.
      'field-surface block w-full min-w-0 px-(--field-inset) py-1.5 type-body-sm',
      'disabled:cursor-not-allowed read-only:cursor-default',
      // field-sizing sizes both axes, so the width is pinned and only the height follows the text.
      autoGrow && 'field-sizing-content [contain:inline-size]',
      resizable && !autoGrow ? 'resize-y' : 'resize-none',
      limit === undefined && className,
    )}
  />;

  if (limit === undefined) return textarea;
  return <div data-slot="textarea-limit" className={cn('flex w-full min-w-0 flex-col gap-1', className)}>
    {textarea}
    <p
      id={counterId}
      data-slot="textarea-counter"
      data-status={over ? 'fail' : undefined}
      className={cn('self-end type-label-sm text-text-2 data-[status=fail]:text-fail-text', !near && 'sr-only')}
    >
      {over ? `${fmt.format(-left)} over the ${fmt.format(limit)} limit` : `${fmt.format(left)} left`}
    </p>
    {/* Announces only the crossings, never every keystroke. */}
    <span role="status" className="sr-only">{over ? `Over the ${fmt.format(limit)} character limit` : near ? 'Near the character limit' : ''}</span>
  </div>;
}

export {Textarea, type TextareaProps};
