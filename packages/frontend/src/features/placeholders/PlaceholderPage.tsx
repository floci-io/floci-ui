import {Activity, Info} from 'lucide-react'
import {EmptyState} from '@/components/EmptyState'

export function PlaceholderPage({title, description}: { title: string; description: string }) {
    return (
        <>
            <div className="page-header">
                <div className="page-title">
                    <h1>{title}</h1>
                    <span className="info-link">
            <Info size={11}/>
            Info
          </span>
                </div>
            </div>
            <EmptyState icon={Activity} title={`${title} is not available yet`} description={description}/>
        </>
    )
}
