import {useCallback, useEffect, useRef, useState} from 'react'

type SidebarPref = 'expanded' | 'collapsed'

const STORAGE_KEY = 'floci-sidebar'
/** Same breakpoint the rest of the console reflows at. */
const NARROW_QUERY = '(max-width: 980px)'

function getStored(): SidebarPref | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        return stored === 'collapsed' || stored === 'expanded' ? stored : null
    } catch {
        // localStorage unavailable (private mode) — let the viewport decide.
        return null
    }
}

function matchesNarrow(): boolean {
    return window.matchMedia(NARROW_QUERY).matches
}

/**
 * True when focus sits inside the sidebar nav — the state that holds the rail
 * open via the `.sidebar:has(.nav:focus-within)` rule in index.css.
 */
function navHasFocus(): boolean {
    const active = document.activeElement
    return active instanceof HTMLElement && active.closest('.sidebar .nav') !== null
}

/** The shortcut must not fire while the user is typing in the topbar search. */
function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.isContentEditable) return true
    return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

/**
 * Sidebar collapse state.
 *
 * The preference stays null until the user makes an explicit choice, so the
 * viewport decides on a first visit. Once they toggle, that choice persists and
 * the breakpoint stops applying — resizing never undoes a deliberate decision.
 */
export function useSidebar() {
    const [pref, setPref] = useState<SidebarPref | null>(getStored)
    const [narrow, setNarrow] = useState(matchesNarrow)
    /** Attach to the footer toggle so the shortcut can park focus outside .nav. */
    const toggleRef = useRef<HTMLButtonElement>(null)

    const collapsed = pref !== null ? pref === 'collapsed' : narrow

    const toggle = useCallback(() => {
        const next: SidebarPref = collapsed ? 'expanded' : 'collapsed'
        setPref(next)

        // Collapsing while focus sits in the nav leaves
        // `.sidebar:has(.nav:focus-within)` matching, which holds the panel at
        // full width — so the shortcut looks like it did nothing. Park focus on
        // the toggle instead: it is outside .nav, stays visible in the rail, and
        // is one Shift+Tab from where the user was. Blurring would drop them
        // back to the start of the document.
        if (next === 'collapsed' && navHasFocus()) {
            toggleRef.current?.focus({preventScroll: true})
        }
    }, [collapsed])

    useEffect(() => {
        const query = window.matchMedia(NARROW_QUERY)
        const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches)
        query.addEventListener('change', onChange)
        return () => query.removeEventListener('change', onChange)
    }, [])

    useEffect(() => {
        document.documentElement.setAttribute('data-sidebar', collapsed ? 'collapsed' : 'expanded')
    }, [collapsed])

    useEffect(() => {
        if (pref === null) return
        try {
            localStorage.setItem(STORAGE_KEY, pref)
        } catch {
            // ignore persistence failures
        }
    }, [pref])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'b' && event.key !== 'B') return
            if (!event.metaKey && !event.ctrlKey) return
            if (event.altKey || event.shiftKey) return
            if (isTypingTarget(event.target)) return
            event.preventDefault()
            toggle()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [toggle])

    return {collapsed, toggle, toggleRef}
}
