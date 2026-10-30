import type {CloudProvider} from '../cloud-spi/types'

/**
 * Emulator ids an emulator may put in FLOCI_CLOUD, mapped to the console's cloud ids.
 * Floci-AZ calls itself `az`; the console calls the cloud `azure`.
 */
const FLOCI_CLOUD_IDS: Readonly<Record<string, CloudProvider>> = {
    aws: 'aws',
    az: 'azure',
    azure: 'azure',
    gcp: 'gcp',
    oci: 'oci',
}

let warnedUnknown = false

/**
 * The one cloud this console serves, or null for a standalone console that
 * serves all four. An emulator that starts the console as its sidecar sets
 * FLOCI_CLOUD to its own cloud; the other clouds have no emulator behind them
 * there. An unknown value is ignored rather than locking the console to a
 * cloud nobody asked for.
 */
export function resolveScopedCloud(env: Record<string, string | undefined> = process.env): CloudProvider | null {
    const value = env.FLOCI_CLOUD?.trim().toLowerCase()
    if (!value) return null
    const cloud = cloudForEmulatorId(value)
    if (!cloud && !warnedUnknown) {
        warnedUnknown = true
        console.warn(`Ignoring FLOCI_CLOUD=${value}: expected aws, az, gcp or oci. Serving every cloud.`)
    }
    return cloud ?? null
}

/** The console's cloud for an emulator id (`az` is `azure`), or null for an id no emulator uses. */
export function cloudForEmulatorId(id: string): CloudProvider | null {
    const value = id.trim().toLowerCase()
    // An own-key lookup: `constructor` must not resolve to Object's inherited constructor.
    return Object.prototype.hasOwnProperty.call(FLOCI_CLOUD_IDS, value) ? FLOCI_CLOUD_IDS[value] : null
}

/** The cloud the console opens on: the scoped cloud, else AWS. */
export function resolveDefaultCloud(env: Record<string, string | undefined> = process.env): CloudProvider {
    return resolveScopedCloud(env) ?? 'aws'
}
