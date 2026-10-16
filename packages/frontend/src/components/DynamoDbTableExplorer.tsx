import {useId, useMemo, useState, type FormEvent, type KeyboardEvent} from 'react'
import {Braces, Play, Plus, RefreshCw, Search, TableProperties} from 'lucide-react'
import {useMutation, useQueries, useQueryClient} from '@tanstack/react-query'
import {listFlatItems, putFlatItem, queryFlatItems, queryFlatItemsByKey} from '@/api/cloudProxyClient'
import {JsonRecordModal} from '@/components/JsonRecordModal'
import {useAccountId} from '@/lib/accountStore'
import type {CloudProvider} from '@/types/cloud'
import type {ChildItem, CloudResource, CollectionPage, KeyConditionOperator, KeyQuery} from '@/types/resource'

interface DynamoDbTableExplorerProps {
    cloud: CloudProvider
    resource?: CloudResource
    runtimeReachable: boolean
}

interface TableExplorerProps {
    cloud: CloudProvider
    accountId: string
    resource: CloudResource
    runtimeReachable: boolean
}

/**
 * Records are scanned one cursor page at a time through the generic flat item
 * store, one query per loaded page as in LogsExplorerPanel. Query mode reads
 * the same way through the store's key query verb, against the table or a
 * secondary index. The PartiQL panel runs through the store's query verb; its
 * NextToken comes back as the page cursor, so "Load more rows" continues the
 * statement that produced it.
 */
export function DynamoDbTableExplorer({cloud, resource, runtimeReachable}: DynamoDbTableExplorerProps) {
    const accountId = useAccountId()

    if (!resource) {
        return (
            <section className="dynamodb-explorer">
                <div className="empty compact">
                    <h2>Select a DynamoDB table</h2>
                    <p>Records and their contents load after a table is selected.</p>
                </div>
            </section>
        )
    }

    // Keyed so a different table or account starts from a clean selection,
    // cursor chain and statement instead of resetting each piece of state.
    return (
        <TableExplorer
            key={`${accountId}:${cloud}:${resource.id}`}
            cloud={cloud}
            accountId={accountId}
            resource={resource}
            runtimeReachable={runtimeReachable}
        />
    )
}

type ReadMode = 'scan' | 'query'

