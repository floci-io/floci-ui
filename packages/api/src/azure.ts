import {RuntimeUnavailableError, httpStatusToCloudError} from './cloud-spi/errors'

export interface AzureRuntimeFetchOptions {
    emptyOnNotFound?: boolean
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
        readonly accountName: string = azureAccountName(),
    ) {}

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
        if (!res.ok) {
            const detail = await safeResponseText(res)
            // A 501 here is the runtime declaring the operation missing (e.g. floci-az
            // has no /functions), which must surface as such rather than a bare 502.
            throw httpStatusToCloudError(
                res.status,
                `Azure runtime request failed: HTTP ${res.status} ${path}${detail ? ` - ${detail}` : ''}`,
            )
        }

        return res
    }
}

export function azureEndpoint(): string {
    return process.env.FLOCI_AZURE_ENDPOINT ?? process.env.FLOCI_AZ_ENDPOINT ?? 'http://localhost:4577'
}

export function azureAccountName(): string {
    return process.env.FLOCI_AZURE_ACCOUNT_NAME ?? 'devstoreaccount1'
}

export function azureSubscriptionId(): string {
    return process.env.FLOCI_AZURE_SUBSCRIPTION_ID ?? '00000000-0000-0000-0000-000000000000'
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
