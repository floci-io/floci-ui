import {describe, expect, test} from 'bun:test'
import {
    CreateClusterCommand,
    DeleteClusterCommand,
    type DSQLClient,
    GetClusterCommand,
    ListClustersCommand,
    UpdateClusterCommand,
} from '@aws-sdk/client-dsql'
import {GetSessionTokenCommand, type STSClient} from '@aws-sdk/client-sts'
import {endpoint} from '../aws'
import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import type {SqlQueryResult} from '../cloud-spi/types'
import type {SqlDataClient, SqlDataConnection} from '../adapter-azure/MssqlDataClient'
import {AwsDsqlAdapter} from './AwsDsqlAdapter'

type SendHandler = (command: unknown) => Promise<unknown>

const IDENTIFIER = 'abcdefghijklmnopqrstuvwxyz'
const ENDPOINT = `${IDENTIFIER}.dsql.us-east-1.localhost.floci.io`

function cluster(identifier = IDENTIFIER, overrides: Record<string, unknown> = {}) {
    return {
        identifier,
        arn: `arn:aws:dsql:us-east-1:000000000000:cluster/${identifier}`,
        status: 'ACTIVE',
        creationTime: new Date('2026-10-16T15:49:38.488Z'),
        deletionProtectionEnabled: true,
        tags: {Name: 'orders'},
        encryptionDetails: {encryptionType: 'AWS_OWNED_KMS_KEY', encryptionStatus: 'ENABLED'},
        endpoint: `${identifier}.dsql.us-east-1.localhost.floci.io`,
        ...overrides,
    }
}

const FLOCI_CA = '-----BEGIN CERTIFICATE-----\nfloci\n-----END CERTIFICATE-----\n'

const SESSION = {
    Credentials: {
        AccessKeyId: 'ASIAEXAMPLESESSION01',
        SecretAccessKey: 'session-secret',
        SessionToken: 'session-token',
        Expiration: new Date(Date.now() + 12 * 3_600_000),
    },
}