function TableExplorer({cloud, accountId, resource, runtimeReachable}: TableExplorerProps) {
    const tableName = resource.id
    const [mode, setMode] = useState<ReadMode>('scan')
    // Each run gets its own number, so running the same lookup again is a new
    // query key and fetches fresh results from the first page.
    const [keyQueryRun, setKeyQueryRun] = useState<{query: KeyQuery; run: number}>()
    const keyQuery = keyQueryRun?.query
    const [selectedItemId, setSelectedItemId] = useState<string>()
    const [addRecordOpen, setAddRecordOpen] = useState(false)
    const keyFields = useMemo(() => dynamoKeyFields(resource), [resource])
    const accessPaths = useMemo(() => dynamoAccessPaths(resource), [resource])
    const scanned = usePagedRecords(
        ['nosql-items', accountId, cloud, tableName],
        (cursor, signal) => listFlatItems(cloud, 'nosql', tableName, cursor, signal),
        runtimeReachable && mode === 'scan',
    )
    const queried = usePagedRecords(
        ['nosql-key-query', accountId, cloud, tableName, keyQueryRun],
        (cursor, signal) => queryFlatItemsByKey(cloud, 'nosql', tableName, keyQuery as KeyQuery, cursor, signal),
        runtimeReachable && Boolean(keyQuery),
    )
    const records = mode === 'query' ? queried : scanned
    const selectedItem = records.items.find((item) => item.id === selectedItemId)
    const queriedPath = keyQuery ? accessPaths.find((path) => path.index === keyQuery.index) : undefined
    const showsProjection = mode === 'query' && queriedPath !== undefined && !queriedPath.projectsAllAttributes
    const putItemMut = useMutation({
        mutationFn: (document: Record<string, unknown>) => putFlatItem(cloud, 'nosql', tableName, document),
        onSuccess: refreshRecords,
    })

    // A write can change both lists, whichever one is on screen.
    function refreshRecords() {
        scanned.refresh()
        if (keyQuery) queried.refresh()
    }

    function runKeyQuery(query: KeyQuery) {
        setKeyQueryRun((previous) => ({query, run: (previous?.run ?? 0) + 1}))
    }

    function changeMode(next: ReadMode) {
        // The same id can be a full item in one mode and an index projection
        // in the other, so a selection does not carry across.
        if (next !== mode) setSelectedItemId(undefined)
        setMode(next)
    }

    return (
        <section className="dynamodb-explorer">
            <div className="cosmos-column cosmos-column--wide">
                <PanelHeader
                    icon={<TableProperties size={15}/>}
                    eyebrow="Table explorer"
                    title={tableName}
                    detail={mode === 'query' && !keyQuery ? 'Enter a partition key to query' : recordCount(records)}
                />
                <div className="cosmos-toolbar">
                    <div className="settings-toggle-group dynamodb-mode" role="radiogroup" aria-label="Read mode">
                        {(['scan', 'query'] as const).map((option) => (
                            <button
                                key={option}
                                type="button"
                                className={`settings-toggle-btn${mode === option ? ' active' : ''}`}
                                role="radio"
                                aria-checked={mode === option}
                                onClick={() => changeMode(option)}
                            >
                                {option === 'scan' ? 'Scan' : 'Query'}
                            </button>
                        ))}
                    </div>
                    <button
                        className="button primary"
                        type="button"
                        disabled={!runtimeReachable}
                        onClick={() => {
                            putItemMut.reset()
                            setAddRecordOpen(true)
                        }}
                    >
                        <Plus size={14}/>
                        Add record
                    </button>
                    <button className="button" type="button" disabled={records.isRefreshing || (mode === 'query' && !keyQuery)} onClick={records.refresh}>
                        <RefreshCw size={14}/>
                        {records.isRefreshing ? 'Loading' : 'Refresh'}
                    </button>
                </div>
                {/* Hidden rather than unmounted, so the inputs still match
                    the query results when the user comes back from Scan. */}
                <div hidden={mode !== 'query'}>
                    <KeyQueryForm
                        accessPaths={accessPaths}
                        runtimeReachable={runtimeReachable}
                        isRunning={queried.isRefreshing}
                        onRun={runKeyQuery}
                    />
                </div>
                {records.error && (
                    <div className="form-error">
                        {records.error.message}
                        {records.retry && <button className="button" type="button" onClick={records.retry}>Retry</button>}
                    </div>
                )}
                <RecordsTable
                    records={records}
                    emptyMessage={mode === 'query' ? 'No items match this key condition.' : 'This table does not contain any items.'}
                    selectedItemId={selectedItemId}
                    onSelect={setSelectedItemId}
                />
            </div>

            <div className="cosmos-column">
                <PanelHeader icon={<Braces size={15}/>} eyebrow="Record contents" title={selectedItem ? formatJson(itemKey(selectedItem)) : 'Select record'} detail={showsProjection ? `Attributes projected into ${queriedPath?.index}` : 'DynamoDB attributes normalized to JSON'}/>
                {selectedItem ? (
                    <pre className="dynamodb-document">{JSON.stringify(selectedItem.body, null, 2)}</pre>
                ) : (
                    <div className="empty compact"><h2>Select a record</h2><p>{showsProjection ? 'Attributes projected into the index appear here.' : 'Full record contents appear here.'}</p></div>
                )}
                <PartiqlPanel cloud={cloud} tableName={tableName} runtimeReachable={runtimeReachable} onTableChanged={refreshRecords}/>
            </div>

            <JsonRecordModal
                open={addRecordOpen}
                title={`Add record to ${tableName}`}
                description={dynamoModalDescription(keyFields)}
                initialValue={JSON.stringify(Object.fromEntries(keyFields.map(({name, type}) => [name, type === 'N' ? '0' : ''])), null, 2)}
                isPending={putItemMut.isPending}
                submitError={putItemMut.error instanceof Error ? putItemMut.error.message : undefined}
                onClose={() => setAddRecordOpen(false)}
                onSubmit={(document) => putItemMut.mutate(document, {
                    onSuccess: (item) => {
                        setAddRecordOpen(false)
                        // A query may not match the new item, so show it
                        // among the scanned records, which always hold it.
                        setMode('scan')
                        setSelectedItemId(item.id)
                    },
                })}
            />
        </section>
    )
}

