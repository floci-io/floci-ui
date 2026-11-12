'use client';

import {createContext, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentProps, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref} from 'react';
import {Input as InputPrimitive} from '@base-ui/react/input';
import {Icon, Close, Search, View, ViewOff} from '@/components/sodium/icon';
import {cn, mergeClass, mergeRefs} from '@/lib/sodium/utils';
import {Button, type ButtonProps} from '@/components/sodium/ui/button';
import {CopyButton} from '@/components/sodium/ui/copy-button';
import {useFieldDisabled} from '@/components/sodium/ui/field';
import {Kbd} from '@/components/sodium/ui/kbd';

// Sodium's input: one line of text in the field recipe (styles.css, field), on Base UI's Input so a Field labels and
// validates it. Square, in the secondary button's light: its hair-off-white body and a 1px --line edge at rest, 32px
// tall by default, 26 small, 36 large. Under the pointer the body lifts toward white and the edge lightens, as the
// secondary does. With the cursor in it the body turns white, the edge turns --focus (dark gold in light, yellow in
// dark) and doubles to 2px inward, so the field never grows, with a pale yellow halo outside. Invalid is the red edge
// and a pale red halo; disabled sits flat on the well in text-disabled; read-only does not lift.
//
// Padding: the nearest thing you see sits as far from the side as from the top and bottom. Text starts on the size's
// --field-inset (10px at 32, 7 at 26, 12 at 36, measured on the capitals); a leading glyph, a key cap or a glyph at the
// end pulls out to its own (size - its height) / 2, and an action cell runs flush to the edge.
//
// The value is a sentence's words, so it is the sans; mono sets it in Commit Mono as written (type-code), for an ID,
// a key, a path or a command, where characters are compared one by one.
//
// The box holds the bare text control (data-control) and two slots, leading and trailing. An icon, a scheme, a unit,
// a key hint or an InputAction goes in a slot, inside the edge, and a press on the box or on a slot that is not a
// button puts the cursor in the text, so the whole box is the target. An InputAction is a cell flush with the edge,
// the field's full height: a ghost one shows its square wash up to the edge, and the slab of a one-line form covers
// the field's edge at its end, so the field and its action read as one ruled row.
//
// Modes:
//   text      any native text type, with the two slots
//   password  masked, with a show and hide toggle in the trailing slot; the glyph says which
//   search    a magnifier (the pending mark while pending), a clear button once there is a query, Escape to clear,
//             and a key hint while empty for the one search on the page that owns a shortcut
//   copy      a read-only value in mono with a Copy button; focusing it selects the whole value

type InputSize = 'sm' | 'default' | 'lg';

const SizeContext = createContext<InputSize>('default');

// Each size sets --input-h, the height token. The box takes max(the token, one line plus 8px), so it grows with the
// text at 200% zoom instead of clipping it. The box takes its size's text role too, so that one line (1lh) is the
// text's own line. It sets --field-icon too, the glyph size its slots and actions draw: 16px beside 14 and 15px text,
// 14px (--icon-sm) beside the small field's 13px, so a glyph spans the text's capitals and does not hang below them.
// --field-size and --field-px are what the field recipe measures its insets by.
const boxSize: Record<InputSize, string> = {
  sm: '[--input-h:var(--control-sm)] [--field-size:var(--control-sm)] [--field-px:var(--field-inset-sm)] [--field-icon:var(--icon-sm)] type-caption',
  default: '[--input-h:var(--control)] [--field-size:var(--control)] [--field-px:var(--field-inset)] [--field-icon:var(--icon)] type-body-sm',
  lg: '[--input-h:var(--control-lg)] [--field-size:var(--control-lg)] [--field-px:var(--field-inset-lg)] [--field-icon:var(--icon)] type-body',
};
const textSize: Record<InputSize, string> = {sm: 'type-caption', default: 'type-body-sm', lg: 'type-body'};
// Mono as written, through the code roles: 12px in a small field, 13px otherwise, beside 13 to 15px sans.
const monoSize: Record<InputSize, string> = {sm: 'type-code-sm', default: 'type-code', lg: 'type-code'};
const slotSize: Record<InputSize, string> = {sm: 'type-label-sm', default: 'type-label-sm', lg: 'type-label'};

