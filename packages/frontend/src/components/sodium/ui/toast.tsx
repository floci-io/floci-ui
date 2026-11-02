'use client';

import {isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {Toast as ToastPrimitive} from '@base-ui/react/toast';
import {useDomDirection} from '@/lib/sodium/direction';
import {cn, reducedMotion} from '@/lib/sodium/utils';
import {useSodiumPortal} from '@/lib/sodium/portal';
import {Icon, Close as CloseIcon} from '@/components/sodium/icon';
import {buttonVariants} from '@/components/sodium/ui/button';
import {StatusMark} from '@/components/sodium/ui/status';

// Reports something that happened out of view, then leaves: a backfill finished, an export is ready, a job failed
// while the person was on another page. Base UI's Toast underneath, with a function-style call
// (`toast.success('Backfill finished')`) on top. Mount one <Toaster/> per app; it portals into the Sodium root.
//
// The timer is the reading time, not a fixed 5 seconds: 3 seconds plus 60ms per character of title and description,
// plus 3 seconds when it has an action, between 4 and 12 seconds. A 2px line along the bottom wipes out over exactly
// that time, linear, and stops while the pointer or focus is in the stack and while the window is in the background,
// the same moments Base UI pauses the timer. fail and loading never time out.
//
// The look is the overlay recipe: the panel with a 1px --line edge, square, no shadow, 360px wide at the bottom end
// and the full width on a phone. Status is the Status mark and a mono capital title: a solid square for done, a half
// square for a warning, the diamond for a failure, the running cells while loading. At most one action, a small
// secondary Button; the close is a ghost X. Never the yellow slab: a toast reports, it does not ask.
//
// The limit (3) never hides a fail: fails always show, routine toasts fill what is left oldest first, and the newest
// routine toast waits with its timer stopped. A closed toast leaves at once and the others close up behind it.

const toastManager = ToastPrimitive.createToastManager();

type ToastKind = 'default' | 'success' | 'warn' | 'fail' | 'loading';

type ToastOptions = {
  description?: ReactNode;
  /** One action, like Undo or View: the only one a toast holds. Adds 3 seconds to the timer. */
  action?: {label: ReactNode; onClick: () => void};
  /** ms before it leaves. 0 keeps it until closed. Defaults to the reading time; 0 for fail and loading. */
  timeout?: number;
  /** Reusing an id replaces that toast in place. */
  id?: string;
  onClose?: () => void;
};

/** Characters of readable text in a node, walking elements; a node it cannot read counts as 40. */
function textLength(node: ReactNode): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0;
  if (typeof node === 'string' || typeof node === 'number') return String(node).length;
  if (Array.isArray(node)) return node.reduce<number>((sum, n) => sum + textLength(n), 0);
  if (isValidElement<{children?: ReactNode}>(node)) return textLength(node.props.children);
  return 40;
}

/** Reading time, in ms: the base, per character of title and description, the extra for an action, and the clamp. */
const READ = {base: 3000, char: 60, action: 3000, min: 4000, max: 12000};

/** The reading time in ms: 3s plus 60ms a character, plus 3s with an action, clamped to 4 to 12 seconds. */
function readingTimeout(title: ReactNode, description?: ReactNode, hasAction = false) {
  const ms = READ.base + READ.char * (textLength(title) + textLength(description)) + (hasAction ? READ.action : 0);
  return Math.min(READ.max, Math.max(READ.min, Math.round(ms / 100) * 100));
}

function timeoutFor(kind: ToastKind, title: ReactNode, options: ToastOptions) {
  if (options.timeout !== undefined) return options.timeout;
  if (kind === 'fail' || kind === 'loading') return 0;
  return readingTimeout(title, options.description, !!options.action);
}

/**
 * Everything a toast shows, from one call's arguments. add and update both build through this, so an
 * update replaces the whole toast (an action left out is gone) and never drops a field add would set.
 */
