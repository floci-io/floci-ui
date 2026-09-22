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
    const [focusedIndex, setFocusedIndex] = useState(0)
    const containerRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
    const selectedCloud = clouds.find((cloud) => cloud.id === selected)

    // Runs only when `open`/`focusedIndex` change (not on every `clouds`
    // refetch), so a background query refresh while the menu is open can't
    // steal focus away from whatever option the user has navigated to.
    useEffect(() => {
        if (open) optionRefs.current[focusedIndex]?.focus()
    }, [open, focusedIndex])

    useEffect(() => {
        if (!open) return
        const onClick = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setOpen(false)
                triggerRef.current?.focus()
            }
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false)
                triggerRef.current?.focus()
            }
        }
        document.addEventListener('mousedown', onClick)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('mousedown', onClick)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [open])

    function openMenu() {
        const selectedIndex = clouds.findIndex((cloud) => cloud.id === selected)
        setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0)
        setOpen(true)
    }

    function choose(cloud: CloudProvider) {
        setOpen(false)
        triggerRef.current?.focus()
        if (cloud !== selected) onSelect(cloud)
    }

    function onListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'ArrowDown') {
            event.preventDefault()
            setFocusedIndex((index) => (index + 1) % clouds.length)
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setFocusedIndex((index) => (index - 1 + clouds.length) % clouds.length)
        } else if (event.key === 'Home') {
            event.preventDefault()
            setFocusedIndex(0)
        } else if (event.key === 'End') {
            event.preventDefault()
            setFocusedIndex(clouds.length - 1)
        }
    }

    return (
        <div className="cloud-switcher" ref={containerRef}>
            <button
                ref={triggerRef}
                type="button"
                className="account-trigger"
                onClick={() => (open ? setOpen(false) : openMenu())}
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
                    <div className="account-recents" onKeyDown={onListKeyDown}>
                        {clouds.map((cloud, index) => (
                            <button
                                key={cloud.id}
                                ref={(el) => { optionRefs.current[index] = el }}
                                type="button"
                                className={`account-option${cloud.id === selected ? ' active' : ''}`}
                                role="option"
                                tabIndex={index === focusedIndex ? 0 : -1}
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
