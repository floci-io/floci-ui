import {ConflictError, NotFoundError, ValidationError} from '../cloud-spi/errors'
import {azure, type AzureRuntimeClient} from '../azure'
import {azureServerlessSchema} from '../cloud-spi/serverlessSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServerlessInvokeResult,
    ServiceSchema,
} from '../cloud-spi/types'

/** `AppResponse` from Floci-AZ's `/admin/apps`. */
interface AzureFunctionApp {
    name?: string
    runtime?: string
    linuxFxVersion?: string
    status?: string
    createdAt?: string
}

/** `FunctionResponse` from Floci-AZ's `/admin/apps/{app}/functions`. */
interface AzureFunction {
    name?: string
    appName?: string
    runtime?: string
    linuxFxVersion?: string
    handler?: string
    timeoutSeconds?: number
    invokeUrl?: string
    status?: string
    createdAt?: string
}

interface ValueList<T> {
    value?: T[]
}

type AzureFunctionsKind = 'app' | 'function'

type FunctionsTarget =
    | {kind: 'app'; app: string}
    | {kind: 'function'; app: string; fn: string}

const RUNTIMES = new Set(['node', 'python', 'dotnet', 'java'])
const APP_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,58}[A-Za-z0-9])?$/
const FUNCTION_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,126}$/
const ZIP_MAGIC = [0x50, 0x4b]
const jsonHeaders = {accept: 'application/json', 'content-type': 'application/json'}

/**
 * Azure Functions on Floci-AZ (`/{account}-functions`).
 *
 * The runtime has two levels: Function Apps (`admin/apps`) and the functions
 * deployed into them (`admin/apps/{app}/functions`). Both are listed as
 * resources, as OCI Functions does, because a function cannot exist without an
 * app. An app's id is its name; a function's id is `{app}/{function}`.
 */
export class AzureServerlessAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'serverless' as const

    constructor(private readonly client: AzureRuntimeClient = azure) { }

    schema(): ServiceSchema {
        return azureServerlessSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const kind = optionalKind(query.filters?.kind)
        const apps = (await this.azureJson<ValueList<AzureFunctionApp>>(`${this.base()}/admin/apps`, {method: 'GET'}))?.value ?? []

        const resources: CloudResource[] = []
        if (kind !== 'function') resources.push(...apps.map(toAppResource))
        if (kind !== 'app') {
            // There is no account-wide function list, so functions are gathered per app. A 404
            // here means the app was deleted since the list above, so it has no functions left.
            const perApp = await Promise.all(apps.filter((app) => app.name).map(async (app) =>
                (await this.azureJson<ValueList<AzureFunction>>(
                    `${this.appPath(app.name ?? '')}/functions`,
                    {method: 'GET'},
                    {emptyOnNotFound: true},
                ))?.value ?? []))
            resources.push(...perApp.flat().map(toFunctionResource))
        }
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const target = parseId(id)
        if (target.kind === 'app') {
            const app = await this.azureJson<AzureFunctionApp>(this.appPath(target.app), {method: 'GET'}, {emptyOnNotFound: true})
            return app ? toAppResource(app) : null
        }
        const fn = await this.getFunction(target.app, target.fn)
        return fn ? toFunctionResource(fn) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const resourceType = stringValue(input.values.resourceType) || 'function'
        if (resourceType === 'app') return this.createApp(input.values)
        if (resourceType === 'function') return this.createFunction(input.values)
        throw new ValidationError(`Unsupported Azure Functions resourceType: ${resourceType}`)
    }

    async delete(id: string): Promise<void> {
        const target = parseId(id)
        const path = target.kind === 'app' ? this.appPath(target.app) : this.functionPath(target.app, target.fn)
        await this.client.fetch(path, {method: 'DELETE'})
    }

    /**
     * Floci-AZ proxies `api/{app}/{function}` to the function's own container, so
     * the response is whatever the function (or, before that, the runtime) returned.
     * A failing status is a result to show, not an adapter error.
     */
    async invoke(id: string, payload: string): Promise<ServerlessInvokeResult> {
        const target = parseId(id)
        if (target.kind !== 'function') {
            throw new ValidationError('Only functions can be invoked. Select a function, not a Function App.')
        }
        const startedAt = performance.now()
        const res = await this.client.fetch(
            `${this.base()}/api/${encodeURIComponent(target.app)}/${encodeURIComponent(target.fn)}`,
            {method: 'POST', headers: {'content-type': 'application/json'}, body: payload?.trim() ? payload : '{}'},
            {allowErrorStatus: true, includeStorageApiVersion: false},
        )
        const body = res ? await res.text() : ''
        return {
            statusCode: res?.status ?? 204,
            payload: body,
            ...(res && !res.ok ? {functionError: `Function returned HTTP ${res.status}`} : {}),
            executionDuration: Math.round(performance.now() - startedAt),
        }
    }

    private async createApp(values: Record<string, unknown>): Promise<CloudResource> {
        const appName = requiredString(values.appName, 'appName')
        if (!APP_NAME.test(appName)) {
            throw new ValidationError('Use a valid Function App name: 1-60 letters, numbers, or hyphens; do not start or end with a hyphen.')
        }
        const runtime = requiredString(values.runtime, 'runtime')
        if (!RUNTIMES.has(runtime)) {
            throw new ValidationError(`runtime must be one of ${[...RUNTIMES].join(', ')}, got ${runtime}`)
        }
        const linuxFxVersion = stringValue(values.linuxFxVersion)

        // The runtime upserts, so an existing app would be silently replaced.
        if (await this.azureJson<AzureFunctionApp>(this.appPath(appName), {method: 'GET'}, {emptyOnNotFound: true})) {
            throw new ConflictError(`Function App ${appName} already exists`)
        }
        const app = await this.azureJson<AzureFunctionApp>(this.appPath(appName), {
            method: 'PUT',
            body: JSON.stringify({runtime, ...(linuxFxVersion ? {linuxFxVersion} : {})}),
        })
        return toAppResource(app ?? {name: appName, runtime})
    }

    private async createFunction(values: Record<string, unknown>): Promise<CloudResource> {
        const appName = requiredString(values.appName, 'appName')
        if (!APP_NAME.test(appName)) {
            throw new ValidationError('Use a valid Function App name: 1-60 letters, numbers, or hyphens; do not start or end with a hyphen.')
        }
        const functionName = requiredString(values.functionName, 'functionName')
        if (!FUNCTION_NAME.test(functionName)) {
            throw new ValidationError('Use a valid function name: up to 127 letters, numbers, hyphens, or underscores, starting with a letter or number.')
        }
        const handler = stringValue(values.handler)
        const timeoutSeconds = positiveInteger(values.timeoutSeconds, 'timeoutSeconds')
        const zipBase64 = zipPackage(values.zipBase64)

        // The runtime upserts (a redeploy), so an existing function would be silently replaced.
        if (await this.getFunction(appName, functionName)) {
            throw new ConflictError(`Function ${functionName} already exists in Function App ${appName}`)
        }
        const fn = await this.azureJson<AzureFunction>(this.functionPath(appName, functionName), {
            method: 'PUT',
            body: JSON.stringify({
                ...(handler ? {handler} : {}),
                ...(timeoutSeconds !== null ? {timeoutSeconds} : {}),
                ...(zipBase64 ? {zipBase64} : {}),
            }),
        })
        return toFunctionResource(fn ?? {name: functionName, appName})
    }

    private getFunction(app: string, fn: string): Promise<AzureFunction | null> {
        return this.azureJson<AzureFunction>(this.functionPath(app, fn), {method: 'GET'}, {emptyOnNotFound: true})
    }

    private base(): string {
        return `/${encodeURIComponent(this.client.accountName)}-functions`
    }

    private appPath(app: string): string {
        return `${this.base()}/admin/apps/${encodeURIComponent(app)}`
    }

    private functionPath(app: string, fn: string): string {
        return `${this.appPath(app)}/functions/${encodeURIComponent(fn)}`
    }

    private async azureJson<T>(
        path: string,
        init: RequestInit,
        options?: {emptyOnNotFound?: boolean},
    ): Promise<T | null> {
        const res = await this.client.fetch(path, {...init, headers: {...jsonHeaders, ...(init.headers ?? {})}}, options)
        if (!res || res.status === 204) return null
        return await res.json() as T
    }
}

