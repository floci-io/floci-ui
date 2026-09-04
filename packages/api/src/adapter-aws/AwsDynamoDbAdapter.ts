import {
    CreateTableCommand,
    DeleteTableCommand,
    DescribeTableCommand,
    ListTablesCommand,
    PutItemCommand,
    ScanCommand,
    type AttributeDefinition,
    type AttributeValue,
    type DynamoDBClient,
    type KeySchemaElement,
    type ScalarAttributeType,
    type TableDescription,
} from '@aws-sdk/client-dynamodb'
import {marshall, unmarshall} from '@aws-sdk/util-dynamodb'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {dynamodb as defaultDynamoDb} from '../aws'
import {awsDynamoDbSchema} from '../cloud-spi/dynamodbSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    NoSqlItem,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const DESCRIBE_BATCH_SIZE = 10
const ITEM_SCAN_LIMIT = 100

export class AwsDynamoDbAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'nosql' as const

    constructor(private readonly dynamodb: DynamoDBClient = defaultDynamoDb) {}

    schema(): ServiceSchema {
        return awsDynamoDbSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const tableNames = filterNamesBySearch(await this.listTableNames(), query.search)
        const resources: CloudResource[] = []

        for (let index = 0; index < tableNames.length; index += DESCRIBE_BATCH_SIZE) {
            const batch = tableNames.slice(index, index + DESCRIBE_BATCH_SIZE)
            resources.push(...await Promise.all(batch.map((tableName) => this.describe(tableName))))
        }

        return resources
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            return await this.describe(id)
        } catch (error) {
            if (isResourceNotFound(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const tableName = requiredString(input.values.tableName, 'tableName')
        if (!isValidTableName(tableName)) {
            throw new ValidationError('Use a valid DynamoDB table name: 3-255 letters, numbers, underscores, dots, or hyphens.')
        }

        const partitionKey = requiredString(input.values.partitionKey, 'partitionKey')
        const partitionKeyType = attributeType(input.values.partitionKeyType, 'partitionKeyType')
        const sortKey = stringValue(input.values.sortKey)
        if (sortKey === partitionKey) throw new ValidationError('sortKey must differ from partitionKey')

        const attributeDefinitions: AttributeDefinition[] = [
            {AttributeName: partitionKey, AttributeType: partitionKeyType},
        ]
        const keySchema: KeySchemaElement[] = [
            {AttributeName: partitionKey, KeyType: 'HASH'},
        ]

        if (sortKey) {
            attributeDefinitions.push({
                AttributeName: sortKey,
                AttributeType: attributeType(input.values.sortKeyType || 'S', 'sortKeyType'),
            })
            keySchema.push({AttributeName: sortKey, KeyType: 'RANGE'})
        }

        const response = await this.dynamodb.send(new CreateTableCommand({
            TableName: tableName,
            AttributeDefinitions: attributeDefinitions,
            KeySchema: keySchema,
            BillingMode: 'PAY_PER_REQUEST',
        }))

        return toResource(response.TableDescription ?? {
            TableName: tableName,
            AttributeDefinitions: attributeDefinitions,
            KeySchema: keySchema,
            BillingModeSummary: {BillingMode: 'PAY_PER_REQUEST'},
        })
    }

    async delete(id: string): Promise<void> {
        await this.dynamodb.send(new DeleteTableCommand({TableName: id}))
    }

    async listNoSqlItems(resourceId: string): Promise<NoSqlItem[]> {
        const table = await this.describeTable(resourceId)
        const keyNames = keyAttributes(table).map(({name}) => name)
        const items: NoSqlItem[] = []
        let exclusiveStartKey: Record<string, AttributeValue> | undefined

        do {
            const response = await this.dynamodb.send(new ScanCommand({
                TableName: resourceId,
                ExclusiveStartKey: exclusiveStartKey,
                Limit: ITEM_SCAN_LIMIT - items.length,
            }))
            for (const rawItem of response.Items ?? []) {
                const document = normalizeDocument(unmarshall(rawItem, {wrapNumbers: normalizeNumber}))
                const key = Object.fromEntries(keyNames.map((name) => [name, document[name]]))
                items.push({id: JSON.stringify(key), key, document})
                if (items.length === ITEM_SCAN_LIMIT) break
            }
            exclusiveStartKey = response.LastEvaluatedKey
        } while (items.length < ITEM_SCAN_LIMIT && exclusiveStartKey && Object.keys(exclusiveStartKey).length > 0)

        return items
    }

    async putNoSqlItem(resourceId: string, document: Record<string, unknown>): Promise<NoSqlItem> {
        if (!document || typeof document !== 'object' || Array.isArray(document)) {
            throw new ValidationError('Item must be a JSON object.')
        }

        const table = await this.describeTable(resourceId)
        const keys = keyAttributes(table)
        if (keys.length === 0) throw new RuntimeError(`DynamoDB table ${resourceId} has no key schema`)
        const untypedKey = keys.find(({type}) => !type)
        if (untypedKey) throw new RuntimeError(`DynamoDB table ${resourceId} has no type definition for key ${untypedKey.name}`)

        const item = marshalDocument(document, keys)
        await this.dynamodb.send(new PutItemCommand({TableName: resourceId, Item: item}))

        const normalizedDocument = normalizeDocument(unmarshall(item, {wrapNumbers: normalizeNumber}))
        const key = Object.fromEntries(keys.map(({name}) => [name, normalizedDocument[name]]))
        return {id: JSON.stringify(key), key, document: normalizedDocument}
    }

    private async listTableNames(): Promise<string[]> {
        const tableNames: string[] = []
        let exclusiveStartTableName: string | undefined

        do {
            const response = await this.dynamodb.send(new ListTablesCommand({
                ExclusiveStartTableName: exclusiveStartTableName,
            }))
            tableNames.push(...(response.TableNames ?? []))
            exclusiveStartTableName = response.LastEvaluatedTableName
        } while (exclusiveStartTableName)

        return tableNames
    }

    private async describe(tableName: string): Promise<CloudResource> {
        return toResource(await this.describeTable(tableName))
    }

    private async describeTable(tableName: string): Promise<TableDescription> {
        const response = await this.dynamodb.send(new DescribeTableCommand({TableName: tableName}))
        if (!response.Table) throw new RuntimeError(`DynamoDB did not return a description for table ${tableName}`)
        return response.Table
    }
}

interface KeyAttribute {
    name: string
    type?: ScalarAttributeType
}

function keyAttributes(table: TableDescription): KeyAttribute[] {
    const attributeTypes = new Map(
        (table.AttributeDefinitions ?? [])
            .filter((definition): definition is AttributeDefinition & {AttributeName: string} => Boolean(definition.AttributeName))
            .map((definition) => [definition.AttributeName, definition.AttributeType]),
    )
    return (table.KeySchema ?? [])
        .filter((key): key is KeySchemaElement & {AttributeName: string} => Boolean(key.AttributeName))
        .map((key) => ({name: key.AttributeName, type: attributeTypes.get(key.AttributeName)}))
}

function marshalDocument(document: Record<string, unknown>, keys: KeyAttribute[]): Record<string, AttributeValue> {
    for (const {name} of keys) {
        if (!Object.prototype.hasOwnProperty.call(document, name)) {
            throw new ValidationError(`Key attribute ${name} is required.`)
        }
    }
    const marshalledKeys = Object.fromEntries(
        keys.map((key) => [key.name, marshalKey(key, document[key.name])]),
    )

    let item: Record<string, AttributeValue>
    try {
        item = marshall(document)
    } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : 'Item contains a value DynamoDB cannot store.', {cause: error})
    }

    return {...item, ...marshalledKeys}
}

