import {
    CreateRestApiCommand,
    DeleteRestApiCommand,
    GetRestApiCommand,
    GetRestApisCommand,
    type APIGatewayClient,
    type RestApi,
} from '@aws-sdk/client-api-gateway'
import {apiGateway as defaultApiGateway} from '../aws'
import {awsApiGatewaySchema} from '../cloud-spi/apigatewaySchema'
import {ValidationError} from '../cloud-spi/errors'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

export class AwsApiGatewayAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'apigateway' as const

    constructor(private readonly apiGateway: APIGatewayClient = defaultApiGateway) {}

    schema(): ServiceSchema {
        return awsApiGatewaySchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const apis: RestApi[] = []
        let position: string | undefined

        do {
            const res = await this.apiGateway.send(new GetRestApisCommand({position}))
            apis.push(...(res.items ?? []))
            position = res.position
        } while (position)

        return filterBySearch(apis.map(toResource), query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            const res = await this.apiGateway.send(new GetRestApiCommand({restApiId: id}))
            return toResource(res)
        } catch (error) {
            if (hasHttpStatus(error, 404)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = stringValue(input.values.name)
        const description = stringValue(input.values.description)
        if (!name) throw new ValidationError('name is required')

        const res = await this.apiGateway.send(new CreateRestApiCommand({
            name,
            description: description || undefined,
        }))
        return toResource(res)
    }

    async delete(id: string): Promise<void> {
        await this.apiGateway.send(new DeleteRestApiCommand({restApiId: id}))
    }
}

function toResource(api: RestApi): CloudResource {
    const id = api.id ?? ''
    return {
        id,
        name: api.name ?? '',
        cloud: 'aws',
        service: 'apigateway',
        type: 'rest-api',
        region: null,
        createdAt: api.createdDate?.toISOString() ?? null,
        metadata: {
            provider: 'aws',
            apigatewayService: 'rest',
            description: api.description,
            version: api.version,
            endpointTypes: api.endpointConfiguration?.types,
            rootResourceId: api.rootResourceId,
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

function hasHttpStatus(error: unknown, status: number): boolean {
    if (typeof error !== 'object' || error === null) return false
    const metadata = (error as {$metadata?: {httpStatusCode?: number}}).$metadata
    return metadata?.httpStatusCode === status
}
