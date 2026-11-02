'use client';

import {useEffect, useRef, useState} from 'react';
import {Icon, Checkmark, Copy, WarningAlt} from '@/components/sodium/icon';
import {cn} from '@/lib/sodium/utils';
import {Button, type ButtonProps} from '@/components/sodium/ui/button';

// Sodium's copy button: a Button that copies a value and confirms in place. Ghost and icon-only by default, so it sits
// quietly at the end of a row, a code block or a field; secondary where copying is the region's own action. Never the
// slab: copying never moves the task on.
//
// The glyph cuts from Copy to a check for 1.6s and a hidden status region says "Copied", so a screen reader hears it
// too. With a visible label the box sizes to the word it shows, so the padding is the button's own on both sides. If the
// clipboard is refused it shows the warning glyph and says how to copy by hand. A value fetched on demand (a function
// that returns a promise, such as a key read from a vault) pends in place, the pending mark in the glyph's place, and a second
// press while it fetches does nothing.
//
// WebKit drops the press's user activation across an await, so for a fetched value the button calls clipboard.write
// in the same tick as the press, with a ClipboardItem whose text is a promise; the browser holds the activation until
// it settles. Where that is missing or refused, it awaits the value and falls back to writeText.

type CopyState = 'idle' | 'fetching' | 'copied' | 'failed';

/** Writes a value that is still being fetched, keeping the press's user activation. */
async function writeFetched(result: Promise<string>): Promise<string> {
  let text = '';
  const blob = result.then(t => { text = t; return new Blob([t], {type: 'text/plain'}); });
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
    try {
      // Called before any await, so it runs inside the press.
      await navigator.clipboard.write([new ClipboardItem({'text/plain': blob})]);
      return text;
    } catch {
      // Falls through to writeText, which works wherever the activation survives the await.
    }
  }
  text = await result;
  await navigator.clipboard.writeText(text);
  return text;
}

type CopyButtonProps = Omit<ButtonProps, 'onClick' | 'onCopy' | 'children' | 'pending' | 'pendingLabel' | 'value' | 'variant'> & {
  /** The text to copy, or a function that returns it, for a value fetched on demand. */
  value: string | (() => string | Promise<string>);
  /** What is copied, for the accessible name: "run ID" gives "Copy run ID". */
  label?: string;
  /** Shows "Copy", then "Copied", as a label after the glyph. */
  showLabel?: boolean;
  /** ghost in a row or a block; secondary where copying is the region's own action. Never the slab. */
  variant?: 'ghost' | 'secondary';
  /** How long the confirmation stays, in ms. */
  timeout?: number;
  onCopy?: (value: string) => void;
  /** Shows one state without a press, for the docs. Presses still copy. */
  forceState?: Exclude<CopyState, 'idle'>;
};

function CopyButton({value, label, showLabel = false, timeout = 1600, onCopy, forceState, variant = 'ghost', size, className, ...props}: CopyButtonProps) {
  const [live, setState] = useState<CopyState>('idle');
  const [announcement, setAnnouncement] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  useEffect(() => () => { clearTimeout(timer.current); cancelAnimationFrame(frame.current); }, []);
  const state = forceState ?? live;

  // Empty the region, then fill it on the next frame, so the same message twice is announced twice.
  const announce = (message: string) => {
    cancelAnimationFrame(frame.current);
    setAnnouncement('');
    frame.current = requestAnimationFrame(() => setAnnouncement(message));
  };

  const copy = async () => {
    clearTimeout(timer.current);
    try {
      let text: string;
      const result = typeof value === 'function' ? value() : value;
      if (typeof result === 'string') {
        text = result;
        await navigator.clipboard.writeText(text);
      } else {
        const writing = writeFetched(result);
        setState('fetching');
        text = await writing;
      }
      setState('copied');
      announce(label ? `${label} copied` : 'Copied');
      onCopy?.(text);
    } catch {
      setState('failed');
      announce('Could not copy. Select the text and copy it by hand.');
    }
    timer.current = setTimeout(() => { setState('idle'); setAnnouncement(''); }, timeout);
  };

  const s = size ?? (showLabel ? 'sm' : 'icon-sm');
  const glyph = state === 'copied' ? Checkmark : state === 'failed' ? WarningAlt : Copy;

  return <>
    <Button
      data-slot="copy-button"
      data-state={state}
      variant={variant}
      size={s}
      aria-label={label ? `Copy ${label}` : 'Copy'}
      aria-busy={state === 'fetching' || undefined}
      onClick={copy}
      className={cn('data-[state=failed]:text-fail-text', className)}
      {...props}
    >
      {/* The box sizes to what it shows, with the button's own padding on both sides: no hidden states held in it, which
          left a short "Copy" floating in a slot as wide as the loading mark plus "Copied". While a value is fetched the
          pending mark takes the glyph's place. */}
      {state === 'fetching' ? <span aria-hidden className="pending shrink-0"/> : <Icon icon={glyph}/>}
      {showLabel && <span aria-hidden>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Failed' : 'Copy'}</span>}
    </Button>
    <span role="status" data-slot="copy-button-status" className="sr-only">{announcement}</span>
  </>;
}

export {CopyButton, type CopyButtonProps};