function marshalKey(key: KeyAttribute, value: unknown): AttributeValue {
    if (key.type === 'N') {
        if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
            throw new ValidationError(`Key attribute ${key.name} must quote integers outside JavaScript's safe range.`)
        }
        const number = typeof value === 'number' || typeof value === 'string' ? String(value) : ''
        if (!isDynamoNumber(number)) throw new ValidationError(`Key attribute ${key.name} must be a number.`)
        return {N: number}
    }
    if (key.type === 'B') {
        if (typeof value !== 'string' || !isBase64(value)) {
            throw new ValidationError(`Binary key attribute ${key.name} must be a non-empty base64 string.`)
        }
        return {B: Buffer.from(value, 'base64')}
    }
    if (typeof value !== 'string' || !value) throw new ValidationError(`Key attribute ${key.name} must be a non-empty string.`)
    return {S: value}
}

function isDynamoNumber(value: string): boolean {
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(value)
}

function isBase64(value: string): boolean {
    return value.length > 0 && value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
}

function normalizeDocument(document: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(document).map(([name, value]) => [name, normalizeValue(value)]),
    )
}

function normalizeValue(value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Uint8Array) return Buffer.from(value).toString('base64')
    if (value instanceof Set) return Array.from(value, normalizeValue)
    if (Array.isArray(value)) return value.map(normalizeValue)
    if (typeof value === 'object' && value !== null) return normalizeDocument(value as Record<string, unknown>)
    return value
}