function toastFields(kind: ToastKind, title: ReactNode, options: Omit<ToastOptions, 'id'>) {
  const {description, action, onClose} = options;
  const timeout = timeoutFor(kind, title, options);
  return {
    title,
    description,
    type: kind,
    timeout,
    priority: kind === 'fail' ? 'high' as const : 'low' as const,
    onClose,
    data: {timeout},
    actionProps: action ? {children: action.label, onClick: action.onClick} : undefined,
  };
}

function add(kind: ToastKind, title: ReactNode, options: ToastOptions = {}) {
  // A toast with no title is a box holding only a close button: drop it and return no id.
  if (textLength(title) === 0 && !isValidElement(title)) return '';
  return toastManager.add({id: options.id, ...toastFields(kind, title, options)});
}

/** Shows a toast and returns its id. */
const toast = Object.assign((title: ReactNode, options?: ToastOptions) => add('default', title, options), {
  success: (title: ReactNode, options?: ToastOptions) => add('success', title, options),
  warn: (title: ReactNode, options?: ToastOptions) => add('warn', title, options),
  fail: (title: ReactNode, options?: ToastOptions) => add('fail', title, options),
  loading: (title: ReactNode, options?: ToastOptions) => add('loading', title, options),
  /** Loading while the promise runs, then success or fail in the same toast. */
  promise: <T,>(promise: Promise<T>, labels: {loading: ReactNode; success: ReactNode | ((value: T) => ReactNode); fail: ReactNode | ((error: unknown) => ReactNode)}) =>
    toastManager.promise(promise, {
      loading: {title: labels.loading, type: 'loading', timeout: 0, data: {timeout: 0}},
      success: value => {
        const title = typeof labels.success === 'function' ? (labels.success as (v: T) => ReactNode)(value) : labels.success;
        const timeout = readingTimeout(title);
        return {title, type: 'success', timeout, data: {timeout}};
      },
      error: error => ({title: typeof labels.fail === 'function' ? (labels.fail as (e: unknown) => ReactNode)(error) : labels.fail, type: 'fail', priority: 'high', timeout: 0, data: {timeout: 0}}),
    }),
  /** Replaces a toast in place: its kind, title and every option, so pass the action again to keep it. */
  update: (id: string, kind: ToastKind, title: ReactNode, options: Omit<ToastOptions, 'id'> = {}) =>
    toastManager.update(id, toastFields(kind, title, options)),
  dismiss: (id?: string) => toastManager.close(id),
});

type ToasterProps = {
  /**
   * Renders the stack in place instead of fixed to the window, for docs and previews. An inline stack is a
   * specimen: a plain group, not a live "Notifications" region, so a page with several still has one.
   */
  inline?: boolean;
  /**
   * Most toasts visible at once. A fail toast always shows and takes a slot; routine toasts fill the rest
   * oldest first, and the newest routine toast waits, its timer stopped, until there is room.
   */
  limit?: number;
  /** A manager from createToastManager, for a toaster separate from toast(). */
  manager?: typeof toastManager;
  className?: string;
};

/** Mount once. Renders every toast created with toast(). */
function Toaster({inline, limit = 3, manager = toastManager, className}: ToasterProps) {
  const container = useSodiumPortal();
  const [away, setAway] = useState(false);
  // Base UI pauses timers while the window is in the background; the drain line pauses with them.
  useEffect(() => {
    const sync = () => setAway(!document.hasFocus());
    sync();
    window.addEventListener('blur', sync);
    window.addEventListener('focus', sync);
    return () => { window.removeEventListener('blur', sync); window.removeEventListener('focus', sync); };
  }, []);
  const viewport = <ToastPrimitive.Viewport
    data-slot="toast-viewport"
    data-away={away || undefined}
    {...(inline ? {role: 'group', 'aria-live': 'off' as const, 'aria-label': 'Example toasts'} : {})}
    className={cn(
      'group/toasts @container/toast flex w-full flex-col-reverse gap-2',
      // On phones the stack spans the width 16px in and clears the home indicator; from sm it is 360px at the bottom end.
      inline ? 'relative' : 'fixed z-(--z-overlay) end-0 bottom-0 p-4 pb-[max(var(--space-4),env(safe-area-inset-bottom))] sm:end-6 sm:bottom-6 sm:w-(--toast) sm:p-0',
      className,
    )}
  >
    <ToastList limit={limit} manager={manager}/>
  </ToastPrimitive.Viewport>;
  // Base UI's own limit hides the oldest, which would hide a held fail behind routine toasts.
  // ToastList applies Sodium's limit instead, so Base UI's is off.
  return <ToastPrimitive.Provider toastManager={manager} limit={Number.MAX_SAFE_INTEGER}>
    {inline ? viewport : <ToastPrimitive.Portal container={container}>{viewport}</ToastPrimitive.Portal>}
  </ToastPrimitive.Provider>;
}

