import {SaxesParser} from 'saxes'
import {ConflictError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {azureQueueSchema} from '../cloud-spi/queueSchema'
import {azure, type AzureRuntimeClient} from '../azure'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

export class AzureQueueAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'queue' as const

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureQueueSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const names: string[] = []
        const seenMarkers = new Set<string>()
        let marker: string | null = null
        for (let page = 0; page < 100; page += 1) {
            const params = new URLSearchParams({comp: 'list'})
            if (marker) params.set('marker', marker)
            const response = await this.client.fetch(`${accountPath(this.client)}?${params}`, {method: 'GET'})
            if (!response) throw new RuntimeError('Azure Queue Storage list returned no response')

            const result = parseQueuePage(await response.text())
            names.push(...result.names)
            if (!result.nextMarker) {
                const search = query.search?.trim().toLowerCase()
                return names.filter((name) => !search || name.toLowerCase().includes(search))
                    .map((name) => toResource(name))
            }
            if (seenMarkers.has(result.nextMarker)) throw new RuntimeError('Azure Queue Storage repeated a list marker')
            seenMarkers.add(result.nextMarker)
            marker = result.nextMarker
        }

        throw new RuntimeError('Azure Queue Storage list exceeded 100 pages')
    }

    async get(id: string): Promise<CloudResource | null> {
        const response = await this.client.fetch(`${queuePath(this.client, id)}?comp=metadata`,
            {method: 'GET'}, {emptyOnNotFound: true})
        if (!response) return null

        const rawCount = response.headers.get('x-ms-approximate-messages-count')
        const count = rawCount === null || rawCount.trim() === '' ? null : Number(rawCount)
        return toResource(id, Number.isFinite(count) ? count : null)
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = typeof input.values.queueName === 'string' ? input.values.queueName.trim() : ''
        if (!name) throw new ValidationError('queueName is required')
        if (!isValidQueueName(name)) {
            throw new ValidationError('Use a valid Azure queue name: 3-63 lowercase letters, numbers, or single hyphens.')
        }

        const response = await this.client.fetch(queuePath(this.client, name), {method: 'PUT'})
        if (response?.status === 204) throw new ConflictError(`Queue ${name} already exists`)
        return toResource(name)
    }

    async delete(id: string): Promise<void> {
        await this.client.fetch(queuePath(this.client, id), {method: 'DELETE'})
    }

    async health(): Promise<void> {
        await this.client.fetch(`${accountPath(this.client)}?comp=list&maxresults=1`, {method: 'GET'})
    }
}

function accountPath(client: AzureRuntimeClient): string {
    return `/${encodeURIComponent(client.accountName)}-queue`
}

function queuePath(client: AzureRuntimeClient, name: string): string {
    return `${accountPath(client)}/${encodeURIComponent(name)}`
}

function toResource(name: string, approximateMessages: number | null = null): CloudResource {
    return {
        id: name,
        name,
        cloud: 'azure',
        service: 'queue',
        type: 'queue',
        region: null,
        createdAt: null,
        metadata: {provider: 'azure', storageService: 'queue', approximateMessages},
    }
}

function isValidQueueName(name: string): boolean {
    return /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,61}[a-z0-9]$/.test(name)
}

function parseQueuePage(xml: string): {names: string[]; nextMarker: string | null} {
    const names: string[] = []
    const stack: string[] = []
    let name = ''
    let nextMarker = ''
    let sawRoot = false
    const parser = new SaxesParser({xmlns: true})

    parser.on('opentag', (tag) => {
        if (stack.length === 0) {
            if (tag.local !== 'EnumerationResults') throw new RuntimeError('Invalid Azure queue list response')
            sawRoot = true
        }
        stack.push(tag.local)
        if (stack.join('/') === 'EnumerationResults/Queues/Queue') name = ''
    })
    parser.on('text', (text) => {
        if (stack.join('/') === 'EnumerationResults/Queues/Queue/Name') name += text
        if (stack.join('/') === 'EnumerationResults/NextMarker') nextMarker += text
    })
    parser.on('closetag', () => {
        if (stack.join('/') === 'EnumerationResults/Queues/Queue') {
            if (!name) throw new RuntimeError('Azure queue list contained a queue without a name')
            names.push(name)
        }
        stack.pop()
    })

    try {
        parser.write(xml).close()
    } catch (error) {
        if (error instanceof RuntimeError) throw error
        throw new RuntimeError('Invalid Azure queue list XML', {cause: error})
    }
    if (!sawRoot) throw new RuntimeError('Invalid Azure queue list response')
    return {names, nextMarker: nextMarker.trim() || null}
}
