import {NotFoundError, RuntimeError, ValidationError} from '../cloud-spi/errors'
import {
    GCP_BIGQUERY_FIELD_TYPES,
    GCP_BIGQUERY_ID_MESSAGE,
    GCP_BIGQUERY_ID_PATTERN,
    GCP_BIGQUERY_RESOURCE_TYPES,
    GCP_BIGQUERY_SCHEMA_MESSAGE,
    gcpBigQuerySchema,
} from '../cloud-spi/bigQuerySchema'
import {mapWithLimit} from '../concurrency'
import {gcp, type GcpRuntimeClient} from '../gcp'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'

/**
 * BigQuery through the Floci-GCP emulator, which serves the public
 * `bigquery.googleapis.com` v2 REST paths under `/bigquery/v2`. Verified against
 * `floci/floci-gcp` 0.12.0:
 *
 *   GET    /bigquery/v2/projects/{p}/datasets
 *   POST   /bigquery/v2/projects/{p}/datasets
 *   GET    /bigquery/v2/projects/{p}/datasets/{d}
 *   DELETE /bigquery/v2/projects/{p}/datasets/{d}
 *   GET    /bigquery/v2/projects/{p}/datasets/{d}/tables
 *   POST   /bigquery/v2/projects/{p}/datasets/{d}/tables
 *   GET    /bigquery/v2/projects/{p}/datasets/{d}/tables/{t}
 *   DELETE /bigquery/v2/projects/{p}/datasets/{d}/tables/{t}
 *
 * A dataset has the id `dataset`, a table `dataset/table`: a table is only
 * addressable through its dataset. Deleting a dataset that still holds tables
 * fails with the runtime's own "still in use" error, as it does on BigQuery
 * without `deleteContents`. Queries, row inserts and table data are not part of
 * this adapter.
 */

const JSON_HEADERS = {'content-type': 'application/json'}
const ID_PATTERN = new RegExp(GCP_BIGQUERY_ID_PATTERN)
const COLUMN_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,299}$/
const FIELD_TYPES: readonly string[] = GCP_BIGQUERY_FIELD_TYPES
/** Bound on `nextPageToken` hops, so a runtime that never stops paging cannot hang a request. */
const MAX_PAGES = 100
const LIST_CONCURRENCY = 8

interface BigQueryDataset {
    id?: string
    datasetReference?: {projectId?: string; datasetId?: string}
    location?: string
    description?: string
    labels?: Record<string, string>
    creationTime?: string
    lastModifiedTime?: string
    maxTimeTravelHours?: string
    defaultTableExpirationMs?: string
}

interface BigQueryField {
    name?: string
    type?: string
    mode?: string
    description?: string
    fields?: BigQueryField[]
}

interface BigQueryTable {
    id?: string
    tableReference?: {projectId?: string; datasetId?: string; tableId?: string}
    type?: string
    description?: string
    labels?: Record<string, string>
    schema?: {fields?: BigQueryField[]}
    numRows?: string
    numBytes?: string
    location?: string
    creationTime?: string
    lastModifiedTime?: string
    expirationTime?: string
}

interface BigQueryPage {
    nextPageToken?: string
}

interface BigQueryDatasetList extends BigQueryPage {
    datasets?: BigQueryDataset[]
}

interface BigQueryTableList extends BigQueryPage {
    tables?: BigQueryTable[]
}

export class GcpBigQueryAdapter implements CloudServiceAdapter {
    readonly cloud = 'gcp' as const
    readonly service = 'analytics' as const

    constructor(private readonly client: GcpRuntimeClient = gcp) {}

    schema(): ServiceSchema {
        return gcpBigQuerySchema()
    }

