import type {CloudProvider} from '../cloud-spi/types'
import {cloudForEmulatorId} from './defaultCloud'

/**
 * The parts of an emulator's `/_floci/info` manifest (Console Contract v2) the
 * console reads. The manifest has more; unknown keys are ignored by design.
 */
export interface EmulatorManifest {
    cloud: CloudProvider | null
    defaults: Readonly<Record<string, string>>
}

type Env = Record<string, string | undefined>
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

const SUPPORTED_MANIFEST_VERSION = 1
const LOAD_TIMEOUT_MS = 2_000
const RETRY_DELAY_MS = 30_000
const MAX_RETRIES = 10

let current: EmulatorManifest | null = null

/**
 * A default the emulator declares for `cloud`, e.g. `subscription_id` for Azure.
 * Only a manifest for that same cloud answers: another emulator's defaults mean
 * nothing here.
 */
export function manifestDefault(cloud: CloudProvider, key: string): string | undefined {
    if (current?.cloud !== cloud) return undefined
    return current.defaults[key]
}

/** Parse a manifest body, or null when it is not one this console understands. */
export function parseEmulatorManifest(body: unknown): EmulatorManifest | null {
    if (typeof body !== 'object' || body === null) return null
    const manifest = body as {manifest_version?: unknown; cloud?: unknown; defaults?: unknown}
    if (manifest.manifest_version !== SUPPORTED_MANIFEST_VERSION) return null

    // No prototype: a manifest key like `__proto__` must stay plain data.
    const defaults: Record<string, string> = Object.create(null)
    if (typeof manifest.defaults === 'object' && manifest.defaults !== null) {
        for (const [key, value] of Object.entries(manifest.defaults)) {
            if (typeof value === 'string' && value.trim()) defaults[key] = value.trim()
        }
    }
    const cloud = typeof manifest.cloud === 'string' ? cloudForEmulatorId(manifest.cloud) : null
    return {cloud, defaults}
}

/** Fetch and parse the manifest at FLOCI_INFO_URL; null when unset, unreachable or not understood. */
export async function fetchEmulatorManifest(
    env: Env = process.env,
    fetcher: Fetcher = globalThis.fetch,
    timeoutMs: number = LOAD_TIMEOUT_MS,
): Promise<EmulatorManifest | null> {
    const url = env.FLOCI_INFO_URL?.trim()
    if (!url) return null
    try {
        const res = await fetcher(url, {method: 'GET', signal: AbortSignal.timeout(timeoutMs)})
        if (!res.ok) return null
        return parseEmulatorManifest(await res.json())
    } catch {
        // Optional by contract: a console without the manifest falls back to its own defaults.
        return null
    }
}

/**
 * Load the manifest once at startup. Never throws and never waits longer than
 * the fetch timeout; when the emulator is not answering yet it retries in the
 * background, so a later start of the emulator still fills the defaults in.
 */
export async function loadEmulatorManifest(
    env: Env = process.env,
    fetcher: Fetcher = globalThis.fetch,
    retryDelayMs: number = RETRY_DELAY_MS,
): Promise<void> {
    if (!env.FLOCI_INFO_URL?.trim()) return
    const attempt = async (retriesLeft: number): Promise<void> => {
        const manifest = await fetchEmulatorManifest(env, fetcher)
        if (manifest) {
            current = manifest
            return
        }
        if (retriesLeft > 0) {
            const timer = setTimeout(() => void attempt(retriesLeft - 1), retryDelayMs)
            timer.unref?.()
        }
    }
    await attempt(MAX_RETRIES)
}

/** Test seam: replace the loaded manifest. */
export function setEmulatorManifest(manifest: EmulatorManifest | null): void {
    current = manifest
}
