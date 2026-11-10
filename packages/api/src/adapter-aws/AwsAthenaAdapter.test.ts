import {describe, expect, test} from 'bun:test'
import {
    CreateWorkGroupCommand,
    DeleteWorkGroupCommand,
    GetQueryExecutionCommand,
    GetWorkGroupCommand,
    ListQueryExecutionsCommand,
    ListWorkGroupsCommand,
    type AthenaClient,
    type QueryExecution,
} from '@aws-sdk/client-athena'
import {AwsAthenaAdapter} from './AwsAthenaAdapter'
import {NotSupportedError, ValidationError} from '../cloud-spi/errors'

type SendHandler = (command: unknown) => Promise<unknown>

function createAdapter(send: SendHandler = async () => ({})) {
    return new AwsAthenaAdapter({send} as unknown as AthenaClient)
}

function notFound(message: string): Error {
    return Object.assign(new Error(message), {name: 'InvalidRequestException', $metadata: {httpStatusCode: 400}})
}

function execution(id: string, query: string, submitted: string, state = 'SUCCEEDED', extra: Partial<QueryExecution> = {}): QueryExecution {
    return {
        QueryExecutionId: id,
        Query: query,
        WorkGroup: 'primary',
        StatementType: 'DML',
        QueryExecutionContext: {Database: 'default', Catalog: 'AwsDataCatalog'},
        ResultConfiguration: {OutputLocation: `s3://results/${id}.csv`},
        Status: {State: state as 'SUCCEEDED', SubmissionDateTime: new Date(submitted)},
        Statistics: {EngineExecutionTimeInMillis: 12, DataScannedInBytes: 2048},
        ...extra,
    }
}

const QUERIES: Record<string, QueryExecution> = {
    a: execution('a', 'SELECT 1', '2026-11-08T10:00:00Z'),
    b: execution('b', 'SELECT\n  *   FROM orders', '2026-11-08T11:00:00Z', 'FAILED', {
        Status: {State: 'FAILED', StateChangeReason: 'boom', SubmissionDateTime: new Date('2026-11-08T11:00:00Z')},
    }),
}

function runtime(): SendHandler {
    return async (command) => {
        if (command instanceof ListWorkGroupsCommand) {
            return {WorkGroups: [{Name: 'primary', State: 'ENABLED'}, {Name: 'etl', State: 'ENABLED', Description: 'nightly jobs'}]}
        }
        if (command instanceof ListQueryExecutionsCommand) return {QueryExecutionIds: ['a', 'b']}
        if (command instanceof GetQueryExecutionCommand) {
            const found = QUERIES[command.input.QueryExecutionId ?? '']
            if (!found) throw notFound(`Query execution not found: ${command.input.QueryExecutionId}`)
            return {QueryExecution: found}
        }
        if (command instanceof GetWorkGroupCommand) {
            if (command.input.WorkGroup === 'missing') throw notFound('WorkGroup missing is not found.')
            return {
                WorkGroup: {
                    Name: command.input.WorkGroup,
                    State: 'ENABLED',
                    Description: 'nightly jobs',
                    CreationTime: new Date('2026-11-01T00:00:00Z'),
                    Configuration: {
                        ResultConfiguration: {OutputLocation: 's3://results/etl/'},
                        EnforceWorkGroupConfiguration: true,
                        EngineVersion: {EffectiveEngineVersion: 'Athena engine version 3'},
                    },
                },
            }
        }
        return {}
    }
}

