import {RuntimeUnavailableError, httpStatusToCloudError} from './cloud-spi/errors'

/** Floci-GCP's health endpoint; deliberately not the `/_floci/health` core uses. */
const GCP_HEALTH_PATH = '/_floci-gcp/health'

export interface GcpRuntimeFetchOptions {
    emptyOnNotFound?: boolean
}

/**
 * Transport seam for the Floci-GCP runtime, mirroring `AzureRuntimeClient`.
 *
 * Both GCP adapters previously carried their own copy of this and threw away the
 * response body, so a failure surfaced as a bare "HTTP 500" with no explanation.
 */
export interface GcpRuntimeClient {
    readonly endpoint: string
    readonly project: string
    readonly location: string
    fetch(path: string, init?: RequestInit, options?: GcpRuntimeFetchOptions): Promise<Response | null>
    json<T>(path: string, init?: RequestInit, options?: GcpRuntimeFetchOptions): Promise<T | null>
    health(): Promise<void>
}

/** Google's REST error envelope. */
interface GcpErrorEnvelope {
    error?: {code?: number; message?: string; status?: string}
}

export class GcpRestRuntimeClient implements GcpRuntimeClient {
    constructor(
        readonly endpoint: string = gcpEndpoint(),
        readonly project: string = gcpProject(),
        readonly location: string = gcpLocation(),
    ) {}

    async fetch(path: string, init: RequestInit = {}, options: GcpRuntimeFetchOptions = {}): Promise<Response | null> {
        let res: Response
        try {
            res = await globalThis.fetch(`${this.endpoint}${path}`, init)
        } catch (error) {
            throw new RuntimeUnavailableError(
                `Cannot reach Floci-GCP at ${this.endpoint}: ${errorMessage(error)}`,
                {cause: error},
            )
        }

        if (options.emptyOnNotFound && res.status === 404) return null
        if (!res.ok) {
            const detail = await readErrorDetail(res)
            throw httpStatusToCloudError(
                res.status,
                `GCP runtime request failed: HTTP ${res.status} ${path}${detail ? ` - ${detail}` : ''}`,
            )
        }

        return res
    }

    async json<T>(path: string, init: RequestInit = {}, options: GcpRuntimeFetchOptions = {}): Promise<T | null> {
        const res = await this.fetch(path, init, options)
        if (!res) return null
        return res.json() as Promise<T>
    }

    /**
     * Liveness probe against the runtime's own health endpoint.
     *
     * Note the path is `/_floci-gcp/health`, not the `/_floci/health` that Floci
     * core uses — `/` and `/_floci/health` both 404 on this runtime.
     */
    async health(): Promise<void> {
        const url = `${this.endpoint}${GCP_HEALTH_PATH}`
        let res: Response
        try {
            res = await globalThis.fetch(url, {method: 'GET'})
        } catch (error) {
            throw new RuntimeUnavailableError(
                `Cannot reach Floci-GCP at ${this.endpoint}: ${errorMessage(error)}`,
                {cause: error},
            )
        }
        if (res.status >= 500) {
            throw new RuntimeUnavailableError(`Floci-GCP at ${this.endpoint} returned HTTP ${res.status}`)
        }
    }
}

export function gcpEndpoint(): string {
    return process.env.FLOCI_GCP_ENDPOINT ?? process.env.FLOCI_GP_ENDPOINT ?? 'http://localhost:4588'
}

export function gcpProject(): string {
    return process.env.FLOCI_GCP_PROJECT ?? 'floci-local'
}

export function gcpLocation(): string {
    return process.env.FLOCI_GCP_LOCATION ?? 'us-central1'
}

export const gcp = new GcpRestRuntimeClient()

export async function checkGcpRuntime(endpoint: string = gcpEndpoint()): Promise<void> {
    await new GcpRestRuntimeClient(endpoint).health()
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** Prefer Google's structured error message over the raw body. */
async function readErrorDetail(res: Response): Promise<string> {
    const text = await safeResponseText(res)
    if (!text) return ''
    try {
        const parsed = JSON.parse(text) as GcpErrorEnvelope
        return parsed.error?.message ?? text
    } catch {
        return text
    }
}

async function safeResponseText(res: Response): Promise<string> {
    try {
        return (await res.text()).trim().slice(0, 500)
    } catch {
        return ''
    }
}
