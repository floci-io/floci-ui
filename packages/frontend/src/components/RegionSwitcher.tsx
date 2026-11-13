import {useEffect, useRef, useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {Check, ChevronDown, Globe} from 'lucide-react'
import {useCloudStatusQuery} from '@/api/queries/cloudQueries'
import {isRegion, setRegion, useRegion, useRegionRecents} from '@/lib/regionStore'

/**
 * AWS region switcher, the region counterpart of the AccountSwitcher: one active
 * region, picked from recents or typed in, with "default" returning to the region
 * Floci started the console with. Reuses the account switcher's styles.
 */
export function RegionSwitcher() {
    const selected = useRegion()
    const recents = useRegionRecents()
    const queryClient = useQueryClient()
    // The API reports the region it served the status in: the selected one, or
    // the console's default when none is selected.
    const status = useCloudStatusQuery('aws')
    const served = status.data?.region ?? null
    const defaultRegion = selected === null ? served : null
    const current = selected ?? served
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState('')
    const [error, setError] = useState<string | null>(null)
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
        if (!setRegion(region)) {
            setError('Use a region name such as eu-central-1.')
            return
        }
        setDraft('')
        setError(null)
        setOpen(false)
        // Resources are region-scoped and query keys do not carry the region, so
        // drop everything cached for the previous region instead of showing it
        // until the refetch lands.
        void queryClient.resetQueries()
    }

    function submitDraft() {
        const trimmed = draft.trim()
        if (!isRegion(trimmed)) {
            setError('Use a region name such as eu-central-1.')
            return
        }
        applyRegion(trimmed)
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
                <div className="account-popover" role="listbox">
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
                        {recents.map((region) => (
                            <button
                                key={region}
                                type="button"
                                className={`account-option${region === selected ? ' active' : ''}`}
                                role="option"
                                aria-selected={region === selected}
                                onClick={() => applyRegion(region)}
                            >
                                <span className="account-option-id">{region}</span>
                                {region === selected && <Check size={13}/>}
                            </button>
                        ))}
                    </div>
                    <form
                        className="account-entry"
                        onSubmit={(event) => {
                            event.preventDefault()
                            submitDraft()
                        }}
                    >
                        <input
                            value={draft}
                            maxLength={32}
                            placeholder="e.g. eu-central-1"
                            aria-label="New region"
                            onChange={(event) => {
                                setDraft(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                                setError(null)
                            }}
                        />
                        <button type="submit" disabled={!isRegion(draft.trim())}>
                            Switch
                        </button>
                    </form>
                    {error && <div className="account-error">{error}</div>}
                </div>
            )}
        </div>
    )
}