type ToastObject = ReturnType<typeof ToastPrimitive.useToastManager>['toasts'][number];

/**
 * Which toasts wait. Fail toasts always show. Routine toasts fill the slots left, oldest first, so the
 * newest routine toast is the one that waits. Leaving toasts take no slot.
 */
function waitingIds(toasts: ToastObject[], limit: number) {
  const live = toasts.filter(t => t.transitionStatus !== 'ending');
  const fails = live.filter(t => t.type === 'fail').length;
  // toasts come newest first; walk oldest first.
  const routine = live.filter(t => t.type !== 'fail').reverse();
  return new Set(routine.slice(Math.max(0, limit - fails)).map(t => t.id));
}

function ToastList({limit, manager}: {limit: number; manager: typeof toastManager}) {
  const {toasts} = ToastPrimitive.useToastManager();
  const waiting = waitingIds(toasts, limit);
  const key = [...waiting].join(' ');
  // A waiting toast's timer stops, so it cannot time out unseen; it starts over when the toast shows.
  const parked = useRef(new Set<string>());
  useEffect(() => {
    for (const t of toasts) {
      const ms = (t.data as {timeout?: number} | undefined)?.timeout ?? 0;
      if (!ms || t.transitionStatus === 'ending') continue;
      if (waiting.has(t.id) && !parked.current.has(t.id)) { parked.current.add(t.id); manager.update(t.id, {timeout: 0}); }
      else if (!waiting.has(t.id) && parked.current.has(t.id)) { parked.current.delete(t.id); manager.update(t.id, {timeout: ms}); }
    }
    // key captures the waiting set; toasts changes on every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, manager]);
  // When a toast leaves or arrives, the others glide to their new place instead of jumping (FLIP).
  const nodes = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    nodes.current.forEach((el, id) => {
      if (!el.offsetParent || !el.parentElement) return;
      const top = el.parentElement.getBoundingClientRect().top + el.offsetTop;
      next.set(id, top);
      const before = tops.current.get(id);
      if (before === undefined || Math.abs(before - top) < 1 || reducedMotion(el)) return;
      el.getAnimations().forEach(a => { if (a.id === 'toast-flip') a.cancel(); });
      const style = getComputedStyle(el);
      el.animate([{transform: `translateY(${before - top}px)`}, {transform: 'none'}], {
        id: 'toast-flip',
        duration: parseFloat(style.getPropertyValue('--dur-overlay')) || 200,
        easing: style.getPropertyValue('--ease-out').trim() || 'ease-out',
      });
    });
    tops.current = next;
  });
  const register = (id: string) => (el: HTMLElement | null) => { if (el) nodes.current.set(id, el); else nodes.current.delete(id); };
  return toasts.map(t => <ToastItem key={t.id} toast={t} waiting={waiting.has(t.id)} nodeRef={register(t.id)}/>);
}

/**
 * The drain line: 2px along the whole bottom edge that shrinks to nothing over the timeout. It runs on the Web
 * Animations API, so it needs no keyframes in the theme, and pauses whenever the stack is expanded (pointer or focus
 * in it) or the window is in the background, as Base UI pauses the timer.
 */