/** The control's own disabled prop, or a disabled Field or FieldSet around it. Slots and actions read it too. */
function useOff(disabled?: boolean) {
  const inField = useFieldDisabled();
  return !!disabled || inField;
}

type InputRootProps = ComponentProps<'div'> & {
  size?: InputSize;
  disabled?: boolean;
  readOnly?: boolean;
};

/** The box: the field recipe around the text and its slots. A press anywhere but a button focuses the text. */
function InputRoot({size = 'default', disabled, readOnly, className, onPointerDown, children, ...props}: InputRootProps) {
  const down = (e: PointerEvent<HTMLDivElement>) => {
    onPointerDown?.(e);
    if ((e.target as HTMLElement).closest('button, a, input, textarea, [role=button]')) return;
    const control = e.currentTarget.querySelector<HTMLElement>('[data-control]');
    if (!control || disabled) return;
    e.preventDefault();
    control.focus();
  };
  return <SizeContext.Provider value={size}>
    <div
      data-slot="input"
      data-size={size}
      data-disabled={disabled || undefined}
      data-readonly={readOnly || undefined}
      onPointerDown={down}
      className={cn(
        'field group/input w-full cursor-text [--field-h:max(var(--input-h),calc(1lh+var(--space-2)))]',
        boxSize[size],
        'data-disabled:cursor-not-allowed data-readonly:cursor-default',
        className,
      )}
      {...props}
    >{children}</div>
  </SizeContext.Provider>;
}

// A slot keeps the field's own 8px gap between its parts, and draws its glyphs at the box's --field-icon.
const slotClass = 'flex shrink-0 items-center gap-2 self-stretch text-text-2 select-none [&_svg]:size-(--field-icon) [&_svg]:shrink-0 [&_svg]:text-text-3 group-data-disabled/input:text-text-disabled group-data-disabled/input:[&_svg]:text-text-disabled [unicode-bidi:plaintext]';

/**
 * The pending mark in the magnifier's place: a cell the glyph's size with the mark centred in it, 2 to 4px wider and
 * spilling into the gap, so the text never moves when a search starts.
 */
function InputPending() {
  return <span data-slot="input-pending" className="flex size-(--field-icon) shrink-0 items-center justify-center">
    <span className="pending shrink-0 text-text-2"/>
  </span>;
}

/**
 * Before the text: an icon, a scheme such as "https://", a currency sign. A glyph first pulls out to the glyph inset;
 * an InputAction here sits flush with the edge; words stay on the text inset.
 */
function InputLeading({className, ...props}: ComponentProps<'span'>) {
  const size = useContext(SizeContext);
  return <span
    data-slot="input-leading"
    className={cn(slotClass, slotSize[size], 'has-[>svg:first-child]:ms-(--field-pull-glyph) has-[>[data-slot=input-pending]:first-child]:ms-(--field-pull-glyph) has-[>button:first-child]:ms-(--field-pull-cell)', className)}
    {...props}
  />;
}

/** After the text: a unit, a key hint, or InputAction cells, the last one flush with the edge. A key cap or a glyph last pulls out to its own inset. */
function InputTrailing({className, ...props}: ComponentProps<'span'>) {
  const size = useContext(SizeContext);
  return <span
    data-slot="input-trailing"
    className={cn(slotClass, slotSize[size], 'has-[>svg:last-child]:me-(--field-pull-glyph) has-[>[data-slot=kbd]:last-child]:me-(--field-pull-kbd) has-[>button:last-child]:me-(--field-pull-cell) has-[>[data-slot=copy-button-status]:last-child]:me-(--field-pull-cell)', className)}
    {...props}
  />;
}