describe('AwsDsqlAdapter', () => {
    test('serves Aurora DSQL as its own AWS service', () => {
        const adapter = createAdapter()

        expect(adapter.cloud).toBe('aws')
        expect(adapter.service).toBe('dsql')
        expect(adapter.schema()).toMatchObject({cloud: 'aws', service: 'dsql', displayName: 'Aurora DSQL'})
        expect(adapter.schema().actions).toEqual(['list', 'create', 'update', 'inspect', 'delete'])
    })

    test('builds with its defaults, as the registry builds it', () => {
        expect(new AwsDsqlAdapter().schema().service).toBe('dsql')
    })

    test('lists every page of clusters and reads each one', async () => {
        const tokens: Array<string | undefined> = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListClustersCommand) {
                tokens.push(command.input.nextToken)
                return command.input.nextToken
                    ? {clusters: [{identifier: 'bbbbbbbbbbbbbbbbbbbbbbbbbb'}]}
                    : {clusters: [{identifier: IDENTIFIER}], nextToken: 'page-2'}
            }
            if (command instanceof GetClusterCommand) return cluster(command.input.identifier, {tags: {}})
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        const resources = await adapter.list()

        expect(tokens).toEqual([undefined, 'page-2'])
        expect(resources.map((resource) => resource.id)).toEqual([IDENTIFIER, 'bbbbbbbbbbbbbbbbbbbbbbbbbb'])
        expect(resources[0]).toMatchObject({
            name: IDENTIFIER,
            type: 'dsql-cluster',
            region: 'us-east-1',
            status: 'ACTIVE',
            createdAt: '2026-10-16T15:49:38.488Z',
            metadata: {endpoint: ENDPOINT, deletionProtectionEnabled: true, encryptionType: 'AWS_OWNED_KMS_KEY'},
        })
    })

    test('counts clusters without describing each one, but falls back to list for search', async () => {
        let getCalls = 0
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListClustersCommand) return {clusters: [{identifier: IDENTIFIER}]}
            if (command instanceof GetClusterCommand) {
                getCalls++
                return cluster(command.input.identifier, {tags: {Name: 'orders'}})
            }
            throw new Error(`Unexpected command: ${command?.constructor?.name}`)
        })

        await expect(adapter.count()).resolves.toBe(1)
        expect(getCalls).toBe(0)

        await expect(adapter.count({search: 'orders'})).resolves.toBe(1)
        expect(getCalls).toBe(1)
    })

    test('names a cluster after its Name tag and finds it by either', async () => {
        const adapter = createAdapter(async (command) => {
            if (command instanceof ListClustersCommand) return {clusters: [{identifier: IDENTIFIER}]}
            if (command instanceof GetClusterCommand) return cluster()
            return {}
        })

        await expect(adapter.list({search: 'ORD'})).resolves.toMatchObject([
            {id: IDENTIFIER, name: 'orders', metadata: {tags: [{key: 'Name', value: 'orders'}]}},
        ])
        await expect(adapter.list({search: 'abcdef'})).resolves.toHaveLength(1)
        await expect(adapter.list({search: 'billing'})).resolves.toHaveLength(0)
    })

    test('answers null for a cluster that does not exist', async () => {
        const adapter = createAdapter(async () => {
            throw Object.assign(new Error('gone'), {name: 'ResourceNotFoundException'})
        })

        await expect(adapter.get(IDENTIFIER)).resolves.toBeNull()
    })

    test('creates a cluster with the protection chosen and the Name tag given', async () => {
        const inputs: unknown[] = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof CreateClusterCommand) {
                inputs.push(command.input)
                return {identifier: IDENTIFIER, arn: cluster().arn, status: 'CREATING', deletionProtectionEnabled: false}
            }
            if (command instanceof GetClusterCommand) return cluster(IDENTIFIER, {status: 'CREATING', deletionProtectionEnabled: false})
            return {}
        })

        const created = await adapter.create({values: {deletionProtectionEnabled: 'false', name: 'orders'}})

        expect(inputs).toEqual([{deletionProtectionEnabled: false, tags: {Name: 'orders'}}])
        expect(created).toMatchObject({id: IDENTIFIER, status: 'CREATING'})
    })

    test('refuses a protection that is neither true nor false', async () => {
        const adapter = createAdapter()

        await expect(adapter.create({values: {deletionProtectionEnabled: 'maybe'}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.create({values: {}})).rejects.toBeInstanceOf(ValidationError)
    })

    test('updates deletion protection, and deletes', async () => {
        const sent: unknown[] = []
        const adapter = createAdapter(async (command) => {
            if (command instanceof UpdateClusterCommand || command instanceof DeleteClusterCommand) {
                sent.push(command.input)
                return {}
            }
            if (command instanceof GetClusterCommand) return cluster(IDENTIFIER, {deletionProtectionEnabled: false})
            return {}
        })

        await expect(adapter.update(IDENTIFIER, {values: {deletionProtectionEnabled: 'false'}}))
            .resolves.toMatchObject({metadata: {deletionProtectionEnabled: false}})
        await adapter.delete(IDENTIFIER)

        expect(sent).toEqual([{identifier: IDENTIFIER, deletionProtectionEnabled: false}, {identifier: IDENTIFIER}])
    })

    test('queries the cluster as admin with a DbConnectAdmin token, through Floci, naming the endpoint', async () => {
        const data = new RecordingDataClient()
        const resolved: string[] = []
        const adapter = createAdapter(clusterOnly, sessionOnly, 'http://floci:4566', data, async (host) => {
            resolved.push(host)
            return {address: '172.19.0.2'}
        })

        await adapter.querySql(IDENTIFIER, {}, 'SELECT 1')

        expect(resolved).toEqual(['floci'])
        const connection = data.connections[0]
        expect(connection).toMatchObject({
            server: '172.19.0.2',
            port: 5432,
            database: 'postgres',
            username: 'admin',
            tlsMode: 'verify',
            tlsServerName: ENDPOINT,
            tlsCa: FLOCI_CA,
        })
        const token = new URL(`https://${connection.password}`)
        expect(token.hostname).toBe(ENDPOINT)
        expect(token.searchParams.get('Action')).toBe('DbConnectAdmin')
        expect(token.searchParams.get('X-Amz-Credential')).toStartWith('ASIAEXAMPLESESSION01/')
        expect(token.searchParams.get('X-Amz-Credential')).toContain('/us-east-1/dsql/aws4_request')
        expect(token.searchParams.get('X-Amz-Security-Token')).toBe('session-token')
    })

    test('dials the endpoint itself when no Floci endpoint is configured, and an IP host as it is', async () => {
        const direct = new RecordingDataClient()
        await createAdapter(clusterOnly, sessionOnly, null, direct).querySql(IDENTIFIER, {}, 'SELECT 1')
        const byAddress = new RecordingDataClient()
        await createAdapter(clusterOnly, sessionOnly, 'http://127.0.0.1:4566', byAddress, async () => {
            throw new Error('an IP needs no lookup')
        }).querySql(IDENTIFIER, {}, 'SELECT 1')

        expect(direct.connections[0]).toMatchObject({server: ENDPOINT, tlsMode: 'verify', tlsServerName: ENDPOINT})
        expect(direct.connections[0].tlsCa).toBeUndefined()
        expect(byAddress.connections[0].server).toBe('127.0.0.1')
    })

    test('verifies the server against Floci\'s CA, read once from Floci, and fails when it cannot', async () => {
        const fetched: string[] = []
        const adapter = createAdapter(clusterOnly, sessionOnly, 'http://floci:4566', new RecordingDataClient(),
            undefined, async (url) => {
                fetched.push(url)
                return FLOCI_CA
            })
        await adapter.querySql(IDENTIFIER, {}, 'SELECT 1')
        await adapter.querySql(IDENTIFIER, {}, 'SELECT 2')
        const unreachable = createAdapter(clusterOnly, sessionOnly, 'http://floci:4566', new RecordingDataClient(),
            undefined, async () => {
                throw new Error('connection refused')
            })

        expect(fetched).toEqual(['http://floci:4566/_floci/ca.pem'])
        await expect(unreachable.querySql(IDENTIFIER, {}, 'SELECT 1')).rejects.toBeInstanceOf(RuntimeError)
    })

    test('reaches Floci at the API\'s own endpoint by default, so FLOCI_ENDPOINT may be left unset', async () => {
        const fetched: string[] = []
        const data = new RecordingDataClient()
        const adapter = new AwsDsqlAdapter(
            {send: clusterOnly} as unknown as DSQLClient,
            {send: sessionOnly} as unknown as STSClient,
            undefined,
            data,
            async () => ({address: '127.0.0.1'}),
            async (url) => {
                fetched.push(url)
                return FLOCI_CA
            },
        )

        await adapter.querySql(IDENTIFIER, {}, 'SELECT 1')

        expect(fetched).toEqual([new URL('/_floci/ca.pem', endpoint).toString()])
        expect(data.connections[0]).toMatchObject({server: '127.0.0.1', tlsServerName: ENDPOINT, tlsCa: FLOCI_CA})
    })

    test('asks STS for session credentials once while they are fresh', async () => {
        let sessions = 0
        const adapter = createAdapter(clusterOnly, async (command) => {
            if (command instanceof GetSessionTokenCommand) sessions += 1
            return SESSION
        }, null, new RecordingDataClient())

        await adapter.querySql(IDENTIFIER, {}, 'SELECT 1')
        await adapter.querySql(IDENTIFIER, {}, 'SELECT 2')

        expect(sessions).toBe(1)
    })

    test('lists the one database and the tables outside DSQL\'s own schemas', async () => {
        const data = new RecordingDataClient((query) => query.includes('current_database()')
            ? [{name: 'postgres'}]
            : [{schemaName: 'public', name: 'orders', objectType: 'table', rowCount: '3'},
                {schemaName: 'public', name: 'open_orders', objectType: 'view', rowCount: null}])
        const adapter = createAdapter(clusterOnly, sessionOnly, null, data)

        await expect(adapter.listSqlDatabases(IDENTIFIER, {})).resolves.toEqual([
            {name: 'postgres', state: 'ONLINE', createdAt: null, isSystem: false},
        ])
        await expect(adapter.listSqlTables(IDENTIFIER, {})).resolves.toEqual([
            {schema: 'public', name: 'orders', type: 'table', rowCount: 3},
            {schema: 'public', name: 'open_orders', type: 'view', rowCount: null},
        ])
        expect(data.queries[1]).toContain("NOT IN ('pg_catalog', 'information_schema', 'sys')")
    })

    test('refuses an empty query and a cluster that does not exist', async () => {
        const adapter = createAdapter(async () => {
            throw Object.assign(new Error('gone'), {name: 'ResourceNotFoundException'})
        }, sessionOnly, null, new RecordingDataClient())

        await expect(adapter.querySql(IDENTIFIER, {}, '  ')).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.querySql(IDENTIFIER, {}, 'SELECT 1')).rejects.toBeInstanceOf(NotFoundError)
    })
})

