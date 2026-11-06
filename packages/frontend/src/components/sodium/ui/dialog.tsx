'use client';

import * as React from 'react';
import {Dialog as DialogPrimitive} from '@base-ui/react/dialog';
import {AlertDialog as AlertDialogPrimitive} from '@base-ui/react/alert-dialog';
import {cva, type VariantProps} from 'class-variance-authority';
import {Button, type ButtonProps} from '@/components/sodium/ui/button';
import {Icon, Close as CloseIcon, ErrorOutline} from '@/components/sodium/icon';
import {cn, mergeClass} from '@/lib/sodium/utils';
import {useSodiumModal, useSodiumPortal} from '@/lib/sodium/portal';
import {
  closesAfter, overlayBodyClass, overlayDescriptionClass, overlayErrorClass, overlayFooterClass, overlayHeadMetaClass, overlayHeaderClass,
  overlayMetaClass, overlayModal, overlayMotion, overlayTitleClass, scrimClass, useDefaultAction, useOverlayOpen, useScrollBody, type DefaultAction,
} from '@/lib/sodium/overlay';

// Sodium's dialog, on Base UI's Dialog and AlertDialog. One component, three jobs:
//
//   <Dialog>                                   modal work: a short form, a preview, a choice
//   <Dialog role="alertdialog">                one question; the scrim does nothing and there is no corner X
//   <Dialog role="alertdialog" confirmText=…>  an irreversible action the person confirms by typing a name
//
// The look is the overlay recipe as one region, built like a Frame: the panel fill with a 1px --line edge, square,
// no shadow, over the scrim (ink at 32% in light, black at 64% in dark, no blur). Inside it nothing is boxed again.
// DialogHeader is the region header (panel-head, 38px): the name in mono as written, `deploy ingest-events v14`, then
// meta, then the X as a 26px ghost header action. DialogBody sits on the 12px --inset all round and opens with
// DialogDescription, one sentence in text-2. DialogFooter is FrameFooter: meta first, the way out and at most one
// primary (the yellow slab or the destructive) at the end, --inset from every edge. A tall dialog scrolls in its
// body; the header, the X and the actions stay put.
//
// The footer declares what Enter does (`defaultAction`); a destructive action makes dismiss the default, so Enter
// fails safe. DialogAction takes `onAction`: a returned promise turns the button pending, blocks every way out
// (Escape, the scrim, Cancel, the X) until it settles, closes on success and shows the error as a failure row above
// the footer. While a modal dialog is open the page behind is inert (useSodiumModal), so Tab and a screen reader stay
// inside. Focus returns to the trigger on close, and Escape closes only the innermost overlay (Base UI).

type DialogRole = 'dialog' | 'alertdialog';

type DialogState = {
  role: DialogRole;
  /** The name the person must type before the primary action enables. */
  confirmText?: string;
  typed: string;
  setTyped: (value: string) => void;
  matched: boolean;
  pending: boolean;
  error: string | null;
  run: (action: () => void | Promise<unknown>, closeAfter: boolean) => void;
  close: () => void;
  /** Open and modal: the page behind is inert. */
  locks: boolean;
};

const DialogContext = React.createContext<DialogState | null>(null);

/** The nearest dialog's state: role, pending, error and the typed confirm. */
function useDialog() {
  const context = React.useContext(DialogContext);
  if (!context) throw new Error('Dialog parts must be inside <Dialog>.');
  return context;
}

type DialogProps = Omit<DialogPrimitive.Root.Props, 'role'> & {
  /**
   * dialog: modal work, dismissed by Escape, the scrim or the X. alertdialog: one question the person must answer;
   * the scrim does nothing and there is no X; Escape still backs out.
   */
  role?: DialogRole;
  /**
   * The exact name the person types to confirm, case-sensitive. The primary DialogAction stays disabled until it
   * matches. Pair it with role="alertdialog" and a destructive action.
   */
  confirmText?: string;
};

