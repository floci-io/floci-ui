import {NotFoundError, ValidationError} from '../cloud-spi/errors'
import {ociServerlessSchema} from '../cloud-spi/serverlessSchema'
import {oci, type OciRuntimeClient} from '../oci'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServerlessInvokeResult,
    ServiceSchema,
} from '../cloud-spi/types'

/** `Application` / `ApplicationSummary` from the Functions management API. */
interface OciApplication {
    id?: string
    compartmentId?: string
    displayName?: string
    lifecycleState?: string
    subnetIds?: string[]
    shape?: string
    config?: Record<string, string>
    timeCreated?: string
    timeUpdated?: string
    freeformTags?: Record<string, string>
}

/** `Function` / `FunctionSummary`; note the exact `memoryInMBs` casing. */
interface OciFunction {
    id?: string
    applicationId?: string
    compartmentId?: string
    displayName?: string
    lifecycleState?: string
    image?: string
    imageDigest?: string
    shape?: string
    memoryInMBs?: number
    timeoutInSeconds?: number
    invokeEndpoint?: string
    config?: Record<string, string>
    timeCreated?: string
    timeUpdated?: string
    freeformTags?: Record<string, string>
}

type OciFunctionsKind = 'application' | 'function'

const API = '/20181201'
const APPLICATION_OCID = /^ocid1\.fnapp\./
const FUNCTION_OCID = /^ocid1\.fnfunc\./
const SUBNET_OCID = /^ocid1\.subnet\./
/** OCI rejects a function timeout above five minutes. */
const MAX_TIMEOUT_SECONDS = 300

/**
 * OCI Functions (API 20181201), scoped to the tenancy root compartment.
 *
 * Applications and functions are both listed as resources. A function cannot
 * exist without an application, so the console has to be able to create one;
 * the OCID prefix (`fnapp` / `fnfunc`) tells get and delete which to call.
 */
export class OciFunctionsAdapter implements CloudServiceAdapter {
    readonly cloud = 'oci' as const
    readonly service = 'serverless' as const

    constructor(private readonly client: OciRuntimeClient = oci) {}

