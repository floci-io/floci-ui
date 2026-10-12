import {describe, expect, test} from 'bun:test'
import {
    CreateTableCommand,
    DeleteTableCommand,
    DescribeTableCommand,
    ExecuteStatementCommand,
    ListTablesCommand,
    PutItemCommand,
    ScanCommand,
    type DynamoDBClient,
} from '@aws-sdk/client-dynamodb'
import {AwsDynamoDbAdapter} from './AwsDynamoDbAdapter'
import {ValidationError} from '../cloud-spi/errors'

type Command =
    | CreateTableCommand
    | DeleteTableCommand
    | DescribeTableCommand
    | ExecuteStatementCommand
    | ListTablesCommand
    | PutItemCommand
    | ScanCommand

function fakeClient(send: (command: Command) => Promise<unknown>): DynamoDBClient {
    return {send} as unknown as DynamoDBClient
}

function childItem(key: Record<string, unknown>, body: Record<string, unknown>) {
    return {id: JSON.stringify(key), collectionId: null, timestamp: null, body, metadata: {key}}
}

describe('AwsDynamoDbAdapter', () => {
    test('lists, describes, maps, and filters tables across pages', async () => {
        const describedTables: string[] = []
        const client = fakeClient(async (command) => {
            if (command instanceof ListTablesCommand) {
                return command.input.ExclusiveStartTableName
                    ? {TableNames: ['audit-events']}
                    : {TableNames: ['orders'], LastEvaluatedTableName: 'orders'}
            }
            if (command instanceof DescribeTableCommand) {
                describedTables.push(command.input.TableName ?? '')
                return {Table: {
                    TableName: command.input.TableName,
                    TableStatus: 'ACTIVE',
                    TableArn: `arn:aws:dynamodb:eu-west-2:000000000000:table/${command.input.TableName}`,
                    CreationDateTime: new Date('2026-07-18T10:00:00.000Z'),
                    ItemCount: 3,
                    KeySchema: [{AttributeName: 'pk', KeyType: 'HASH'}],
                }}
            }
            throw new Error('Unexpected command')
        })

        const result = await new AwsDynamoDbAdapter(client).list({search: 'audit'})

        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({
            id: 'audit-events',
            name: 'audit-events',
            cloud: 'aws',
            service: 'nosql',
            type: 'dynamodb-table',
            region: 'eu-west-2',
            status: 'ACTIVE',
            createdAt: '2026-07-18T10:00:00.000Z',
        })
        expect(result[0].metadata.itemCount).toBe(3)
        expect(describedTables).toEqual(['audit-events'])
    })

    test('describes tables in bounded batches', async () => {
        let activeDescriptions = 0
        let maximumActiveDescriptions = 0
        const tableNames = Array.from({length: 21}, (_, index) => `table-${index}`)
        const client = fakeClient(async (command) => {
            if (command instanceof ListTablesCommand) return {TableNames: tableNames}
            if (command instanceof DescribeTableCommand) {
                activeDescriptions += 1
                maximumActiveDescriptions = Math.max(maximumActiveDescriptions, activeDescriptions)
                await Promise.resolve()
                activeDescriptions -= 1
                return {Table: {TableName: command.input.TableName}}
            }
            throw new Error('Unexpected command')
        })

        const result = await new AwsDynamoDbAdapter(client).list()

        expect(result).toHaveLength(21)
        expect(maximumActiveDescriptions).toBe(10)
    })

    test('gets a table description', async () => {
        const client = fakeClient(async (command) => {
            expect(command).toBeInstanceOf(DescribeTableCommand)
            return {Table: {TableName: 'orders', TableStatus: 'ACTIVE'}}
        })

        const result = await new AwsDynamoDbAdapter(client).get('orders')

        expect(result?.name).toBe('orders')
    })

    test('returns null when a table does not exist', async () => {
        const client = fakeClient(async () => {
            throw Object.assign(new Error('Requested resource not found'), {name: 'ResourceNotFoundException'})
        })

        await expect(new AwsDynamoDbAdapter(client).get('missing')).resolves.toBeNull()
    })

    test('creates a table with partition and sort keys', async () => {
        let captured: CreateTableCommand | undefined
        const client = fakeClient(async (command) => {
            expect(command).toBeInstanceOf(CreateTableCommand)
            captured = command as CreateTableCommand
            return {TableDescription: {TableName: 'orders', TableStatus: 'ACTIVE'}}
        })

        const result = await new AwsDynamoDbAdapter(client).create({values: {
            tableName: 'orders',
            partitionKey: 'accountId',
            partitionKeyType: 'S',
            sortKey: 'createdAt',
            sortKeyType: 'N',
        }})

        expect(captured?.input).toEqual({
            TableName: 'orders',
            AttributeDefinitions: [
                {AttributeName: 'accountId', AttributeType: 'S'},
                {AttributeName: 'createdAt', AttributeType: 'N'},
            ],
            KeySchema: [
                {AttributeName: 'accountId', KeyType: 'HASH'},
                {AttributeName: 'createdAt', KeyType: 'RANGE'},
            ],
            BillingMode: 'PAY_PER_REQUEST',
        })
        expect(result).toMatchObject({name: 'orders', type: 'dynamodb-table'})
    })

    test('reports no status when create returns no table description', async () => {
        const client = fakeClient(async () => ({}))

        const result = await new AwsDynamoDbAdapter(client).create({values: {
            tableName: 'orders',
            partitionKey: 'accountId',
            partitionKeyType: 'S',
        }})

        expect(result).toMatchObject({name: 'orders', status: null})
    })

    test('defaults an optional sort key type to string', async () => {
        let captured: CreateTableCommand | undefined
        const client = fakeClient(async (command) => {
            captured = command as CreateTableCommand
            return {TableDescription: {TableName: 'orders'}}
        })

        await new AwsDynamoDbAdapter(client).create({values: {
            tableName: 'orders',
            partitionKey: 'pk',
            partitionKeyType: 'S',
            sortKey: 'sk',
        }})

        expect(captured?.input.AttributeDefinitions?.[1]?.AttributeType).toBe('S')
    })

    test('validates create input before calling DynamoDB', async () => {
        let called = false
        const client = fakeClient(async () => {
            called = true
            return {}
        })
        const adapter = new AwsDynamoDbAdapter(client)

        await expect(adapter.create({values: {
            tableName: 'x',
            partitionKey: 'pk',
            partitionKeyType: 'S',
        }})).rejects.toThrow('Use a valid DynamoDB table name')
        await expect(adapter.create({values: {
            tableName: 'orders',
            partitionKey: 'pk',
            partitionKeyType: 'S',
            sortKey: 'pk',
        }})).rejects.toThrow('sortKey must differ from partitionKey')
        expect(called).toBe(false)
    })

    test('deletes a table', async () => {
        let captured: DeleteTableCommand | undefined
        const client = fakeClient(async (command) => {
            captured = command as DeleteTableCommand
            return {}
        })

        await new AwsDynamoDbAdapter(client).delete('orders')

        expect(captured?.input.TableName).toBe('orders')
    })

    test('scans one page of table records and returns a cursor for the next', async () => {
        const scans: ScanCommand[] = []
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {KeySchema: [
                    {AttributeName: 'accountId', KeyType: 'HASH'},
                    {AttributeName: 'createdAt', KeyType: 'RANGE'},
                ]}}
            }
            if (command instanceof ScanCommand) {
                scans.push(command)
                return command.input.ExclusiveStartKey
                    ? {Items: [{accountId: {S: 'acct-2'}, createdAt: {N: '9007199254740993'}, active: {BOOL: false}, roles: {SS: ['admin', 'editor']}}]}
                    : {
                        Items: [{accountId: {S: 'acct-1'}, createdAt: {N: '1'}, active: {BOOL: true}}],
                        LastEvaluatedKey: {accountId: {S: 'acct-1'}, createdAt: {N: '1'}},
                    }
            }
            throw new Error('Unexpected command')
        })
        const items = new AwsDynamoDbAdapter(client).items

        const first = await items.listItems('orders')
        expect(scans[0].input).toEqual({TableName: 'orders', Limit: 100, ExclusiveStartKey: undefined})
        expect(first.items).toEqual([
            childItem({accountId: 'acct-1', createdAt: 1}, {accountId: 'acct-1', createdAt: 1, active: true}),
        ])
        expect(first.nextCursor).toEqual(expect.any(String))

        const second = await items.listItems('orders', {cursor: first.nextCursor ?? undefined, limit: 25})
        expect(scans[1].input).toEqual({
            TableName: 'orders',
            Limit: 25,
            ExclusiveStartKey: {accountId: {S: 'acct-1'}, createdAt: {N: '1'}},
        })
        expect(second).toEqual({
            items: [childItem(
                {accountId: 'acct-2', createdAt: '9007199254740993'},
                {accountId: 'acct-2', createdAt: '9007199254740993', active: false, roles: ['admin', 'editor']},
            )],
            nextCursor: null,
        })
    })

    test('round-trips a binary key through the scan cursor', async () => {
        const startKeys: unknown[] = []
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}]}}
            }
            if (command instanceof ScanCommand) {
                startKeys.push(command.input.ExclusiveStartKey)
                return {Items: [], LastEvaluatedKey: {id: {B: new Uint8Array([0, 255, 104, 105])}}}
            }
            throw new Error('Unexpected command')
        })
        const items = new AwsDynamoDbAdapter(client).items

        const first = await items.listItems('blobs')
        await items.listItems('blobs', {cursor: first.nextCursor ?? undefined})

        expect(startKeys[1]).toEqual({id: {B: Buffer.from([0, 255, 104, 105])}})
    })

    test.each(['not base64 json', Buffer.from('[]').toString('base64url'), Buffer.from('{"id":{"L":[]}}').toString('base64url')])(
        'rejects the malformed scan cursor %s before scanning',
        async (cursor) => {
            let scans = 0
            const client = fakeClient(async (command) => {
                if (command instanceof DescribeTableCommand) {
                    return {Table: {KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}]}}
                }
                scans += 1
                return {}
            })

            await expect(new AwsDynamoDbAdapter(client).items.listItems('orders', {cursor}))
                .rejects.toThrow(new ValidationError('cursor is not a valid DynamoDB scan cursor.'))
            expect(scans).toBe(0)
        },
    )

    test('puts a record using the table key types', async () => {
        let captured: PutItemCommand | undefined
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {
                    KeySchema: [
                        {AttributeName: 'accountId', KeyType: 'HASH'},
                        {AttributeName: 'sequence', KeyType: 'RANGE'},
                    ],
                    AttributeDefinitions: [
                        {AttributeName: 'accountId', AttributeType: 'S'},
                        {AttributeName: 'sequence', AttributeType: 'N'},
                    ],
                }}
            }
            if (command instanceof PutItemCommand) {
                captured = command
                return {}
            }
            throw new Error('Unexpected command')
        })

        const result = await new AwsDynamoDbAdapter(client).items.putItem!('orders', {
            accountId: 'acct-1',
            sequence: '9007199254740993',
            active: true,
        })

        expect(captured?.input).toEqual({
            TableName: 'orders',
            Item: {
                accountId: {S: 'acct-1'},
                sequence: {N: '9007199254740993'},
                active: {BOOL: true},
            },
        })
        expect(result).toEqual(childItem(
            {accountId: 'acct-1', sequence: '9007199254740993'},
            {accountId: 'acct-1', sequence: '9007199254740993', active: true},
        ))
    })

    test('accepts base64 for binary keys', async () => {
        let captured: PutItemCommand | undefined
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {
                    KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}],
                    AttributeDefinitions: [{AttributeName: 'id', AttributeType: 'B'}],
                }}
            }
            captured = command as PutItemCommand
            return {}
        })

        const result = await new AwsDynamoDbAdapter(client).items.putItem!('blobs', {id: 'aGVsbG8=', name: 'hello'})

        expect(captured?.input.Item?.id.B).toEqual(Buffer.from('hello'))
        expect(result.metadata.key).toEqual({id: 'aGVsbG8='})
    })

    test('validates required and typed keys before putting a record', async () => {
        let putCalls = 0
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {
                    KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}],
                    AttributeDefinitions: [{AttributeName: 'id', AttributeType: 'N'}],
                }}
            }
            putCalls += 1
            return {}
        })
        const items = new AwsDynamoDbAdapter(client).items

        await expect(items.putItem!('orders', {})).rejects.toThrow('Key attribute id is required')
        await expect(items.putItem!('orders', {id: 'not-a-number'})).rejects.toThrow('Key attribute id must be a number')
        for (const json of ['1', '1.5', '9007199254740993', '123456789.123456789', '1.0000000000000000001']) {
            await expect(items.putItem!('orders', {id: JSON.parse(json)}))
                .rejects.toThrow('must be a quoted number to preserve precision')
        }
        expect(putCalls).toBe(0)
    })

    test.each(['123456789.123456789', '1.0000000000000000001'])('preserves the quoted numeric key %s when writing and reading', async (id) => {
        let captured: PutItemCommand | undefined
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {
                    KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}],
                    AttributeDefinitions: [{AttributeName: 'id', AttributeType: 'N'}],
                }}
            }
            if (command instanceof ScanCommand) return {Items: [{id: {N: id}}]}
            captured = command as PutItemCommand
            return {}
        })
        const items = new AwsDynamoDbAdapter(client).items

        const created = await items.putItem!('orders', {id})
        const listed = await items.listItems('orders')

        expect(captured?.input.Item?.id).toEqual({N: id})
        expect(created).toEqual(childItem({id}, {id}))
        expect(listed.items).toEqual([created])
    })

    test.each([
        ['top-level attribute', '{"id":"order-1","count":9007199254740993}', '$["count"]'],
        ['nested object', '{"id":"order-1","details":{"count":-9007199254740993}}', '$["details"]["count"]'],
        ['array value', '{"id":"order-1","counts":[0,9007199254740993]}', '$["counts"][1]'],
        ['object inside an array', '{"id":"order-1","entries":[{"count":9007199254740993}]}', '$["entries"][0]["count"]'],
    ])('rejects unsafe integers (%s) before putting a record', async (_name, json, path) => {
        let putCalls = 0
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {
                    KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}],
                    AttributeDefinitions: [{AttributeName: 'id', AttributeType: 'S'}],
                }}
            }
            putCalls += 1
            return {}
        })

        await expect(new AwsDynamoDbAdapter(client).items.putItem!('orders', JSON.parse(json)))
            .rejects.toThrow(new ValidationError(`Item value at ${path} must quote integers outside JavaScript's safe range.`))
        expect(putCalls).toBe(0)
    })

    test.each([
        ['1.0', '1', 1],
        ['1e3', '1000', 1000],
        ['1000', '1E+3', 1000],
        ['+0001.5000', '1.5', 1.5],
        ['-0.00e10', '0', 0],
        ['.00000100', '1E-6', 0.000001],
        ['0.0000001', '1E-7', 1e-7],
        ['9007199254740993.00', '9.007199254740993E15', '9007199254740993'],
        ['-9007199254740993e0', '-9007199254740993', '-9007199254740993'],
        ['1.000000000000000000100', '10000000000000000001E-19', '1.0000000000000000001'],
        ['123456789.1234567890', '1.23456789123456789E8', '123456789.123456789'],
        ['10e-131', '1E-130', 1e-130],
        ['1e125', '10E124', '1e125'],
    ] as const)('keeps create and refreshed IDs equal for %s and %s', async (input, stored, normalized) => {
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {
                    KeySchema: [
                        {AttributeName: 'accountId', KeyType: 'HASH'},
                        {AttributeName: 'sequence', KeyType: 'RANGE'},
                    ],
                    AttributeDefinitions: [
                        {AttributeName: 'accountId', AttributeType: 'S'},
                        {AttributeName: 'sequence', AttributeType: 'N'},
                    ],
                }}
            }
            if (command instanceof PutItemCommand) {
                expect(command.input.Item?.sequence).toEqual({N: input})
                return {}
            }
            if (command instanceof ScanCommand) {
                return {Items: [{accountId: {S: 'acct-1'}, sequence: {N: stored}}]}
            }
            throw new Error('Unexpected command')
        })
        const items = new AwsDynamoDbAdapter(client).items

        const created = await items.putItem!('orders', {accountId: 'acct-1', sequence: input})
        const listed = await items.listItems('orders')
        const key = {accountId: 'acct-1', sequence: normalized}

        expect(created).toEqual(childItem(key, key))
        expect(listed.items).toEqual([created])
    })

    test('preserves safe integers, fractions, and quoted large values in nested records', async () => {
        let captured: PutItemCommand | undefined
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {
                    KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}],
                    AttributeDefinitions: [{AttributeName: 'id', AttributeType: 'S'}],
                }}
            }
            captured = command as PutItemCommand
            return {}
        })
        const document = {
            id: 'order-1',
            values: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0, 1.5],
            details: {count: '9007199254740993', active: true, optional: null},
        }

        const result = await new AwsDynamoDbAdapter(client).items.putItem!('orders', document)

        expect(captured?.input.Item?.values).toEqual({L: [
            {N: '-9007199254740991'}, {N: '9007199254740991'}, {N: '0'}, {N: '1.5'},
        ]})
        expect(captured?.input.Item?.details.M?.count).toEqual({S: '9007199254740993'})
        expect(result.body).toEqual(document)
    })

    test('runs a PartiQL statement and maps rows with the table key', async () => {
        const statements: ExecuteStatementCommand[] = []
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}]}}
            }
            if (command instanceof ExecuteStatementCommand) {
                statements.push(command)
                return {
                    Items: [{id: {S: 'order-1'}, total: {N: '9007199254740993'}, tags: {SS: ['new']}}],
                    NextToken: 'token-2',
                }
            }
            throw new Error('Unexpected command')
        })

        const result = await new AwsDynamoDbAdapter(client).items.queryItems!(
            'orders',
            '  SELECT * FROM "orders" WHERE total > 10  ',
        )

        expect(statements[0].input).toEqual({
            Statement: 'SELECT * FROM "orders" WHERE total > 10',
            Limit: 100,
            NextToken: undefined,
        })
        expect(result).toEqual({
            items: [childItem({id: 'order-1'}, {id: 'order-1', total: '9007199254740993', tags: ['new']})],
            nextCursor: 'token-2',
        })
    })

    test('continues a PartiQL statement with its NextToken and page size', async () => {
        let captured: ExecuteStatementCommand | undefined
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}]}}
            }
            captured = command as ExecuteStatementCommand
            return {Items: []}
        })

        const result = await new AwsDynamoDbAdapter(client).items.queryItems!(
            'orders',
            'SELECT * FROM "orders"',
            {cursor: 'token-2', limit: 10},
        )

        expect(captured?.input).toEqual({Statement: 'SELECT * FROM "orders"', Limit: 10, NextToken: 'token-2'})
        expect(result).toEqual({items: [], nextCursor: null})
    })

    test('identifies projected rows without key attributes by position', async () => {
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}]}}
            }
            return {Items: [{total: {N: '3'}}, {total: {N: '5'}}]}
        })

        const result = await new AwsDynamoDbAdapter(client).items.queryItems!('orders', 'SELECT total FROM "orders"')

        expect(result.items.map(({id, body, metadata}) => ({id, body, metadata}))).toEqual([
            {id: 'row-0', body: {total: 3}, metadata: {key: null}},
            {id: 'row-1', body: {total: 5}, metadata: {key: null}},
        ])
    })

    test.each([
        ['an empty statement', '   ', 'A PartiQL statement is required.'],
        ['a statement over 8192 characters', `SELECT * FROM "orders" WHERE id = '${'x'.repeat(8192)}'`, 'A PartiQL statement must be at most 8192 characters.'],
    ])('rejects %s before calling DynamoDB', async (_name, statement, message) => {
        let calls = 0
        const client = fakeClient(async () => {
            calls += 1
            return {}
        })

        await expect(new AwsDynamoDbAdapter(client).items.queryItems!('orders', statement))
            .rejects.toThrow(new ValidationError(message))
        expect(calls).toBe(0)
    })

    test.each([
        ['INSERT', 'INSERT INTO "orders" VALUE {\'id\': \'order-2\'}'],
        ['UPDATE', 'UPDATE "orders" SET total = 1 WHERE id = \'order-1\''],
        ['DELETE', 'DELETE FROM "orders" WHERE id = \'order-1\''],
    ])('returns no rows and no cursor for a %s statement', async (_verb, statement) => {
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}]}}
            }
            return {}
        })

        const result = await new AwsDynamoDbAdapter(client).items.queryItems!('orders', statement)

        expect(result).toEqual({items: [], nextCursor: null})
    })

    test('maps nested map and list attributes of a PartiQL row', async () => {
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {
                    Table: {
                        KeySchema: [
                            {AttributeName: 'customerId', KeyType: 'HASH'},
                            {AttributeName: 'orderId', KeyType: 'RANGE'},
                        ],
                    },
                }
            }
            return {
                Items: [{
                    customerId: {S: 'c1'},
                    orderId: {S: '2026-001'},
                    shipping: {M: {city: {S: 'Madrid'}, express: {BOOL: true}}},
                    items: {L: [{M: {sku: {S: 'A1'}, qty: {N: '2'}}}, {M: {sku: {S: 'B7'}, qty: {N: '1'}}}]},
                    tags: {L: [{S: 'gift'}, {S: 'priority'}]},
                }],
            }
        })

        const result = await new AwsDynamoDbAdapter(client).items.queryItems!(
            'orders',
            'SELECT * FROM "orders" WHERE shipping.express = true',
        )

        expect(result.items).toHaveLength(1)
        expect(result.items[0].id).toBe(JSON.stringify({customerId: 'c1', orderId: '2026-001'}))
        expect(result.items[0].metadata).toEqual({key: {customerId: 'c1', orderId: '2026-001'}})
        expect(result.items[0].body).toEqual({
            customerId: 'c1',
            orderId: '2026-001',
            shipping: {city: 'Madrid', express: true},
            items: [{sku: 'A1', qty: 2}, {sku: 'B7', qty: 1}],
            tags: ['gift', 'priority'],
        })
    })

    test('lets a PartiQL error from DynamoDB reach the caller', async () => {
        const rejection = Object.assign(new Error("Statement wasn't well formed, can't be processed: unexpected token"), {
            name: 'ValidationException',
        })
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}]}}
            }
            throw rejection
        })

        await expect(new AwsDynamoDbAdapter(client).items.queryItems!('orders', 'SELEKT * FROM "orders"'))
            .rejects.toBe(rejection)
    })

    test('returns the AWS DynamoDB schema', () => {
        const adapter = new AwsDynamoDbAdapter(fakeClient(async () => ({})))

        expect(adapter.schema()).toMatchObject({
            cloud: 'aws',
            service: 'nosql',
            displayName: 'DynamoDB',
            actions: ['list', 'create', 'delete', 'inspect'],
        })
    })
})
