import {Skeleton, SkeletonRows, SkeletonText} from '@/components/sodium/ui/skeleton'
import {cn} from '@/lib/sodium/utils'

interface RowsSkeletonProps {
    rows?: number
    label?: string
    className?: string
}

/** Placeholder rows for a list that is still loading, announced as one busy region. Still, never animated. */
export function RowsSkeleton({rows = 6, label = 'Loading', className}: RowsSkeletonProps) {
    return (
        <div role="status" aria-busy="true" aria-label={label} className={cn('w-full', className)}>
            <SkeletonRows rows={rows}/>
        </div>
    )
}

/** What a page shows while its code or its first data is on the way: a title, a line and a region of rows. */
export function PageSkeleton({rows = 8, label = 'Loading page'}: {rows?: number; label?: string}) {
    return (
        <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-2">
                <Skeleton className="h-7 w-56"/>
                <SkeletonText type="body-sm" lines={1} last={0.4}/>
            </div>
            <div className="frame">
                <SkeletonRows rows={rows}/>
            </div>
        </div>
    )
}
