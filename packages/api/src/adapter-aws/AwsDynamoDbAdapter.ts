import {
    CreateTableCommand,
    DeleteTableCommand,
    DescribeTableCommand,
    ExecuteStatementCommand,
    ListTablesCommand,
    PutItemCommand,
    QueryCommand,
    ScanCommand,
    type AttributeDefinition,
    type AttributeValue,
    type DynamoDBClient,
    type KeySchemaElement,
    type KeyType,
    type ScalarAttributeType,
    type TableDescription,
} from '@aws-sdk/client-dynamodb'
import {marshall, unmarshall} from '@aws-sdk/util-dynamodb'
import {RuntimeError, ValidationError} from '../cloud-spi/errors'
import {dynamodb as defaultDynamoDb} from '../aws'
import {
    DEFAULT_PAGE_LIMIT,
    type ChildItem,
    type CollectionPage,
    type ItemStoreAdapter,
    type KeyConditionOperator,
    type KeyQuery,
    type PageQuery,
} from '../cloud-spi/childCollections'
import {awsDynamoDbSchema} from '../cloud-spi/dynamodbSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

const DESCRIBE_BATCH_SIZE = 10
// ExecuteStatement rejects a Statement longer than this with a ValidationException.
const MAX_STATEMENT_LENGTH = 8192

export class AwsDynamoDbAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'nosql' as const

    readonly items: ItemStoreAdapter

    constructor(private readonly dynamodb: DynamoDBClient = defaultDynamoDb) {
        this.items = new DynamoDbItemStore(dynamodb)
    }

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
        return toResource(await describeTable(this.dynamodb, tableName))
    }

}

/**
 * The table is the collection, so DynamoDB implements the flat half of the
 * child-collections SPI. Item ids are the item's primary key as JSON, which is
 * stable across calls and is what DeleteItem/GetItem would need.
 */
class DynamoDbItemStore implements ItemStoreAdapter {
    constructor(private readonly dynamodb: DynamoDBClient) {}

    async listItems(resourceId: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        const keys = keyAttributes(await describeTable(this.dynamodb, resourceId))
        const response = await this.dynamodb.send(new ScanCommand({
            TableName: resourceId,
            Limit: page.limit ?? DEFAULT_PAGE_LIMIT,
            ExclusiveStartKey: page.cursor ? decodePageCursor(page.cursor) : undefined,
        }))
        return {
            items: (response.Items ?? []).map((rawItem, index) => toChildItem(rawItem, keys, index)),
            nextCursor: encodePageCursor(response.LastEvaluatedKey),
        }
    }

    async putItem(resourceId: string, body: Record<string, unknown>): Promise<ChildItem> {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new ValidationError('Item must be a JSON object.')
        }

        const table = await describeTable(this.dynamodb, resourceId)
        const keys = keyAttributes(table)
        if (keys.length === 0) throw new RuntimeError(`DynamoDB table ${resourceId} has no key schema`)
        const untypedKey = keys.find(({type}) => !type)
        if (untypedKey) throw new RuntimeError(`DynamoDB table ${resourceId} has no type definition for key ${untypedKey.name}`)

