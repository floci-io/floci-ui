import {useMemo, useState, type KeyboardEvent} from 'react'
import {Braces, Play, Plus, RefreshCw, TableProperties} from 'lucide-react'
import {useMutation, useQueries, useQueryClient, type UseMutationResult} from '@tanstack/react-query'
import {listFlatItems, putFlatItem, queryFlatItems} from '@/api/cloudProxyClient'
import {JsonRecordModal} from '@/components/JsonRecordModal'
import {useAccountId} from '@/lib/accountStore'
import type {CloudProvider} from '@/types/cloud'
import type {ChildItem, CloudResource} from '@/types/resource'

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
 * store, one query per loaded page as in LogsExplorerPanel. The PartiQL panel
 * runs through the same store's query verb; its NextToken comes back as the
 * page cursor, so "Load more rows" continues the statement that produced it.
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

function TableExplorer({cloud, accountId, resource, runtimeReachable}: TableExplorerProps) {
    const tableName = resource.id
    const [selectedItemId, setSelectedItemId] = useState<string>()
    const [addRecordOpen, setAddRecordOpen] = useState(false)
    const keyFields = useMemo(() => dynamoKeyFields(resource), [resource])
    const records = useScannedRecords(cloud, accountId, tableName, runtimeReachable)
    const selectedItem = records.items.find((item) => item.id === selectedItemId)
    const putItemMut = records.putItem

    return (
        <section className="dynamodb-explorer">
            <div className="cosmos-column cosmos-column--wide">
                <PanelHeader
                    icon={<TableProperties size={15}/>}
                    eyebrow="Table explorer"
                    title={tableName}
                    detail={`${records.items.length}${records.nextCursor ? '+' : ''} records`}
                />
                <div className="cosmos-toolbar">
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
                    <button className="button" type="button" disabled={records.isRefreshing} onClick={records.refresh}>
                        <RefreshCw size={14}/>
                        {records.isRefreshing ? 'Loading' : 'Refresh'}
                    </button>
                </div>
                {records.error && (
                    <div className="form-error">
                        {records.error.message}
                        {records.retry && <button className="button" type="button" onClick={records.retry}>Retry</button>}
                    </div>
                )}
                <RecordsTable records={records} selectedItemId={selectedItemId} onSelect={setSelectedItemId}/>
            </div>

            <div className="cosmos-column">
                <PanelHeader icon={<Braces size={15}/>} eyebrow="Record contents" title={selectedItem ? formatJson(itemKey(selectedItem)) : 'Select record'} detail="DynamoDB attributes normalized to JSON"/>
                {selectedItem ? (
                    <pre className="dynamodb-document">{JSON.stringify(selectedItem.body, null, 2)}</pre>
                ) : (
                    <div className="empty compact"><h2>Select a record</h2><p>Full record contents appear here.</p></div>
                )}
                <PartiqlPanel cloud={cloud} tableName={tableName} runtimeReachable={runtimeReachable} onTableChanged={records.refresh}/>
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
                        setSelectedItemId(item.id)
                    },
                })}
            />
        </section>
    )
}

interface ScannedRecords {
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
    putItem: UseMutationResult<ChildItem, Error, Record<string, unknown>>
}

function useScannedRecords(cloud: CloudProvider, accountId: string, tableName: string, enabled: boolean): ScannedRecords {
    const qc = useQueryClient()
    const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
    const pagesKey = ['nosql-items', accountId, cloud, tableName]
    const pages = useQueries({
        queries: cursors.map((cursor) => ({
            queryKey: [...pagesKey, cursor],
            queryFn: ({signal}: {signal: AbortSignal}) => listFlatItems(cloud, 'nosql', tableName, cursor, signal),
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
        setCursors([undefined])
        return qc.invalidateQueries({queryKey: pagesKey})
    }

    const putItem = useMutation({
        mutationFn: (document: Record<string, unknown>) => putFlatItem(cloud, 'nosql', tableName, document),
        onSuccess: refresh,
    })

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
            if (nextCursor && !isFetching) setCursors((previous) => [...previous, nextCursor])
        },
        refresh: () => void refresh(),
        retry: failedPage ? () => void failedPage.refetch() : null,
        putItem,
    }
}

function RecordsTable({records, selectedItemId, onSelect}: {records: ScannedRecords; selectedItemId?: string; onSelect: (id: string) => void}) {
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
            {records.isEmpty && <div className="empty compact"><h2>No records</h2><p>This table does not contain any items.</p></div>}
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
}

function dynamoKeyFields(resource?: CloudResource): DynamoKeyField[] {
    const keySchema = Array.isArray(resource?.metadata.keySchema) ? resource.metadata.keySchema : []
    const definitions = Array.isArray(resource?.metadata.attributeDefinitions) ? resource.metadata.attributeDefinitions : []
    const types = new Map(definitions.flatMap((definition) => {
        if (!definition || typeof definition !== 'object') return []
        const {AttributeName, AttributeType} = definition as {AttributeName?: unknown; AttributeType?: unknown}
        return typeof AttributeName === 'string' && isDynamoKeyType(AttributeType) ? [[AttributeName, AttributeType] as const] : []
    }))

    return keySchema.flatMap((key) => {
        if (!key || typeof key !== 'object') return []
        const name = (key as {AttributeName?: unknown}).AttributeName
        return typeof name === 'string' ? [{name, type: types.get(name)}] : []
    })
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

function summarize(item: ChildItem): string {
    return Object.entries(item.body)
        .slice(0, 3)
        .map(([name, value]) => `${name}: ${formatJson(value)}`)
        .join(' · ')
}

function formatJson(value: unknown): string {
    return JSON.stringify(value) ?? String(value)
}
