import {RuntimeUnavailableError, httpStatusToCloudError} from './cloud-spi/errors'
import {cloudEndpoint} from './service/endpoints'
import {manifestDefault} from './service/emulatorManifest'

export interface AzureRuntimeFetchOptions {
    emptyOnNotFound?: boolean
    /** Return a non-OK response instead of throwing, for callers whose body is the result (a function's own 4xx/5xx). */
    allowErrorStatus?: boolean
    includeStorageApiVersion?: boolean
}

export interface AzureRuntimeClient {
    readonly endpoint: string
    readonly accountName: string
    fetch(path: string, init: RequestInit, options?: AzureRuntimeFetchOptions): Promise<Response | null>
}

export class AzureRestRuntimeClient implements AzureRuntimeClient {
    constructor(
        readonly endpoint: string = azureEndpoint(),
        private readonly configuredAccountName?: string,
    ) {}

    /** Read per call, so a storage account the emulator's manifest declares after startup still applies. */
    get accountName(): string {
        return this.configuredAccountName ?? azureAccountName()
    }

    async fetch(path: string, init: RequestInit, options: AzureRuntimeFetchOptions = {}): Promise<Response | null> {
        let res: Response
        try {
            res = await globalThis.fetch(`${this.endpoint}${path}`, {
                ...init,
                headers: {
                    ...(options.includeStorageApiVersion === false ? {} : {'x-ms-version': '2021-12-02'}),
                    ...(init.headers ?? {}),
                },
            })
        } catch (error) {
            throw new RuntimeUnavailableError(
                `Cannot reach Floci-AZ at ${this.endpoint}: ${errorMessage(error)}`,
                {cause: error},
            )
        }

        if (options.emptyOnNotFound && res.status === 404) return null
        if (!res.ok && !options.allowErrorStatus) {
            const detail = await safeResponseText(res)
            // A 501 here is the runtime declaring the operation missing, which must
            // surface as such rather than a bare 502.
            throw httpStatusToCloudError(
                res.status,
                `Azure runtime request failed: HTTP ${res.status} ${path}${detail ? ` - ${detail}` : ''}`,
            )
        }

        return res
    }
}

export function azureEndpoint(): string {
    return cloudEndpoint('azure')
}

export function azureAccountName(): string {
    return process.env.FLOCI_AZURE_ACCOUNT_NAME ?? manifestDefault('azure', 'storage_account') ?? 'devstoreaccount1'
}

export function azureSubscriptionId(): string {
    return process.env.FLOCI_AZURE_SUBSCRIPTION_ID
        ?? manifestDefault('azure', 'subscription_id')
        ?? '00000000-0000-0000-0000-000000000000'
}

/** The location new resources default to: FLOCI_AZURE_LOCATION, else the emulator's, else eastus. */
export function azureLocation(): string {
    return process.env.FLOCI_AZURE_LOCATION?.trim() || manifestDefault('azure', 'location') || 'eastus'
}

/** azureLocation() when it is one of `allowed`, else eastus, so a configured location never yields an invalid default. */
export function azureLocationIn<T extends string>(allowed: readonly T[]): T {
    const location = azureLocation()
    return (allowed as readonly string[]).includes(location) ? location as T : 'eastus' as T
}

export function azureResourceGroup(): string {
    return process.env.FLOCI_AZURE_RESOURCE_GROUP ?? 'floci-local'
}

export const azure = new AzureRestRuntimeClient()

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

async function safeResponseText(res: Response): Promise<string> {
    try {
        return (await res.text()).trim().slice(0, 500)
    } catch {
        return ''
    }
}
