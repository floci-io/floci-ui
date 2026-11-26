import {lookup} from 'node:dns/promises'
import {isIP} from 'node:net'
import {
    CreateClusterCommand,
    DeleteClusterCommand,
    type DSQLClient,
    GetClusterCommand,
    type GetClusterOutput,
    ListClustersCommand,
    UpdateClusterCommand,
} from '@aws-sdk/client-dsql'
import {DsqlSigner} from '@aws-sdk/dsql-signer'
import {GetSessionTokenCommand, type STSClient} from '@aws-sdk/client-sts'
import {awsClients, endpoint as flociApiEndpoint} from '../aws'
import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {awsDsqlSchema} from '../cloud-spi/dsqlSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
    SqlConnectionInput,
    SqlDatabase,
    SqlQueryResult,
    SqlTable,
    UpdateResourceInput,
} from '../cloud-spi/types'
import type {SqlDataClient, SqlDataConnection} from '../adapter-azure/MssqlDataClient'
import {PostgresDataClient} from '../adapter-azure/PostgresDataClient'

/** DSQL serves every cluster on 5432, with one database, signed in as admin with an IAM token. */
const DSQL_PORT = 5432
const DSQL_DATABASE = 'postgres'
const DSQL_ADMIN = 'admin'
const GET_BATCH_SIZE = 10
const CREDENTIALS_REFRESH_MARGIN_MS = 5 * 60_000

const CURRENT_DATABASE_QUERY = 'SELECT current_database() AS name'
/** The sys schema is DSQL's own, as pg_catalog is PostgreSQL's. */
const LIST_TABLES_QUERY = `
SELECT
    namespace.nspname AS "schemaName",
    relation.relname AS name,
    CASE WHEN relation.relkind IN ('v', 'm') THEN 'view' ELSE 'table' END AS "objectType",
    CASE
        WHEN relation.relkind IN ('r', 'p') AND relation.reltuples >= 0
        THEN relation.reltuples::bigint
        ELSE NULL
    END AS "rowCount"
FROM pg_class AS relation
INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'sys')
  AND namespace.nspname NOT LIKE 'pg_toast%'
  AND relation.relkind IN ('r', 'p', 'v', 'm')
ORDER BY namespace.nspname, relation.relname`

type Resolve = (host: string) => Promise<{address: string}>
type FetchText = (url: string) => Promise<string>

interface SessionCredentials {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
}

/**
 * Aurora DSQL clusters, and the data in them. The SQL explorer signs in as
 * admin with a DbConnectAdmin token, the way every DSQL client does.
 */
