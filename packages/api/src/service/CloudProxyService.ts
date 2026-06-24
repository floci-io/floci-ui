import type {
    CloudDescriptor,
    CloudProvider,
    CloudResource,
    CloudServiceDescriptor,
    CloudServiceType,
    CloudStatus,
    CosmosContainer,
    CosmosItem,
    CosmosQueryResult,
    CreateResourceInput,
    ResourceQuery,
    ServerlessInvokeResult,
    ServiceSchema,
    StorageObjectDownload,
    StorageObjectList,
} from '../cloud-spi/types'
import {storageSchemaFor} from '../cloud-spi/storageSchema'
import {CloudAdapterRegistry} from '../registry/CloudAdapterRegistry'
import {serverlessSchemaFor} from '../cloud-spi/serverlessSchema'
import {k8sSchemaFor} from '../cloud-spi/eksSchema'
import {databaseSchemaFor} from '../cloud-spi/databaseSchema'
import {azureEndpoint} from '../azure'
import {checkGcpRuntime, gcpEndpoint} from '../gcp'

export class CloudProxyService {
    constructor(private readonly registry: CloudAdapterRegistry) {}

    clouds(): CloudDescriptor[] {
        return [
            {id: 'aws', displayName: 'AWS', availability: 'available'},
            {id: 'azure', displayName: 'Azure', availability: 'available'},
            {id: 'gcp', displayName: 'GCP', availability: 'available'},
        ]
    }

    services(cloud: CloudProvider): CloudServiceDescriptor[] {

        const services: CloudServiceDescriptor[] = [{
            cloud,
            service: 'storage',
            displayName: 'Storage',
            availability: this.registry.get(cloud, 'storage') ? 'available' : 'coming_soon',
        }]

        services.push({
            cloud,
            service: 'k8s',
            displayName: 'k8s Engine',
            availability: this.registry.get(cloud, 'k8s') ? 'available' : 'coming_soon',
        })
        services.push({
            cloud,
            service: 'database',
            displayName: 'Database',
            availability: this.registry.get(cloud, 'database') ? 'available' : 'coming_soon',
        })
        services.push({
            cloud,
            service: 'serverless',
            displayName: 'Serverless',
            availability: this.registry.get(cloud, 'serverless') ? 'available' : 'coming_soon',
        })
        services.push({
            cloud,
            service: 'compute',
            displayName: 'Compute',
            availability: this.registry.get(cloud, 'compute') ? 'available' : 'coming_soon',
        })
        services.push({
            cloud,
            service: 'networking',
            displayName: 'Networking',
            availability: this.registry.get(cloud, 'networking') ? 'available' : 'coming_soon',
        })
        return services
    }

    schema(cloud: CloudProvider, service: CloudServiceType): ServiceSchema | null {
        const adapter = this.registry.get(cloud, service)
        if (adapter) return adapter.schema()
        if (service === 'storage') return storageSchemaFor(cloud)
        if (service === 'k8s') return k8sSchemaFor(cloud)
        if (service === 'database') return databaseSchemaFor(cloud)
        if (service === 'serverless') return serverlessSchemaFor(cloud)
        return null
    }

    async status(cloud: CloudProvider): Promise<CloudStatus> {
        const adapter = this.registry.get(cloud, 'storage')
        if (cloud === 'gcp') {
            try {
                await checkGcpRuntime()
                return {
                    cloud,
                    adapterRegistered: Boolean(adapter),
                    runtime: 'reachable',
                    endpoint: endpointFor(cloud),
                    checkedAt: new Date().toISOString(),
                    error: null,
                }
            } catch (error) {
                return {
                    cloud,
                    adapterRegistered: Boolean(adapter),
                    runtime: 'unavailable',
                    endpoint: endpointFor(cloud),
                    checkedAt: new Date().toISOString(),
                    error: error instanceof Error ? error.message : 'Runtime check failed',
                }
            }
        }

        if (!adapter) {
            return {
                cloud,
                adapterRegistered: false,
                runtime: 'coming_soon',
                endpoint: endpointFor(cloud),
                checkedAt: new Date().toISOString(),
                error: null,
            }
        }

        try {
            await adapter.list()
            return {
                cloud,
                adapterRegistered: true,
                runtime: 'reachable',
                endpoint: endpointFor(cloud),
                checkedAt: new Date().toISOString(),
                error: null,
            }
        } catch (error) {
            return {
                cloud,
                adapterRegistered: true,
                runtime: 'unavailable',
                endpoint: endpointFor(cloud),
                checkedAt: new Date().toISOString(),
                error: error instanceof Error ? error.message : 'Runtime check failed',
            }
        }
    }

    async listResources(cloud: CloudProvider, service: CloudServiceType, query: ResourceQuery): Promise<CloudResource[]> {
        return this.requireAdapter(cloud, service).list(query)
    }

    async getResource(cloud: CloudProvider, service: CloudServiceType, id: string): Promise<CloudResource | null> {
        return this.requireAdapter(cloud, service).get(id)
    }

    async createResource(cloud: CloudProvider, service: CloudServiceType, input: CreateResourceInput): Promise<CloudResource> {
        return this.requireAdapter(cloud, service).create(input)
    }

