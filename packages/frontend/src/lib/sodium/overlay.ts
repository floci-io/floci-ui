'use client';

import * as React from 'react';
import type {Dialog as DialogPrimitive} from '@base-ui/react/dialog';
import {coarsePointer, cycleTab} from '@/lib/sodium/portal';
import {cn, mergeRefs} from '@/lib/sodium/utils';

// What Sodium's overlays share, written once: the open state that waits for a running action, the footer's default
// action on Enter, the scrolling body, the anchored and modal surfaces, the way they arrive, the scrim, and the rows
// every list popup (select, combobox, dropdown menu, command) is built from, so an option and a menu item are one row.
//
// No overlay casts a shadow. Every overlay is the overlay recipe from styles.css: the panel fill and a 1px --line
// edge, the same rule a card draws, square, no blur. A dialog and a sheet add the scrim behind them.
//
// A list popup has no inner padding. Its rows run edge to edge, square, in the field's light (styles.css, menu-row):
// the highlighted row lifts to white between two hairline rules, and a checked or chosen row shows only its ink tick,
// with no fill, so a menu never fills with yellow. The lift is the focus indicator inside the popup: a row has no room for an offset
// ring, and two marks on one row would disagree. A row's text starts on the inset of the field it opened from
// (--field-inset, or -sm in a small list), so a select's trigger text and its options line up; a leading glyph sits as
// far from the side as from the row's top and bottom.

// ---------- Open state and the pending block ----------

type ChangeDetails = {cancel: () => void};

/**
 * What the open state knows, apart from React. Every open and every close starts a new session, and a run belongs to
 * the session it started in, so a settle from an earlier session changes nothing.
 */
type OverlayModel = {open: boolean; session: number; pending: boolean; error: string | null};

const overlayModel = (open: boolean): OverlayModel => ({open, session: 0, pending: false, error: null});

/** Any promise-like value counts as pending, not only a native Promise. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as {then?: unknown}).then === 'function';
}

/** The overlay opened or closed. Opening starts clean; any close ends the session, so a run still going is no longer this overlay's. */
function overlayOpenChanged(model: OverlayModel, open: boolean): OverlayModel {
  if (model.open === open) return model;
  return {open, session: model.session + 1, pending: false, error: open ? null : model.error};
}

/** Whether a request to close goes through. While a run is pending nothing closes the overlay. */
function overlayMayClose(model: OverlayModel) {
  return !model.pending;
}

/** A run starts. Refused while one is pending; the error clears. */
function overlayRunStarted(model: OverlayModel): OverlayModel | null {
  if (model.pending) return null;
  return {...model, pending: true, error: null};
}

type RunOutcome = {ok: true} | {ok: false; error: string};

/** A run settled. Ignored unless it belongs to the current session and that session still waits on it. */
function overlayRunSettled(model: OverlayModel, session: number, outcome: RunOutcome, closeAfter: boolean): {model: OverlayModel; close: boolean} {
  if (session !== model.session || !model.pending) return {model, close: false};
  if (outcome.ok) return {model: {...model, pending: false}, close: closeAfter && model.open};
  return {model: {...model, pending: false, error: outcome.error}, close: false};
}

const FAILED = 'That did not work. Nothing changed.';
const messageOf = (e: unknown) => e instanceof Error ? e.message : typeof e === 'string' && e ? e : FAILED;

/** Base UI's change details for a close the overlay asks for itself, after an action finished. */
function ownDetails<D extends ChangeDetails>(): D {
  const details = {
    reason: 'imperative-action',
    event: new Event('sodium-overlay'),
    trigger: undefined,
    isCanceled: false,
    isPropagationAllowed: false,
    cancel() { details.isCanceled = true; },
    allowPropagation() { details.isPropagationAllowed = true; },
    preventUnmountOnClose() {},
  };
  return details as unknown as D;
}

