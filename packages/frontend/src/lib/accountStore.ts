import {useSyncExternalStore} from 'react'

// Floci isolates resources per AWS account, and selects the account from the
// 12-digit access key it is given (see the API's aws.ts). The console mirrors
// that: a single active account at a time, sent on every request via the
// `x-floci-account-id` header. This is a context switch, not a filter — accounts
// do not overlap in Floci.

export const DEFAULT_ACCOUNT_ID = '000000000000'
/** Request header the API reads to scope a request to an account. */
export const ACCOUNT_HEADER = 'x-floci-account-id'
const ACCOUNT_KEY = 'floci.accountId'
const RECENTS_KEY = 'floci.accountId.recents'
const MAX_RECENTS = 8

export function isAccountId(value: string | null | undefined): value is string {
    return typeof value === 'string' && /^\d{12}$/.test(value)
}

function readAccount(): string {
    try {
        const stored = localStorage.getItem(ACCOUNT_KEY)
        if (isAccountId(stored)) return stored
    } catch {
        // localStorage unavailable (private mode / SSR) — fall back to default.
    }
    return DEFAULT_ACCOUNT_ID
}

function readRecents(): string[] {
    try {
        const raw = localStorage.getItem(RECENTS_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) return parsed.filter(isAccountId).slice(0, MAX_RECENTS)
        }
    } catch {
        // ignore malformed storage
    }
    return [DEFAULT_ACCOUNT_ID]
}

let currentAccount = readAccount()
let recents = readRecents()
if (!recents.includes(currentAccount)) recents = [currentAccount, ...recents].slice(0, MAX_RECENTS)

const listeners = new Set<() => void>()

function persist(): void {
    try {
        localStorage.setItem(ACCOUNT_KEY, currentAccount)
        localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
    } catch {
        // ignore persistence failures
    }
}

function emit(): void {
    for (const listener of listeners) listener()
}

/** Current account id — read synchronously by the API request interceptor. */
export function getAccountId(): string {
    return currentAccount
}

export function getRecents(): string[] {
    return recents
}

/**
 * Switch the active account. Returns false for invalid ids (not 12 digits).
 * The reference of getRecents()/getAccountId() only changes when something
 * actually changed, keeping useSyncExternalStore snapshots stable.
 */
export function setAccountId(id: string): boolean {
    if (!isAccountId(id)) return false
    const sameAccount = id === currentAccount
    const alreadyTop = recents[0] === id
    if (sameAccount && alreadyTop) return true

    currentAccount = id
    recents = [id, ...recents.filter((r) => r !== id)].slice(0, MAX_RECENTS)
    persist()
    emit()
    return true
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function useAccountId(): string {
    return useSyncExternalStore(subscribe, getAccountId, getAccountId)
}

export function useAccountRecents(): string[] {
    return useSyncExternalStore(subscribe, getRecents, getRecents)
}