export class AwsDsqlAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'dsql' as const

    private sessionCredentials?: {value: SessionCredentials; expiresAt: number}
    private flociCa?: Promise<string>

    constructor(
        private readonly dsql: DSQLClient = awsClients.dsql,
        private readonly sts: STSClient = awsClients.sts,
        private readonly flociEndpoint: string | null = flociApiEndpoint,
        private readonly dataClient: SqlDataClient = new PostgresDataClient(),
        private readonly resolve: Resolve = (host) => lookup(host),
        private readonly fetchText: FetchText = readText,
    ) {}

    schema(): ServiceSchema {
        return awsDsqlSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const identifiers = await this.listClusterIdentifiers()

        const resources: CloudResource[] = []
        for (let index = 0; index < identifiers.length; index += GET_BATCH_SIZE) {
            const batch = identifiers.slice(index, index + GET_BATCH_SIZE)
            const clusters = await Promise.all(batch.map((identifier) => this.get(identifier)))
            resources.push(...clusters.filter((cluster): cluster is CloudResource => cluster !== null))
        }
        return filterBySearch(resources, query.search)
    }

    async count(query: ResourceQuery = {}): Promise<number> {
        if (query.search) return (await this.list(query)).length
        return (await this.listClusterIdentifiers()).length
    }

    private async listClusterIdentifiers(): Promise<string[]> {
        const identifiers: string[] = []
        let nextToken: string | undefined
        do {
            const page = await this.dsql.send(new ListClustersCommand(nextToken ? {nextToken} : {}))
            identifiers.push(...(page.clusters ?? []).flatMap((cluster) => cluster.identifier ? [cluster.identifier] : []))
            nextToken = page.nextToken
        } while (nextToken)
        return identifiers
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            return clusterResource(await this.dsql.send(new GetClusterCommand({identifier: id})))
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = stringValue(input.values.name)
        const created = await this.dsql.send(new CreateClusterCommand({
            deletionProtectionEnabled: requiredBoolean(input.values.deletionProtectionEnabled, 'deletionProtectionEnabled'),
            ...(name ? {tags: {Name: name}} : {}),
        }))
        if (!created.identifier) throw new RuntimeError('Aurora DSQL did not return the new cluster\'s identifier')
        return (await this.get(created.identifier)) ?? clusterResource({...created, tags: name ? {Name: name} : undefined})
    }

    async update(id: string, input: UpdateResourceInput): Promise<CloudResource> {
        const deletionProtectionEnabled = optionalBoolean(input.values?.deletionProtectionEnabled, 'deletionProtectionEnabled')
        if (deletionProtectionEnabled !== undefined) {
            await this.dsql.send(new UpdateClusterCommand({identifier: id, deletionProtectionEnabled}))
        }
        const cluster = await this.get(id)
        if (!cluster) throw new NotFoundError(`Aurora DSQL cluster ${id} not found`)
        return cluster
    }

    async delete(id: string): Promise<void> {
        await this.dsql.send(new DeleteClusterCommand({identifier: id}))
    }

    async health(): Promise<void> {
        await this.dsql.send(new ListClustersCommand({maxResults: 1}))
    }

    async listSqlDatabases(clusterId: string, connection: SqlConnectionInput): Promise<SqlDatabase[]> {
        const result = await this.querySql(clusterId, connection, CURRENT_DATABASE_QUERY)
        return (result.resultSets[0]?.rows ?? []).flatMap((row) => {
            const name = stringValue(row.name)
            return name ? [{name, state: 'ONLINE', createdAt: null, isSystem: false}] : []
        })
    }

    async listSqlTables(clusterId: string, connection: SqlConnectionInput): Promise<SqlTable[]> {
        const result = await this.querySql(clusterId, connection, LIST_TABLES_QUERY)
        return (result.resultSets[0]?.rows ?? []).flatMap((row) => {
            const schema = stringValue(row.schemaName)
            const name = stringValue(row.name)
            if (!schema || !name) return []
            return [{
                schema,
                name,
                type: row.objectType === 'view' ? 'view' as const : 'table' as const,
                rowCount: integerValue(row.rowCount),
            }]
        })
    }

    /** Credentials are not asked for: the token is the password, as DSQL's own clients sign it. */
    async querySql(clusterId: string, _connection: SqlConnectionInput, query: string): Promise<SqlQueryResult> {
        if (!query.trim()) throw new ValidationError('SQL query is required')
        return this.dataClient.query(await this.dataConnection(clusterId), query)
    }

    private async dataConnection(clusterId: string): Promise<SqlDataConnection> {
        const cluster = await this.get(clusterId)
        if (!cluster) throw new NotFoundError('Aurora DSQL cluster not found')
        const endpoint = stringValue(cluster.metadata.endpoint)
        if (!endpoint || !cluster.region) throw new RuntimeError('Aurora DSQL cluster endpoint is not available')

        const signer = new DsqlSigner({
            hostname: endpoint,
            region: cluster.region,
            credentials: await this.signingCredentials(),
        })
        return {
            server: await this.serverAddress(endpoint),
            port: DSQL_PORT,
            database: DSQL_DATABASE,
            username: DSQL_ADMIN,
            password: await signer.getDbConnectAdminAuthToken(),
            // TLS is mandatory on DSQL, and the token is the admin's password, so
            // the server is always verified for the endpoint's name: against
            // Floci's CA when Floci serves the cluster, the system's otherwise.
            tlsMode: 'verify',
            tlsServerName: endpoint,
            ...(this.flociEndpoint ? {tlsCa: await this.flociCertificateAuthority()} : {}),
        }
    }

    /** Floci's CA, which signs its DSQL endpoints' certificate, as Floci serves it. */
    private flociCertificateAuthority(): Promise<string> {
        if (!this.flociCa) {
            const url = new URL('/_floci/ca.pem', this.flociEndpoint ?? undefined).toString()
            this.flociCa = this.fetchText(url).catch((error: unknown) => {
                this.flociCa = undefined
                throw new RuntimeError(`Could not read Floci's CA from ${url}`, {cause: error})
            })
        }
        return this.flociCa
    }

    /**
     * Floci serves every cluster on its own address and tells them apart by the
     * TLS server name, as DSQL's endpoints are told apart by DNS; a console in
     * Floci's network cannot resolve the endpoint's public name to Floci. The
     * connection therefore goes to Floci's address, as an IP: pg sends the host
     * it dials as the server name whenever that host is a name, which would
     * replace the endpoint's. With no Floci endpoint the endpoint is dialled.
     */
    private async serverAddress(endpoint: string): Promise<string> {
        if (!this.flociEndpoint) return endpoint
        const host = new URL(this.flociEndpoint).hostname.replace(/^\[|\]$/g, '')
        return isIP(host) ? host : (await this.resolve(host)).address
    }

    /**
     * Floci checks a token's signature as DSQL does, against a key it issued, and
     * the console's own access key is an account id it never issued. Session
     * credentials from STS are a key Floci knows, for the same account.
     */
    private async signingCredentials(): Promise<SessionCredentials> {
        const cached = this.sessionCredentials
        if (cached && cached.expiresAt - Date.now() > CREDENTIALS_REFRESH_MARGIN_MS) return cached.value

        const response = await this.sts.send(new GetSessionTokenCommand({}))
        const credentials = response.Credentials
        if (!credentials?.AccessKeyId || !credentials.SecretAccessKey) {
            throw new RuntimeError('STS returned no session credentials to sign the Aurora DSQL token with')
        }
        const value: SessionCredentials = {
            accessKeyId: credentials.AccessKeyId,
            secretAccessKey: credentials.SecretAccessKey,
            sessionToken: credentials.SessionToken,
        }
        this.sessionCredentials = {value, expiresAt: credentials.Expiration?.getTime() ?? Date.now()}
        return value
    }
}