    async deleteResource(cloud: CloudProvider, service: CloudServiceType, id: string): Promise<void> {
        await this.requireAdapter(cloud, service).delete(id)
    }
async invokeResource(
    cloud: CloudProvider,
    service: CloudServiceType,
    id: string,
    payload: string,
): Promise<ServerlessInvokeResult> {
    const adapter = this.requireAdapter(cloud, service)
    if (!adapter.invoke) throw new Error(`${cloud}/${service} invoke is not supported`)
    return adapter.invoke(id, payload)
}
    async listObjects(cloud: CloudProvider, service: CloudServiceType, resourceId: string, prefix?: string): Promise<StorageObjectList> {
        const adapter = this.requireAdapter(cloud, service)
        if (!adapter.listObjects) throw new Error(`Object listing is not supported for ${cloud}/${service}`)
        return adapter.listObjects(resourceId, prefix)
    }

    async putObject(cloud: CloudProvider, service: CloudServiceType, resourceId: string, key: string, body: Uint8Array, contentType: string): Promise<void> {
        const adapter = this.requireAdapter(cloud, service)
        if (!adapter.putObject) throw new Error(`Object upload is not supported for ${cloud}/${service}`)
        await adapter.putObject(resourceId, key, body, contentType)
    }

    async getObject(cloud: CloudProvider, service: CloudServiceType, resourceId: string, key: string): Promise<StorageObjectDownload> {
        const adapter = this.requireAdapter(cloud, service)
        if (!adapter.getObject) throw new Error(`Object download is not supported for ${cloud}/${service}`)
        return adapter.getObject(resourceId, key)
    }

    async deleteObject(cloud: CloudProvider, service: CloudServiceType, resourceId: string, key: string): Promise<void> {
        const adapter = this.requireAdapter(cloud, service)
        if (!adapter.deleteObject) throw new Error(`Object delete is not supported for ${cloud}/${service}`)
        await adapter.deleteObject(resourceId, key)
    }

    async copyObject(cloud: CloudProvider, service: CloudServiceType, srcResourceId: string, srcKey: string, destKey: string, destResourceId?: string): Promise<void> {
        const adapter = this.requireAdapter(cloud, service)
        if (!adapter.copyObject) throw new Error(`Object copy is not supported for ${cloud}/${service}`)
        await adapter.copyObject(srcResourceId, srcKey, destKey, destResourceId)
    }

    async listCosmosContainers(cloud: CloudProvider, databaseId: string): Promise<CosmosContainer[]> {
        const adapter = this.requireAdapter(cloud, 'database')
        if (!adapter.listCosmosContainers) throw new Error(`Cosmos containers are not supported for ${cloud}/database`)
        return adapter.listCosmosContainers(databaseId)
    }

    async createCosmosContainer(cloud: CloudProvider, databaseId: string, input: CreateResourceInput): Promise<CosmosContainer> {
        const adapter = this.requireAdapter(cloud, 'database')
        if (!adapter.createCosmosContainer) throw new Error(`Cosmos container creation is not supported for ${cloud}/database`)
        return adapter.createCosmosContainer(databaseId, input)
    }

    async deleteCosmosContainer(cloud: CloudProvider, databaseId: string, containerId: string): Promise<void> {
        const adapter = this.requireAdapter(cloud, 'database')
        if (!adapter.deleteCosmosContainer) throw new Error(`Cosmos container deletion is not supported for ${cloud}/database`)
        await adapter.deleteCosmosContainer(databaseId, containerId)
    }

    async listCosmosItems(cloud: CloudProvider, databaseId: string, containerId: string): Promise<CosmosItem[]> {
        const adapter = this.requireAdapter(cloud, 'database')
        if (!adapter.listCosmosItems) throw new Error(`Cosmos items are not supported for ${cloud}/database`)
        return adapter.listCosmosItems(databaseId, containerId)
    }

    async upsertCosmosItem(cloud: CloudProvider, databaseId: string, containerId: string, document: Record<string, unknown>): Promise<CosmosItem> {
        const adapter = this.requireAdapter(cloud, 'database')
        if (!adapter.upsertCosmosItem) throw new Error(`Cosmos item upsert is not supported for ${cloud}/database`)
        return adapter.upsertCosmosItem(databaseId, containerId, document)
    }

    async deleteCosmosItem(cloud: CloudProvider, databaseId: string, containerId: string, itemId: string, partitionKey?: string | null): Promise<void> {
        const adapter = this.requireAdapter(cloud, 'database')
        if (!adapter.deleteCosmosItem) throw new Error(`Cosmos item deletion is not supported for ${cloud}/database`)
        await adapter.deleteCosmosItem(databaseId, containerId, itemId, partitionKey)
    }

    async queryCosmosItems(cloud: CloudProvider, databaseId: string, containerId: string, query: string): Promise<CosmosQueryResult> {
        const adapter = this.requireAdapter(cloud, 'database')
        if (!adapter.queryCosmosItems) throw new Error(`Cosmos query is not supported for ${cloud}/database`)
        return adapter.queryCosmosItems(databaseId, containerId, query)
    }

    private requireAdapter(cloud: CloudProvider, service: CloudServiceType) {
        const adapter = this.registry.get(cloud, service)
        if (!adapter) throw new Error(`No adapter registered for ${cloud}/${service}`)
        return adapter
    }
}

function endpointFor(cloud: CloudProvider): string | null {
    if (cloud === 'aws') return process.env.FLOCI_ENDPOINT ?? 'http://localhost:4566'
    if (cloud === 'azure') return azureEndpoint()
    if (cloud === 'gcp') return gcpEndpoint()
    return null
}
