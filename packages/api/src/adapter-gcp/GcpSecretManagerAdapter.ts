import {ValidationError} from '../cloud-spi/errors'
import {gcpSecretsSchema} from '../cloud-spi/secretsSchema'
import {gcp, type GcpRuntimeClient} from '../gcp'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * GCP Secret Manager metadata as `secrets` resources. Verified against
 * `floci/floci-gcp` 0.5.0, which mirrors the public v1 REST API:
 *
 *   GET    /v1/projects/{project}/secrets
 *   POST   /v1/projects/{project}/secrets?secretId={id}
 *   GET    /v1/projects/{project}/secrets/{id}
 *   DELETE /v1/projects/{project}/secrets/{id}
 *
 * Like the AWS adapter, this never reads a secret payload — that would require
 * `secrets/{id}/versions/latest:access`, and the value has no business on a
 * cached resource object.
 */

interface GcpSecret {
    name?: string
    createTime?: string
    labels?: Record<string, string>
    replication?: {automatic?: unknown; userManaged?: unknown}
}

interface GcpSecretList {
    secrets?: GcpSecret[]
}

export class GcpSecretManagerAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'secrets' as const

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpSecretsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const body = await this.client.json<GcpSecretList>(this.secretsPath())
        return filterBySearch((body?.secrets ?? []).map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        const secret = await this.client.json<GcpSecret>(
            `${this.secretsPath()}/${encodeURIComponent(id)}`,
            {method: 'GET'},
            {emptyOnNotFound: true},
        )
        return secret ? toResource(secret) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = stringValue(input.values.secretName ?? input.values.name)
        if (!name) throw new ValidationError('secretName is required')
        if (!isValidSecretName(name)) {
            throw new ValidationError(
                'Use a valid Secret Manager name: 1-255 letters, numbers, hyphens, or underscores.',
            )
        }

        // The id travels as a query parameter; the body carries the replication policy.
        const secret = await this.client.json<GcpSecret>(
            `${this.secretsPath()}?secretId=${encodeURIComponent(name)}`,
            {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({replication: {automatic: {}}}),
            },
        )

        return toResource(secret ?? {name: `projects/${this.client.project}/secrets/${name}`})
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(`${this.secretsPath()}/${encodeURIComponent(id)}`, {method: 'DELETE'})
    }

    private secretsPath(): string {
        return `/v1/projects/${encodeURIComponent(this.client.project)}/secrets`
    }
}

function toResource(secret: GcpSecret): CloudResource {
    const path = secret.name ?? ''
    const name = path.split('/').pop() ?? path

    return {
        id: name,
        name,
        cloud: 'gcp',
        service: 'secrets',
        type: 'secret',
        region: null,
        createdAt: secret.createTime ?? null,
        metadata: {
            provider: 'gcp',
            secretsService: 'secretmanager',
            resourcePath: path,
            replication: secret.replication?.userManaged ? 'user-managed' : 'automatic',
            labels: secret.labels,
        },
    }
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function isValidSecretName(value: string): boolean {
    return /^[A-Za-z0-9_-]{1,255}$/.test(value)
}
