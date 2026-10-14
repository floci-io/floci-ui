import type {LucideIcon} from 'lucide-react'

interface EmptyStateProps {
    icon: LucideIcon
    title: string
    description: string
    compact?: boolean
}

export function EmptyState({icon: Icon, title, description, compact}: EmptyStateProps) {
    return (
        <div className={`empty ${compact ? 'compact' : ''}`}>
            <div className="empty-icon">
                <Icon size={compact ? 18 : 24}/>
            </div>
            <h2>{title}</h2>
            <p>{description}</p>
        </div>
    )
}
