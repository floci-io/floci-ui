'use client';

import {useSyncExternalStore, type ComponentProps} from 'react';
import {cn} from '@/lib/sodium/utils';

// Sodium's key cap: one key, in mono capitals at the micro role (11px) inside a square 1px rule box, 20px tall and at
// least as wide. It reads as a printed key on a row, not a control, so its edge is the faint --line, not the control
// edge: a key is never pressed on screen. A combination is a KbdGroup, keys 4px apart.
//
// keys writes a shortcut for the platform it is read on: keys="mod+k" is ⌘ K where there is a Command key and CTRL K
// elsewhere, with the spoken name (Command K, Control K) for a screen reader. The server cannot know the platform, so
// a key whose two forms differ renders as a blank cap until hydration fills in the reader's own form, instead of
// painting Ctrl for a frame and swapping it for ⌘.

type Platform = 'mac' | 'other';

const subscribe = () => () => {};
const detect = (): Platform => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'mac' : 'other');
/** 'unknown' on the server and during hydration, until the client's platform is read. */
function usePlatform(): Platform | 'unknown' {
  return useSyncExternalStore<Platform | 'unknown'>(subscribe, detect, () => 'unknown');
}

/** The shown and spoken forms of each named key, the Command-key platform first. Anything else shows as typed. */
const names: Record<string, {mac: string; other: string; spoken: {mac: string; other: string}}> = {
  mod: {mac: '⌘', other: 'Ctrl', spoken: {mac: 'Command', other: 'Control'}},
  cmd: {mac: '⌘', other: 'Win', spoken: {mac: 'Command', other: 'Windows'}},
  ctrl: {mac: '⌃', other: 'Ctrl', spoken: {mac: 'Control', other: 'Control'}},
  shift: {mac: '⇧', other: 'Shift', spoken: {mac: 'Shift', other: 'Shift'}},
  alt: {mac: '⌥', other: 'Alt', spoken: {mac: 'Option', other: 'Alt'}},
  enter: {mac: '↵', other: 'Enter', spoken: {mac: 'Return', other: 'Enter'}},
  esc: {mac: 'Esc', other: 'Esc', spoken: {mac: 'Escape', other: 'Escape'}},
  backspace: {mac: '⌫', other: 'Backspace', spoken: {mac: 'Delete', other: 'Backspace'}},
  tab: {mac: '⇥', other: 'Tab', spoken: {mac: 'Tab', other: 'Tab'}},
  space: {mac: 'Space', other: 'Space', spoken: {mac: 'Space', other: 'Space'}},
  up: {mac: '↑', other: '↑', spoken: {mac: 'Up arrow', other: 'Up arrow'}},
  down: {mac: '↓', other: '↓', spoken: {mac: 'Down arrow', other: 'Down arrow'}},
  left: {mac: '←', other: '←', spoken: {mac: 'Left arrow', other: 'Left arrow'}},
  right: {mac: '→', other: '→', spoken: {mac: 'Right arrow', other: 'Right arrow'}},
};

/** Splits "mod+shift+p" into its keys, each with its shown and spoken form on a platform. */
function shortcut(keys: string, platform: Platform) {
  return keys.split('+').map(k => k.trim()).filter(Boolean).map(k => {
    const known = names[k.toLowerCase()];
    const shown = known ? known[platform] : k;
    return {shown, spoken: known ? known.spoken[platform] : shown};
  });
}

/** The cap. A long name wraps inside it, which grows taller, instead of spilling out. */
const kbdClass = cn(
  'pointer-events-none inline-flex min-h-5 w-fit max-w-full min-w-5 shrink-0 items-center justify-center border border-line bg-page px-1 text-center',
  'type-micro text-text-2 select-none [overflow-wrap:anywhere] [&_svg]:size-(--icon) [&_svg]:shrink-0',
);

type KbdProps = ComponentProps<'kbd'> & {
  /** A shortcut such as "mod+k" or "shift+enter", written for the reader's platform. Replaces children. */
  keys?: string;
};

function Kbd({className, keys, children, ...props}: KbdProps) {
  // keys="" is a shortcut with no keys: it renders nothing, not an empty cap.
  if (keys !== undefined) return <KbdShortcut keys={keys} className={className} {...props}/>;
  return <kbd data-slot="kbd" className={cn(kbdClass, className)} {...props}>{children}</kbd>;
}

function KbdShortcut({keys, className, ...props}: Omit<KbdProps, 'children'> & {keys: string}) {
  const platform = usePlatform();
  const parts = shortcut(keys, platform === 'unknown' ? 'other' : platform);
  // Until the platform is known, a key whose two forms differ is a blank cap of the minimum width.
  const neutral = platform === 'unknown' ? shortcut(keys, 'mac').map((m, i) => m.shown === parts[i].shown) : null;
  if (!parts.length) return null;
  return <kbd data-slot="kbd-group" data-platform={platform === 'unknown' ? undefined : platform} className={cn('inline-flex max-w-full flex-wrap items-center gap-1 font-[inherit]', className)} {...props}>
    {parts.map((p, i) => neutral && !neutral[i]
      ? <kbd key={i} data-slot="kbd" data-placeholder="" aria-hidden className={kbdClass}/>
      : <kbd key={i} data-slot="kbd" aria-hidden className={kbdClass}>{p.shown}</kbd>)}
    {platform !== 'unknown' && <span className="sr-only">{parts.map(p => p.spoken).join(' ')}</span>}
  </kbd>;
}

/** A combination written by hand: keys 4px apart, read as one. */
function KbdGroup({className, ...props}: ComponentProps<'kbd'>) {
  return <kbd data-slot="kbd-group" className={cn('inline-flex max-w-full flex-wrap items-center gap-1 font-[inherit]', className)} {...props}/>;
}

export {Kbd, KbdGroup, shortcut, type KbdProps};