    schema(): ServiceSchema {
        return ociServerlessSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const kind = optionalKind(query.filters?.kind)
        const applications = await this.listApplications()
        const names = new Map(applications.map((app) => [app.id ?? '', app.displayName]))

        const resources: CloudResource[] = []
        if (kind !== 'function') {
            resources.push(...applications.map((app) => this.applicationResource(app)))
        }
        if (kind !== 'application') {
            // ListFunctions requires an applicationId, so functions are gathered per application.
            const perApplication = await Promise.all(
                applications
                    .filter((app) => app.id)
                    .map((app) => this.client.listAll<OciFunction>(
                        `${API}/functions?${new URLSearchParams({applicationId: app.id ?? ''})}`,
                    )),
            )
            resources.push(...perApplication.flat().map((fn) => this.functionResource(fn, names.get(fn.applicationId ?? ''))))
        }
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        if (APPLICATION_OCID.test(id)) {
            const app = await this.client.json<OciApplication>(
                `${API}/applications/${encodeURIComponent(id)}`,
                {method: 'GET'},
                {emptyOnNotFound: true},
            )
            return app ? this.applicationResource(app) : null
        }
        if (FUNCTION_OCID.test(id)) {
            const fn = await this.client.json<OciFunction>(
                `${API}/functions/${encodeURIComponent(id)}`,
                {method: 'GET'},
                {emptyOnNotFound: true},
            )
            if (!fn) return null
            const app = fn.applicationId
                ? await this.client.json<OciApplication>(
                    `${API}/applications/${encodeURIComponent(fn.applicationId)}`,
                    {method: 'GET'},
                    {emptyOnNotFound: true},
                )
                : null
            return this.functionResource(fn, app?.displayName)
        }
        return null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const resourceType = stringValue(input.values.resourceType) || 'function'
        if (resourceType === 'application') return this.createApplication(input.values)
        if (resourceType === 'function') return this.createFunction(input.values)
        throw new ValidationError(`Unsupported OCI Functions resourceType: ${resourceType}`)
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(`${API}/${collectionFor(id)}/${encodeURIComponent(id)}`, {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    /**
     * InvokeFunction. OCI serves it on the function's `invokeEndpoint`; Floci-OCI
     * serves the invoke plane on its single endpoint, and the `invokeEndpoint` it
     * reports is its own base URL as seen from inside its container, so the call
     * goes through the runtime client. The body is raw bytes in and out.
     */
    async invoke(id: string, payload: string): Promise<ServerlessInvokeResult> {
        if (!FUNCTION_OCID.test(id)) {
            throw new ValidationError('Only functions can be invoked. Select a function (ocid1.fnfunc...), not an application.')
        }
        const startedAt = performance.now()
        const res = await this.client.fetch(`${API}/functions/${encodeURIComponent(id)}/actions/invoke`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: payload || '{}',
        }, {emptyOnNotFound: true})
        if (!res) throw new NotFoundError(`Function ${id} not found`)
        const body = await res.text()
        return {
            statusCode: res.status,
            payload: body,
            executionDuration: Math.round(performance.now() - startedAt),
        }
    }

    private listApplications(): Promise<OciApplication[]> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
        return this.client.listAll<OciApplication>(`${API}/applications?${qs}`)
    }

    private async createApplication(values: Record<string, unknown>): Promise<CloudResource> {
        const displayName = requiredString(values.displayName, 'displayName')
        const subnetIds = stringList(values.subnetIds)
        if (subnetIds.length === 0) {
            throw new ValidationError('subnetIds is required: provide at least one subnet OCID for the application.')
        }
        const invalid = subnetIds.find((subnetId) => !SUBNET_OCID.test(subnetId))
        if (invalid) throw new ValidationError(`${invalid} is not a subnet OCID (ocid1.subnet...).`)
        const shape = stringValue(values.shape)

        const app = await this.client.json<OciApplication>(`${API}/applications`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                compartmentId: this.client.tenancyId,
                displayName,
                subnetIds,
                ...(shape ? {shape} : {}),
            }),
        })
        return this.applicationResource(app ?? {displayName, subnetIds})
    }

    private async createFunction(values: Record<string, unknown>): Promise<CloudResource> {
        const displayName = requiredString(values.displayName, 'displayName')
        const applicationId = requiredString(values.applicationId, 'applicationId')
        if (!APPLICATION_OCID.test(applicationId)) {
            throw new ValidationError('applicationId must be an application OCID (ocid1.fnapp...). Create an application first if none exists.')
        }
        const image = requiredString(values.image, 'image')
        const memoryInMBs = positiveInteger(values.memoryInMBs, 'memoryInMBs')
        if (memoryInMBs === null) throw new ValidationError('memoryInMBs is required')
        const timeoutInSeconds = positiveInteger(values.timeoutInSeconds, 'timeoutInSeconds')
        if (timeoutInSeconds !== null && timeoutInSeconds > MAX_TIMEOUT_SECONDS) {
            throw new ValidationError(`timeoutInSeconds must be at most ${MAX_TIMEOUT_SECONDS}.`)
        }

        const fn = await this.client.json<OciFunction>(`${API}/functions`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                applicationId,
                displayName,
                image,
                memoryInMBs,
                ...(timeoutInSeconds !== null ? {timeoutInSeconds} : {}),
            }),
        })
        return this.functionResource(fn ?? {displayName, applicationId, image, memoryInMBs})
    }

    private applicationResource(app: OciApplication): CloudResource {
        return {
            id: app.id ?? '',
            name: app.displayName ?? app.id ?? '',
            cloud: 'oci',
            service: 'serverless',
            type: 'oci-function-application',
            region: this.client.region,
            createdAt: app.timeCreated ?? null,
            status: app.lifecycleState ?? null,
            metadata: {
                provider: 'oci',
                serverlessService: 'functions',
                kind: 'application',
                ocid: app.id,
                compartmentId: app.compartmentId,
                subnetIds: app.subnetIds,
                shape: app.shape,
                config: app.config,
                freeformTags: app.freeformTags,
                lastModified: app.timeUpdated,
            },
        }
    }

    private functionResource(fn: OciFunction, applicationName?: string): CloudResource {
        return {
            id: fn.id ?? '',
            name: fn.displayName ?? fn.id ?? '',
            cloud: 'oci',
            service: 'serverless',
            type: 'oci-function',
            region: this.client.region,
            createdAt: fn.timeCreated ?? null,
            status: fn.lifecycleState ?? null,
            metadata: {
                provider: 'oci',
                serverlessService: 'functions',
                kind: 'function',
                ocid: fn.id,
                compartmentId: fn.compartmentId,
                applicationId: fn.applicationId,
                applicationName,
                image: fn.image,
                imageDigest: fn.imageDigest,
                shape: fn.shape,
                memoryInMBs: fn.memoryInMBs,
                timeoutInSeconds: fn.timeoutInSeconds,
                invokeEndpoint: fn.invokeEndpoint,
                config: fn.config,
                freeformTags: fn.freeformTags,
                lastModified: fn.timeUpdated,
            },
        }
    }
}

function collectionFor(id: string): 'applications' | 'functions' {
    if (APPLICATION_OCID.test(id)) return 'applications'
    if (FUNCTION_OCID.test(id)) return 'functions'
    throw new ValidationError(`${id} is not an OCI Functions application or function OCID.`)
}

function optionalKind(value: string | undefined): OciFunctionsKind | undefined {
    if (!value) return undefined
    if (value === 'application' || value === 'function') return value
    throw new ValidationError(`kind must be application or function, got ${value}`)
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function requiredString(value: unknown, field: string): string {
    const text = stringValue(value)
    if (!text) throw new ValidationError(`${field} is required`)
    return text
}

/** Accepts a comma or newline separated string, or an array from an API caller. */
function stringList(value: unknown): string[] {
    const parts = Array.isArray(value) ? value : stringValue(value).split(/[,\n]/)
    return parts.map(stringValue).filter(Boolean)
}

function positiveInteger(value: unknown, field: string): number | null {
    const text = typeof value === 'number' ? String(value) : stringValue(value)
    if (!text) return null
    if (!/^\d+$/.test(text) || Number(text) < 1) {
        throw new ValidationError(`${field} must be a positive whole number.`)
    }
    return Number(text)
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}
