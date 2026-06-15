import {azureServerlessSchema} from '../cloud-spi/serverlessSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

export class AzureServerlessAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'serverless' as const

    schema(): ServiceSchema {
        return azureServerlessSchema()
    }

    async list(_query: ResourceQuery = {}): Promise<CloudResource[]> {
        return []
    }

    async get(_id: string): Promise<CloudResource | null> {
        return null
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new Error('Azure Functions adapter not implemented yet')
    }

    async delete(_id: string): Promise<void> {
        throw new Error('Azure Functions adapter not implemented yet')
    }
}