        const item = marshalDocument(body, keys)
        await this.dynamodb.send(new PutItemCommand({TableName: resourceId, Item: item}))
        return toChildItem(item, keys, 0)
    }

    /**
     * Runs a PartiQL statement with ExecuteStatement. The statement names its
     * own table, as the real API requires; it is not rewritten or restricted to
     * `resourceId`, which only resolves the key schema used to identify rows.
     * INSERT, UPDATE and DELETE are valid statements and return no items.
     */
    async queryItems(resourceId: string, query: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        const statement = typeof query === 'string' ? query.trim() : ''
        if (!statement) throw new ValidationError('A PartiQL statement is required.')
        if (statement.length > MAX_STATEMENT_LENGTH) {
            throw new ValidationError(`A PartiQL statement must be at most ${MAX_STATEMENT_LENGTH} characters.`)
        }

        const keys = keyAttributes(await describeTable(this.dynamodb, resourceId))
        const response = await this.dynamodb.send(new ExecuteStatementCommand({
            Statement: statement,
            Limit: page.limit ?? DEFAULT_PAGE_LIMIT,
            // ExecuteStatement's NextToken is already opaque and bound to the
            // statement, so it is the cursor as-is.
            NextToken: page.cursor,
        }))
        return {
            items: (response.Items ?? []).map((rawItem, index) => toChildItem(rawItem, keys, index)),
            nextCursor: response.NextToken ?? null,
        }
    }

    /**
     * Runs Query against the table or one of its secondary indexes. Key names
     * and types come from the described table, so the caller sends values only.
     */
    async queryItemsByKey(resourceId: string, query: KeyQuery, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        const table = await describeTable(this.dynamodb, resourceId)
        const accessPath = query.index ? `index ${query.index}` : `table ${resourceId}`
        const accessKeys = keyAttributes(table, query.index ? indexKeySchema(table, query.index) : table.KeySchema)
        const partitionKey = accessKeys.find(({keyType}) => keyType === 'HASH')
        const sortKey = accessKeys.find(({keyType}) => keyType === 'RANGE')
        if (!partitionKey) throw new RuntimeError(`DynamoDB ${accessPath} has no partition key`)
        const untypedKey = [partitionKey, sortKey].find((key) => key && !key.type)
        if (untypedKey) throw new RuntimeError(`DynamoDB ${accessPath} has no type definition for key ${untypedKey.name}`)

        const names: Record<string, string> = {'#pk': partitionKey.name}
        const values: Record<string, AttributeValue> = {':pk': marshalKey(partitionKey, query.partitionKey)}
        let keyCondition = '#pk = :pk'
        if (query.sortKey) {
            if (!sortKey) throw new ValidationError(`DynamoDB ${accessPath} has no sort key.`)
            names['#sk'] = sortKey.name
            values[':sk'] = marshalKey(sortKey, query.sortKey.value)
            if (query.sortKey.operator === 'between') values[':skTo'] = marshalKey(sortKey, query.sortKey.to ?? '')
            keyCondition += ` AND ${SORT_KEY_CONDITIONS[query.sortKey.operator]}`
        }

        const response = await this.dynamodb.send(new QueryCommand({
            TableName: resourceId,
            IndexName: query.index,
            KeyConditionExpression: keyCondition,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ScanIndexForward: !query.descending,
            Limit: page.limit ?? DEFAULT_PAGE_LIMIT,
            ExclusiveStartKey: page.cursor ? decodePageCursor(page.cursor) : undefined,
        }))
        // Rows are identified by the table's primary key, which every index
        // projection carries, so ids match the scanned records.
        const tableKeys = keyAttributes(table)
        return {
            items: (response.Items ?? []).map((rawItem, index) => toChildItem(rawItem, tableKeys, index)),
            nextCursor: encodePageCursor(response.LastEvaluatedKey),
        }
    }
}

const SORT_KEY_CONDITIONS: Record<KeyConditionOperator, string> = {
    eq: '#sk = :sk',
    lt: '#sk < :sk',
    lte: '#sk <= :sk',
    gt: '#sk > :sk',
    gte: '#sk >= :sk',
    beginsWith: 'begins_with(#sk, :sk)',
    between: '#sk BETWEEN :sk AND :skTo',
}

function indexKeySchema(table: TableDescription, indexName: string): KeySchemaElement[] {
    const index = [...(table.GlobalSecondaryIndexes ?? []), ...(table.LocalSecondaryIndexes ?? [])]
        .find(({IndexName}) => IndexName === indexName)
    if (!index) throw new ValidationError(`DynamoDB table ${table.TableName} has no index named ${indexName}.`)
    // Never undefined: keyAttributes would default to the table's own keys.
    return index.KeySchema ?? []
}

async function describeTable(dynamodb: DynamoDBClient, tableName: string): Promise<TableDescription> {
    const response = await dynamodb.send(new DescribeTableCommand({TableName: tableName}))
    if (!response.Table) throw new RuntimeError(`DynamoDB did not return a description for table ${tableName}`)
    return response.Table
}

function toChildItem(rawItem: Record<string, AttributeValue>, keys: KeyAttribute[], index: number): ChildItem {
    const body = normalizeDocument(unmarshall(rawItem, {wrapNumbers: normalizeNumber}))
    const keyNames = keys.map(({name}) => name)
    const hasKey = keyNames.length > 0 && keyNames.every((name) => Object.prototype.hasOwnProperty.call(body, name))
    const key = hasKey ? Object.fromEntries(keyNames.map((name) => [name, body[name]])) : null
    return {
        // A projection such as `SELECT total FROM ...` can drop the key
        // attributes. Position within the page is all that is left then, so
        // that id is only unique within one response.
        id: key ? JSON.stringify(key) : `row-${index}`,
        collectionId: null,
        timestamp: null,
        body,
        metadata: {key},
    }
}

/**
 * LastEvaluatedKey holds only key attributes, which are scalar S, N or B.
 * Binary values are carried as base64 so the cursor survives JSON.
 */
