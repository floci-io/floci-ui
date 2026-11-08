import {
    CreateWorkGroupCommand,
    DeleteWorkGroupCommand,
    GetQueryExecutionCommand,
    GetWorkGroupCommand,
    ListQueryExecutionsCommand,
    ListWorkGroupsCommand,
    type AthenaClient,
    type QueryExecution,
    type WorkGroup,
    type WorkGroupSummary,
} from '@aws-sdk/client-athena'
import {AWS_ATHENA_WORKGROUP_MESSAGE, AWS_ATHENA_WORKGROUP_PATTERN, awsAthenaSchema} from '../cloud-spi/athenaSchema'
import {NotSupportedError, ValidationError} from '../cloud-spi/errors'
import {mapWithLimit} from '../concurrency'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'

/**
 * Athena through Floci core, which serves the JSON 1.1 `AmazonAthena` target.
 * Verified against `floci/floci:latest-compat`:
 *
 *   ListWorkGroups, GetWorkGroup, CreateWorkGroup, DeleteWorkGroup
 *   ListQueryExecutions (ids only), GetQueryExecution
 *
 * `BatchGetQueryExecution` is not served, so every query is read with its own
 * `GetQueryExecution`, at most `MAX_QUERIES` of them. Missing workgroups and
 * queries answer `InvalidRequestException` with a "not found" message rather than
 * a distinct error name, so that text is what marks a miss.
 *
 * A workgroup has the id `workgroup:name`, a query execution `query:id`. Queries
 * are history: they cannot be created or deleted from here.
 */

const WORKGROUP_PREFIX = 'workgroup:'
const QUERY_PREFIX = 'query:'
const PRIMARY_WORKGROUP = 'primary'
const WORKGROUP_NAME = new RegExp(AWS_ATHENA_WORKGROUP_PATTERN)
/** Bound on `NextToken` hops, so a runtime that never stops paging cannot hang a request. */
const MAX_PAGES = 100
/** The newest queries kept per list, since each one costs a request. */
const MAX_QUERIES = 100
const DETAIL_CONCURRENCY = 8
const STATEMENT_PREVIEW = 80

export class AwsAthenaAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'analytics' as const

    constructor(private readonly athena: AthenaClient) {}

    schema(): ServiceSchema {
        return awsAthenaSchema()
    }

    descriptorOverride(): {displayName: string} {
        return {displayName: 'Athena'}
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const workGroups = await this.listWorkGroups()
        const queries = await this.listQueries(workGroups.map((workGroup) => workGroup.Name).filter((name): name is string => !!name))
        const resources = [
            ...workGroups.map((workGroup) => workGroupResource(workGroup)),
            ...queries.map((execution) => queryResource(execution)),
        ]
        const search = query.search?.trim().toLowerCase()
        if (!search) return resources
        return resources.filter((resource) => matches(resource, search))
    }

    async get(id: string): Promise<CloudResource | null> {
        if (id.startsWith(WORKGROUP_PREFIX)) {
            const workGroup = await this.loadWorkGroup(id.slice(WORKGROUP_PREFIX.length))
            return workGroup ? workGroupResource(workGroup, true) : null
        }
        if (id.startsWith(QUERY_PREFIX)) {
            const execution = await this.loadQuery(id.slice(QUERY_PREFIX.length))
            return execution ? queryResource(execution, true) : null
        }
        throw new ValidationError(`Unknown Athena id: ${id}`)
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const name = stringValue(input.values.name)
        if (!name) throw new ValidationError('name is required')
        if (!WORKGROUP_NAME.test(name)) throw new ValidationError(AWS_ATHENA_WORKGROUP_MESSAGE)
        const description = stringValue(input.values.description)
        const outputLocation = stringValue(input.values.outputLocation)
        if (outputLocation && !outputLocation.startsWith('s3://')) {
            throw new ValidationError('outputLocation must be an s3:// location')
        }

        await this.athena.send(new CreateWorkGroupCommand({
            Name: name,
            Description: description || undefined,
            Configuration: outputLocation ? {ResultConfiguration: {OutputLocation: outputLocation}} : undefined,
        }))
        const created = await this.loadWorkGroup(name)
        return workGroupResource(created ?? {Name: name, Description: description || undefined}, true)
    }

    async delete(id: string): Promise<void> {
        if (!id.startsWith(WORKGROUP_PREFIX)) {
            throw new NotSupportedError('Only workgroups can be deleted: queries are history.')
        }
        await this.athena.send(new DeleteWorkGroupCommand({WorkGroup: id.slice(WORKGROUP_PREFIX.length)}))
    }

    async health(): Promise<void> {
        await this.athena.send(new ListWorkGroupsCommand({MaxResults: 1}))
    }

    private async listWorkGroups(): Promise<WorkGroupSummary[]> {
        const workGroups: WorkGroupSummary[] = []
        let nextToken: string | undefined
        for (let page = 0; page < MAX_PAGES; page++) {
            const response = await this.athena.send(new ListWorkGroupsCommand({NextToken: nextToken}))
            workGroups.push(...(response.WorkGroups ?? []))
            nextToken = response.NextToken
            if (!nextToken) break
        }
        return workGroups
    }

    /** Ids from every workgroup, since Athena lists only `primary` unless one is named. */
    private async listQueries(workGroups: string[]): Promise<QueryExecution[]> {
        const ids = new Set<string>()
        for (const workGroup of workGroups) {
            let nextToken: string | undefined
            for (let page = 0; page < MAX_PAGES && ids.size < MAX_QUERIES * 5; page++) {
                const response = await this.athena.send(new ListQueryExecutionsCommand({WorkGroup: workGroup, NextToken: nextToken}))
                for (const id of response.QueryExecutionIds ?? []) ids.add(id)
                nextToken = response.NextToken
                if (!nextToken) break
            }
        }
        const executions = await mapWithLimit([...ids].slice(0, MAX_QUERIES), DETAIL_CONCURRENCY, (id) => this.loadQuery(id))
        return executions
            .filter((execution): execution is QueryExecution => execution !== null)
            .sort((left, right) => submitted(right) - submitted(left))
    }

    private async loadWorkGroup(name: string): Promise<WorkGroup | null> {
        try {
            return (await this.athena.send(new GetWorkGroupCommand({WorkGroup: name}))).WorkGroup ?? null
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }

    private async loadQuery(id: string): Promise<QueryExecution | null> {
        try {
            return (await this.athena.send(new GetQueryExecutionCommand({QueryExecutionId: id}))).QueryExecution ?? null
        } catch (error) {
            if (isNotFound(error)) return null
            throw error
        }
    }
}

