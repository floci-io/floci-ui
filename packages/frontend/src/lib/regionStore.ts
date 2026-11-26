import {useSyncExternalStore} from 'react'

// Floci keeps AWS resources per region, and the region of a request is the one
// its SDK client signs for. The console mirrors the account switcher: one active
// region at a time, sent on every request via the `x-floci-region` header. A
// null region means "the console's default", the one Floci started the console
// with (`AWS_REGION`), which the API reports on the AWS status.

/** Request header the API reads to scope a request to an AWS region. */
export const REGION_HEADER = 'x-floci-region'

/**
 * A region header value that pins a request to the console's default region: the
 * interceptor removes the header instead of filling in the selected region, so a
 * request confirmed on the default stays there after a switch. It never reaches the API.
 */
export const CONSOLE_DEFAULT_REGION = 'console-default'
const REGION_KEY = 'floci.region'
const RECENTS_KEY = 'floci.region.recents'
const MAX_RECENTS = 8

// Same shape the API accepts: us-east-1, eu-central-1, us-gov-west-1, cn-north-1.
const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/

/** Whether a value has the shape of a region name; the interceptor checks explicit headers with it. */
export function isRegion(value: string | null | undefined): value is string {
    return typeof value === 'string' && REGION_PATTERN.test(value)
}

export interface AwsRegion {
    id: string
    name: string
}

/**
 * The regions the switcher offers: those of the standard `aws` partition, with the names the
 * AWS console gives them, as Floci's partitions.json lists them. US regions first, as in the
 * AWS console, then the rest by name.
 */
export const AWS_REGIONS: readonly AwsRegion[] = [
    {id: 'us-east-1', name: 'US East (N. Virginia)'},
    {id: 'us-east-2', name: 'US East (Ohio)'},
    {id: 'us-west-1', name: 'US West (N. California)'},
    {id: 'us-west-2', name: 'US West (Oregon)'},
    {id: 'af-south-1', name: 'Africa (Cape Town)'},
    {id: 'ap-east-1', name: 'Asia Pacific (Hong Kong)'},
    {id: 'ap-east-2', name: 'Asia Pacific (Taipei)'},
    {id: 'ap-northeast-1', name: 'Asia Pacific (Tokyo)'},
    {id: 'ap-northeast-2', name: 'Asia Pacific (Seoul)'},
    {id: 'ap-northeast-3', name: 'Asia Pacific (Osaka)'},
    {id: 'ap-south-1', name: 'Asia Pacific (Mumbai)'},
    {id: 'ap-south-2', name: 'Asia Pacific (Hyderabad)'},
    {id: 'ap-southeast-1', name: 'Asia Pacific (Singapore)'},
    {id: 'ap-southeast-2', name: 'Asia Pacific (Sydney)'},
    {id: 'ap-southeast-3', name: 'Asia Pacific (Jakarta)'},
    {id: 'ap-southeast-4', name: 'Asia Pacific (Melbourne)'},
    {id: 'ap-southeast-5', name: 'Asia Pacific (Malaysia)'},
    {id: 'ap-southeast-6', name: 'Asia Pacific (New Zealand)'},
    {id: 'ap-southeast-7', name: 'Asia Pacific (Thailand)'},
    {id: 'ca-central-1', name: 'Canada (Central)'},
    {id: 'ca-west-1', name: 'Canada West (Calgary)'},
    {id: 'eu-central-1', name: 'Europe (Frankfurt)'},
    {id: 'eu-central-2', name: 'Europe (Zurich)'},
    {id: 'eu-north-1', name: 'Europe (Stockholm)'},
    {id: 'eu-south-1', name: 'Europe (Milan)'},
    {id: 'eu-south-2', name: 'Europe (Spain)'},
    {id: 'eu-west-1', name: 'Europe (Ireland)'},
    {id: 'eu-west-2', name: 'Europe (London)'},
    {id: 'eu-west-3', name: 'Europe (Paris)'},
    {id: 'il-central-1', name: 'Israel (Tel Aviv)'},
    {id: 'mx-central-1', name: 'Mexico (Central)'},
    {id: 'me-central-1', name: 'Middle East (UAE)'},
    {id: 'me-south-1', name: 'Middle East (Bahrain)'},
    {id: 'me-west-1', name: 'Middle East (Saudi Arabia)'},
    {id: 'sa-east-1', name: 'South America (Sao Paulo)'},
    {id: 'sa-west-1', name: 'South America (Chile)'},
]

const KNOWN_REGIONS = new Set(AWS_REGIONS.map((region) => region.id))

/** Whether a value is one of the regions the switcher offers. */
export function isKnownRegion(value: string | null | undefined): value is string {
    return typeof value === 'string' && KNOWN_REGIONS.has(value)
}

function readRegion(): string | null {
    try {
        const stored = localStorage.getItem(REGION_KEY)
        if (isKnownRegion(stored)) return stored
    } catch {
        // localStorage unavailable (private mode / SSR): fall back to the default.
    }
    return null
}

function readRecents(): string[] {
    try {
        const raw = localStorage.getItem(RECENTS_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) return parsed.filter(isKnownRegion).slice(0, MAX_RECENTS)
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

/** Selected region, or null for the console's default. Read synchronously by the request interceptor. */
export function getRegion(): string | null {
    return currentRegion
}

export function getRegionRecents(): string[] {
    return recents
}

/**
 * Switch the active region; null returns to the console's default. Returns false
 * for a region the switcher doesn't offer. Snapshot references only change when something
 * actually changed, keeping useSyncExternalStore snapshots stable.
 */
export function setRegion(region: string | null): boolean {
    if (region !== null && !isKnownRegion(region)) return false
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