function clusterResource(cluster: Partial<GetClusterOutput>): CloudResource {
    const identifier = cluster.identifier ?? ''
    const nameTag = cluster.tags?.Name
    return {
        id: identifier,
        name: nameTag || identifier,
        cloud: 'aws',
        service: 'dsql',
        type: 'dsql-cluster',
        region: regionFromArn(cluster.arn),
        createdAt: cluster.creationTime?.toISOString() ?? null,
        status: cluster.status ?? null,
        metadata: {
            provider: 'aws',
            arn: cluster.arn,
            endpoint: cluster.endpoint,
            deletionProtectionEnabled: cluster.deletionProtectionEnabled,
            encryptionType: cluster.encryptionDetails?.encryptionType,
            encryptionStatus: cluster.encryptionDetails?.encryptionStatus,
            tags: Object.entries(cluster.tags ?? {}).map(([key, value]) => ({key, value})),
        },
    }
}

function requiredBoolean(value: unknown, field: string): boolean {
    const parsed = optionalBoolean(value, field)
    if (parsed === undefined) throw new ValidationError(`${field} is required`)
    return parsed
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
    throw new ValidationError(`${field} must be true or false`)
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function integerValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
    return null
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) =>
        resource.name.toLowerCase().includes(normalized) || resource.id.toLowerCase().includes(normalized))
}

function regionFromArn(arn?: string): string | null {
    return arn?.split(':')[3] || null
}

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const candidate = error as {name?: string; $metadata?: {httpStatusCode?: number}}
    return candidate.name === 'ResourceNotFoundException' || candidate.$metadata?.httpStatusCode === 404
}

async function readText(url: string): Promise<string> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url} answered ${response.status}`)
    return response.text()
}
