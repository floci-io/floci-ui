import {HTMLAttributes, MouseEvent, ReactNode, useCallback, useEffect, useId, useRef, useState} from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), audio[controls], video[controls], [tabindex]:not([tabindex="-1"])'

/** A select, combobox or menu opened from inside the dialog: its trigger reports it, since the list renders outside. */
const SODIUM_POPUP = '[role="combobox"][aria-expanded="true"], [aria-haspopup="menu"][aria-expanded="true"], [aria-haspopup="listbox"][aria-expanded="true"]'

const FIELD = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'

/** Open overlays in mount order; only the topmost one answers the keyboard. */
const openOverlays: HTMLElement[] = []

function isTopmost(overlay: HTMLElement) {
    const top = [...openOverlays].reverse().find((candidate) => !openOverlays.some((other) => other !== candidate && candidate.contains(other)))
    return top === overlay
}

interface ModalOverlayProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick' | 'role'> {
    onClose: () => void
    children: ReactNode
}

/**
 * Backdrop for every modal: announces it as a dialog named by its first heading (or by an
 * explicit aria-label / aria-labelledby when it has none), moves focus to the first field
 * and keeps Tab inside, closes on Escape or a backdrop click, and returns focus to the
 * control that opened it. It opens and closes with the transitions.dev modal motion: the surface scales up
 * from the page, and dips back before it unmounts.
 */
export function ModalOverlay({onClose, className = 'modal-overlay', children, ...rest}: ModalOverlayProps) {
    const overlayRef = useRef<HTMLDivElement>(null)
    const headingId = useId()
    const named = Boolean(rest['aria-label'] || rest['aria-labelledby'])
    // Read during the first render: a child's autoFocus moves focus before any effect runs.
    const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null)

    const onCloseRef = useRef(onClose)
    useEffect(() => {
        onCloseRef.current = onClose
    }, [onClose])

    const [phase, setPhase] = useState<'enter' | 'open' | 'closing'>('enter')
    const closingRef = useRef(false)
    const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

    /** Escape and the backdrop dip the surface first, then hand the close to the owner. */
    const requestClose = useCallback(() => {
        if (closingRef.current) return
        const closeMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')) || 0
        if (!closeMs) {
            onCloseRef.current()
            return
        }
        closingRef.current = true
        setPhase('closing')
        closeTimer.current = setTimeout(() => onCloseRef.current(), closeMs)
    }, [])

    useEffect(() => () => clearTimeout(closeTimer.current), [])

    useEffect(() => {
        const overlay = overlayRef.current
        if (!overlay) return
        const heading = named ? null : overlay.querySelector('h1, h2, h3, .modal-header')
        if (heading) {
            if (!heading.id) heading.id = headingId
            overlay.setAttribute('aria-labelledby', heading.id)
        }
        void overlay.offsetWidth // the resting scale is painted before the open class lands
        setPhase((current) => (current === 'enter' ? 'open' : current))
        if (!overlay.contains(document.activeElement)) {
            (overlay.querySelector<HTMLElement>(FIELD) ?? overlay.querySelector<HTMLElement>(FOCUSABLE) ?? overlay).focus()
        }

        function onKeyDown(event: KeyboardEvent) {
            if (!overlay || !isTopmost(overlay)) return
            // A select or menu opened from inside the dialog owns Escape and Tab until it closes.
            if (document.querySelector(SODIUM_POPUP)) return
            if (event.key === 'Escape') {
                requestClose()
                return
            }
            if (event.key !== 'Tab') return
            const focusable = [...overlay.querySelectorAll<HTMLElement>(FOCUSABLE)]
            const first = focusable[0] ?? overlay
            const last = focusable[focusable.length - 1] ?? overlay
            const active = document.activeElement
            const outside = !overlay.contains(active)
            if (event.shiftKey && (outside || active === first || active === overlay)) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && (outside || active === last)) {
                event.preventDefault()
                first.focus()
            }
        }

        openOverlays.push(overlay)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
            openOverlays.splice(openOverlays.indexOf(overlay), 1)
            opener?.focus()
        }
    }, [headingId, named, opener, requestClose])

    function handleClick(event: MouseEvent<HTMLDivElement>) {
        if (event.target === event.currentTarget) requestClose()
    }

    return (
        <div
            {...rest}
            ref={overlayRef}
            className={`${className} t-modal${phase === 'open' ? ' is-open' : phase === 'closing' ? ' is-closing' : ''}`}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onClick={handleClick}
        >
            {children}
        </div>
    )
}
