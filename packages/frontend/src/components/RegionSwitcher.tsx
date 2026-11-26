import {useEffect, useRef, useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {Check, ChevronDown, Globe} from 'lucide-react'
import {useCloudStatusQuery} from '@/api/queries/cloudQueries'
import {AWS_REGIONS, setRegion, useRegion, useRegionRecents} from '@/lib/regionStore'

const REGION_NAMES = new Map(AWS_REGIONS.map((region) => [region.id, region.name]))

/**
 * AWS region switcher, the region counterpart of the AccountSwitcher: one active
 * region, picked from the standard AWS regions with recent ones on top, and
 * "default" returning to the region Floci started the console with. Reuses the
 * account switcher's styles.
 */
export function RegionSwitcher() {
    const selected = useRegion()
    const recents = useRegionRecents()
    const queryClient = useQueryClient()
    // The API reports the region it served the status in: the selected one, or
    // the console's default when none is selected. The default is remembered once
    // seen, so returning to it doesn't show the region just left while the status
    // is asked again.
    const status = useCloudStatusQuery('aws')
    const served = status.data?.region ?? null
    const [knownDefault, setKnownDefault] = useState<string | null>(null)
    useEffect(() => {
        if (selected === null && !status.isFetching && served !== null) setKnownDefault(served)
    }, [selected, status.isFetching, served])
    const defaultRegion = knownDefault ?? (selected === null && !status.isFetching ? served : null)
    const current = selected ?? defaultRegion
    const [open, setOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const onClick = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onClick)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    function applyRegion(region: string | null) {
        if (!setRegion(region)) return
        setOpen(false)
        // As on an account switch: queries keyed by region refetch under their new
        // key, and the few that carry neither account nor region are refreshed.
        void queryClient.invalidateQueries()
    }

    function option(region: string, key: string) {
        const name = REGION_NAMES.get(region)
        return (
            <button
                key={key}
                type="button"
                className={`account-option${region === selected ? ' active' : ''}`}
                role="option"
                aria-selected={region === selected}
                title={name}
                onClick={() => applyRegion(region)}
            >
                <span className="account-option-id region-option-id">{region}</span>
                {name && <span className="region-option-name">{name}</span>}
                {region === selected && <Check size={13}/>}
            </button>
        )
    }

    return (
        <div className="account-switcher" ref={containerRef}>
            <button
                type="button"
                className="account-trigger"
                onClick={() => setOpen((v) => !v)}
                title="Switch AWS region"
                aria-label={`Switch AWS region ${current ?? ''}`.trim()}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <Globe size={14}/>
                <span className="account-meta">
                    <span className="account-label">Region</span>
                    <span className="account-value">{current ?? '…'}</span>
                </span>
                <ChevronDown size={14}/>
            </button>

            {open && (
                <div className="account-popover region-popover" role="listbox" aria-label="Regions">
                    <div className="account-popover-title">Switch region</div>
                    <div className="account-recents">
                        <button
                            type="button"
                            className={`account-option${selected === null ? ' active' : ''}`}
                            role="option"
                            aria-selected={selected === null}
                            onClick={() => applyRegion(null)}
                        >
                            <span className="account-option-id">{defaultRegion ?? 'Console default'}</span>
                            <span className="account-tag">default</span>
                            {selected === null && <Check size={13}/>}
                        </button>
                        {recents.length > 0 && (
                            <div role="group" aria-label="Recent regions">
                                <div className="account-popover-title" aria-hidden="true">Recent</div>
                                {recents.map((region) => option(region, `recent-${region}`))}
                            </div>
                        )}
                        <div role="group" aria-label="All regions">
                            <div className="account-popover-title" aria-hidden="true">All regions</div>
                            {AWS_REGIONS.map((region) => option(region.id, region.id))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
