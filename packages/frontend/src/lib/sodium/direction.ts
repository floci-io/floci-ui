'use client';

import {createElement, useLayoutEffect, useState, type ReactNode, type RefObject} from 'react';
import {DirectionProvider} from '@base-ui/react/direction-provider';
import {SodiumPortalProvider} from '@/lib/sodium/portal';

// Sodium's reading direction, for Base UI and for portalled popups. CSS follows the dir attribute on
// its own, but Base UI computes some things in JavaScript (which side a submenu opens on, which arrow
// key moves forward in a menu, slider and tabs), and it reads those from DirectionProvider, not from
// the DOM. Render this wherever dir is set, with the same value: on the .sodium root
// (components/docs-kit/system-routes.tsx) and on any subtree that flips, such as the docs' right-to-left edge
// specimens.
//
// Popups portal out of the subtree, so they would lose a dir set on a wrapper. Inside the root portal
// provider, SodiumDirection also opens a portal scope of its own: a container with the same dir,
// portalled into the root container (lib/portal.ts). A dialog, menu, popover or tooltip opened from a
// right-to-left subtree then lays out right to left, while it still sits outside the page.
//
// Sodium's own components read the direction from the DOM with useDomDirection, so a component under a
// plain dir="rtl" mirrors whether or not a SodiumDirection says so.

export type Direction = 'ltr' | 'rtl';

export function SodiumDirection({dir, children}: {dir: Direction; children: ReactNode}) {
  return createElement(DirectionProvider, {direction: dir}, createElement(SodiumPortalProvider, {dir, children}));
}

type DirectionTarget = RefObject<Element | null> | Element | null | undefined;

const resolve = (target: DirectionTarget) => (target && 'current' in target ? target.current : target) ?? null;

/**
 * An element's computed reading direction ('ltr' until it mounts), or the document's when there is no
 * element. Read after layout, then again only when a dir attribute changes somewhere in the document,
 * never on every render.
 */
export function useDomDirection(target: DirectionTarget): Direction {
  const [dir, setDir] = useState<Direction>('ltr');
  useLayoutEffect(() => {
    const doc = resolve(target)?.ownerDocument ?? (typeof document === 'undefined' ? null : document);
    if (!doc) return;
    const read = () => {
      const el = resolve(target) ?? doc.documentElement;
      setDir(getComputedStyle(el).direction === 'rtl' ? 'rtl' : 'ltr');
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(doc.documentElement, {attributes: true, attributeFilter: ['dir'], subtree: true});
    return () => watch.disconnect();
  }, [target]);
  return dir;
}