    /** A failure on any dataset fails the whole list: a partial list would read as missing tables. */
    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const datasets = await this.pages<BigQueryDataset, BigQueryDatasetList>(
            this.datasetsPath(),
            (page) => page.datasets,
        )
        const tablesByDataset = await mapWithLimit(datasets, LIST_CONCURRENCY, (dataset) =>
            this.pages<BigQueryTable, BigQueryTableList>(
                `${this.datasetsPath()}/${encodeURIComponent(datasetIdOf(dataset))}/tables`,
                (page) => page.tables,
            ),
        )
        return filterBySearch(
            [...datasets.map(datasetResource(this.client)), ...tablesByDataset.flat().map(tableResource(this.client))],
            query.search,
        )
    }

    async get(id: string): Promise<CloudResource | null> {
        const parts = id.split('/')
        if (parts.length === 1) {
            const dataset = await this.client.json<BigQueryDataset>(
                this.datasetPath(id),
                {method: 'GET'},
                {emptyOnNotFound: true},
            )
            return dataset ? datasetResource(this.client)(dataset) : null
        }
        if (parts.length !== 2) return null

        const table = await this.client.json<BigQueryTable>(this.tablePath(id), {method: 'GET'}, {emptyOnNotFound: true})
        return table ? tableResource(this.client)(table) : null
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const resourceType = oneOf(input.values.resourceType, GCP_BIGQUERY_RESOURCE_TYPES, 'resourceType')

        if (resourceType === 'dataset') {
            const datasetId = bigQueryId(input.values.datasetName, 'datasetName')
            const dataset = await this.client.json<BigQueryDataset>(this.datasetsPath(), {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({datasetReference: {projectId: this.client.project, datasetId}}),
            })
            if (!dataset?.datasetReference?.datasetId) throw new RuntimeError('BigQuery did not return the created dataset')
            return datasetResource(this.client)(dataset)
        }

        const dataset = bigQueryId(input.values.dataset, 'dataset')
        const tableId = bigQueryId(input.values.tableName, 'tableName')
        const fields = schemaFields(input.values.schema)
        const table = await this.client.json<BigQueryTable>(`${this.datasetPath(dataset)}/tables`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({
                tableReference: {projectId: this.client.project, datasetId: dataset, tableId},
                schema: {fields},
            }),
        })
        if (!table?.tableReference?.tableId) throw new RuntimeError('BigQuery did not return the created table')
        return tableResource(this.client)(table)
    }

    async delete(id: string): Promise<void> {
        const parts = id.split('/')
        if (parts.length === 1) {
            await this.client.fetch(this.datasetPath(id), {method: 'DELETE'})
            return
        }
        await this.client.fetch(this.tablePath(id), {method: 'DELETE'})
    }

    /** Every page of a list call, following `nextPageToken`. */
    private async pages<T, L extends BigQueryPage>(path: string, items: (page: L) => T[] | undefined): Promise<T[]> {
        const all: T[] = []
        let token: string | undefined
        for (let hop = 0; hop < MAX_PAGES; hop += 1) {
            const page = await this.client.json<L>(token ? `${path}?pageToken=${encodeURIComponent(token)}` : path)
            all.push(...(page ? (items(page) ?? []) : []))
            token = page?.nextPageToken || undefined
            if (!token) return all
        }
        throw new RuntimeError(`BigQuery kept returning pages after ${MAX_PAGES}; refusing a partial list`)
    }

    private datasetsPath(): string {
        return `/bigquery/v2/projects/${encodeURIComponent(this.client.project)}/datasets`
    }

    private datasetPath(dataset: string): string {
        return `${this.datasetsPath()}/${encodeURIComponent(bigQueryId(dataset, 'dataset'))}`
    }

    /** `dataset/table`, validated segment by segment so an id can never address another path. */
    private tablePath(id: string): string {
        const [dataset, table, ...rest] = id.split('/')
        if (rest.length > 0 || table === undefined) throw new NotFoundError(`Table ${id} was not found`)
        return `${this.datasetPath(dataset)}/tables/${encodeURIComponent(bigQueryId(table, 'table'))}`
    }
}

function datasetIdOf(dataset: BigQueryDataset): string {
    return dataset.datasetReference?.datasetId ?? leaf(dataset.id)
}

/** `project:dataset` or `project:dataset.table` to its last segment. */
function leaf(id: string | undefined): string {
    return (id ?? '').split(/[:.]/).pop() ?? ''
}

