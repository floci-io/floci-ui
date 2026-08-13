import {describe, expect, test} from 'bun:test'
import {
    CreateTableCommand,
    DeleteTableCommand,
    DescribeTableCommand,
    ListTablesCommand,
    ScanCommand,
    type DynamoDBClient,
} from '@aws-sdk/client-dynamodb'
import {AwsDynamoDbAdapter} from './AwsDynamoDbAdapter'

type Command = CreateTableCommand | DeleteTableCommand | DescribeTableCommand | ListTablesCommand | ScanCommand

function fakeClient(send: (command: Command) => Promise<unknown>): DynamoDBClient {
    return {send} as unknown as DynamoDBClient
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

    test('lists and unmarshalls table records across scan pages', async () => {
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {KeySchema: [
                    {AttributeName: 'accountId', KeyType: 'HASH'},
                    {AttributeName: 'createdAt', KeyType: 'RANGE'},
                ]}}
            }
            if (command instanceof ScanCommand) {
                expect(command.input.Limit).toBe(command.input.ExclusiveStartKey ? 99 : 100)
                return command.input.ExclusiveStartKey
                    ? {Items: [{accountId: {S: 'acct-2'}, createdAt: {N: '9007199254740993'}, active: {BOOL: false}, roles: {SS: ['admin', 'editor']}}]}
                    : {
                        Items: [{accountId: {S: 'acct-1'}, createdAt: {N: '1'}, active: {BOOL: true}}],
                        LastEvaluatedKey: {accountId: {S: 'acct-1'}, createdAt: {N: '1'}},
                    }
            }
            throw new Error('Unexpected command')
        })

        const result = await new AwsDynamoDbAdapter(client).listNoSqlItems('orders')

        expect(result).toEqual([
            {
                id: '{"accountId":"acct-1","createdAt":1}',
                key: {accountId: 'acct-1', createdAt: 1},
                document: {accountId: 'acct-1', createdAt: 1, active: true},
            },
            {
                id: '{"accountId":"acct-2","createdAt":"9007199254740993"}',
                key: {accountId: 'acct-2', createdAt: '9007199254740993'},
                document: {accountId: 'acct-2', createdAt: '9007199254740993', active: false, roles: ['admin', 'editor']},
            },
        ])
    })

    test('stops scanning after 100 records', async () => {
        let scanCount = 0
        const client = fakeClient(async (command) => {
            if (command instanceof DescribeTableCommand) {
                return {Table: {KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}]}}
            }
            if (command instanceof ScanCommand) {
                scanCount += 1
                expect(command.input.Limit).toBe(100)
                return {
                    Items: Array.from({length: 100}, (_, index) => ({id: {N: String(index)}})),
                    LastEvaluatedKey: {id: {N: '99'}},
                }
            }
            throw new Error('Unexpected command')
        })

        const result = await new AwsDynamoDbAdapter(client).listNoSqlItems('orders')

        expect(result).toHaveLength(100)
        expect(scanCount).toBe(1)
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