/**
 * Open state, controlled or not, and the pending block. run() calls an action; a returned thenable sets pending until
 * it settles, and while pending setOpen(false) is refused, so Escape, a swipe, the scrim, Cancel and the X all wait.
 * It closes after success when asked and keeps the rejection's message as the error. `session` changes on every open
 * and close, so state that belongs to one open (a typed confirm) resets by keying on it.
 */
function useOverlayOpen<D extends ChangeDetails>({open: openProp, defaultOpen = false, onOpenChange}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean, details: D) => void;
}) {
  const [openState, setOpenState] = React.useState(defaultOpen);
  const open = openProp ?? openState;
  const [model, setModel] = React.useState(() => overlayModel(open));
  const modelRef = React.useRef(model);
  const commit = React.useCallback((next: OverlayModel) => {
    if (next === modelRef.current) return;
    modelRef.current = next;
    setModel(next);
  }, []);
  const latest = React.useRef({controlled: openProp !== undefined, onOpenChange});
  React.useLayoutEffect(() => { latest.current = {controlled: openProp !== undefined, onOpenChange}; });
  React.useLayoutEffect(() => { commit(overlayOpenChanged(modelRef.current, open)); }, [open, commit]);

  const setOpen = React.useCallback((next: boolean, details?: D) => {
    const full = details ?? ownDetails<D>();
    if (!next && !overlayMayClose(modelRef.current)) { full.cancel(); return; }
    if (!latest.current.controlled) setOpenState(next);
    latest.current.onOpenChange?.(next, full);
  }, []);

  const run = React.useCallback((action: () => unknown, closeAfter: boolean) => {
    const started = overlayRunStarted(modelRef.current);
    if (!started) return;
    let result: unknown;
    try { result = action(); }
    catch (e) { commit({...modelRef.current, error: messageOf(e)}); return; }
    if (!isThenable(result)) { commit({...modelRef.current, error: null}); if (closeAfter) setOpen(false); return; }
    commit(started);
    const settle = (outcome: RunOutcome) => {
      const {model: next, close} = overlayRunSettled(modelRef.current, started.session, outcome, closeAfter);
      commit(next);
      if (close) setOpen(false);
    };
    result.then(() => settle({ok: true}), (e: unknown) => settle({ok: false, error: messageOf(e)}));
  }, [commit, setOpen]);

  return {open, setOpen, pending: model.pending, error: model.error, session: model.session, run};
}

/**
 * Whether a primary action closes its overlay. With onAction it closes after the action settles. Without one, a bare
 * action is a "done" and closes; an onClick or a form submit owns what happens next, so those stay open.
 */
function closesAfter({close, onAction, onClick, type}: {close?: boolean; onAction?: unknown; onClick?: unknown; type?: string}) {
  return close ?? (onAction !== undefined || (onClick === undefined && type !== 'submit'));
}

// ---------- The footer's default action ----------

type DefaultAction = 'primary' | 'dismiss' | 'none';

// A focused control already owns Enter, so the overlay never takes it from one of these.
const CONTROL = 'button, a[href], textarea, select, summary, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="combobox"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [contenteditable="true"]';
// Text a person types into. Enter in one never dismisses, so typing is never thrown away.
const FIELD = 'input:not([type="checkbox"],[type="radio"],[type="button"],[type="submit"],[type="reset"],[type="hidden"],[type="range"]):not(:disabled,[readonly]), textarea:not(:disabled,[readonly])';

function footerOf(popup: HTMLElement) {
  return popup.querySelector<HTMLElement>('[data-default-action]');
}

function modeOf(footer: HTMLElement): DefaultAction {
  const declared = footer.dataset.defaultAction;
  if (declared === 'primary' || declared === 'dismiss' || declared === 'none') return declared;
  // Undeclared: a destructive primary makes dismiss the default, so Enter fails safe.
  return footer.querySelector('[data-dialog-action="primary"][data-variant="destructive"]') ? 'dismiss' : 'primary';
}

