import {useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {Input, InputAction} from '@/components/sodium/ui/input'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/sodium/ui/select'
import {Tag} from '@/components/sodium/ui/tag'
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

function accountLabel(id: string) {
    return id === DEFAULT_ACCOUNT_ID
        ? <span className="flex items-center gap-2">{formatAccount(id)}<Tag size="sm" variant="outline">Default</Tag></span>
        : formatAccount(id)
}

export function AccountSwitcher() {
    const accountId = useAccountId()
    const recents = useAccountRecents()
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState('')
    const [error, setError] = useState<string | null>(null)
    const ids = recents.includes(accountId) ? recents : [accountId, ...recents]
    const items = ids.map((id) => ({value: id, label: accountLabel(id)}))

    function applyAccount(id: string) {
        if (!setAccountId(id)) {
            setError('Account id must be exactly 12 digits.')
            return
        }
        setDraft('')
        setError(null)
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
        <div className="flex w-56 flex-col gap-2">
            <Select
                items={items}
                value={accountId}
                onValueChange={(next) => {
                    if (next && next !== accountId) applyAccount(next)
                }}
            >
                <SelectTrigger aria-label="Account">
                    <SelectValue/>
                </SelectTrigger>
                <SelectContent>
                    {items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <form
                onSubmit={(event) => {
                    event.preventDefault()
                    submitDraft()
                }}
            >
                <Input
                    mono
                    value={draft}
                    inputMode="numeric"
                    maxLength={12}
                    placeholder="12-digit ID"
                    aria-label="New account id"
                    aria-invalid={error ? true : undefined}
                    onChange={(event) => {
                        setDraft(event.target.value.replace(/\D/g, ''))
                        setError(null)
                    }}
                    trailing={
                        <InputAction type="submit" size="text" disabled={!isAccountId(draft.trim())}>
                            Switch
                        </InputAction>
                    }
                />
            </form>
            {error && <p role="alert" className="type-body-sm text-fail-text">{error}</p>}
        </div>
    )
}
