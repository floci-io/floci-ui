import type {ReactNode} from 'react'
import {DataTable, type SodiumIcon} from '@/components/sodium/icon'
import {Empty, EmptyHeader, EmptyDescription, EmptyIcon, EmptyTitle, type EmptyReason} from '@/components/sodium/ui/empty-state'
import {cn} from '@/lib/sodium/utils'

interface EmptyStateProps {
    icon?: SodiumIcon
    title: ReactNode
    description?: ReactNode
    compact?: boolean
    reason?: EmptyReason
    className?: string
    /** The way out, such as a Retry button. */
    children?: ReactNode
}

/**
 * What a region shows when there is nothing in it: a glyph, a sentence and at most one way out, centred in the room
 * the region has. Sodium's Empty sits at the start of a region; the console's panels are wide and often empty, so
 * this one centres it.
 */
export function EmptyState({icon, title, description, compact, reason = 'empty', className, children}: EmptyStateProps) {
    return (
        <div className={cn('flex w-full flex-1 items-center justify-center px-4', compact ? 'min-h-48 py-8' : 'min-h-72 py-12', className)}>
            <Empty variant="plain" size={compact ? 'sm' : 'default'} reason={reason} className="items-center text-center">
                <EmptyIcon icon={icon ?? DataTable}/>
                <EmptyHeader className="items-center">
                    <EmptyTitle>{title}</EmptyTitle>
                    {description !== undefined && <EmptyDescription>{description}</EmptyDescription>}
                </EmptyHeader>
                {children}
            </Empty>
        </div>
    )
}