function toAppResource(app: AzureFunctionApp): CloudResource {
    const name = app.name ?? ''
    return {
        id: name,
        name,
        cloud: 'azure',
        service: 'serverless',
        type: 'azure-function-app',
        region: null,
        createdAt: app.createdAt ?? null,
        status: app.status ?? null,
        metadata: {
            provider: 'azure',
            serverlessService: 'functions',
            kind: 'app',
            runtime: app.runtime,
            linuxFxVersion: app.linuxFxVersion,
        },
    }
}

function toFunctionResource(fn: AzureFunction): CloudResource {
    const name = fn.name ?? ''
    return {
        id: `${fn.appName ?? ''}/${name}`,
        name,
        cloud: 'azure',
        service: 'serverless',
        type: 'azure-function',
        region: null,
        createdAt: fn.createdAt ?? null,
        status: fn.status ?? null,
        metadata: {
            provider: 'azure',
            serverlessService: 'functions',
            kind: 'function',
            appName: fn.appName,
            runtime: fn.runtime,
            linuxFxVersion: fn.linuxFxVersion,
            handler: fn.handler,
            timeoutSeconds: fn.timeoutSeconds,
            invokeUrl: fn.invokeUrl,
        },
    }
}

/** `app` or `app/function`; names cannot contain a slash, so the split is unambiguous. */
function parseId(id: string): FunctionsTarget {
    const parts = id.split('/')
    if (parts.length === 1 && APP_NAME.test(parts[0])) return {kind: 'app', app: parts[0]}
    if (parts.length === 2 && APP_NAME.test(parts[0]) && FUNCTION_NAME.test(parts[1])) {
        return {kind: 'function', app: parts[0], fn: parts[1]}
    }
    throw new NotFoundError(`${id} is not an Azure Functions app or app/function id`)
}

function optionalKind(value: string | undefined): AzureFunctionsKind | undefined {
    if (!value) return undefined
    if (value === 'app' || value === 'function') return value
    throw new ValidationError(`kind must be app or function, got ${value}`)
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function requiredString(value: unknown, field: string): string {
    const text = stringValue(value)
    if (!text) throw new ValidationError(`${field} is required`)
    return text
}

function positiveInteger(value: unknown, field: string): number | null {
    const text = typeof value === 'number' ? String(value) : stringValue(value)
    if (!text) return null
    if (!/^\d+$/.test(text) || Number(text) < 1) {
        throw new ValidationError(`${field} must be a positive whole number.`)
    }
    return Number(text)
}

/**
 * Floci-AZ decodes `zipBase64` without catching a bad value, so a malformed
 * package would surface as a 500. Reject it here with a readable message.
 */
function zipPackage(value: unknown): string {
    const text = stringValue(value).replace(/\s+/g, '')
    if (!text) return ''
    const bytes = /^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length % 4 === 0 ? Buffer.from(text, 'base64') : null
    if (!bytes || !ZIP_MAGIC.every((byte, i) => bytes[i] === byte)) {
        throw new ValidationError('zipBase64 must be the base64 encoding of a zip archive.')
    }
    return text
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}