describe('AwsAthenaAdapter', () => {
    test('fills the analytics category for AWS as Athena', () => {
        const adapter = createAdapter()

        expect(adapter.schema()).toMatchObject({cloud: 'aws', service: 'analytics', displayName: 'Athena'})
        expect(adapter.descriptorOverride()).toEqual({displayName: 'Athena'})
        expect(adapter.schema().actions).toEqual(['list', 'create', 'inspect', 'delete'])
    })

    test('lists workgroups then queries, newest query first, with the statement collapsed to one line', async () => {
        const rows = await createAdapter(runtime()).list()

        expect(rows.map((row) => row.id)).toEqual(['workgroup:primary', 'workgroup:etl', 'query:b', 'query:a'])
        expect(rows[1]).toMatchObject({type: 'athena-workgroup', status: 'ENABLED', metadata: {description: 'nightly jobs'}})
        expect(rows[2]).toMatchObject({
            name: 'SELECT * FROM orders',
            type: 'athena-query',
            status: 'FAILED',
            createdAt: '2026-11-08T11:00:00.000Z',
            metadata: {workGroup: 'primary', database: 'default', stateChangeReason: 'boom'},
        })
    })

    test('lists the queries of every workgroup once, even if the runtime ignores the workgroup filter', async () => {
        const workGroups: Array<string | undefined> = []
        const send = runtime()
        const rows = await createAdapter(async (command) => {
            if (command instanceof ListQueryExecutionsCommand) workGroups.push(command.input.WorkGroup)
            return send(command)
        }).list()

        expect(workGroups).toEqual(['primary', 'etl'])
        expect(rows.filter((row) => row.type === 'athena-query')).toHaveLength(2)
    })

    test('follows the continuation tokens of workgroups and query ids', async () => {
        const send = runtime()
        const rows = await createAdapter(async (command) => {
            if (command instanceof ListWorkGroupsCommand) {
                return command.input.NextToken
                    ? {WorkGroups: [{Name: 'two', State: 'ENABLED'}]}
                    : {WorkGroups: [{Name: 'one', State: 'ENABLED'}], NextToken: 'next'}
            }
            if (command instanceof ListQueryExecutionsCommand) {
                return command.input.NextToken ? {QueryExecutionIds: ['b']} : {QueryExecutionIds: ['a'], NextToken: 'more'}
            }
            return send(command)
        }).list()

        expect(rows.filter((row) => row.type === 'athena-workgroup').map((row) => row.name)).toEqual(['one', 'two'])
        expect(rows.filter((row) => row.type === 'athena-query').map((row) => row.id)).toEqual(['query:b', 'query:a'])
    })

    test('keeps the newest query of a later workgroup when an earlier one holds 100 older ones', async () => {
        const older = Array.from({length: 100}, (_, index) => `old-${index}`)
        const rows = await createAdapter(async (command) => {
            if (command instanceof ListWorkGroupsCommand) return {WorkGroups: [{Name: 'primary'}, {Name: 'etl'}]}
            if (command instanceof ListQueryExecutionsCommand) {
                return {QueryExecutionIds: command.input.WorkGroup === 'primary' ? older : ['fresh']}
            }
            if (command instanceof GetQueryExecutionCommand) {
                const id = command.input.QueryExecutionId ?? ''
                return {QueryExecution: execution(id, `SELECT '${id}'`, id === 'fresh' ? '2026-11-09T00:00:00Z' : '2026-11-01T00:00:00Z')}
            }
            return {}
        }).list()

        const queries = rows.filter((row) => row.type === 'athena-query')
        expect(queries).toHaveLength(100)
        expect(queries[0].id).toBe('query:fresh')
    })

    test('reads past 500 ids so a later workgroup is still listed', async () => {
        const workGroups: Array<string | undefined> = []
        const rows = await createAdapter(async (command) => {
            if (command instanceof ListWorkGroupsCommand) {
                return {WorkGroups: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((Name) => ({Name}))}
            }
            if (command instanceof ListQueryExecutionsCommand) {
                workGroups.push(command.input.WorkGroup)
                const own = command.input.WorkGroup ?? ''
                return {QueryExecutionIds: Array.from({length: 100}, (_, index) => `${own}-${index}`)}
            }
            if (command instanceof GetQueryExecutionCommand) {
                const id = command.input.QueryExecutionId ?? ''
                return {QueryExecution: execution(id, 'SELECT 1', id.startsWith('w6') ? '2026-11-09T00:00:00Z' : '2026-11-01T00:00:00Z')}
            }
            return {}
        }).list()

        expect(workGroups).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6'])
        expect(rows.filter((row) => row.type === 'athena-query')[0].id.startsWith('query:w6')).toBe(true)
    })

    test('is empty when there are no workgroups and no queries', async () => {
        const rows = await createAdapter(async (command) => {
            if (command instanceof ListWorkGroupsCommand) return {WorkGroups: []}
            return {}
        }).list()

        expect(rows).toEqual([])
    })

    test('searches by statement, state, workgroup and kind', async () => {
        const adapter = createAdapter(runtime())

        expect((await adapter.list({search: 'orders'})).map((row) => row.id)).toEqual(['query:b'])
        expect((await adapter.list({search: 'failed'})).map((row) => row.id)).toEqual(['query:b'])
        expect((await adapter.list({search: 'nightly'})).map((row) => row.id)).toEqual(['workgroup:etl'])
        expect((await adapter.list({search: 'nothing-matches'}))).toEqual([])
    })

    test('searches the whole statement, not only its shortened name', async () => {
        const statement = `SELECT ${'x, '.repeat(60)}needle_column FROM orders`
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListWorkGroupsCommand) return {WorkGroups: [{Name: 'primary'}]}
            if (command instanceof ListQueryExecutionsCommand) return {QueryExecutionIds: ['long']}
            if (command instanceof GetQueryExecutionCommand) return {QueryExecution: execution('long', statement, '2026-11-08T10:00:00Z')}
            return {}
        })

        const rows = await adapter.list({search: 'needle_column'})

        expect(rows.map((row) => row.id)).toEqual(['query:long'])
        expect(rows[0].name.length).toBeLessThanOrEqual(80)
        expect(rows[0].name).not.toContain('needle_column')
    })

    test('inspects a query with its statement, state, timings and output location', async () => {
        const row = await createAdapter(runtime()).get('query:b')

        expect(row).toMatchObject({id: 'query:b', status: 'FAILED'})
        expect(row?.metadata).toMatchObject({
            statement: 'SELECT\n  *   FROM orders',
            outputLocation: 's3://results/b.csv',
            engineExecutionTimeInMillis: 12,
            dataScannedInBytes: 2048,
            stateChangeReason: 'boom',
        })
    })

    test('inspects a workgroup with its configuration', async () => {
        const row = await createAdapter(runtime()).get('workgroup:etl')

        expect(row).toMatchObject({name: 'etl', status: 'ENABLED', createdAt: '2026-11-01T00:00:00.000Z'})
        expect(row?.metadata).toMatchObject({
            outputLocation: 's3://results/etl/',
            enforceWorkGroupConfiguration: true,
            engineVersion: 'Athena engine version 3',
        })
    })

    test('returns null for a workgroup or query the runtime reports as not found', async () => {
        const adapter = createAdapter(runtime())

        expect(await adapter.get('workgroup:missing')).toBeNull()
        expect(await adapter.get('query:nope')).toBeNull()
    })

    test('rethrows other failures instead of reporting a miss', async () => {
        const adapter = createAdapter(async () => {
            throw Object.assign(new Error('boom'), {name: 'InternalServerException', $metadata: {httpStatusCode: 500}})
        })

        await expect(adapter.get('query:a')).rejects.toThrow('boom')
    })

    test('rejects an id it does not own', async () => {
        await expect(createAdapter().get('bucket:x')).rejects.toBeInstanceOf(ValidationError)
    })

    test('creates a workgroup with a result location and returns it as read back', async () => {
        const inputs: unknown[] = []
        const send = runtime()
        const row = await createAdapter(async (command) => {
            if (command instanceof CreateWorkGroupCommand) inputs.push(command.input)
            return send(command)
        }).create({values: {name: ' etl ', description: 'nightly jobs', outputLocation: 's3://results/etl/'}})

        expect(inputs).toEqual([{
            Name: 'etl',
            Description: 'nightly jobs',
            Configuration: {ResultConfiguration: {OutputLocation: 's3://results/etl/'}},
        }])
        expect(row).toMatchObject({id: 'workgroup:etl', type: 'athena-workgroup'})
    })

    test('creates a workgroup with only a name', async () => {
        const inputs: Array<{Configuration?: unknown; Description?: unknown}> = []
        await createAdapter(async (command) => {
            if (command instanceof CreateWorkGroupCommand) inputs.push(command.input)
            return {}
        }).create({values: {name: 'plain'}})

        expect(inputs[0].Configuration).toBeUndefined()
        expect(inputs[0].Description).toBeUndefined()
    })

    test('rejects a workgroup with no name, a bad name or a non S3 location before calling the runtime', async () => {
        let calls = 0
        const adapter = createAdapter(async () => { calls++; return {} })

        await expect(adapter.create({values: {}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {name: 'has space'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {name: 'ok', outputLocation: 'https://x/y'}})).rejects.toBeInstanceOf(ValidationError)
        expect(calls).toBe(0)
    })

    test('deletes a workgroup by name', async () => {
        const inputs: unknown[] = []
        await createAdapter(async (command) => {
            if (command instanceof DeleteWorkGroupCommand) inputs.push(command.input)
            return {}
        }).delete('workgroup:etl')

        expect(inputs).toEqual([{WorkGroup: 'etl'}])
    })

    test('refuses to delete a query, which is history', async () => {
        await expect(createAdapter().delete('query:a')).rejects.toBeInstanceOf(NotSupportedError)
    })

    test('probes health with a one item workgroup list', async () => {
        const inputs: unknown[] = []
        await createAdapter(async (command) => {
            if (command instanceof ListWorkGroupsCommand) inputs.push(command.input)
            return {}
        }).health()

        expect(inputs).toEqual([{MaxResults: 1}])
    })
})