interface PagedRecords {
    items: ChildItem[]
    nextCursor: string | null
    isLoading: boolean
    isEmpty: boolean
    isLoadingMore: boolean
    isFetching: boolean
    isRefreshing: boolean
    error: Error | null
    loadMore: () => void
    refresh: () => void
    retry: (() => void) | null
}

/**
 * One query per loaded cursor page. The cursor chain belongs to the query key
 * that produced it, so a new key starts again from the first page.
 */
function usePagedRecords(
    pagesKey: readonly unknown[],
    fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<CollectionPage<ChildItem>>,
    enabled: boolean,
): PagedRecords {
    const qc = useQueryClient()
    const chainKey = JSON.stringify(pagesKey)
    const [chain, setChain] = useState<{key: string; cursors: Array<string | undefined>}>({key: chainKey, cursors: [undefined]})
    const cursors = chain.key === chainKey ? chain.cursors : [undefined]
    const pages = useQueries({
        queries: cursors.map((cursor) => ({
            queryKey: [...pagesKey, cursor],
            queryFn: ({signal}: {signal: AbortSignal}) => fetchPage(cursor, signal),
            enabled,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
        })),
    })
    const firstPage = pages[0]
    const lastPage = pages[pages.length - 1]
    const items = pages.flatMap((page) => page.data?.items ?? [])
    const nextCursor = lastPage.data?.nextCursor ?? null
    // While any page is in flight, the last cursor may belong to a chain a
    // refresh is replacing, so continuing from it could repeat or skip rows.
    const isFetching = pages.some((page) => page.isFetching)
    const failedPage = pages.find((page) => page.error instanceof Error)
    const error = failedPage?.error ?? null

    // Back to a single page: refetching in place would join a fresh first
    // page to trailing pages built from the old cursor chain.
    function refresh() {
        setChain({key: chainKey, cursors: [undefined]})
        void qc.invalidateQueries({queryKey: pagesKey})
    }

    return {
        items,
        nextCursor,
        isLoading: firstPage.isLoading,
        isEmpty: firstPage.isSuccess && items.length === 0,
        isLoadingMore: pages.length > 1 && lastPage.isLoading,
        isRefreshing: firstPage.isFetching,
        isFetching,
        error,
        loadMore: () => {
            if (nextCursor && !isFetching) setChain({key: chainKey, cursors: [...cursors, nextCursor]})
        },
        refresh,
        retry: failedPage ? () => void failedPage.refetch() : null,
    }
}

interface RecordsTableProps {
    records: PagedRecords
    emptyMessage: string
    selectedItemId?: string
    onSelect: (id: string) => void
}