/** The bare text control inside the box. The box draws the page and the edge, and shows its focus. */
function InputControl({className, mono, ...props}: InputPrimitive.Props & {
  /** Sets the value in Commit Mono as written, for IDs, keys, URLs and commands. */
  mono?: boolean;
}) {
  const size = useContext(SizeContext);
  return <InputPrimitive
    data-slot="input-control"
    data-control=""
    className={mergeClass([
      'h-full w-full min-w-0 flex-1 truncate bg-transparent text-inherit',
      mono ? monoSize[size] : textSize[size],
      'disabled:cursor-not-allowed read-only:cursor-default',
      'file:me-2 file:cursor-pointer file:border file:border-line file:bg-page file:px-2 file:type-label-sm file:text-text-1',
      '[&::-webkit-search-cancel-button]:appearance-none',
    ], className)}
    {...props}
  />;
}

type InputActionProps = Omit<ButtonProps, 'size' | 'variant'> & {
  /** icon (the default) is square and needs aria-label; text holds a short verb. */
  size?: 'icon' | 'text';
  /** ghost (the default) for show, clear and copy; primary for the one action of a field that is a whole form. */
  variant?: 'ghost' | 'primary';
};

/**
 * A Button drawn as a cell of the field: the field's full height, flush with its edge. Ghost by default; the slab
 * (variant="primary") covers the field's edge at its end, for a field that is a one-line form, and is then the only
 * primary in its group.
 */
function InputAction({className, size = 'icon', variant = 'ghost', ...props}: InputActionProps) {
  const box = useContext(SizeContext);
  return <Button
    data-slot="input-action"
    variant={variant}
    size={size === 'icon' ? 'icon-sm' : 'sm'}
    className={mergeClass([
      'h-auto min-h-0 max-w-none self-stretch [&_svg]:size-(--field-icon)',
      size === 'icon' ? 'w-[calc(var(--input-h)-2*var(--line-width))]' : 'px-3',
      variant === 'primary' && '-my-px -me-px',
      box === 'lg' ? 'type-label' : 'type-label-sm',
    ], className)}
    {...props}
  />;
}

/** Splits the box's props (forced states, style) from the props meant for the text control. */
function splitBox<T extends Record<string, unknown>>(props: T) {
  const box: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) (k.startsWith('data-force-') || k === 'style' ? box : rest)[k] = v;
  return {box, rest: rest as T};
}

function useControllable<T>(value: T | undefined, defaultValue: T, onChange?: (next: T) => void) {
  const [inner, setInner] = useState(defaultValue);
  const current = value !== undefined ? value : inner;
  const set = (next: T) => { if (value === undefined) setInner(next); onChange?.(next); };
  return [current, set] as const;
}

type BoxProps = {
  /** 26, 32 or 36px tall. Match the buttons beside it. */
  size?: InputSize;
  /** Inside the edge, before the text. */
  leading?: ReactNode;
  /** Inside the edge, after the text. */
  trailing?: ReactNode;
  /** Classes for the box: width and placement. */
  className?: string;
  /** Classes for the text control. */
  controlClassName?: string;
  /** Sets the value in Commit Mono as written, for an ID, a key or a path. */
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
};

type NativeProps = Omit<InputPrimitive.Props, 'size' | 'prefix' | 'className' | 'type' | 'value' | 'defaultValue' | 'onValueChange' | 'ref'>;
type StringValue = {value?: string; defaultValue?: string; onValueChange?: (value: string) => void};

type TextModeProps = BoxProps & NativeProps & StringValue & {
  mode?: 'text';
  /** Any native text type: text, email, url, tel, file. */
  type?: string;
};

type PasswordModeProps = BoxProps & NativeProps & StringValue & {
  mode: 'password';
  /** Starts with the password shown. */
  defaultRevealed?: boolean;
};

type SearchModeProps = BoxProps & NativeProps & StringValue & {
  mode: 'search';
  /**
   * One key that focuses the field from anywhere outside another text field, dialog or menu, shown while empty.
   * Usually "/". When several fields claim one key, the first in document order owns it.
   */
  shortcut?: string;
  /** false shows the hint without claiming the key. */
  shortcutOwner?: boolean;
  clearLabel?: string;
  /** A search is running: the magnifier turns into the pending mark. */
  pending?: boolean;
};

