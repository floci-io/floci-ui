import {useEffect} from 'react'
import {createPortal} from 'react-dom'

interface ExpandablePanelProps {
    expanded: boolean
    onCollapse: () => void
    children: React.ReactNode
}

/**
 * Shared inline-or-full-page-modal shell for a panel that's too cramped in
 * its normal spot (the resource inspector's narrow column) to be useful for
 * real work. Renders `children` in place when collapsed, or portals the same
 * children into a full-page overlay when expanded — one mounted instance
 * either way, so in-progress state (query text, scroll position, loaded
 * pages) survives the toggle.
 *
 * Escape and clicking the overlay both collapse. Extracted from
 * LogsQueryPanel and LogsExplorerPanel, which had drifted into two copies of
 * the identical expand/collapse/Escape mechanics.
 */
export function ExpandablePanel({expanded, onCollapse, children}: ExpandablePanelProps) {
    useEffect(() => {
        if (!expanded) return
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') onCollapse()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [expanded, onCollapse])

    if (!expanded) return <>{children}</>

    return createPortal(
        <div className="modal-overlay" onClick={onCollapse}>
            <div className="logs-query-modal" onClick={(event) => event.stopPropagation()}>
                {children}
            </div>
        </div>,
        document.body,
    )
}