class RecordingDataClient implements SqlDataClient {
    readonly connections: SqlDataConnection[] = []
    readonly queries: string[] = []

    constructor(private readonly rows: (query: string) => Array<Record<string, unknown>> = () => []) {}

    async query(connection: SqlDataConnection, query: string): Promise<SqlQueryResult> {
        this.connections.push(connection)
        this.queries.push(query)
        const rows = this.rows(query)
        return {
            resultSets: [{columns: Object.keys(rows[0] ?? {}).map((name) => ({name, type: 'text'})), rows, truncated: false}],
            rowsAffected: [rows.length],
            durationMs: 1,
        }
    }
}

async function clusterOnly(command: unknown): Promise<unknown> {
    if (command instanceof GetClusterCommand) return cluster()
    throw new Error(`Unexpected command: ${command?.constructor?.name}`)
}

async function sessionOnly(): Promise<unknown> {
    return SESSION
}

function createAdapter(
    handler: SendHandler = async () => ({clusters: []}),
    stsHandler: SendHandler = sessionOnly,
    flociEndpoint: string | null = null,
    dataClient: SqlDataClient = new RecordingDataClient(),
    resolve: (host: string) => Promise<{address: string}> = async () => ({address: '127.0.0.1'}),
    fetchCa: (url: string) => Promise<string> = async () => FLOCI_CA,
): AwsDsqlAdapter {
    return new AwsDsqlAdapter(
        {send: handler} as unknown as DSQLClient,
        {send: stsHandler} as unknown as STSClient,
        flociEndpoint,
        dataClient,
        resolve,
        fetchCa,
    )
}