type CopyModeProps = BoxProps & Omit<NativeProps, 'onCopy'> & {
  mode: 'copy';
  value: string;
  /** What is copied, for the button's name: "endpoint" gives "Copy endpoint". */
  noun?: string;
  onCopy?: (value: string) => void;
  /** Shows a state of the Copy button without a press, for the docs. */
  forceCopyState?: 'copied' | 'failed';
};

type InputProps = TextModeProps | PasswordModeProps | SearchModeProps | CopyModeProps;
type InputMode = NonNullable<InputProps['mode']>;

const isInvalid = (rest: Record<string, unknown>) => rest['aria-invalid'] === true || rest['aria-invalid'] === 'true';

function Input(props: InputProps) {
  switch (props.mode) {
    case 'password': return <PasswordMode {...props}/>;
    case 'search': return <SearchMode {...props}/>;
    case 'copy': return <CopyMode {...props}/>;
    default: return <TextMode {...props}/>;
  }
}

function TextMode({mode: _mode, size = 'default', leading, trailing, className, controlClassName, mono, disabled: disabledProp, readOnly, type = 'text', ...all}: TextModeProps) {
  const disabled = useOff(disabledProp);
  const {box, rest} = splitBox(all);
  return <InputRoot size={size} disabled={disabled} readOnly={readOnly} className={className} data-mode="text" data-invalid={isInvalid(rest) || undefined} {...box}>
    {leading !== undefined && <InputLeading>{leading}</InputLeading>}
    <InputControl type={type} disabled={disabled} readOnly={readOnly} mono={mono} className={controlClassName} {...rest}/>
    {trailing !== undefined && <InputTrailing>{trailing}</InputTrailing>}
  </InputRoot>;
}

function PasswordMode({mode: _mode, size = 'default', leading, trailing: _trailing, className, controlClassName, mono: _mono, value, defaultValue = '', onValueChange, onChange, defaultRevealed = false, disabled: disabledProp, autoComplete, ...all}: PasswordModeProps) {
  const disabled = useOff(disabledProp);
  const {box, rest} = splitBox(all);
  const [current, set] = useControllable(value, defaultValue, onValueChange);
  const [revealed, setRevealed] = useState(defaultRevealed);
  return <InputRoot size={size} disabled={disabled} className={className} data-mode="password" {...box}>
    {leading !== undefined && <InputLeading>{leading}</InputLeading>}
    <InputControl
      type={revealed ? 'text' : 'password'}
      value={current}
      onChange={(e: ChangeEvent<HTMLInputElement>) => { set(e.target.value); onChange?.(e as never); }}
      disabled={disabled}
      autoComplete={autoComplete ?? 'current-password'}
      autoCapitalize="off"
      spellCheck={false}
      mono={revealed}
      className={controlClassName}
      {...rest}
    />
    <InputTrailing>
      <InputAction
        disabled={disabled}
        aria-pressed={revealed}
        aria-label={revealed ? 'Hide password' : 'Show password'}
        onClick={() => setRevealed(r => !r)}
      ><Icon icon={revealed ? ViewOff : View}/></InputAction>
    </InputTrailing>
  </InputRoot>;
}

const isEditable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

// One key, one owner. Every search with a shortcut registers here, and one window listener hands the key to the first
// enabled field in document order, so two fields never fight over "/" and the last one mounted never steals it.
type ShortcutEntry = {el: () => HTMLInputElement | null; key: string};
const shortcuts = new Set<ShortcutEntry>();
function onShortcutKey(e: globalThis.KeyboardEvent) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || isEditable(e.target)) return;
  // An open listbox or combobox owns every printable key for its typeahead.
  if (e.target instanceof Element && e.target.closest('[role=listbox], [role=option], [role=combobox], [role=tree], [role=grid]')) return;
  // Inside an open dialog or menu the key stays there; it never pulls focus to a field behind the overlay.
  const layer = e.target instanceof Element ? e.target.closest('[role=dialog], [role=alertdialog], [role=menu]') : null;
  const owners = [...shortcuts]
    .filter(entry => entry.key === e.key && entry.el()?.isConnected && (!layer || layer.contains(entry.el())))
    .map(entry => entry.el()!)
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  if (!owners.length) return;
  e.preventDefault();
  owners[0].focus();
}
function claimShortcut(entry: ShortcutEntry) {
  if (!shortcuts.size) window.addEventListener('keydown', onShortcutKey);
  shortcuts.add(entry);
  return () => {
    shortcuts.delete(entry);
    if (!shortcuts.size) window.removeEventListener('keydown', onShortcutKey);
  };
}

