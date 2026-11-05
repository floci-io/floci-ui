import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {ociDatabaseSchema} from '../cloud-spi/databaseSchema'
import {oci, type OciRuntimeClient} from '../oci'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * OCI Database with PostgreSQL through the Floci-OCI emulator, which mirrors the
 * `20220915` REST API:
 *
 *   GET/POST    /20220915/dbSystems
 *   GET/DELETE  /20220915/dbSystems/{dbSystemId}
 *   GET         /20220915/dbSystems/{dbSystemId}/connectionDetails
 *   GET         /20220915/workRequests/{workRequestId}
 *
 * A list answers `{items:[...]}`. Mutations answer with an `opc-work-request-id`;
 * real OCI sends no body on create, so the new OCID is resolved through the work
 * request, with the echoed body as the fallback. The admin password is only ever
 * sent on create: neither the runtime nor this adapter returns it.
 */

const API = '/20220915'

interface OciDbSystem {
    id?: string
    displayName?: string
    compartmentId?: string
    lifecycleState?: string
    lifecycleDetails?: string
    dbVersion?: string
    shape?: string
    instanceCount?: number
    instanceOcpuCount?: number
    instanceMemorySizeInGBs?: number
    adminUsername?: string
    systemType?: string
    timeCreated?: string
    networkDetails?: {subnetId?: string}
    storageDetails?: {isRegionallyDurable?: boolean; iops?: number}
    freeformTags?: Record<string, string>
}

interface OciConnectionDetails {
    caCertificate?: string
    primaryDbEndpoint?: {fqdn?: string; port?: number}
}

interface OciWorkRequest {
    status?: string
    resources?: Array<{entityType?: string; actionType?: string; identifier?: string}>
}

interface OciCollection<T> {
    items?: T[]
}

export class OciDatabaseAdapter implements CloudServiceAdapter {
    readonly cloud = 'oci' as const
    readonly service = 'database' as const

    constructor(private readonly client: OciRuntimeClient = oci) {}

    schema(): ServiceSchema {
        return ociDatabaseSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const systems = await this.listDbSystems()
        return filterBySearch(
            systems.filter((system) => system.lifecycleState !== 'DELETED').map((system) => this.toResource(system)),
            query.search,
        )
    }

    async get(id: string): Promise<CloudResource | null> {
        const system = await this.client.json<OciDbSystem>(dbSystemPath(id), {method: 'GET'}, {emptyOnNotFound: true})
        if (!system || system.lifecycleState === 'DELETED') return null
        return this.toResource(system, await this.connectionDetails(system))
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const displayName = stringValue(input.values.displayName ?? input.values.name)
        const dbVersion = stringValue(input.values.dbVersion)
        const shape = stringValue(input.values.shape)
        const subnetId = stringValue(input.values.subnetId)
        const username = stringValue(input.values.adminUsername)
        // The password is passed through as typed; trimming would change a valid secret.
        const password = typeof input.values.adminPassword === 'string' ? input.values.adminPassword : ''

        if (!displayName) throw new ValidationError('displayName is required')
        if (displayName.length > 255) throw new ValidationError('DB system name must be at most 255 characters')
        if (!dbVersion) throw new ValidationError('dbVersion is required')
        if (!shape) throw new ValidationError('shape is required')
        if (!subnetId) throw new ValidationError('subnetId is required: DB systems run in a subnet')
        if (!subnetId.startsWith('ocid1.subnet.')) {
            throw new ValidationError('subnetId must be a subnet OCID starting with ocid1.subnet.')
        }
        if (!username) throw new ValidationError('adminUsername is required')
        if (password.length < 8) throw new ValidationError('adminPassword must be at least 8 characters')
        const ocpus = wholeNumber(input.values.instanceOcpuCount, 2, 'OCPUs')
        const memory = wholeNumber(input.values.instanceMemorySizeInGBs, 32, 'Memory')

        const res = await this.client.fetch(`${API}/dbSystems`, jsonRequest('POST', {
            compartmentId: this.client.tenancyId,
            displayName,
            dbVersion,
            shape,
            instanceCount: 1,
            instanceOcpuCount: ocpus,
            instanceMemorySizeInGBs: memory,
            // Regionally durable storage needs no availability domain, which a local runtime has no use for.
            storageDetails: {isRegionallyDurable: true, systemType: 'OCI_OPTIMIZED_STORAGE'},
            networkDetails: {subnetId},
            credentials: {username, passwordDetails: {passwordType: 'PLAIN_TEXT', password}},
        }))
        const id = await this.createdIdentifier(res)
        // The system may not be served yet; the accepted create is reported as CREATING, not as a failure.
        return (await this.get(id)) ?? this.toResource({
            id, displayName, dbVersion, shape, compartmentId: this.client.tenancyId,
            instanceOcpuCount: ocpus, instanceMemorySizeInGBs: memory, lifecycleState: 'CREATING',
        })
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(dbSystemPath(id), {method: 'DELETE'}, {emptyOnNotFound: true})
    }

