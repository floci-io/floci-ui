import type {ReactElement, ReactNode} from 'react'
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/sodium/ui/tooltip'

interface HintProps {
    /** What the control does, as a short verb and object: "Refresh resources". */
    label: ReactNode
    side?: 'top' | 'right' | 'bottom' | 'left'
    shortcut?: string
    /** No tooltip while true, for a label the page already shows. */
    disabled?: boolean
    /** The control itself: a Button, a link. It receives the hover and focus handling. */
    children: ReactElement
}

/** A Sodium tooltip around one control, so an icon or a terse button says what it does. */
export function Hint({label, side, shortcut, disabled, children}: HintProps) {
    return (
        <Tooltip disabled={disabled}>
            <TooltipTrigger render={children}/>
            <TooltipContent side={side} shortcut={shortcut}>{label as string}</TooltipContent>
        </Tooltip>
    )
}