function SearchMode({mode: _mode, size = 'default', leading: _leading, trailing: _trailing, className, controlClassName, mono: _mono, value, defaultValue = '', onValueChange, onChange, shortcut, shortcutOwner = true, clearLabel = 'Clear search', pending, disabled: disabledProp, onKeyDown, ref, ...all}: SearchModeProps) {
  const disabled = useOff(disabledProp);
  const {box, rest} = splitBox(all);
  const [current, set] = useControllable(value, defaultValue, onValueChange);
  const inner = useRef<HTMLInputElement | null>(null);
  const setRef = useMemo(() => mergeRefs<HTMLInputElement>(inner, ref), [ref]);

  useEffect(() => {
    if (!shortcut || !shortcutOwner || disabled) return;
    return claimShortcut({el: () => inner.current, key: shortcut});
  }, [shortcut, shortcutOwner, disabled]);

  return <InputRoot size={size} disabled={disabled} className={className} data-mode="search" data-pending={pending || undefined} {...box}>
    <InputLeading>{pending
      ? <InputPending/>
      : <Icon icon={Search}/>}</InputLeading>
    <InputControl
      ref={setRef}
      type="search"
      value={current}
      disabled={disabled}
      onChange={(e: ChangeEvent<HTMLInputElement>) => { set(e.target.value); onChange?.(e as never); }}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        onKeyDown?.(e as never);
        if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
        if (current) { e.preventDefault(); e.stopPropagation(); set(''); }
        else inner.current?.blur();
      }}
      autoComplete="off"
      spellCheck={false}
      enterKeyHint="search"
      aria-busy={pending || undefined}
      className={controlClassName}
      {...rest}
    />
    {current && !disabled
      ? <InputTrailing>
          <InputAction aria-label={clearLabel} onClick={() => { set(''); inner.current?.focus(); }}><Icon icon={Close}/></InputAction>
        </InputTrailing>
      // A touch phone has no "/" key, so the hint hides where the pointer is coarse.
      : shortcut && <InputTrailing aria-hidden className="pointer-coarse:hidden"><Kbd>{shortcut}</Kbd></InputTrailing>}
  </InputRoot>;
}

function CopyMode({mode: _mode, size = 'default', leading, trailing: _trailing, className, controlClassName, value, noun, onCopy, mono = true, forceCopyState, disabled: disabledProp, ...all}: CopyModeProps) {
  const disabled = useOff(disabledProp);
  const {box, rest} = splitBox(all);
  return <InputRoot size={size} disabled={disabled} readOnly className={className} data-mode="copy" {...box}>
    {leading !== undefined && <InputLeading>{leading}</InputLeading>}
    <InputControl
      readOnly
      value={value}
      disabled={disabled}
      onFocus={(e: FocusEvent<HTMLInputElement>) => e.currentTarget.select()}
      mono={mono}
      className={controlClassName}
      {...rest}
    />
    <InputTrailing>
      <CopyButton
        data-slot="input-action"
        value={value}
        label={noun}
        onCopy={onCopy}
        forceState={forceCopyState}
        disabled={disabled || !value}
        size="icon-sm"
        className="h-auto min-h-0 w-[calc(var(--input-h)-2*var(--line-width))] self-stretch [&_svg]:size-(--field-icon)"
      />
    </InputTrailing>
  </InputRoot>;
}

export {
  Input, InputAction, InputControl, InputLeading, InputPending, InputRoot, InputTrailing,
  type InputMode, type InputProps, type InputRootProps, type InputSize, type SearchModeProps,
};