/** The footer's button for an action, or null when it is disabled. */
function actionOf(footer: HTMLElement, action: 'primary' | 'dismiss') {
  const el = footer.querySelector<HTMLElement>(`[data-dialog-action="${action}"]`);
  if (!el || el.matches(':disabled, [aria-disabled="true"], [data-disabled]')) return null;
  return el;
}

type InitialFocus = DialogPrimitive.Popup.Props['initialFocus'];

/**
 * Wires a popup to its footer's default action. Enter outside a control presses the declared button; opening focuses
 * `[data-autofocus]`, else the dismiss button (dismiss) or the first field, else the primary button (primary). Tab
 * cycles inside the popup.
 */
function useDefaultAction<E extends HTMLElement>({ref, onKeyDown, initialFocus}: {
  ref?: React.Ref<E>;
  onKeyDown?: React.KeyboardEventHandler<E>;
  initialFocus?: InitialFocus;
}) {
  const popupRef = React.useRef<E | null>(null);
  const setRef = React.useMemo(() => mergeRefs(popupRef, ref), [ref]);

  const handleKeyDown = (event: React.KeyboardEvent<E>) => {
    onKeyDown?.(event);
    cycleTab(event);
    if (event.defaultPrevented || event.key !== 'Enter' || event.nativeEvent.isComposing || event.repeat) return;
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    const popup = event.currentTarget;
    const target = event.target as HTMLElement;
    if (!popup.contains(target)) return;
    if (target !== popup && target.closest(CONTROL)) return;
    if (target instanceof HTMLInputElement && target.form) return;
    const footer = footerOf(popup);
    if (!footer) return;
    const mode = modeOf(footer);
    if (mode === 'none' || (mode === 'dismiss' && target.matches(FIELD))) return;
    const button = actionOf(footer, mode);
    if (!button) return;
    event.preventDefault();
    button.click();
  };

  const focusOnOpen: InitialFocus = initialFocus ?? (() => {
    const popup = popupRef.current;
    if (!popup) return true;
    // A finger: a focused text field raises the keyboard before anyone asked for it, so the popup takes focus.
    if (coarsePointer()) return popup;
    const auto = popup.querySelector<HTMLElement>('[data-autofocus]');
    if (auto) return auto;
    const footer = footerOf(popup);
    if (!footer) return true;
    const mode = modeOf(footer);
    if (mode === 'dismiss') return actionOf(footer, 'dismiss') ?? true;
    if (mode === 'primary') return popup.querySelector<HTMLElement>(FIELD) ?? actionOf(footer, 'primary') ?? true;
    return popup.querySelector<HTMLElement>(FIELD) ?? popup;
  });

  return {ref: setRef, onKeyDown: handleKeyDown, initialFocus: focusOnOpen};
}

// ---------- The scrolling body ----------

/**
 * For the body of a dialog or a sheet, which scrolls between a header and a footer that stay put. Sets data-scrolled
 * while it is scrolled off its top, for a part that wants to know, and gives the body a tab stop while it has
 * something to scroll, so the keyboard can reach it.
 */
function useScrollBody<E extends HTMLElement>(ref?: React.Ref<E>) {
  const scroller = React.useRef<E | null>(null);
  const setRef = React.useMemo(() => mergeRefs(scroller, ref), [ref]);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => {
      if (el.scrollTop > 0) el.dataset.scrolled = ''; else delete el.dataset.scrolled;
      if (el.scrollHeight > el.clientHeight + 1) el.tabIndex = 0; else el.removeAttribute('tabindex');
    };
    update();
    el.addEventListener('scroll', update, {passive: true});
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, []);
  return setRef;
}

// ---------- Looks ----------

/** Forced colors repaint the edge, so every overlay takes a CanvasText outline there. */
const forcedOutline = 'forced-colors:outline-solid forced-colors:outline-1 forced-colors:outline-[CanvasText]';