function datasetResource(client: GcpRuntimeClient) {
    return (dataset: BigQueryDataset): CloudResource => {
        const name = datasetIdOf(dataset)
        return {
            id: name,
            name,
            cloud: 'gcp',
            service: 'analytics',
            type: 'dataset',
            region: dataset.location ?? client.location,
            createdAt: epochMillisToIso(dataset.creationTime),
            status: null,
            metadata: {
                provider: 'gcp',
                resourcePath: dataset.id ?? null,
                location: dataset.location ?? null,
                description: dataset.description ?? null,
                labels: dataset.labels ?? {},
                updatedAt: epochMillisToIso(dataset.lastModifiedTime),
                maxTimeTravelHours: numberOrNull(dataset.maxTimeTravelHours),
                defaultTableExpirationMs: numberOrNull(dataset.defaultTableExpirationMs),
            },
        }
    }
}

function tableResource(client: GcpRuntimeClient) {
    return (table: BigQueryTable): CloudResource => {
        const dataset = table.tableReference?.datasetId ?? ''
        const name = table.tableReference?.tableId ?? ''
        return {
            id: `${dataset}/${name}`,
            name,
            cloud: 'gcp',
            service: 'analytics',
            type: 'table',
            region: table.location ?? client.location,
            createdAt: epochMillisToIso(table.creationTime),
            status: null,
            metadata: {
                provider: 'gcp',
                resourcePath: table.id ?? null,
                dataset,
                tableType: table.type ?? null,
                location: table.location ?? null,
                description: table.description ?? null,
                numRows: numberOrNull(table.numRows),
                numBytes: numberOrNull(table.numBytes),
                schema: table.schema?.fields ?? [],
                labels: table.labels ?? {},
                updatedAt: epochMillisToIso(table.lastModifiedTime),
                expiresAt: epochMillisToIso(table.expirationTime),
            },
        }
    }
}

/** BigQuery reports times as milliseconds since the epoch, in a string. */
function epochMillisToIso(value: string | undefined): string | null {
    if (value === undefined || value === '') return null
    const millis = Number(value)
    return Number.isFinite(millis) ? new Date(millis).toISOString() : null
}

function numberOrNull(value: string | undefined): number | null {
    if (value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function bigQueryId(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`)
    const trimmed = value.trim()
    if (!ID_PATTERN.test(trimmed)) throw new ValidationError(`${field}: ${GCP_BIGQUERY_ID_MESSAGE}`)
    return trimmed
}

/** Parses `id:INTEGER,item:STRING`, the shorthand `bq mk` takes, into BigQuery schema fields. */
function schemaFields(value: unknown): BigQueryField[] {
    if (typeof value !== 'string' || !value.trim()) throw new ValidationError('schema is required')

    const seen = new Set<string>()
    return value.split(',').map((entry) => {
        const [name, type, ...rest] = entry.split(':').map((part) => part.trim())
        if (!name || !type || rest.length > 0) {
            throw new ValidationError(`schema: "${entry.trim()}" is not name:TYPE. ${GCP_BIGQUERY_SCHEMA_MESSAGE}`)
        }
        if (!COLUMN_NAME_PATTERN.test(name)) {
            throw new ValidationError(
                `schema: column "${name}" must start with a letter or underscore and use letters, numbers, or underscores.`,
            )
        }
        const upperType = type.toUpperCase()
        if (!FIELD_TYPES.includes(upperType)) {
            throw new ValidationError(`schema: column "${name}" has unknown type "${type}". ${GCP_BIGQUERY_SCHEMA_MESSAGE}`)
        }
        if (seen.has(name.toLowerCase())) throw new ValidationError(`schema: column "${name}" is listed twice`)
        seen.add(name.toLowerCase())
        return {name, type: upperType}
    })
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
    throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter(
        (resource) => resource.name.toLowerCase().includes(normalized) || resource.id.toLowerCase().includes(normalized),
    )
}
