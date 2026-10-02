import {RuntimeUnavailableError, httpStatusToCloudError} from './cloud-spi/errors'

/** Floci-OCI's health endpoint; like Floci-GCP it does not answer `/_floci/health`. */
const OCI_HEALTH_PATH = '/_floci-oci/health'

export interface OciRuntimeFetchOptions {
    emptyOnNotFound?: boolean
    /** Return a non-2xx response instead of throwing, for calls whose error body is the result. */
    allowErrorStatus?: boolean
}

/**
 * Transport seam for the Floci-OCI runtime, mirroring `GcpRuntimeClient`.
 *
 * Requests are sent unsigned: Floci-OCI never verifies the signature and scopes
 * an unsigned request to its default tenancy, which is also `tenancyId` here.
 */
export interface OciRuntimeClient {
    readonly endpoint: string
    readonly tenancyId: string
    readonly region: string
    fetch(path: string, init?: RequestInit, options?: OciRuntimeFetchOptions): Promise<Response | null>
    json<T>(path: string, init?: RequestInit, options?: OciRuntimeFetchOptions): Promise<T | null>
    /** GET every page of a list operation, following `opc-next-page`. */
    listAll<T>(path: string): Promise<T[]>
    /** The Object Storage namespace, discovered once from `GET /n/`. */
    namespace(): Promise<string>
    health(): Promise<void>
}

/** OCI's REST error body, e.g. `{"code":"BucketNotFound","message":"..."}`. */
interface OciErrorEnvelope {
    code?: string
    message?: string
}

export class OciRestRuntimeClient implements OciRuntimeClient {
    private namespacePromise: Promise<string> | null = null

    constructor(
        readonly endpoint: string = ociEndpoint(),
        readonly tenancyId: string = ociTenancyId(),
        readonly region: string = ociRegion(),
        private readonly configuredNamespace: string | undefined = ociNamespace(),
    ) {}

    async fetch(path: string, init: RequestInit = {}, options: OciRuntimeFetchOptions = {}): Promise<Response | null> {
        let res: Response
        try {
            res = await globalThis.fetch(`${this.endpoint}${path}`, init)
        } catch (error) {
            throw new RuntimeUnavailableError(
                `Cannot reach Floci-OCI at ${this.endpoint}: ${errorMessage(error)}`,
                {cause: error},
            )
        }

        if (options.emptyOnNotFound && res.status === 404) return null
        if (!res.ok && !options.allowErrorStatus) {
            const detail = await readErrorDetail(res)
            throw httpStatusToCloudError(
                res.status,
                `OCI runtime request failed: HTTP ${res.status} ${path}${detail ? ` - ${detail}` : ''}`,
            )
        }

        return res
    }

    async json<T>(path: string, init: RequestInit = {}, options: OciRuntimeFetchOptions = {}): Promise<T | null> {
        const res = await this.fetch(path, init, options)
        if (!res) return null
        return res.json() as Promise<T>
    }

    async listAll<T>(path: string): Promise<T[]> {
        const items: T[] = []
        // Stops on a token seen before, so a runtime that repeats one cannot loop forever.
        const seen = new Set<string>()
        let page: string | null = null
        do {
            const res = await this.fetch(page ? withQuery(path, 'page', page) : path)
            if (!res) break
            items.push(...((await res.json()) as T[]))
            if (page) seen.add(page)
            page = res.headers.get('opc-next-page')
        } while (page && !seen.has(page))
        return items
    }

    namespace(): Promise<string> {
        if (this.configuredNamespace) return Promise.resolve(this.configuredNamespace)
        this.namespacePromise ??= this.json<string>('/n/').then((value) => {
            if (!value) throw new RuntimeUnavailableError(`Floci-OCI at ${this.endpoint} returned no namespace`)
            return value
        })
        // A failed lookup (runtime not up yet) must not be cached forever.
        this.namespacePromise.catch(() => {
            this.namespacePromise = null
        })
        return this.namespacePromise
    }

    async health(): Promise<void> {
        const url = `${this.endpoint}${OCI_HEALTH_PATH}`
        let res: Response
        try {
            res = await globalThis.fetch(url, {method: 'GET'})
        } catch (error) {
            throw new RuntimeUnavailableError(
                `Cannot reach Floci-OCI at ${this.endpoint}: ${errorMessage(error)}`,
                {cause: error},
            )
        }
        // Any non-2xx counts: a 404 here means the endpoint is not Floci-OCI.
        if (!res.ok) {
            throw new RuntimeUnavailableError(`Floci-OCI at ${this.endpoint} returned HTTP ${res.status}`)
        }
    }
}

export function ociEndpoint(): string {
    return process.env.FLOCI_OCI_ENDPOINT ?? 'http://localhost:4599'
}

/** Floci-OCI's built-in default tenancy, which is also the root compartment. */
export function ociTenancyId(): string {
    return process.env.FLOCI_OCI_TENANCY_ID
        ?? 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
}

export function ociRegion(): string {
    return process.env.FLOCI_OCI_REGION ?? 'us-ashburn-1'
}

/** Unset by default: the namespace is discovered from the runtime. */
export function ociNamespace(): string | undefined {
    return process.env.FLOCI_OCI_NAMESPACE || undefined
}

export const oci = new OciRestRuntimeClient()

function withQuery(path: string, key: string, value: string): string {
    return `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** Prefer OCI's structured `code: message` over the raw body. */
async function readErrorDetail(res: Response): Promise<string> {
    const text = await safeResponseText(res)
    if (!text) return ''
    try {
        const parsed = JSON.parse(text) as OciErrorEnvelope
        if (!parsed.message) return text
        return parsed.code ? `${parsed.code}: ${parsed.message}` : parsed.message
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