/** The anchored overlay: the panel with a 1px --line edge. The popup takes no ring when it holds focus; its rows show it. */
const overlaySurface = cn('overlay outline-none', forcedOutline);

/**
 * The modal overlay, a dialog or a sheet: the same surface as a column, the header and footer fixed and the body
 * scrolling between them. Its parts are divided by rules, never boxed again.
 */
const overlayModal = cn(overlaySurface, 'flex min-h-0 flex-col');

/** The overlay-motion recipe: in --overlay-shift from the trigger on --dur-overlay, out on --dur-state. A modal one only fades. */
const overlayMotion = 'overlay-motion';

/** The scrim behind every modal overlay: ink at 32% in light, black at 64% in dark (--scrim). No blur. */
const scrimClass = 'fixed inset-0 z-(--z-overlay) bg-scrim transition-opacity duration-(--dur-overlay) ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-(--dur-state)';

// A dialog and a sheet are regions, drawn with the frame's parts (ui/frame.tsx) so they read as the same product: the
// panel-head header at --head (38px) with the name in mono as written and the X as a header action, a body on the
// 12px --inset all round that opens with one sentence, and a footer on --inset with meta first and the actions at the
// end. Every edge is the one inset, so the header's name, the body's first word and the footer's meta start on one line.

/** The header of a dialog or a sheet: panel-head, the region header, with its rule under it. It stays put while the body scrolls. */
const overlayHeaderClass = 'panel-head shrink-0';

/** The header's name, as FrameTitle: mono as written, first, taking the room and truncating so the meta and the X show. */
// flex-1, so the meta sits at the end beside the X rather than halfway between two auto margins.
const overlayTitleClass = 'me-auto min-w-0 flex-1 truncate text-text-1';

/** The header's meta at its end, as FrameValue meta. */
const overlayHeadMetaClass = 'shrink-0 type-code-sm text-text-2';

/** The scrolling body: --inset on all four sides and 12px between items, as FrameBody. The header's rule sits over it. */
const overlayBodyClass = cn(
  'flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-inset type-body-sm text-text-1',
  'focus-visible:focus-ring-inset',
);

/** The body's opening sentence, as FrameDescription: type-body-sm in text-2, held to a readable measure. */
const overlayDescriptionClass = 'max-w-(--measure-hint) type-body-sm text-text-2 break-words';

/** The footer, as FrameFooter: a rule over it, meta first, then the way out and at most one primary, --inset from every edge. */
const overlayFooterClass = 'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line p-inset';

/** A footer's meta, as FrameMeta: a count or a cost as written, in text-2, at the row's start. */
const overlayMetaClass = 'me-auto min-w-0 truncate type-code-sm text-text-2';

/** What went wrong with the footer's action: the failure tint as a ruled row above the footer, on --inset, the sentence in the failure word. */
const overlayErrorClass = 'flex shrink-0 items-start gap-2 border-t border-fail bg-fail-tint p-inset type-body-sm text-fail-text [&_svg]:mt-0.5';

/** How a list's rows measure themselves: a glyph (row - glyph) / 2 in, and words after a leading column. */
const menuVarsClass = '[--menu-glyph:calc((var(--menu-item-h)-var(--icon))/2)] [--menu-col:calc(var(--menu-glyph)+var(--icon)+var(--space-2))]';

/**
 * The list popup: the anchored overlay, at least --menu-min wide, scrolling past --popup-max. Rows are --row-sm (32),
 * or --control-sm (26) in a small list; the popup sets --menu-item-h and the rows read it, with the row's text inset
 * (--menu-px, the field's), a glyph's inset ((row - glyph) / 2, --menu-glyph) and where words start after a leading
 * check or icon column (--menu-col).
 */
