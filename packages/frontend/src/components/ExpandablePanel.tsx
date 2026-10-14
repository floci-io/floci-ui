import {createPortal} from 'react-dom'
import {ModalOverlay} from './ModalOverlay'

interface ExpandablePanelProps {
    expanded: boolean
    label: string
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
 * Escape and clicking the overlay both collapse (via ModalOverlay). Extracted from
 * LogsQueryPanel and LogsExplorerPanel, which had drifted into two copies of
 * the identical expand/collapse/Escape mechanics.
 */
export function ExpandablePanel({expanded, label, onCollapse, children}: ExpandablePanelProps) {
    if (!expanded) return <>{children}</>

    return createPortal(
        <ModalOverlay onClose={onCollapse} aria-label={label}>
            <div className="logs-query-modal" onClick={(event) => event.stopPropagation()}>
                {children}
            </div>
        </ModalOverlay>,
        document.body,
    )
}