function Dialog({role = 'dialog', confirmText, open: openProp, defaultOpen = false, onOpenChange, modal = true, children, ...props}: DialogProps) {
  const {open, setOpen, pending, error, session, run} = useOverlayOpen<DialogPrimitive.Root.ChangeEventDetails>({
    open: openProp, defaultOpen, onOpenChange,
  });
  // The typed confirm belongs to one open: a new session, however the dialog opened, starts it empty.
  const [entry, setEntry] = React.useState({session, value: ''});
  const typed = entry.session === session ? entry.value : '';
  const setTyped = React.useCallback((value: string) => setEntry({session, value}), [session]);

  const matched = confirmText === undefined || typed.trim() === confirmText;
  // An alert dialog is always modal in Base UI.
  const locks = open && (role === 'alertdialog' || modal === true);

  const state = React.useMemo<DialogState>(() => ({
    role, confirmText, typed, setTyped, matched, pending, error, run, close: () => setOpen(false), locks,
  }), [role, confirmText, typed, setTyped, matched, pending, error, run, setOpen, locks]);

  return <DialogContext.Provider value={state}>
    {role === 'alertdialog'
      ? <AlertDialogPrimitive.Root data-slot="dialog" open={open} onOpenChange={setOpen} {...(props as AlertDialogPrimitive.Root.Props)}>{children}</AlertDialogPrimitive.Root>
      : <DialogPrimitive.Root data-slot="dialog" open={open} onOpenChange={setOpen} modal={modal} {...props}>{children}</DialogPrimitive.Root>}
  </DialogContext.Provider>;
}

const dialogVariants = cva(
  [
    'group/dialog fixed top-1/2 left-1/2 z-(--z-overlay) -translate-x-1/2 -translate-y-1/2',
    // 16px of page shows on each side of a phone; 32px above and below a tall dialog.
    'max-h-[calc(100dvh-var(--space-8)*2)] w-[calc(100%-var(--space-4)*2)]',
    overlayModal,
    overlayMotion,
    // A nested dialog dims its parent rather than stacking a second scrim.
    'after:pointer-events-none after:absolute after:inset-0 after:z-(--z-raised) after:bg-scrim after:opacity-0 after:transition-opacity after:duration-(--dur-state) data-nested-dialog-open:after:opacity-100',
  ],
  {
    variants: {
      size: {
        sm: 'max-w-(--overlay-sm)',
        default: 'max-w-(--overlay)',
        lg: 'max-w-(--overlay-lg)',
      },
    },
    defaultVariants: {size: 'default'},
  },
);

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props}/>;
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  const container = useSodiumPortal();
  return <DialogPrimitive.Portal data-slot="dialog-portal" container={container} {...props}/>;
}

function DialogOverlay({className, ...props}: DialogPrimitive.Backdrop.Props) {
  return <DialogPrimitive.Backdrop data-slot="dialog-overlay" className={mergeClass(scrimClass, className)} {...props}/>;
}

type DialogContentProps = DialogPrimitive.Popup.Props & VariantProps<typeof dialogVariants> & {
  /** The ghost X, the header's last action. On for role="dialog", off for alertdialog. DialogHeader draws it. */
  showCloseButton?: boolean;
};

/** Whether this popup's header carries the X. */
const DialogCloseContext = React.createContext(false);

function DialogContent({className, size, showCloseButton, children, ref, onKeyDown, initialFocus, ...props}: DialogContentProps) {
  const {role, pending, locks} = useDialog();
  const withClose = showCloseButton ?? role === 'dialog';
  const action = useDefaultAction<HTMLDivElement>({ref, onKeyDown, initialFocus});
  useSodiumModal(locks);
  return <DialogPortal>
    <DialogOverlay/>
    <DialogPrimitive.Popup
      data-slot="dialog-content"
      data-size={size ?? 'default'}
      data-role={role}
      data-close={withClose || undefined}
      aria-busy={pending || undefined}
      className={mergeClass(dialogVariants({size}), className)}
      {...action}
      {...props}
    >
      <DialogCloseContext.Provider value={withClose}>{children}</DialogCloseContext.Provider>
    </DialogPrimitive.Popup>
  </DialogPortal>;
}

type DialogHeaderProps = React.ComponentProps<'div'> & {
  /** Meta at the header's end, before the X, in text-2: a version, a region, a size. */
  meta?: React.ReactNode;
};

