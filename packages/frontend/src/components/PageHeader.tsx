import type {ReactNode} from 'react'
import {DitherBackdrop} from '@/components/DitherBackdrop'
import {Icon, type SodiumIcon} from '@/components/sodium/icon'

interface PageHeaderProps {
    title: string
    description?: ReactNode
    icon?: SodiumIcon
    /** Controls at the end of the row, such as the service selector. */
    children?: ReactNode
}

/** The one h1 of a page, with its line of context and an animated dither field behind the end of the row. */
export function PageHeader({title, description, icon, children}: PageHeaderProps) {
    return (
        <header className="relative overflow-hidden border-b border-line bg-panel">
            <DitherBackdrop/>
            <div className="relative flex items-center justify-between gap-4 px-6 py-4">
                <div className="flex min-w-0 items-center gap-3">
                    {icon && <Icon icon={icon} size={20} className="text-text-2"/>}
                    <div className="min-w-0">
                        <h1 className="type-title">{title}</h1>
                        {description && <p className="type-body-sm text-text-2">{description}</p>}
                    </div>
                </div>
                {children}
            </div>
        </header>
    )
}
