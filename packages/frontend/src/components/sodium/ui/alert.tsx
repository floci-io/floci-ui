'use client';

import {createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {cva} from 'class-variance-authority';
import {Icon, Close} from '@/components/sodium/icon';
import {Button} from '@/components/sodium/ui/button';
import {StatusMark, statusLabels} from '@/components/sodium/ui/status';
import {cn, mergeRefs} from '@/lib/sodium/utils';

// A message about the view it sits in: a partition that failed to load, a warehouse near its quota, a schedule that
// changed. Inline, in the flow, a square box.
//
// The box is the page with the one --line edge every Sodium card draws, whatever the status: no tint, no coloured
// edge, never a bar down one side. status shows once, as the status mark before the title, in the status colour; the
// title says what happened ("Load failed at line 6") and a screen reader hears the status word with it. Everything
// else is ink: the title in label capitals, the cause in body-sm text-2. neutral has no mark. Never yellow on the box:
// yellow is the one fix, a primary Button in AlertAction.
//
// The title and the cause stack 8px apart on the left, both trimmed to cap height and baseline so the padding counts
// to the letters: 14px above the capitals and 14px below the baseline, so the block and the action both sit centred
// in the box, the action at the end. Under 24rem of its own width the action takes a row of its own under the text.
//
// How it leaves: warn and fail never take a close button; they stay until the problem is gone. A neutral or ok alert
// with a dismissKey stays dismissed for that key and comes back by itself when the key changes. Dismissing moves focus
// to the next focusable thing after the alert, never to the top of the page.

type AlertStatus = 'neutral' | 'ok' | 'warn' | 'fail';

// One surface for every status: status changes the Status at the lead, never the box.
const alertVariants = cva('group/alert @container/alert relative w-full min-w-0 border border-line bg-page px-inset py-3.5 text-start text-text-1 forced-colors:border-[CanvasText]');

type AlertContextValue = {status: AlertStatus; dismiss: () => void; dismissible: boolean};
const AlertContext = createContext<AlertContextValue | null>(null);

const storageKey = (key: string) => `sodium:alert-dismissed:${key}`;
function readDismissed(key: string) {
  try { return localStorage.getItem(storageKey(key)) === '1'; } catch { return false; }
}

/** The next element after `from` in document order that takes focus, outside `from` itself. */
function nextFocusable(from: HTMLElement) {
  const all = [...document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
  return all.find(el => !from.contains(el) && (from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? null;
}

type AlertProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  /** What kind of message: a note, good news, a warning or a failure. Sets the lead Status, the role and whether it
   *  closes, never the box. warn and fail never take a close button. */
  status?: AlertStatus;
  /** false for a static note that is part of the page and must not be announced. On by default. */
  announce?: boolean;
  /** Remembers a dismissal under this key (localStorage). Change the key when the message changes. */
  dismissKey?: string;
  onDismiss?: () => void;
};

function Alert({className, status = 'neutral', announce = true, dismissKey, onDismiss, role, children, ref, ...props}: AlertProps) {
  const root = useRef<HTMLDivElement>(null);
  const rootRefs = useMemo(() => mergeRefs(root, ref), [ref]);
  // Undefined until the stored dismissal is read, so an alert dismissed before never flashes in.
  const [dismissed, setDismissed] = useState<boolean | undefined>(dismissKey ? undefined : false);
  useLayoutEffect(() => { if (dismissKey) setDismissed(readDismissed(dismissKey)); }, [dismissKey]);

  const dismissible = status === 'neutral' || status === 'ok';
  const dismiss = useCallback(() => {
    if (!dismissible) return;
    const next = root.current ? nextFocusable(root.current) : null;
    if (dismissKey) { try { localStorage.setItem(storageKey(dismissKey), '1'); } catch {} }
    setDismissed(true);
    onDismiss?.();
    requestAnimationFrame(() => next?.focus());
  }, [dismissible, dismissKey, onDismiss]);

  if (dismissed !== false) return null;
  if (children === undefined || children === null || children === false) return null;

  const loud = status === 'warn' || status === 'fail';

  return <AlertContext.Provider value={{status, dismiss, dismissible}}>
    <div
      ref={rootRefs}
      data-slot="alert"
      data-status={status}
      role={role ?? (announce ? (loud ? 'alert' : 'status') : undefined)}
      className={cn(alertVariants(), className)}
      {...props}
    >
      {/* Parts place themselves on named areas, so they work in any order. The Status and the title share the first
          line and the description sits under both; the actions take the row's end, and under 24rem a row of their own. */}
      <div data-slot="alert-grid" className={cn(
        'grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center',
        '[grid-template-areas:"lead_title_action_close""desc_desc_action_close"]',
        '@max-sm/alert:[grid-template-areas:"lead_title_title_close""desc_desc_desc_close""action_action_action_action"]',
      )}>
        {status !== 'neutral' && <span data-slot="alert-status" className="me-2 flex items-center [grid-area:lead] [&>[data-slot=status-mark]]:h-auto">
          <StatusMark status={status} label={statusLabels[status]}/>
        </span>}
        {children}
      </div>
    </div>
  </AlertContext.Provider>;
}

function useAlert() {
  const context = useContext(AlertContext);
  if (!context) throw new Error('Alert parts must be inside <Alert>.');
  return context;
}

/** What happened, in label capitals after the mark: "Load failed at line 6". On the buttons' line, centred on them. */
function AlertTitle({className, ...props}: React.ComponentProps<'p'>) {
  return <p data-slot="alert-title" className={cn('min-w-0 type-label text-text-1 [overflow-wrap:anywhere] [text-box:trim-both_cap_alphabetic] [grid-area:title]', className)} {...props}/>;
}

/** The cause, one sentence in text-2 under the title row, the box's full width. Its line box is trimmed to cap height
 *  and baseline, so the inset counts to the letters, the way it counts to the buttons' edge above. */
function AlertDescription({className, ...props}: React.ComponentProps<'div'>) {
  return <div
    data-slot="alert-description"
    className={cn(
      'mt-2 min-w-0 type-body-sm text-text-2 [overflow-wrap:anywhere] [text-box:trim-both_cap_alphabetic] [grid-area:desc] group-not-has-data-[slot=alert-title]/alert:mt-0 group-not-has-data-[slot=alert-title]/alert:[grid-area:title]',
      '[&_a]:text-text-1 [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-2',
      className,
    )}
    {...props}
  />;
}

/** One or two size="sm" Buttons at the end, centred on the title and cause; a row of their own when under 24rem wide. */
function AlertAction({className, ...props}: React.ComponentProps<'div'>) {
  return <div
    data-slot="alert-action"
    className={cn(
      'ms-4 flex max-w-full min-w-0 flex-wrap items-center gap-2 self-center [grid-area:action]',
      '@max-sm/alert:ms-0 @max-sm/alert:mt-3 @max-sm/alert:justify-self-start',
      className,
    )}
    {...props}
  />;
}

/** Dismisses a neutral or ok alert. Renders nothing on warn and fail, which stay until the problem is fixed. */
function AlertClose({className, label = 'Dismiss', onClick, ...props}: Omit<React.ComponentProps<typeof Button>, 'children' | 'size' | 'variant'> & {label?: string}) {
  const {dismiss, dismissible} = useAlert();
  if (!dismissible) {
    if (process.env.NODE_ENV !== 'production') console.warn('AlertClose: warn and fail alerts stay until the problem is fixed, so the close button is not rendered.');
    return null;
  }
  return <Button
    variant="ghost"
    size="icon-sm"
    data-slot="alert-close"
    aria-label={label}
    onClick={event => { onClick?.(event); if (!event.defaultPrevented) dismiss(); }}
    className={cn('ms-2 [grid-area:close]', className)}
    {...props}
  >
    <Icon icon={Close}/>
  </Button>;
}

export {Alert, AlertTitle, AlertDescription, AlertAction, AlertClose, alertVariants, type AlertProps, type AlertStatus};
