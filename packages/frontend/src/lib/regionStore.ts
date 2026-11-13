import {useSyncExternalStore} from 'react'

// Floci keeps AWS resources per region, and the region of a request is the one
// its SDK client signs for. The console mirrors the account switcher: one active
// region at a time, sent on every request via the `x-floci-region` header. A
// null region means "the console's default", the one Floci started the console
// with (`AWS_REGION`), which the API reports on the AWS status.

/** Request header the API reads to scope a request to an AWS region. */
export const REGION_HEADER = 'x-floci-region'
const REGION_KEY = 'floci.region'
const RECENTS_KEY = 'floci.region.recents'
const MAX_RECENTS = 8

// Same shape the API accepts: us-east-1, eu-central-1, us-gov-west-1, cn-north-1.
const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/

export function isRegion(value: string | null | undefined): value is string {
    return typeof value === 'string' && REGION_PATTERN.test(value)
}

function readRegion(): string | null {
    try {
        const stored = localStorage.getItem(REGION_KEY)
        if (isRegion(stored)) return stored
    } catch {
        // localStorage unavailable (private mode / SSR) — fall back to the default.
    }
    return null
}

function readRecents(): string[] {
    try {
        const raw = localStorage.getItem(RECENTS_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) return parsed.filter(isRegion).slice(0, MAX_RECENTS)
        }
    } catch {
        // ignore malformed storage
    }
    return []
}

let currentRegion = readRegion()
let recents = readRecents()
if (currentRegion !== null && !recents.includes(currentRegion)) {
    recents = [currentRegion, ...recents].slice(0, MAX_RECENTS)
}

const listeners = new Set<() => void>()

function persist(): void {
    try {
        if (currentRegion === null) localStorage.removeItem(REGION_KEY)
        else localStorage.setItem(REGION_KEY, currentRegion)
        localStorage.setItem(RECENTS_KEY, JSON.stringify(recents))
    } catch {
        // ignore persistence failures
    }
}

function emit(): void {
    for (const listener of listeners) listener()
}

/** Selected region, or null for the console's default — read synchronously by the request interceptor. */
export function getRegion(): string | null {
    return currentRegion
}

export function getRegionRecents(): string[] {
    return recents
}

/**
 * Switch the active region; null returns to the console's default. Returns false
 * for an invalid region name. Snapshot references only change when something
 * actually changed, keeping useSyncExternalStore snapshots stable.
 */
export function setRegion(region: string | null): boolean {
    if (region !== null && !isRegion(region)) return false
    const sameRegion = region === currentRegion
    const alreadyTop = region === null || recents[0] === region
    if (sameRegion && alreadyTop) return true

    currentRegion = region
    if (region !== null) recents = [region, ...recents.filter((r) => r !== region)].slice(0, MAX_RECENTS)
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

export function useRegion(): string | null {
    return useSyncExternalStore(subscribe, getRegion, getRegion)
}

export function useRegionRecents(): string[] {
    return useSyncExternalStore(subscribe, getRegionRecents, getRegionRecents)
}
