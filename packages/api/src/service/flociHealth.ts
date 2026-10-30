import {RuntimeUnavailableError} from '../cloud-spi/errors'

export interface FlociHealthProbe {
    /** The emulator's base endpoint, named in error messages. */
    endpoint: string
    /** The health path on that endpoint. */
    path: string
    /** How the emulator is named in error messages, e.g. `Floci-AZ`. */
    label: string
    /** Count a 4xx as unavailable, for a runtime whose 404 means "this is not it". */
    rejectClientErrors: boolean
}

/**
 * Probe an emulator's health endpoint; resolve when the emulator answered.
 *
 * A 503 carrying a health report (`{"status": "DOWN", ...}`) is the emulator
 * saying one of its services has a problem, not that the emulator is absent: its
 * other services still work. Console Contract v2 counts that as reachable. A 5xx
 * without one, a refused connection, and (when asked) a 4xx are unavailable.
 */
export async function probeFlociHealth(probe: FlociHealthProbe): Promise<void> {
    const {endpoint, path, label, rejectClientErrors} = probe
    let res: Response
    try {
        res = await globalThis.fetch(`${endpoint}${path}`, {method: 'GET'})
    } catch (error) {
        throw new RuntimeUnavailableError(`Cannot reach ${label} at ${endpoint}: ${errorMessage(error)}`, {cause: error})
    }
    if (res.ok) return
    if (res.status === 503 && await isHealthReport(res)) return
    if (res.status >= 500 || rejectClientErrors) {
        throw new RuntimeUnavailableError(`${label} at ${endpoint} returned HTTP ${res.status}`)
    }
}

async function isHealthReport(res: Response): Promise<boolean> {
    try {
        const body: unknown = JSON.parse(await res.text())
        return typeof body === 'object' && body !== null && typeof (body as {status?: unknown}).status === 'string'
    } catch {
        return false
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