/**
 * The region header: panel-head at --head (38px) on the panel fill with a rule under it. DialogTitle first, then the
 * meta, then the X as a 26px ghost header action whose glyph lands on the 12px inset. It stays put while the body scrolls.
 */
function DialogHeader({className, meta, children, ...props}: DialogHeaderProps) {
  const {pending, error} = useDialog();
  const withClose = React.useContext(DialogCloseContext);
  return <div
    data-slot="dialog-header"
    data-pending={pending || undefined}
    data-status={error ? 'fail' : undefined}
    className={cn(overlayHeaderClass, className)}
    {...props}
  >
    {children}
    {meta && <span data-slot="dialog-header-meta" className={overlayHeadMetaClass}>{meta}</span>}
    {withClose && <div className="panel-head-actions">
      <DialogPrimitive.Close
        data-slot="dialog-close-button"
        aria-label="Close"
        disabled={pending}
        render={<Button variant="ghost" size="icon-sm"/>}
      >
        <Icon icon={CloseIcon}/>
      </DialogPrimitive.Close>
    </div>}
  </div>;
}

/**
 * The rest, on the 12px --inset all round: DialogDescription first, then a form, a list of changes, the typed confirm.
 * It scrolls when the dialog runs out of room. Rows inside take rule-row, so the faint rule falls between rows only.
 */
function DialogBody({className, ref, ...props}: React.ComponentProps<'div'>) {
  const setRef = useScrollBody<HTMLDivElement>(ref);
  return <div
    ref={setRef}
    data-slot="dialog-body"
    className={cn(overlayBodyClass, className)}
    {...props}
  />;
}

type DialogFooterProps = React.ComponentProps<'div'> & {
  /**
   * What Enter does when focus is not on a control. primary presses the DialogAction; dismiss presses the
   * DialogClose; none leaves Enter alone. Unset, it is dismiss when the action is destructive and primary otherwise.
   */
  defaultAction?: DefaultAction;
  /** Meta at the start of the row, such as how many tables the action touches. */
  meta?: React.ReactNode;
};

/** The ruled footer row: the meta, then DialogClose and one DialogAction. A failed action shows as a row above it. */
function DialogFooter({className, defaultAction, meta, children, ...props}: DialogFooterProps) {
  const {error} = useDialog();
  return <>
    {error && <div data-slot="dialog-error" role="alert" data-status="fail" className={overlayErrorClass}>
      <Icon icon={ErrorOutline}/>
      <span className="min-w-0 break-words">{error}</span>
    </div>}
    <div
      data-slot="dialog-footer"
      data-default-action={defaultAction ?? 'auto'}
      className={cn(overlayFooterClass, error && 'border-fail', className)}
      {...props}
    >
      {meta && <span data-slot="dialog-footer-meta" className={overlayMetaClass}>{meta}</span>}
      {children}
    </div>
  </>;
}

/** The dialog's name, first in DialogHeader, in mono as written: `deploy ingest-events v14`, `cancel job_4812?`. It names the dialog for a screen reader. */
function DialogTitle({className, ...props}: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={mergeClass(overlayTitleClass, className)} {...props}/>;
}

/** The one sentence that opens DialogBody, as FrameDescription. It describes the dialog for a screen reader. */
function DialogDescription({className, ...props}: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={mergeClass(cn(overlayDescriptionClass, '[&_a]:text-text-1 [&_a]:underline [&_a]:underline-offset-4'), className)} {...props}/>;
}

/** Closes the dialog: the footer's way out, a small (26px) secondary Button unless `render` says otherwise. Disabled while an action runs. */
function DialogClose({disabled, render, ...props}: DialogPrimitive.Close.Props) {
  const {pending} = useDialog();
  return <DialogPrimitive.Close
    data-slot="dialog-close"
    data-dialog-action="dismiss"
    disabled={disabled || pending}
    render={render ?? <Button variant="secondary" size="sm"/>}
    {...props}
  />;
}

type DialogActionProps = ButtonProps & {
  /**
   * Close the dialog after the action finishes. On with onAction, and on for a bare action with no onAction, onClick
   * or type="submit" (a "done"). Off when onClick or a form submit owns what happens.
   */
  close?: boolean;
  /**
   * Runs the action. A returned promise turns the button pending and holds the dialog open until it settles: it
   * closes on resolve and shows the rejection's message above the footer.
   */
  onAction?: () => void | Promise<unknown>;
};

