import {useEffect, useRef, useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {Check, ChevronDown, UserRound} from 'lucide-react'
import {
    DEFAULT_ACCOUNT_ID,
    isAccountId,
    setAccountId,
    useAccountId,
    useAccountRecents,
} from '@/lib/accountStore'

function formatAccount(id: string): string {
    // 000000000000 -> 0000-0000-0000, matching how AWS groups account ids.
    return id.replace(/(\d{4})(\d{4})(\d{4})/, '$1-$2-$3')
}

export function AccountSwitcher() {
    const accountId = useAccountId()
    const recents = useAccountRecents()
    const queryClient = useQueryClient()
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

    function applyAccount(id: string) {
        if (!setAccountId(id)) {
            setError('Account id must be exactly 12 digits.')
            return
        }
        setDraft('')
        setError(null)
        setOpen(false)
        // Resources are account-scoped, so anything cached under the previous
        // account must not leak into the new view.
        void queryClient.invalidateQueries()
    }

    function submitDraft() {
        const trimmed = draft.trim()
        if (!isAccountId(trimmed)) {
            setError('Account id must be exactly 12 digits.')
            return
        }
        applyAccount(trimmed)
    }

    return (
        <div className="account-switcher" ref={containerRef}>
            <button
                type="button"
                className="account-trigger"
                onClick={() => setOpen((v) => !v)}
                title="Switch AWS account"
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <UserRound size={14}/>
                <span className="account-meta">
                    <span className="account-label">Account</span>
                    <span className="account-value">{formatAccount(accountId)}</span>
                </span>
                <ChevronDown size={14}/>
            </button>

            {open && (
                <div className="account-popover" role="listbox">
                    <div className="account-popover-title">Switch account</div>
                    <div className="account-recents">
                        {recents.map((id) => (
                            <button
                                key={id}
                                type="button"
                                className={`account-option${id === accountId ? ' active' : ''}`}
                                role="option"
                                aria-selected={id === accountId}
                                onClick={() => applyAccount(id)}
                            >
                                <span className="account-option-id">{formatAccount(id)}</span>
                                {id === DEFAULT_ACCOUNT_ID && <span className="account-tag">default</span>}
                                {id === accountId && <Check size={13}/>}
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
                            inputMode="numeric"
                            maxLength={12}
                            placeholder="12-digit account id"
                            aria-label="New account id"
                            onChange={(event) => {
                                setDraft(event.target.value.replace(/\D/g, ''))
                                setError(null)
                            }}
                        />
                        <button type="submit" disabled={!isAccountId(draft.trim())}>
                            Switch
                        </button>
                    </form>
                    {error && <div className="account-error">{error}</div>}
                </div>
            )}
        </div>
    )
}
