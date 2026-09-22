import {useEffect, useRef, useState} from 'react'
import {Check, ChevronDown, Cloud} from 'lucide-react'
import type {CloudDescriptor, CloudProvider} from '@/types/cloud'

interface CloudSwitcherProps {
    clouds: CloudDescriptor[]
    selected: CloudProvider
    onSelect: (cloud: CloudProvider) => void
}

/** Header dropdown for cloud provider, styled after AccountSwitcher's popover. */
export function CloudSwitcher({clouds, selected, onSelect}: CloudSwitcherProps) {
    const [open, setOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const selectedCloud = clouds.find((cloud) => cloud.id === selected)

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

    function choose(cloud: CloudProvider) {
        setOpen(false)
        if (cloud !== selected) onSelect(cloud)
    }

    return (
        <div className="cloud-switcher" ref={containerRef}>
            <button
                type="button"
                className="account-trigger"
                onClick={() => setOpen((v) => !v)}
                title="Switch cloud"
                aria-label={`Switch cloud, currently ${selectedCloud?.displayName ?? selected.toUpperCase()}`}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <Cloud size={14}/>
                <span className="account-meta">
                    <span className="account-label">Cloud</span>
                    <span className="account-value">{selectedCloud?.displayName ?? selected.toUpperCase()}</span>
                </span>
                <ChevronDown size={14}/>
            </button>

            {open && (
                <div className="account-popover" role="listbox">
                    <div className="account-popover-title">Switch cloud</div>
                    <div className="account-recents">
                        {clouds.map((cloud) => (
                            <button
                                key={cloud.id}
                                type="button"
                                className={`account-option${cloud.id === selected ? ' active' : ''}`}
                                role="option"
                                aria-selected={cloud.id === selected}
                                onClick={() => choose(cloud.id)}
                            >
                                <span className="account-option-id">{cloud.displayName}</span>
                                {cloud.availability === 'coming_soon' && <span className="badge neutral">Soon</span>}
                                {cloud.id === selected && <Check size={13}/>}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
