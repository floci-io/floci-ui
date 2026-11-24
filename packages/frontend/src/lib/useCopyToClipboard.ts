import {useCallback, useEffect, useRef, useState} from "react";

/**
 * Copying a value to the clipboard, with the feedback the caller shows.
 *
 * <p>The clipboard is refused in some contexts and denied by some browsers, so a
 * copy that did not happen is said rather than left to look like a button that
 * does nothing.
 *
 * <p>A write that resolves after a later one is stale and is dropped, and the
 * reset timer is cleared when the caller goes away, so the state is never set
 * on a component that is no longer there.
 *
 * <p>A caller whose subject changes under the button resets it, so a copy that
 * was made of one resource is not claimed for the next.
 */
export function useCopyToClipboard(resetAfterMs = 1500) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const requestRef = useRef(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      // A write that resolves after the caller is gone is stale, and the
      // request counter is what says so.
      requestRef.current += 1;
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const reset = useCallback(() => {
    // A write that is still in flight is stale, and the timer that would clear
    // the state is gone with it.
    requestRef.current += 1;
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setCopied(false);
    setCopyFailed(false);
  }, []);

  const copy = async (text: string) => {
    const request = ++requestRef.current;
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setCopied(false);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(text);
      if (request !== requestRef.current) return;
      setCopied(true);
      resetTimerRef.current = setTimeout(() => {
        if (request === requestRef.current) setCopied(false);
        resetTimerRef.current = null;
      }, resetAfterMs);
    } catch {
      if (request !== requestRef.current) return;
      setCopyFailed(true);
    }
  };

  return {copied, copyFailed, copy, reset};
}
