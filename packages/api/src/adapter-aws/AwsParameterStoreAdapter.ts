import {
    AddTagsToResourceCommand,
    DeleteParameterCommand,
    DescribeParametersCommand,
    type DescribeParametersCommandInput,
    ListTagsForResourceCommand,
    type ParameterMetadata,
    PutParameterCommand,
    RemoveTagsFromResourceCommand,
    type SSMClient,
} from '@aws-sdk/client-ssm'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {awsParametersSchema, PARAMETER_NAME_MAX_LENGTH, PARAMETER_TYPES} from '../cloud-spi/parametersSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

type ParameterTag = {key: string; value: string}

/** Tags plus whether the lookup itself failed, so the two stay distinguishable. */
type TagLookup = {tags: ParameterTag[]; unavailable?: true}

/**
 * SSM reports a missing parameter as `ParameterNotFound` with HTTP **400**, not
 * 404, so `get` matches on the error name. Matching the status instead would
 * rethrow and show a runtime error where the console expects an empty result.
 */
const NOT_FOUND_NAME = 'ParameterNotFound'

export class AwsParameterStoreAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'parameters' as const

    constructor(private readonly ssm: SSMClient) {}

    schema(): ServiceSchema {
        return awsParametersSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const parameters = await this.describeAll()
        const resources = await Promise.all(parameters.map((parameter) => this.toResource(parameter)))
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            const [parameter] = await this.describe({
                ParameterFilters: [{Key: 'Name', Option: 'Equals', Values: [id]}],
            })
            return parameter ? await this.toResource(parameter) : null
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    /**
     * Creates without `Overwrite`, so an existing name fails as a conflict rather
     * than silently replacing a parameter the caller did not mean to touch.
     */
    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = requiredString(input.values.name, 'name')
        if (name.length > PARAMETER_NAME_MAX_LENGTH) {
            throw new ValidationError(`name must be ${PARAMETER_NAME_MAX_LENGTH} characters or fewer`)
        }
        const value = requiredString(input.values.value, 'value')
        const type = oneOf(input.values.type, PARAMETER_TYPES, 'type')
        const description = optionalString(input.values.description, 'description')

        await this.ssm.send(
            new PutParameterCommand({
                Name: name,
                Value: value,
                Type: type,
                ...(description ? {Description: description} : {}),
            }),
        )

        // Read the metadata back rather than echoing the input, so the returned
        // resource reflects the runtime — and carries no value.
        const created = await this.get(name)
        if (!created) throw new RuntimeError(`Parameter ${name} was created but could not be read back`)
        return created
    }

    async delete(id: string): Promise<void> {
        await this.ssm.send(new DeleteParameterCommand({Name: id}))
    }

    async updateTags(id: string, tags: Record<string, string | null>): Promise<void> {
        const added = Object.entries(tags).filter((entry): entry is [string, string] => entry[1] !== null)
        const removed = Object.keys(tags).filter((key) => tags[key] === null)

        if (added.length > 0) {
            await this.ssm.send(
                new AddTagsToResourceCommand({
                    ResourceType: 'Parameter',
                    ResourceId: id,
                    Tags: added.map(([key, value]) => ({Key: key, Value: value})),
                }),
            )
        }
        if (removed.length > 0) {
            await this.ssm.send(
                new RemoveTagsFromResourceCommand({ResourceType: 'Parameter', ResourceId: id, TagKeys: removed}),
            )
        }
    }

    /**
     * The local runtime ignores MaxResults and returns everything in one response,
     * so this loop is only exercised by tests. Real SSM pages at 10.
     */
    private async describeAll(): Promise<ParameterMetadata[]> {
        const parameters: ParameterMetadata[] = []
        let token: string | undefined

        do {
            const page = await this.ssm.send(
                new DescribeParametersCommand(token ? {NextToken: token} : {}),
            )
            parameters.push(...(page.Parameters ?? []))
            token = page.NextToken
        } while (token)

        return parameters
    }

    private async describe(input: DescribeParametersCommandInput): Promise<ParameterMetadata[]> {
        const res = await this.ssm.send(new DescribeParametersCommand(input))
        return res.Parameters ?? []
    }

    private async toResource(parameter: ParameterMetadata): Promise<CloudResource> {
        const name = parameter.Name ?? ''
        return toResource(parameter, await this.getTags(name))
    }

    /**
     * Tags are enrichment, so a failure here degrades the row instead of failing
     * the request. `list` builds every row through `Promise.all`, so an unisolated
     * throttle or a delete race would reject the whole view and show nothing.
     *
     * The failure is reported as `tagsUnavailable` rather than swallowed, so an
     * empty tag list and an unreadable one stay distinguishable.
     */
    private async getTags(name: string): Promise<TagLookup> {
        try {
            const res = await this.ssm.send(
                new ListTagsForResourceCommand({ResourceType: 'Parameter', ResourceId: name}),
            )
            return {tags: (res.TagList ?? []).map((tag) => ({key: tag.Key ?? '', value: tag.Value ?? ''}))}
        } catch {
            return {tags: [], unavailable: true}
        }
    }
}

/**
 * Builds the resource **without the parameter value**, deliberately.
 *
 * `metadata` reaches the inspector, the React Query cache and telemetry, so a
 * value must never travel with the resource — the same rule both secrets
 * adapters pin. It matters more here than it looks: the local runtime returns
 * SecureString plaintext even when `WithDecryption` is false, so relying on the
 * runtime to withhold it would leak the secret. The adapter therefore never
 * issues GetParameter at all.
 */
function toResource(parameter: ParameterMetadata, tagLookup: TagLookup): CloudResource {
    const name = parameter.Name ?? ''

    return {
        id: name,
        name,
        cloud: 'aws',
        service: 'parameters',
        type: 'parameter',
        // Parameter Store is regional but DescribeParameters does not echo the
        // region, and inventing one would be fake data.
        region: null,
        createdAt: parameter.LastModifiedDate ? parameter.LastModifiedDate.toISOString() : null,
        status: null,
        metadata: {
            parameterType: parameter.Type,
            version: parameter.Version,
            description: parameter.Description,
            dataType: parameter.DataType,
            tier: parameter.Tier,
            allowedPattern: parameter.AllowedPattern,
            lastModifiedUser: parameter.LastModifiedUser,
            /** Tells the inspector the blank value is a policy, not a gap. */
            valueWithheld: true,
            tags: tagLookup.tags,
            ...(tagLookup.unavailable ? {tagsUnavailable: true} : {}),
        },
    }
}

/** Matches on the name and the description, since a name is often a long path. */
function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources

    return resources.filter((resource) => {
        const description = String(resource.metadata.description ?? '').toLowerCase()
        return resource.name.toLowerCase().includes(normalized) || description.includes(normalized)
    })
}

function isNotFound(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as {name?: string}).name === NOT_FOUND_NAME
}

function requiredString(value: unknown, field: string): string {
    const raw = optionalString(value, field)
    if (raw === undefined) throw new ValidationError(`${field} is required`)
    return raw
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
    return value
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
    const raw = optionalString(value, field)
    if (raw === undefined) return allowed[0] as T[number]
    if (!allowed.includes(raw)) throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
    return raw as T[number]
}