// DynamoDB `N` values are arbitrary precision. Anything that survives a JSON round-trip
// intact stays a number; integers beyond Number.MAX_SAFE_INTEGER keep their exact decimal
// form as a string rather than silently losing digits.
function normalizeNumber(value: string): number | string {
    const parsed = Number(value)
    return Number.isInteger(parsed) && !Number.isSafeInteger(parsed) ? value : parsed
}

function toResource(table: TableDescription): CloudResource {
    const name = table.TableName ?? ''
    return {
        id: name,
        name,
        cloud: 'aws',
        service: 'nosql',
        type: 'dynamodb-table',
        region: regionFromArn(table.TableArn),
        createdAt: table.CreationDateTime?.toISOString() ?? null,
        status: table.TableStatus ?? null,
        metadata: {
            arn: table.TableArn,
            tableId: table.TableId,
            itemCount: table.ItemCount,
            tableSizeBytes: table.TableSizeBytes,
            billingMode: table.BillingModeSummary?.BillingMode,
            keySchema: table.KeySchema,
            attributeDefinitions: table.AttributeDefinitions,
            provisionedThroughput: table.ProvisionedThroughput,
            globalSecondaryIndexes: table.GlobalSecondaryIndexes,
            localSecondaryIndexes: table.LocalSecondaryIndexes,
            streamSpecification: table.StreamSpecification,
            deletionProtectionEnabled: table.DeletionProtectionEnabled,
        },
    }
}

function requiredString(value: unknown, field: string): string {
    const result = stringValue(value)
    if (!result) throw new ValidationError(`${field} is required`)
    return result
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function attributeType(value: unknown, field: string): ScalarAttributeType {
    const result = stringValue(value)
    if (result === 'S' || result === 'N' || result === 'B') return result
    throw new ValidationError(`${field} must be S, N, or B`)
}

function filterNamesBySearch(names: string[], search?: string): string[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return names
    return names.filter((name) => name.toLowerCase().includes(normalized))
}

function regionFromArn(arn?: string): string | null {
    return arn?.split(':')[3] || null
}

function isValidTableName(value: string): boolean {
    return /^[A-Za-z0-9_.-]{3,255}$/.test(value)
}

function isResourceNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const candidate = error as {name?: string; $metadata?: {httpStatusCode?: number}}
    return candidate.name === 'ResourceNotFoundException' || candidate.$metadata?.httpStatusCode === 404
}