    async health(): Promise<void> {
        const qs = new URLSearchParams({compartmentId: this.client.tenancyId, limit: '1'})
        await this.client.fetch(`${API}/dbSystems?${qs}`)
    }

    /** ListDbSystems wraps its page in `{items:[...]}`, so `listAll` does not apply. */
    private async listDbSystems(): Promise<OciDbSystem[]> {
        const systems: OciDbSystem[] = []
        // Stops on a token seen before, so a runtime that repeats one cannot loop forever.
        const seen = new Set<string>()
        let page: string | null = null
        do {
            const qs = new URLSearchParams({compartmentId: this.client.tenancyId})
            if (page) {
                qs.set('page', page)
                seen.add(page)
            }
            const res = await this.client.fetch(`${API}/dbSystems?${qs}`)
            if (!res) break
            const body = (await res.json()) as OciCollection<OciDbSystem>
            systems.push(...(body.items ?? []))
            page = res.headers.get('opc-next-page')
        } while (page && !seen.has(page))
        return systems
    }

    /** Only a running system has an endpoint; a creating or deleting one answers an error, which is not a failed inspect. */
    private async connectionDetails(system: OciDbSystem): Promise<OciConnectionDetails | null> {
        if (!system.id || system.lifecycleState !== 'ACTIVE') return null
        return this.client.json<OciConnectionDetails>(
            `${dbSystemPath(system.id)}/connectionDetails`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
    }

    private async createdIdentifier(res: Response | null): Promise<string> {
        const workRequestId = res?.headers.get('opc-work-request-id')
        if (workRequestId) {
            const workRequest = await this.client.json<OciWorkRequest>(
                `${API}/workRequests/${encodeURIComponent(workRequestId)}`,
                {method: 'GET'},
                {emptyOnNotFound: true},
            )
            if (workRequest?.status === 'FAILED' || workRequest?.status === 'CANCELED') {
                throw new RuntimeError(`OCI did not create the DB system: work request ${workRequestId} ${workRequest.status}`)
            }
            const resource = workRequest?.resources?.find(
                (entry) => entry.entityType?.toLowerCase() === 'postgresqldbsystem' && entry.identifier,
            )
            if (resource?.identifier) return resource.identifier
        }

        const text = res ? await res.text() : ''
        const id = text ? (safeJson(text) as {id?: unknown} | null)?.id : undefined
        if (typeof id === 'string' && id) return id
        throw new RuntimeError('OCI accepted the DB system request but did not report its OCID')
    }

    private toResource(system: OciDbSystem, connection: OciConnectionDetails | null = null): CloudResource {
        return {
            id: system.id ?? '',
            name: system.displayName ?? system.id ?? '',
            cloud: 'oci',
            service: 'database',
            type: 'dbSystem',
            region: this.client.region,
            createdAt: system.timeCreated ?? null,
            status: system.lifecycleState ?? null,
            engine: system.dbVersion ? `PostgreSQL ${system.dbVersion}` : 'PostgreSQL',
            version: system.dbVersion ?? null,
            instanceClass: system.shape ?? null,
            metadata: {
                provider: 'oci',
                ocid: system.id,
                compartmentId: system.compartmentId,
                lifecycleDetails: system.lifecycleDetails,
                shape: system.shape,
                ocpus: system.instanceOcpuCount,
                memoryInGBs: system.instanceMemorySizeInGBs,
                instanceCount: system.instanceCount,
                systemType: system.systemType,
                adminUsername: system.adminUsername,
                subnetId: system.networkDetails?.subnetId,
                regionallyDurable: system.storageDetails?.isRegionallyDurable,
                host: connection?.primaryDbEndpoint?.fqdn,
                port: connection?.primaryDbEndpoint?.port,
                caCertificate: connection?.caCertificate,
                freeformTags: system.freeformTags,
            },
        }
    }
}

function dbSystemPath(id: string): string {
    return `${API}/dbSystems/${encodeURIComponent(id)}`
}

function jsonRequest(method: string, body: unknown): RequestInit {
    return {method, headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function wholeNumber(value: unknown, fallback: number, label: string): number {
    if (value === undefined || value === null || value === '') return fallback
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) throw new ValidationError(`${label} must be a whole number of at least 1`)
    return parsed
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}