function encodePageCursor(lastEvaluatedKey?: Record<string, AttributeValue>): string | null {
    if (!lastEvaluatedKey || Object.keys(lastEvaluatedKey).length === 0) return null
    const portable = Object.fromEntries(Object.entries(lastEvaluatedKey).map(([name, value]) => {
        if (value.B !== undefined) return [name, {B: Buffer.from(value.B).toString('base64')}]
        return [name, value.S !== undefined ? {S: value.S} : {N: value.N}]
    }))
    return Buffer.from(JSON.stringify(portable)).toString('base64url')
}

function decodePageCursor(cursor: string): Record<string, AttributeValue> {
    let parsed: unknown
    try {
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    } catch (error) {
        throw new ValidationError('cursor is not a valid DynamoDB page cursor.', {cause: error})
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
        throw new ValidationError('cursor is not a valid DynamoDB page cursor.')
    }
    return Object.fromEntries(Object.entries(parsed).map(([name, value]) => {
        const attribute = value as {S?: unknown; N?: unknown; B?: unknown}
        if (typeof attribute?.S === 'string') return [name, {S: attribute.S}]
        if (typeof attribute?.N === 'string') return [name, {N: attribute.N}]
        if (typeof attribute?.B === 'string') return [name, {B: Buffer.from(attribute.B, 'base64')}]
        throw new ValidationError('cursor is not a valid DynamoDB page cursor.')
    }))
}

interface KeyAttribute {
    name: string
    type?: ScalarAttributeType
    keyType?: KeyType
}

// AttributeDefinitions covers every key of the table and its indexes, so one
// lookup types the table's own key schema or any index's.
function keyAttributes(table: TableDescription, keySchema: KeySchemaElement[] = table.KeySchema ?? []): KeyAttribute[] {
    const attributeTypes = new Map(
        (table.AttributeDefinitions ?? [])
            .filter((definition): definition is AttributeDefinition & {AttributeName: string} => Boolean(definition.AttributeName))
            .map((definition) => [definition.AttributeName, definition.AttributeType]),
    )
    return keySchema
        .filter((key): key is KeySchemaElement & {AttributeName: string} => Boolean(key.AttributeName))
        .map((key) => ({name: key.AttributeName, type: attributeTypes.get(key.AttributeName), keyType: key.KeyType}))
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
    validateSafeIntegers(document)

    let item: Record<string, AttributeValue>
    try {
        item = marshall(document)
    } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : 'Item contains a value DynamoDB cannot store.', {cause: error})
    }

    return {...item, ...marshalledKeys}
}

function validateSafeIntegers(value: unknown, path = '$'): void {
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw new ValidationError(`Item value at ${path} must quote integers outside JavaScript's safe range.`)
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => validateSafeIntegers(item, `${path}[${index}]`))
    } else if (typeof value === 'object' && value !== null) {
        for (const [name, item] of Object.entries(value)) {
            validateSafeIntegers(item, `${path}[${JSON.stringify(name)}]`)
        }
    }
}

function marshalKey(key: KeyAttribute, value: unknown): AttributeValue {
    if (key.type === 'N') {
        if (typeof value === 'number') {
            throw new ValidationError(`Key attribute ${key.name} must be a quoted number to preserve precision.`)
        }
        const number = typeof value === 'string' ? value : ''
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

// Compare exact decimals so DynamoDB's formatting changes cannot change item IDs.
function normalizeNumber(value: string): number | string {
    const canonical = canonicalDecimal(value)
    const parsed = Number(canonical)
    if (!Number.isFinite(parsed) || (Number.isInteger(parsed) && !Number.isSafeInteger(parsed))) return canonical
    return canonicalDecimal(String(parsed)) === canonical ? parsed : canonical
}

function canonicalDecimal(value: string): string {
    const [coefficient, exponent = '0'] = value.toLowerCase().split('e')
    const sign = coefficient.startsWith('-') ? '-' : ''
    const [integer, fraction = ''] = coefficient.replace(/^[+-]/, '').split('.')
    const digits = (integer + fraction).replace(/^0+/, '')
    if (!digits) return '0'

    const point = BigInt(digits.length - fraction.length) + BigInt(exponent)
    const significant = digits.replace(/0+$/, '')
    if (point <= -6n || point > 21n) {
        const tail = significant.slice(1)
        const mantissa = significant[0] + (tail ? `.${tail}` : '')
        return `${sign}${mantissa}e${point - 1n}`
    }

    const position = Number(point)
    if (position <= 0) return `${sign}0.${'0'.repeat(-position)}${significant}`
    if (position >= significant.length) return sign + significant.padEnd(position, '0')
    return `${sign}${significant.slice(0, position)}.${significant.slice(position)}`
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