function RecordsTable({records, emptyMessage, selectedItemId, onSelect}: RecordsTableProps) {
    return (
        <div className="cosmos-items-table">
            <table className="table">
                <thead>
                    <tr>
                        <th>Key</th>
                        <th>Contents</th>
                    </tr>
                </thead>
                <tbody>
                    {records.items.map((item) => (
                        <tr key={item.id} className={selectedItemId === item.id ? 'selected' : ''}>
                            <td>
                                <button className="link-button" type="button" aria-pressed={selectedItemId === item.id} onClick={() => onSelect(item.id)}>
                                    <code>{formatJson(itemKey(item))}</code>
                                </button>
                            </td>
                            <td>{summarize(item)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {records.isLoading && <div className="muted padded">Loading records</div>}
            {records.isEmpty && <div className="empty compact"><h2>No records</h2><p>{emptyMessage}</p></div>}
            {records.nextCursor && (
                <div className="dynamodb-load-more">
                    <button className="button" type="button" disabled={records.isFetching} onClick={records.loadMore}>
                        {records.isLoadingMore ? 'Loading…' : 'Load more'}
                    </button>
                </div>
            )}
        </div>
    )
}

const SORT_KEY_OPERATORS: Array<{value: KeyConditionOperator; label: string}> = [
    {value: 'eq', label: '='},
    {value: 'lt', label: '<'},
    {value: 'lte', label: '<='},
    {value: 'gt', label: '>'},
    {value: 'gte', label: '>='},
    {value: 'between', label: 'Between'},
    {value: 'beginsWith', label: 'Begins with'},
]

interface KeyQueryFormProps {
    accessPaths: DynamoAccessPath[]
    runtimeReachable: boolean
    isRunning: boolean
    onRun: (query: KeyQuery) => void
}

function KeyQueryForm({accessPaths, runtimeReachable, isRunning, onRun}: KeyQueryFormProps) {
    const id = useId()
    const [pathId, setPathId] = useState('')
    const [partitionValue, setPartitionValue] = useState('')
    const [operator, setOperator] = useState<KeyConditionOperator | ''>('')
    const [sortValue, setSortValue] = useState('')
    const [sortTo, setSortTo] = useState('')
    const [descending, setDescending] = useState(false)
    const path = accessPaths.find((candidate) => (candidate.index ?? '') === pathId) ?? accessPaths[0]

    if (!path) {
        return <div className="empty compact"><h2>No key schema</h2><p>This table does not describe a partition key to query.</p></div>
    }

    const sortKey = path.sortKey
    // begins_with only applies to string and binary sort keys.
    const operators = SORT_KEY_OPERATORS.filter(({value}) => value !== 'beginsWith' || sortKey?.type !== 'N')
    const activeOperator = sortKey && operators.some(({value}) => value === operator) ? operator : ''
    const canRun = runtimeReachable && !isRunning && Boolean(partitionValue)
        && (!activeOperator || Boolean(sortValue))
        && (activeOperator !== 'between' || Boolean(sortTo))

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!canRun || !path) return
        const query: KeyQuery = {partitionKey: partitionValue}
        if (path.index) query.index = path.index
        if (activeOperator) {
            query.sortKey = activeOperator === 'between'
                ? {operator: activeOperator, value: sortValue, to: sortTo}
                : {operator: activeOperator, value: sortValue}
        }
        if (descending) query.descending = true
        onRun(query)
    }

    return (
        <form className="cosmos-query" aria-label="Query by key" onSubmit={submit}>
            <div className="field-row">
                <label htmlFor={`${id}-path`}>Table or index</label>
                <select id={`${id}-path`} className="input" value={path.index ?? ''} onChange={(event) => setPathId(event.target.value)}>
                    {accessPaths.map((candidate) => (
                        <option key={candidate.index ?? ''} value={candidate.index ?? ''}>{candidate.label}</option>
                    ))}
                </select>
            </div>
            <div className="field-row">
                <label htmlFor={`${id}-pk`}>Partition key</label>
                <input
                    id={`${id}-pk`}
                    className="input"
                    value={partitionValue}
                    placeholder={keyPlaceholder(path.partitionKey)}
                    onChange={(event) => setPartitionValue(event.target.value)}
                />
            </div>
            {sortKey && (
                <div className="field-row">
                    <label htmlFor={`${id}-op`}>Sort key</label>
                    <select
                        id={`${id}-op`}
                        className="input"
                        aria-label="Sort key condition"
                        value={activeOperator}
                        onChange={(event) => setOperator(event.target.value as KeyConditionOperator | '')}
                    >
                        <option value="">Any {sortKey.name}</option>
                        {operators.map(({value, label}) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    {activeOperator && (
                        <input
                            className="input"
                            aria-label={activeOperator === 'between' ? 'Sort key lower bound' : 'Sort key value'}
                            value={sortValue}
                            placeholder={keyPlaceholder(sortKey)}
                            onChange={(event) => setSortValue(event.target.value)}
                        />
                    )}
                    {activeOperator === 'between' && (
                        <input
                            className="input"
                            aria-label="Sort key upper bound"
                            value={sortTo}
                            placeholder={keyPlaceholder(sortKey)}
                            onChange={(event) => setSortTo(event.target.value)}
                        />
                    )}
                </div>
            )}
            <div className="field-row">
                <label htmlFor={`${id}-order`}>Order</label>
                <select id={`${id}-order`} className="input" value={descending ? 'desc' : 'asc'} onChange={(event) => setDescending(event.target.value === 'desc')}>
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                </select>
            </div>
            <button className="button" type="submit" disabled={!canRun}>
                <Search size={14}/>
                {isRunning ? 'Running' : 'Run query'}
            </button>
        </form>
    )
}

interface StatementResult {
    statement: string
    items: ChildItem[]
    nextCursor: string | null
}

interface PartiqlPanelProps {
    cloud: CloudProvider
    tableName: string
    runtimeReachable: boolean
    onTableChanged: () => void
}

function PartiqlPanel({cloud, tableName, runtimeReachable, onTableChanged}: PartiqlPanelProps) {
    const [statement, setStatement] = useState(`SELECT * FROM "${tableName}"`)
    const [result, setResult] = useState<StatementResult>()
    const statementMut = useMutation({
        mutationFn: (input: {statement: string; cursor?: string}) =>
            queryFlatItems(cloud, 'nosql', tableName, input.statement, input.cursor),
        onSuccess: (page, input) => {
            setResult((previous) => ({
                statement: input.statement,
                items: input.cursor && previous ? [...previous.items, ...page.items] : page.items,
                nextCursor: page.nextCursor,
            }))
            // INSERT, UPDATE and DELETE change the table and return no rows,
            // so the scanned records are what shows their effect.
            if (!/^select\b/i.test(input.statement)) onTableChanged()
        },
    })
    const loadingMore = statementMut.isPending && Boolean(statementMut.variables?.cursor)

    function run() {
        const trimmed = statement.trim()
        if (!trimmed || !runtimeReachable || statementMut.isPending) return
        setResult(undefined)
        statementMut.mutate({statement: trimmed})
    }

    function loadMore() {
        if (result?.nextCursor) statementMut.mutate({statement: result.statement, cursor: result.nextCursor})
    }

    function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            run()
        }
    }

    return (
        <>
            <PanelHeader icon={<Play size={15}/>} eyebrow="PartiQL" title="ExecuteStatement" detail="Name the table in the statement. ⌘/Ctrl+Enter runs it."/>
            <div className="cosmos-query">
                <textarea
                    className="textarea code-textarea small"
                    aria-label="PartiQL statement"
                    value={statement}
                    onChange={(event) => setStatement(event.target.value)}
                    onKeyDown={onKeyDown}
                    spellCheck={false}
                />
                <button className="button" type="button" disabled={!runtimeReachable || !statement.trim() || statementMut.isPending} onClick={run}>
                    <Play size={14}/>
                    {statementMut.isPending && !loadingMore ? 'Running' : 'Run statement'}
                </button>
                {statementMut.error instanceof Error && <div className="form-error">{statementMut.error.message}</div>}
                {result && (
                    <>
                        <div className="muted">
                            {result.items.length}{result.nextCursor ? '+' : ''} {result.items.length === 1 ? 'row' : 'rows'}
                        </div>
                        {result.items.length > 0 && (
                            <pre className="cosmos-query-result">{JSON.stringify(result.items.map((item) => item.body), null, 2)}</pre>
                        )}
                        {result.nextCursor && (
                            <div className="dynamodb-load-more">
                                <button className="button" type="button" disabled={!runtimeReachable || statementMut.isPending} onClick={loadMore}>
                                    {loadingMore ? 'Loading…' : 'Load more rows'}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    )
}

interface DynamoKeyField {
    name: string
    type?: 'S' | 'N' | 'B'
    keyType?: 'HASH' | 'RANGE'
}

/** The table itself or one of its secondary indexes, as Query can read it. */
interface DynamoAccessPath {
    index?: string
    label: string
    partitionKey: DynamoKeyField
    sortKey?: DynamoKeyField
    /** False for a KEYS_ONLY or INCLUDE index, whose rows are partial items. */
    projectsAllAttributes: boolean
}

function dynamoKeyFields(resource?: CloudResource, keySchema: unknown = resource?.metadata.keySchema): DynamoKeyField[] {
    const definitions = Array.isArray(resource?.metadata.attributeDefinitions) ? resource.metadata.attributeDefinitions : []
    const types = new Map(definitions.flatMap((definition) => {
        if (!definition || typeof definition !== 'object') return []
        const {AttributeName, AttributeType} = definition as {AttributeName?: unknown; AttributeType?: unknown}
        return typeof AttributeName === 'string' && isDynamoKeyType(AttributeType) ? [[AttributeName, AttributeType] as const] : []
    }))

    return (Array.isArray(keySchema) ? keySchema : []).flatMap((key) => {
        if (!key || typeof key !== 'object') return []
        const {AttributeName: name, KeyType: keyType} = key as {AttributeName?: unknown; KeyType?: unknown}
        if (typeof name !== 'string') return []
        return [{name, type: types.get(name), keyType: keyType === 'HASH' || keyType === 'RANGE' ? keyType : undefined}]
    })
}

function dynamoAccessPaths(resource: CloudResource): DynamoAccessPath[] {
    const indexes = (kind: string, value: unknown) => (Array.isArray(value) ? value : []).flatMap((index) => {
        if (!index || typeof index !== 'object') return []
        const {IndexName, KeySchema, Projection} = index as {IndexName?: unknown; KeySchema?: unknown; Projection?: {ProjectionType?: unknown}}
        if (typeof IndexName !== 'string') return []
        return [{index: IndexName, kind, keySchema: KeySchema, projectsAllAttributes: Projection?.ProjectionType === 'ALL'}]
    })
    const candidates: Array<{index?: string; kind: string; keySchema: unknown; projectsAllAttributes: boolean}> = [
        {index: undefined, kind: 'Table', keySchema: resource.metadata.keySchema, projectsAllAttributes: true},
        ...indexes('GSI', resource.metadata.globalSecondaryIndexes),
        ...indexes('LSI', resource.metadata.localSecondaryIndexes),
    ]

    return candidates.flatMap(({index, kind, keySchema, projectsAllAttributes}) => {
        const fields = dynamoKeyFields(resource, keySchema)
        const partitionKey = fields.find(({keyType}) => keyType === 'HASH')
        if (!partitionKey) return []
        const sortKey = fields.find(({keyType}) => keyType === 'RANGE')
        const keys = [partitionKey, sortKey].filter(Boolean).map((field) => field?.name).join(', ')
        return [{index, label: `${kind}: ${index ?? resource.name} (${keys})`, partitionKey, sortKey, projectsAllAttributes}]
    })
}

// The visible labels say which key it is; the placeholder names the attribute.
function keyPlaceholder({name, type}: DynamoKeyField): string {
    if (type === 'N') return `${name} (number)`
    if (type === 'B') return `${name} (base64)`
    return type === 'S' ? `${name} (string)` : name
}

function dynamoModalDescription(keyFields: DynamoKeyField[]): string {
    const keys = keyFields.map(({name, type}) => `${name}${type ? ` (${type})` : ''}`).join(', ')
    const binaryHint = keyFields.some(({type}) => type === 'B') ? ' Binary keys use base64.' : ''
    const numberHint = keyFields.some(({type}) => type === 'N') ? ' All number keys must be quoted to preserve precision.' : ''
    return `Required keys: ${keys || 'the table key attributes'}.${binaryHint}${numberHint} A matching key replaces the existing record.`
}

function isDynamoKeyType(value: unknown): value is 'S' | 'N' | 'B' {
    return value === 'S' || value === 'N' || value === 'B'
}

function PanelHeader({icon, eyebrow, title, detail}: {icon: React.ReactNode; eyebrow: string; title: string; detail: string}) {
    return (
        <div className="cosmos-panel-header">
            {icon}
            <span>
                <small>{eyebrow}</small>
                <strong>{title}</strong>
                <em>{detail}</em>
            </span>
        </div>
    )
}

function itemKey(item: ChildItem): Record<string, unknown> | null {
    const key = item.metadata.key
    return key && typeof key === 'object' && !Array.isArray(key) ? key as Record<string, unknown> : null
}

// "1+ records" stays plural: more pages mean more than one.
function recordCount({items, nextCursor}: PagedRecords): string {
    if (nextCursor) return `${items.length}+ records`
    return `${items.length} ${items.length === 1 ? 'record' : 'records'}`
}

function summarize(item: ChildItem): string {
    return Object.entries(item.body)
        .slice(0, 3)
        .map(([name, value]) => `${name}: ${formatJson(value)}`)
        .join(' · ')
}

function formatJson(value: unknown): string {
    return JSON.stringify(value) ?? String(value)
}