const menuPopupClass = cn(
  overlaySurface, overlayMotion,
  'flex max-h-[min(var(--popup-max),var(--available-height))] min-w-[max(var(--menu-min),var(--anchor-width,0px))] max-w-(--available-width) flex-col overflow-y-auto overscroll-contain',
  '[--menu-item-h:var(--row-sm)] [--menu-px:var(--field-inset)] data-[size=sm]:[--menu-item-h:var(--control-sm)] data-[size=sm]:[--menu-px:var(--field-inset-sm)]',
  menuVarsClass,
);

/**
 * What every row shares: the height, the field's text inset, a leading or trailing glyph on its own inset, the 16px
 * icon 8px from the words, and menu-row's lift when highlighted.
 */
const rowBase = cn(
  'menu-row relative flex min-h-(--menu-item-h) w-full cursor-default items-center gap-2 px-(--menu-px) text-text-1 outline-none select-none focus-visible:outline-none data-inset:ps-(--menu-col)',
  'has-[>svg:first-child]:ps-(--menu-glyph) has-[>svg:last-child]:pe-(--menu-glyph)',
  '[&_svg]:size-(--icon) [&_svg]:shrink-0 [&_svg]:text-text-3',
  'data-disabled:cursor-not-allowed data-disabled:text-text-disabled data-disabled:[&_svg]:text-text-disabled',
);

/**
 * A menu row: an action, so its name is a mono label in capitals. A destructive row reads in the failure word and
 * takes the failure tint when highlighted.
 */
const menuItemClass = cn(
  rowBase, 'type-label in-data-[size=sm]:type-label-sm',
  'data-[variant=destructive]:text-fail-text data-[variant=destructive]:[&_svg]:text-fail-text data-[variant=destructive]:data-highlighted:bg-fail-tint',
);

/** A checkbox or radio row in a menu: a fixed leading column holds the check on the glyph inset, so unchecked rows line up. */
const menuCheckItemClass = cn(menuItemClass, 'ps-(--menu-col)');

/**
 * An option row in a select or a combobox: a value, so it reads as written, in the sans, the same words the trigger
 * shows once it is chosen, starting where the trigger's text starts. The chosen row carries an ink check in a fixed
 * trailing column and no fill.
 */
const optionItemClass = cn(rowBase, 'pe-(--menu-col) type-body-sm in-data-[size=sm]:type-caption');

/** Where the chosen row's check sits: the trailing column, on the glyph inset, in ink. */
const optionCheckClass = 'pointer-events-none absolute end-(--menu-glyph) flex size-(--icon) items-center justify-center [&_svg]:text-text-1!';

/** A group's heading: a small label in text-2 on the rows' text inset, centred in 32px so the space above and below is even. */
const menuLabelClass = 'flex min-h-(--row-sm) items-center px-(--menu-px) type-label-sm text-text-2 select-none data-inset:ps-(--menu-col)';

/** The rule between groups, edge to edge of the popup. */
const menuSeparatorClass = 'h-px shrink-0 bg-line';

/** A row's shortcut at its inline end: the Kbd caps, 16px clear of the label, the 20px cap as far from the side as from the row's top. */
const menuShortcutClass = 'ms-auto flex shrink-0 items-center gap-1 ps-4 me-[calc((var(--menu-item-h)-var(--space-1)*5)/2-var(--menu-px))]';

export {
  useOverlayOpen,
  overlayModel,
  overlayOpenChanged,
  overlayMayClose,
  overlayRunStarted,
  overlayRunSettled,
  isThenable,
  closesAfter,
  useDefaultAction,
  useScrollBody,
  overlaySurface,
  overlayModal,
  overlayMotion,
  overlayHeaderClass,
  overlayTitleClass,
  overlayHeadMetaClass,
  overlayBodyClass,
  overlayDescriptionClass,
  overlayFooterClass,
  overlayMetaClass,
  overlayErrorClass,
  scrimClass,
  menuPopupClass,
  menuVarsClass,
  menuItemClass,
  menuCheckItemClass,
  menuLabelClass,
  menuSeparatorClass,
  menuShortcutClass,
  optionItemClass,
  optionCheckClass,
  type DefaultAction,
};
