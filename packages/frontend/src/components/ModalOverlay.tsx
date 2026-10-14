import {HTMLAttributes, MouseEvent, ReactNode, useEffect, useId, useRef, useState} from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), audio[controls], video[controls], [tabindex]:not([tabindex="-1"])'

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
 * control that opened it.
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

    useEffect(() => {
        const overlay = overlayRef.current
        if (!overlay) return
        const heading = named ? null : overlay.querySelector('h1, h2, h3, .modal-header')
        if (heading) {
            if (!heading.id) heading.id = headingId
            overlay.setAttribute('aria-labelledby', heading.id)
        }
        if (!overlay.contains(document.activeElement)) {
            (overlay.querySelector<HTMLElement>(FIELD) ?? overlay.querySelector<HTMLElement>(FOCUSABLE) ?? overlay).focus()
        }

        function onKeyDown(event: KeyboardEvent) {
            if (!overlay || !isTopmost(overlay)) return
            if (event.key === 'Escape') {
                onCloseRef.current()
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
    }, [headingId, named, opener])

    function handleClick(event: MouseEvent<HTMLDivElement>) {
        if (event.target === event.currentTarget) onClose()
    }

    return (
        <div
            {...rest}
            ref={overlayRef}
            className={className}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onClick={handleClick}
        >
            {children}
        </div>
    )
}
