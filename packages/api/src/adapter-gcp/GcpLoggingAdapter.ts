import type {CollectionPage, ChildItem, ItemStoreAdapter, PageQuery} from '../cloud-spi/childCollections'
import {NotSupportedError, ValidationError} from '../cloud-spi/errors'
import {gcpLogsSchema} from '../cloud-spi/logsSchema'
import type {CloudResource, CloudServiceAdapter, CreateResourceInput, ResourceQuery, ServiceSchema} from '../cloud-spi/types'
import {gcp, type GcpRuntimeClient} from '../gcp'

interface LogEntry {
    insertId?: string
    timestamp?: string
    receiveTimestamp?: string
    severity?: string
    textPayload?: string
    jsonPayload?: unknown
    resource?: {type?: string; labels?: Record<string, string>}
    labels?: Record<string, string>
}

interface LogEntryPage {
    entries?: LogEntry[]
    nextPageToken?: string
}

interface LogListPage {
    logNames?: string[]
    nextPageToken?: string
}

export class GcpLoggingAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'logs' as const
    readonly items: ItemStoreAdapter

    constructor(private readonly client: GcpRuntimeClient = gcp) {
        this.items = new GcpLogEntries(client)
    }

    schema(): ServiceSchema {
        return gcpLogsSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const path = `/v2/projects/${encodeURIComponent(this.client.project)}/logs`
        const logNames: string[] = []
        let pageToken: string | undefined
        do {
            const pagePath = pageToken ? `${path}?pageToken=${encodeURIComponent(pageToken)}` : path
            const response = await this.client.json<LogListPage>(pagePath)
            logNames.push(...(response?.logNames ?? []))
            pageToken = response?.nextPageToken || undefined
        } while (pageToken)
        const search = query.search?.trim().toLowerCase()
        return logNames
            .filter((name) => !search || displayName(name).toLowerCase().includes(search))
            .map(toResource)
    }

    async get(id: string): Promise<CloudResource | null> {
        assertLogName(id, this.client.project)
        return (await this.list()).find((log) => log.id === id) ?? null
    }

    async create(_input: CreateResourceInput): Promise<CloudResource> {
        throw new NotSupportedError('Cloud Logging creates logs when entries are written.')
    }

    async delete(_id: string): Promise<void> {
        throw new NotSupportedError('Deleting a Cloud Logging log is not available in the console.')
    }
}

class GcpLogEntries implements ItemStoreAdapter {
    constructor(private readonly client: GcpRuntimeClient) {}

    listItems(resourceId: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        return this.read(resourceId, '', page)
    }

    queryItems(resourceId: string, query: string, page: PageQuery = {}): Promise<CollectionPage<ChildItem>> {
        const clauses = query.trim() ? query.trim().split(/\s+AND\s+/i) : []
        if (clauses.some((clause) => !validClause(clause))) {
            throw new ValidationError('Only severity and timestamp comparisons are supported for Cloud Logging.')
        }
        return this.read(resourceId, clauses.join(' AND '), page)
    }

    private async read(resourceId: string, query: string, page: PageQuery): Promise<CollectionPage<ChildItem>> {
        assertLogName(resourceId, this.client.project)
        const response = await this.client.json<LogEntryPage>('/v2/entries:list', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                resourceNames: [`projects/${this.client.project}`],
                filter: `logName="${resourceId}"${query ? ` AND ${query}` : ''}`,
                orderBy: 'timestamp desc',
                pageSize: page.limit ?? 100,
                ...(page.cursor ? {pageToken: page.cursor} : {}),
            }),
        })
        return {
            items: (response?.entries ?? []).map((entry, index): ChildItem => ({
                id: entry.insertId ?? `${entry.timestamp ?? ''}-${index}`,
                collectionId: null,
                timestamp: entry.timestamp ?? null,
                body: {
                    message: entry.textPayload ?? (entry.jsonPayload === undefined ? '' : JSON.stringify(entry.jsonPayload)),
                    severity: entry.severity ?? 'DEFAULT',
                    ...(entry.jsonPayload === undefined ? {} : {jsonPayload: entry.jsonPayload}),
                },
                metadata: {
                    resourceType: entry.resource?.type,
                    resourceLabels: entry.resource?.labels,
                    labels: entry.labels,
                    receiveTimestamp: entry.receiveTimestamp,
                },
            })),
            nextCursor: response?.nextPageToken || null,
        }
    }
}

function assertLogName(name: string, project: string): void {
    const prefix = `projects/${project}/logs/`
    if (!name.startsWith(prefix) || name.length === prefix.length || /["\\\r\n]/.test(name)) {
        throw new ValidationError('Log name must belong to the configured GCP project.')
    }
}

function validClause(clause: string): boolean {
    if (/^severity(?:=|>=|<=|>|<)(DEFAULT|DEBUG|INFO|NOTICE|WARNING|ERROR|CRITICAL|ALERT|EMERGENCY)$/.test(clause)) return true
    const match = clause.match(/^timestamp(?:=|>=|<=|>|<)"([^"]+)"$/)
    return Boolean(match && Number.isFinite(Date.parse(match[1])))
}

function displayName(logName: string): string {
    const suffix = logName.split('/logs/').at(-1) ?? logName
    try {
        return decodeURIComponent(suffix)
    } catch {
        return suffix
    }
}

function toResource(logName: string): CloudResource {
    return {
        id: logName,
        name: displayName(logName),
        cloud: 'gcp',
        service: 'logs',
        type: 'log-group',
        region: null,
        createdAt: null,
        metadata: {provider: 'gcp', logName},
    }
}