function ToastTimer({ms}: {ms: number}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    const stack = el?.closest<HTMLElement>('[data-slot=toast-viewport]');
    if (!el || !ms || reducedMotion(el)) return;
    const drain = el.animate([{scale: '1 1'}, {scale: '0 1'}], {duration: ms, easing: 'linear', fill: 'forwards'});
    const sync = () => {
      const held = !!stack && (stack.hasAttribute('data-expanded') || stack.hasAttribute('data-away'));
      if (held) drain.pause(); else if (drain.playState === 'paused') drain.play();
    };
    sync();
    const watch = new MutationObserver(sync);
    if (stack) watch.observe(stack, {attributes: true, attributeFilter: ['data-expanded', 'data-away']});
    return () => { watch.disconnect(); drain.cancel(); };
  }, [ms]);
  if (!ms) return null;
  return <span
    ref={ref}
    aria-hidden
    data-slot="toast-timer"
    className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-line-control motion-reduce:hidden rtl:origin-right"
  />;
}

/** Each kind's Status mark. */
const kindMark = {success: 'ok', warn: 'warn', fail: 'fail', loading: 'running'} as const;

function ToastItem({toast: t, waiting, nodeRef}: {toast: ToastObject; waiting: boolean; nodeRef: (el: HTMLElement | null) => void}) {
  const kind = (t.type ?? 'default') as ToastKind;
  const ms = (t.data as {timeout?: number} | undefined)?.timeout ?? t.timeout ?? 0;
  // The stack sits at the inline end, so a sideways swipe toward that edge dismisses: right, or left in right to left.
  const end = useDomDirection(useSodiumPortal()) === 'rtl' ? 'left' : 'right';
  const status = kind === 'warn' || kind === 'fail' || kind === 'success' ? kind : undefined;
  return <ToastPrimitive.Root
    ref={nodeRef}
    toast={t}
    data-slot="toast"
    data-kind-of-toast={kind}
    data-timeout={ms || undefined}
    data-waiting={waiting || undefined}
    data-status={status}
    swipeDirection={['down', end]}
    className={cn(
      // A grid so the action can drop under the text when the stack is narrow; the close stays on the first line.
      'overlay relative grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-2 [grid-template-areas:"content_action_close"] overflow-hidden py-2.5 ps-4 pe-2 select-none',
      'forced-colors:border-[CanvasText]',
      '@max-[20rem]/toast:gap-y-2 @max-[20rem]/toast:[grid-template-areas:"content_content_close"_"action_action_action"]',
      'translate-x-(--toast-swipe-movement-x) translate-y-(--toast-swipe-movement-y)',
      'transition-[translate,opacity] duration-(--dur-overlay) ease-out data-swiping:transition-none',
      'data-starting-style:translate-y-2 data-starting-style:opacity-0',
      // A closed toast leaves at once: no fading box that still takes clicks, and the stack closes up in the same frame.
      'data-ending-style:hidden data-waiting:hidden',
    )}
  >
    <ToastPrimitive.Content data-slot="toast-content" className="flex min-w-0 flex-1 items-start gap-2 py-1 [grid-area:content]">
      {kind !== 'default' && <StatusMark status={kindMark[kind]} className="type-label"/>}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <ToastPrimitive.Title data-slot="toast-title" className="type-label break-words text-text-1"/>
        <ToastPrimitive.Description data-slot="toast-description" className="type-body-sm break-words text-text-2 empty:hidden"/>
      </div>
    </ToastPrimitive.Content>
    {/* The action and the X are 26px; the text sits 4px down, so its first 16px line centres on them to half a pixel. */}
    {t.actionProps && <ToastPrimitive.Action data-slot="toast-action" className={buttonVariants({variant: 'secondary', size: 'sm', className: 'self-start [grid-area:action] @max-[20rem]/toast:ms-4 @max-[20rem]/toast:justify-self-start'})}/>}
    <ToastPrimitive.Close data-slot="toast-close" aria-label="Dismiss" className={buttonVariants({variant: 'ghost', size: 'icon-sm', className: 'self-start text-text-2 [grid-area:close] hover:text-text-1'})}>
      <Icon icon={CloseIcon}/>
    </ToastPrimitive.Close>
    {!waiting && <ToastTimer key={`${t.id}-${ms}-${String(t.title)}`} ms={ms}/>}
  </ToastPrimitive.Root>;
}

export {Toaster, toast, toastManager, readingTimeout, type ToastKind, type ToastOptions, type ToasterProps};
