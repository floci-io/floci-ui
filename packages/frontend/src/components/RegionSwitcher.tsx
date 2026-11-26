import {useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {Check, ChevronDown, Globe} from 'lucide-react'
import {useCloudStatusQuery} from '@/api/queries/cloudQueries'
import {AWS_REGIONS, setRegion, useRegion, useRegionRecents} from '@/lib/regionStore'

const REGION_NAMES = new Map(AWS_REGIONS.map((region) => [region.id, region.name]))
const DEFAULT_KEY = 'default'

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
    const [activeKey, setActiveKey] = useState<string>(DEFAULT_KEY)
    const containerRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const listboxRef = useRef<HTMLDivElement>(null)
    const typeahead = useRef({text: '', at: 0})

    // Each region is offered once: the recent ones on top, the rest below them.
    const others = AWS_REGIONS.filter((region) => !recents.includes(region.id))

    useEffect(() => {
        if (!open) return
        const onClick = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            const hadFocus = containerRef.current?.contains(document.activeElement) ?? false
            setOpen(false)
            if (hadFocus) triggerRef.current?.focus()
        }
        document.addEventListener('mousedown', onClick)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    // Opening puts focus on the selected region, the one Tab stop in the list.
    useEffect(() => {
        if (open) listboxRef.current?.querySelector<HTMLElement>('[role="option"][tabindex="0"]')?.focus()
    }, [open])

    function optionElements(): HTMLElement[] {
        return Array.from(listboxRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    }

    function focusOption(key: string) {
        const element = optionElements().find((option) => option.dataset.key === key)
        if (!element) return
        setActiveKey(key)
        element.focus()
    }

    function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
        const options = optionElements()
        if (options.length === 0) return
        const index = Math.max(0, options.findIndex((option) => option.dataset.key === activeKey))
        let next: number | null = null
        if (event.key === 'ArrowDown') next = Math.min(index + 1, options.length - 1)
        else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0)
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = options.length - 1
        else if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
            // Typing jumps to the next region whose code or name starts with what was typed.
            const now = Date.now()
            const text = (now - typeahead.current.at < 700 ? typeahead.current.text : '') + event.key.toLowerCase()
            typeahead.current = {text, at: now}
            const ordered = [...options.slice(index + (text.length === 1 ? 1 : 0)), ...options.slice(0, index)]
            const match = ordered.find((option) => {
                const key = option.dataset.key ?? ''
                const name = REGION_NAMES.get(key)?.toLowerCase() ?? ''
                return key.startsWith(text) || name.startsWith(text)
            })
            if (match) next = options.indexOf(match)
        }
        if (next === null) return
        event.preventDefault()
        focusOption(options[next].dataset.key ?? DEFAULT_KEY)
    }

    function applyRegion(region: string | null) {
        if (!setRegion(region)) return
        setOpen(false)
        triggerRef.current?.focus()
        // As on an account switch: queries keyed by region refetch under their new
        // key, and the few that carry neither account nor region are refreshed.
        void queryClient.invalidateQueries()
    }

    function option(region: string) {
        const name = REGION_NAMES.get(region)
        return (
            <button
                key={region}
                data-key={region}
                type="button"
                className={`account-option${region === selected ? ' active' : ''}`}
                role="option"
                aria-selected={region === selected}
                tabIndex={region === activeKey ? 0 : -1}
                title={name}
                onFocus={() => setActiveKey(region)}
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
                ref={triggerRef}
                type="button"
                className="account-trigger"
                onClick={() => {
                    setActiveKey(selected ?? DEFAULT_KEY)
                    setOpen((v) => !v)
                }}
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
                <div className="account-popover region-popover">
                    <div className="account-popover-title">Switch region</div>
                    <div
                        className="account-recents"
                        role="listbox"
                        aria-label="Regions"
                        ref={listboxRef}
                        onKeyDown={onListKeyDown}
                    >
                        <button
                            data-key={DEFAULT_KEY}
                            type="button"
                            className={`account-option${selected === null ? ' active' : ''}`}
                            role="option"
                            aria-selected={selected === null}
                            tabIndex={activeKey === DEFAULT_KEY ? 0 : -1}
                            onFocus={() => setActiveKey(DEFAULT_KEY)}
                            onClick={() => applyRegion(null)}
                        >
                            <span className="account-option-id region-option-id">Console default</span>
                            {defaultRegion && <span className="region-option-name">{defaultRegion}</span>}
                            {selected === null && <Check size={13}/>}
                        </button>
                        {recents.length > 0 && (
                            <div role="group" aria-label="Recent regions">
                                <div className="account-popover-title" aria-hidden="true">Recent</div>
                                {recents.map(option)}
                            </div>
                        )}
                        <div role="group" aria-label={recents.length > 0 ? 'Other regions' : 'All regions'}>
                            <div className="account-popover-title" aria-hidden="true">
                                {recents.length > 0 ? 'Other regions' : 'All regions'}
                            </div>
                            {others.map((region) => option(region.id))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
