import {azure, type AzureRuntimeClient} from '../azure'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {azureTableSchema} from '../cloud-spi/tableSchema'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

const TABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]{2,62}$/

export class AzureTableAdapter implements CloudServiceAdapter {
    readonly cloud = 'azure' as const
    readonly service = 'table' as const

    constructor(private readonly client: AzureRuntimeClient = azure) {}

    schema(): ServiceSchema {
        return azureTableSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const resources: CloudResource[] = []
        const seenTokens = new Set<string>()
        let nextTableName: string | undefined
        do {
            const path = nextTableName
                ? `${tablePath(this.client)}?${new URLSearchParams({NextTableName: nextTableName})}`
                : tablePath(this.client)
            const {body, response} = await this.tableJson(path, {method: 'GET'})
            if (!isRecord(body) || !Array.isArray(body.value)) {
                throw new RuntimeError('Azure Table Storage returned an invalid table list')
            }

            for (const item of body.value) {
                if (!isRecord(item) || typeof item.TableName !== 'string') {
                    throw new RuntimeError('Azure Table Storage returned a table without a name')
                }
                resources.push(toTableResource(item.TableName, this.client.accountName))
            }
            const continuation = response.headers.get('x-ms-continuation-NextTableName')?.trim()
            if (continuation && seenTokens.has(continuation)) {
                throw new RuntimeError('Azure Table Storage repeated a continuation token')
            }
            if (continuation) seenTokens.add(continuation)
            nextTableName = continuation
        } while (nextTableName)

        const search = query.search?.trim().toLowerCase()
        return search ? resources.filter((resource) => resource.name.toLowerCase().includes(search)) : resources
    }

    async get(id: string): Promise<CloudResource | null> {
        const resources = await this.list()
        return resources.find((resource) => resource.id === id) ?? null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const tableName = typeof input.values?.tableName === 'string' ? input.values.tableName.trim() : ''
        validateTableName(tableName)

        const {body} = await this.tableJson(tablePath(this.client), {
            method: 'POST',
            body: JSON.stringify({TableName: tableName}),
            headers: {'content-type': 'application/json'},
        })
        if (!isRecord(body) || body.TableName !== tableName) {
            throw new RuntimeError('Azure Table Storage returned an invalid created table')
        }
        return toTableResource(tableName, this.client.accountName)
    }

    async delete(id: string): Promise<void> {
        validateTableName(id)
        await this.client.fetch(`${tablePath(this.client)}('${id}')`, {method: 'DELETE'})
    }

    private async tableJson(path: string, init: RequestInit): Promise<{body: unknown; response: Response}> {
        const response = await this.client.fetch(path, {
            ...init,
            headers: {accept: 'application/json', ...(init.headers ?? {})},
        })
        if (!response) throw new RuntimeError('Azure Table Storage returned an empty response')
        try {
            return {body: await response.json(), response}
        } catch (cause) {
            throw new RuntimeError('Azure Table Storage returned invalid JSON', {cause})
        }
    }
}

function tablePath(client: AzureRuntimeClient): string {
    return `/${encodeURIComponent(client.accountName)}-table/Tables`
}

function toTableResource(tableName: string, accountName: string): CloudResource {
    return {
        id: tableName,
        name: tableName,
        cloud: 'azure',
        service: 'table',
        type: 'table',
        region: null,
        createdAt: null,
        metadata: {provider: 'azure', storageService: 'table', accountName},
    }
}

function validateTableName(name: string): void {
    if (name.toLowerCase() === 'tables') {
        throw new ValidationError('The table name "tables" is reserved by Azure Table Storage.')
    }
    if (!TABLE_NAME_PATTERN.test(name)) {
        throw new ValidationError('Use a valid Azure table name: 3-63 letters and numbers, starting with a letter.')
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
