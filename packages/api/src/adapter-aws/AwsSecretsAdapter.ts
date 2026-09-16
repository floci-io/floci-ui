import {
    CreateSecretCommand,
    DeleteSecretCommand,
    DescribeSecretCommand,
    ListSecretsCommand,
    type SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import {secretsManager as defaultSecretsManager} from '../aws'
import {ValidationError} from '../cloud-spi/errors'
import {awsSecretsSchema} from '../cloud-spi/secretsSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * Secrets Manager as a Cloud Explorer service, so the console can count secrets
 * instead of falling back to a dash.
 *
 * Deliberately metadata-only: this file imports ListSecrets and DescribeSecret
 * and NOT GetSecretValue, so no code path here can return a secret value. That
 * is a structural guarantee rather than a convention — adding value disclosure
 * would require adding an import.
 *
 * Create accepts an optional write-only value. It is sent to the runtime once,
 * but is never read back or placed on a resource.
 */
export class AwsSecretsAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'secrets' as const

    constructor(private readonly client: SecretsManagerClient = defaultSecretsManager) {}

    schema(): ServiceSchema {
        return awsSecretsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const resources: CloudResource[] = []
        let nextToken: string | undefined

        // Paginated: a single ListSecrets page caps at 100, and an unpaginated
        // count silently under-reports past that.
        do {
            const res = await this.client.send(new ListSecretsCommand({NextToken: nextToken}))
            for (const secret of res.SecretList ?? []) {
                resources.push(toResource(secret))
            }
            nextToken = res.NextToken
        } while (nextToken)

        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            const res = await this.client.send(new DescribeSecretCommand({SecretId: id}))
            return toResource(res)
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = stringValue(input.values.secretName ?? input.values.name)
        const description = stringValue(input.values.description)
        const secretValue = optionalSecretValue(input.values.secretValue)

        if (!name) throw new ValidationError('secretName is required')

        const res = await this.client.send(new CreateSecretCommand({
            Name: name,
            ...(description ? {Description: description} : {}),
            ...(secretValue !== undefined ? {SecretString: secretValue} : {}),
        }))

        return toResource({Name: res.Name ?? name, ARN: res.ARN})
    }

    async delete(id: string): Promise<void> {
        // A generic delete action cannot ask for a recovery window. Immediate
        // deletion avoids leaving a resource visibly present after deletion.
        await this.client.send(new DeleteSecretCommand({SecretId: id, ForceDeleteWithoutRecovery: true}))
    }
}

interface SecretMetadata {
    Name?: string
    ARN?: string
    CreatedDate?: Date
    LastChangedDate?: Date
    DeletedDate?: Date
    Description?: string
    RotationEnabled?: boolean
    KmsKeyId?: string
    LastAccessedDate?: Date
    Tags?: {Key?: string; Value?: string}[]
}

function toResource(secret: SecretMetadata): CloudResource {
    const name = secret.Name ?? ''
    return {
        id: name,
        name,
        cloud: 'aws',
        service: 'secrets',
        type: 'secret',
        region: null,
        createdAt: secret.CreatedDate?.toISOString() ?? null,
        // A deleted secret lingers in the list during its recovery window, so the
        // status has to distinguish it rather than reading as healthy.
        status: secret.DeletedDate ? 'deleted' : 'active',
        metadata: {
            arn: secret.ARN,
            description: secret.Description,
            rotationEnabled: secret.RotationEnabled ?? false,
            kmsKeyId: secret.KmsKeyId,
            lastChangedDate: secret.LastChangedDate?.toISOString() ?? null,
            lastAccessedDate: secret.LastAccessedDate?.toISOString() ?? null,
            tags: (secret.Tags ?? []).map((tag) => ({key: tag.Key, value: tag.Value})),
        },
    }
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function optionalSecretValue(value: unknown): string | undefined {
    // Whitespace is valid secret content. Treat only an empty input as absent.
    return typeof value === 'string' && value.length > 0 ? value : undefined
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const e = error as {name?: string; $metadata?: {httpStatusCode?: number}}
    return e.name === 'ResourceNotFoundException' || e.$metadata?.httpStatusCode === 404
}