/**
 * The footer's one lead action: the yellow slab, or variant="destructive". Enter presses it when the footer's default
 * is primary. With `confirmText` on the Dialog it stays disabled until the typed name matches.
 */
function DialogAction({close, onAction, onClick, disabled, pending: pendingProp, ...props}: DialogActionProps) {
  const {matched, pending, run} = useDialog();
  const closeAfter = closesAfter({close, onAction, onClick, type: props.type});
  return <Button
    data-slot="dialog-action"
    data-dialog-action="primary"
    // A footer is a region footer, as FrameFooter: 26px buttons, so it is 12 + 26 + 12px tall.
    size="sm"
    disabled={disabled || !matched}
    // The dialog's pending is the action's. A boolean from the start makes Button reserve the pending mark's room.
    pending={pendingProp ?? (onAction !== undefined || props.pendingLabel !== undefined || pending ? pending : undefined)}
    onClick={event => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      if (onAction || closeAfter) run(onAction ?? (() => {}), closeAfter);
    }}
    {...props}
  />;
}

type DialogConfirmFieldProps = Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'children'> & {
  /** The words around the name. Defaults to "Type <name> to confirm". */
  label?: (name: React.ReactNode) => React.ReactNode;
};

/**
 * The typed confirm: the name to type, in mono as written on the well, lit character by character as the person types
 * it, with the first character that differs on the failure tint. The Dialog's confirmText is the name.
 */
function DialogConfirmField({label = name => <>Type {name} to confirm</>, className, id, ...props}: DialogConfirmFieldProps) {
  const {confirmText, typed, setTyped, pending} = useDialog();
  const autoId = React.useId();
  const fieldId = id ?? autoId;
  const hintId = `${fieldId}-hint`;
  if (confirmText === undefined) return null;
  const value = typed.trim();
  let differs = -1;
  for (let i = 0; i < value.length; i++) if (value[i] !== confirmText[i]) { differs = i; break; }
  if (differs < 0 && value.length > confirmText.length) differs = confirmText.length;
  const good = differs < 0 ? value.length : differs;
  const matchedNow = differs < 0 && value.length === confirmText.length;
  const name = <span data-slot="dialog-confirm-name" className="mono bg-well px-1 break-all select-all">
    {Array.from(confirmText).map((ch, i) => <span
      key={i}
      data-char={i < good ? 'match' : i === differs ? 'differs' : 'rest'}
      className="text-text-2 data-[char=differs]:bg-fail-tint data-[char=differs]:text-fail-text data-[char=differs]:underline data-[char=differs]:underline-offset-2 data-[char=match]:text-text-1"
    >{ch}</span>)}
  </span>;
  const hint = differs >= 0
    ? `Differs at character ${differs + 1}. The name is case-sensitive.`
    : matchedNow ? 'Matches. Press the button to confirm; Enter does not.' : 'The name is case-sensitive. Enter does not confirm.';
  return <div data-slot="dialog-confirm-field" className="flex flex-col gap-2">
    <label htmlFor={fieldId} className="type-body-sm text-text-2 break-words">{label(name)}</label>
    <input
      id={fieldId}
      data-autofocus
      value={typed}
      onChange={event => setTyped(event.target.value)}
      readOnly={pending}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      aria-describedby={hintId}
      aria-invalid={differs >= 0 || undefined}
      className={cn('field w-full type-code read-only:text-text-2', className)}
      {...props}
    />
    {/* The hint is the field's description, read on focus. Only the match is announced, so a screen reader does not
        hear a new hint on every keystroke. */}
    <p id={hintId} className={cn('type-caption', differs >= 0 ? 'text-fail-text' : matchedNow ? 'text-ok-text' : 'text-text-2')}>{hint}</p>
    <p aria-live="polite" className="sr-only">{matchedNow ? 'Matches.' : ''}</p>
  </div>;
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogAction,
  DialogConfirmField,
  dialogVariants,
  useDialog,
  type DialogProps,
  type DialogRole,
  type DialogContentProps,
  type DialogHeaderProps,
  type DialogActionProps,
};
