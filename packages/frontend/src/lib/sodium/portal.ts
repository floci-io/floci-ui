'use client';

import {createContext, createElement, Fragment, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';

// Where Sodium's overlays portal to. Base UI portals to document.body by default, which sits outside
// .sodium, so the tokens, the theme and the font never reach a popup. SodiumPortalProvider renders an
// empty [data-sodium-portal] element as the last child of .sodium and hands it down; every overlay
// passes it to its Base UI Portal:
//
//   const container = useSodiumPortal();
//   <PopoverPrimitive.Portal container={container}>...</PopoverPrimitive.Portal>
//
// The hook returns null until the element mounts (Base UI waits on null rather than falling back to
// body), and undefined outside the provider, where Base UI's own default applies.
//
// A provider plays one of three parts, from where it sits:
//
//   root   the first provider in the tree (components/docs-kit/system-routes.tsx). Its container is the last
//          child of .sodium, a sibling of the page, so a modal can make the page inert without making
//          itself inert.
//   dir    a provider given `dir` inside another, which SodiumDirection renders for a subtree that
//          flips. Its container carries the dir attribute and is portalled into the root's container,
//          so a popup opened from a right-to-left specimen lays out right to left and still sits
//          outside the page.
//   stage  a provider without `dir` inside another, such as the docs' Stage. Its container sits in
//          place after its children, so an overlay shown open in a specimen stays in its frame. A
//          stage is part of the page, so a modal inside it does not lock the page.
//
// Modal overlays call useSodiumModal(open). While any is open, every element outside the root's
// container, from .sodium up to body, is inert: Tab, Shift+Tab, a click and a screen reader's virtual
// cursor cannot reach the page behind. Base UI's own aria-hidden is not enough here: it keeps every
// ancestor of an aria-live region visible, and the docs have live regions on most pages.

type Direction = 'ltr' | 'rtl';

type PortalScope = {
  container: HTMLElement | null;
  /** Makes everything outside the root container inert; call the returned function to release. */
  lock: () => () => void;
};

const SodiumPortalContext = createContext<PortalScope | undefined>(undefined);

const noLock = () => () => {};

/** Sets inert on every element outside `keep`, from its parent up to body. Returns the undo. */
function inertOutside(keep: HTMLElement) {
  const set: HTMLElement[] = [];
  let node: HTMLElement | null = keep;
  while (node && node !== node.ownerDocument.body) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert || sibling.tagName === 'SCRIPT') continue;
      sibling.inert = true;
      set.push(sibling);
    }
    node = parent;
  }
  return () => { for (const el of set) el.inert = false; };
}

export function SodiumPortalProvider({children, dir}: {children: ReactNode; dir?: Direction}) {
  const parent = useContext(SodiumPortalContext);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const count = useRef(0);
  const undo = useRef<(() => void) | null>(null);
  const role = !parent ? 'root' : dir ? 'dir' : 'stage';

  const scope = useMemo<PortalScope>(() => {
    if (role === 'dir') return {container, lock: parent!.lock};
    if (role === 'stage') return {container, lock: noLock};
    return {
      container,
      lock: () => {
        count.current += 1;
        if (count.current === 1 && container) undo.current = inertOutside(container);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          count.current -= 1;
          if (count.current === 0) { undo.current?.(); undo.current = null; }
        };
      },
    };
  }, [role, container, parent]);

  // `dir` with no provider above: SodiumDirection at the root, before the root provider. Pass through.
  if (!parent && dir) return createElement(Fragment, null, children);

  const element = createElement('div', {ref: setContainer, 'data-sodium-portal': role, dir: role === 'dir' ? dir : undefined});
  return createElement(SodiumPortalContext.Provider, {value: scope},
    children,
    role === 'dir' ? (parent!.container ? createPortal(element, parent!.container) : null) : element,
  );
}

export function useSodiumPortal() {
  return useContext(SodiumPortalContext)?.container;
}

/**
 * Makes the page behind inert while `active` is true. Call it from a modal overlay's popup with its
 * open state, not its mounted state: the lock lifts in the same commit that closes it, before Base UI
 * returns focus to the trigger on the page.
 */
export function useSodiumModal(active: boolean) {
  const scope = useContext(SodiumPortalContext);
  const lock = scope?.lock;
  const ready = !!scope?.container;
  useLayoutEffect(() => {
    if (!active || !lock || !ready) return;
    return lock();
  }, [active, lock, ready]);
}

const TABBABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable="true"]';

/** The visible tabbable elements inside a popup, in DOM order, without Base UI's focus guards. */
function tabbablesIn(popup: HTMLElement) {
  return Array.from(popup.querySelectorAll<HTMLElement>(TABBABLE)).filter(el => {
    if (el.matches(':disabled, [data-base-ui-focus-guard], [aria-hidden="true"]') || el.tabIndex < 0) return false;
    if (el.closest('[inert]') || el.closest('[hidden]')) return false;
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
}

/**
 * Tab from the last control goes to the first, and Shift+Tab from the first goes to the last. Base UI's
 * focus guards sit at both ends of a popup and the browser stops on them (and on body) before focus
 * returns; handling the key here skips both stops. Call it from the popup's keydown. Keys that bubble
 * through the React tree from a nested overlay are ignored, since that overlay cycles itself.
 */
export function cycleTab(event: {key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; defaultPrevented: boolean; currentTarget: HTMLElement; target: EventTarget; preventDefault: () => void}) {
  if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const popup = event.currentTarget;
  const target = event.target as HTMLElement;
  if (!popup.contains(target)) return;
  const stops = tabbablesIn(popup);
  if (!stops.length) { event.preventDefault(); popup.focus(); return; }
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (event.shiftKey && (target === first || target === popup)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && target === last) { event.preventDefault(); first.focus(); }
}

/** True when the primary pointer is coarse: a finger, where focusing a text field raises the keyboard. */
export function coarsePointer() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