function workGroupResource(workGroup: WorkGroup | WorkGroupSummary, includeDetails = false): CloudResource {
    const name = workGroup.Name ?? ''
    const configuration = 'Configuration' in workGroup ? workGroup.Configuration : undefined
    return {
        id: `${WORKGROUP_PREFIX}${name}`,
        name,
        cloud: 'aws',
        service: 'analytics',
        type: 'athena-workgroup',
        region: null,
        createdAt: workGroup.CreationTime?.toISOString() ?? null,
        status: workGroup.State ?? null,
        metadata: {
            provider: 'aws',
            description: workGroup.Description,
            workGroup: name,
            outputLocation: configuration?.ResultConfiguration?.OutputLocation,
            engineVersion: ('EngineVersion' in workGroup ? workGroup.EngineVersion : configuration?.EngineVersion)?.EffectiveEngineVersion,
            ...(includeDetails ? {
                enforceWorkGroupConfiguration: configuration?.EnforceWorkGroupConfiguration,
                publishCloudWatchMetricsEnabled: configuration?.PublishCloudWatchMetricsEnabled,
                bytesScannedCutoffPerQuery: configuration?.BytesScannedCutoffPerQuery,
                requesterPaysEnabled: configuration?.RequesterPaysEnabled,
            } : {}),
        },
    }
}

function queryResource(execution: QueryExecution, includeDetails = false): CloudResource {
    const id = execution.QueryExecutionId ?? ''
    const statement = execution.Query ?? ''
    const status = execution.Status
    return {
        id: `${QUERY_PREFIX}${id}`,
        name: statement.replace(/\s+/g, ' ').trim().slice(0, STATEMENT_PREVIEW) || id,
        cloud: 'aws',
        service: 'analytics',
        type: 'athena-query',
        region: null,
        createdAt: status?.SubmissionDateTime?.toISOString() ?? null,
        status: status?.State ?? null,
        metadata: {
            provider: 'aws',
            queryExecutionId: id,
            workGroup: execution.WorkGroup,
            database: execution.QueryExecutionContext?.Database,
            catalog: execution.QueryExecutionContext?.Catalog,
            statementType: execution.StatementType,
            outputLocation: execution.ResultConfiguration?.OutputLocation,
            stateChangeReason: status?.StateChangeReason,
            completedAt: status?.CompletionDateTime?.toISOString(),
            ...(includeDetails ? {
                statement,
                engineExecutionTimeInMillis: execution.Statistics?.EngineExecutionTimeInMillis,
                totalExecutionTimeInMillis: execution.Statistics?.TotalExecutionTimeInMillis,
                queryQueueTimeInMillis: execution.Statistics?.QueryQueueTimeInMillis,
                dataScannedInBytes: execution.Statistics?.DataScannedInBytes,
                engineVersion: execution.EngineVersion?.EffectiveEngineVersion,
            } : {}),
        },
    }
}

function matches(resource: CloudResource, search: string): boolean {
    const metadata = resource.metadata
    return [resource.name, resource.status, resource.type, metadata.workGroup, metadata.database, metadata.queryExecutionId, metadata.description]
        .some((value) => typeof value === 'string' && value.toLowerCase().includes(search))
}

function submitted(execution: QueryExecution): number {
    return execution.Status?.SubmissionDateTime?.getTime() ?? 0
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

/** Athena reports a missing workgroup or query as `InvalidRequestException`, so the message is the only marker. */
function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const value = error as {name?: string; message?: string; $metadata?: {httpStatusCode?: number}}
    if (value.$metadata?.httpStatusCode === 404) return true
    return value.name === 'InvalidRequestException' && /not found/i.test(value.message ?? '')
}
