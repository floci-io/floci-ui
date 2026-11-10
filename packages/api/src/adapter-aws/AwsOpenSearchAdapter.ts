import {
    CreateDomainCommand,
    DeleteDomainCommand,
    DescribeDomainCommand,
    type DomainStatus,
    ListDomainNamesCommand,
    type OpenSearchClient,
    type OpenSearchPartitionInstanceType,
} from '@aws-sdk/client-opensearch'
import {mapWithLimit} from '../concurrency'
import {NotFoundError, ValidationError} from '../cloud-spi/errors'
import {
    OPENSEARCH_NAME_MAX_LENGTH,
    OPENSEARCH_NAME_MESSAGE,
    OPENSEARCH_NAME_MIN_LENGTH,
    OPENSEARCH_NAME_PATTERN,
    awsOpenSearchSchema,
} from '../cloud-spi/openSearchSchema'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

const DETAIL_CONCURRENCY = 5

/**
 * OpenSearch Service domains. The id is the domain name, which AWS scopes to one
 * account and Region. A domain that is still starting reports `Created: false`,
 * so the state is derived rather than assumed to be active.
 */
export class AwsOpenSearchAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'search' as const

    constructor(private readonly opensearch: OpenSearchClient) {}

    schema(): ServiceSchema {
        return awsOpenSearchSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const {DomainNames: names = []} = await this.opensearch.send(new ListDomainNamesCommand({}))
        const domains = await mapWithLimit(names, DETAIL_CONCURRENCY, async (info) =>
            info.DomainName ? this.describe(info.DomainName) : null)
        return filterBySearch(
            domains.filter((domain): domain is DomainStatus => domain !== null).map(domainResource),
            query.search,
        )
    }

    async get(id: string): Promise<CloudResource | null> {
        if (!id) return null
        const domain = await this.describe(id)
        return domain ? domainResource(domain) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = stringValue(input.values.name)
        validateName(name)
        const engineVersion = stringValue(input.values.engineVersion)
        const instanceType = stringValue(input.values.instanceType)
        const volumeSize = volumeSizeValue(input.values.volumeSize)

        await this.opensearch.send(new CreateDomainCommand({
            DomainName: name,
            ...(engineVersion ? {EngineVersion: engineVersion} : {}),
            ...(instanceType ? {ClusterConfig: {InstanceType: instanceType as OpenSearchPartitionInstanceType}} : {}),
            ...(volumeSize ? {EBSOptions: {EBSEnabled: true, VolumeSize: volumeSize}} : {}),
        }))
        const created = await this.get(name)
        if (!created) throw new NotFoundError(`OpenSearch did not return ${name} after creating it`)
        return created
    }

    async delete(id: string): Promise<void> {
        await this.opensearch.send(new DeleteDomainCommand({DomainName: id}))
    }

    async health(): Promise<void> {
        await this.opensearch.send(new ListDomainNamesCommand({}))
    }

    private async describe(name: string): Promise<DomainStatus | null> {
        try {
            const {DomainStatus: domain} = await this.opensearch.send(new DescribeDomainCommand({DomainName: name}))
            return domain ?? null
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }
}

function domainResource(domain: DomainStatus): CloudResource {
    const name = domain.DomainName ?? ''
    const [engine, version] = splitEngineVersion(domain.EngineVersion)
    return {
        id: name,
        name,
        cloud: 'aws',
        service: 'search',
        type: 'domain',
        region: regionFromArn(domain.ARN),
        createdAt: null,
        status: domainState(domain),
        engine,
        version,
        instanceClass: domain.ClusterConfig?.InstanceType ?? null,
        metadata: {
            provider: 'aws',
            arn: domain.ARN,
            domainId: domain.DomainId,
            endpoint: domain.Endpoint ?? domain.Endpoints?.vpc ?? null,
            engineVersion: domain.EngineVersion,
            created: domain.Created,
            processing: domain.Processing,
            upgradeProcessing: domain.UpgradeProcessing,
            domainProcessingStatus: domain.DomainProcessingStatus,
            clusterConfig: domain.ClusterConfig,
            ebsOptions: domain.EBSOptions,
            accessPolicies: parseJson(domain.AccessPolicies),
            ipAddressType: domain.IPAddressType,
            encryptionAtRestOptions: domain.EncryptionAtRestOptions,
            nodeToNodeEncryptionOptions: domain.NodeToNodeEncryptionOptions,
            domainEndpointOptions: domain.DomainEndpointOptions,
            advancedSecurityEnabled: domain.AdvancedSecurityOptions?.Enabled,
            vpcOptions: domain.VPCOptions,
        },
    }
}

/**
 * DomainProcessingStatus is the precise state when the runtime reports it. Older
 * and emulated responses carry only the booleans, so fall back to them.
 */
function domainState(domain: DomainStatus): string {
    if (domain.Deleted) return 'Deleting'
    if (domain.DomainProcessingStatus) return domain.DomainProcessingStatus
    if (domain.Created === false) return 'Creating'
    if (domain.UpgradeProcessing) return 'Upgrading'
    if (domain.Processing) return 'Processing'
    return 'Active'
}

/** EngineVersion reads `OpenSearch_2.11` or `Elasticsearch_7.10`. */
function splitEngineVersion(value?: string): [string | null, string | null] {
    if (!value) return [null, null]
    const separator = value.indexOf('_')
    return separator < 0 ? [value, null] : [value.slice(0, separator), value.slice(separator + 1)]
}

function validateName(name: string): void {
    if (!name) throw new ValidationError('name is required')
    if (name.length < OPENSEARCH_NAME_MIN_LENGTH || name.length > OPENSEARCH_NAME_MAX_LENGTH
        || !new RegExp(OPENSEARCH_NAME_PATTERN).test(name)) {
        throw new ValidationError(`name is invalid: ${OPENSEARCH_NAME_MESSAGE}`)
    }
}

function volumeSizeValue(value: unknown): number | undefined {
    const text = stringValue(value)
    if (!text) return undefined
    const size = Number(text)
    if (!Number.isInteger(size) || size <= 0) throw new ValidationError('volumeSize must be a whole number of GiB')
    return size
}

/** The access policy is a JSON document held in a string; show it as the document it is. */
function parseJson(value?: string): unknown {
    if (!value) return null
    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) =>
        resource.name.toLowerCase().includes(normalized)
        || (resource.metadata.engineVersion as string | undefined)?.toLowerCase().includes(normalized))
}

function regionFromArn(arn?: string): string | null {
    return arn?.split(':')[3] || null
}

function isNotFound(error: unknown): boolean {
    return (error as {name?: string} | null)?.name === 'ResourceNotFoundException'
}
