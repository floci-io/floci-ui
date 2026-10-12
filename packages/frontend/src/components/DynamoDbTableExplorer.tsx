import {useEffect, useMemo, useState, type KeyboardEvent} from 'react'
import {Braces, Play, Plus, RefreshCw, TableProperties} from 'lucide-react'
import {useMutation, useQueries, useQueryClient} from '@tanstack/react-query'
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

interface StatementResult {
    statement: string
    items: ChildItem[]
    nextCursor: string | null
}

/**
 * Records are scanned one cursor page at a time through the generic flat item
 * store, one query per loaded page as in LogsExplorerPanel. The PartiQL editor
 * runs through the same store's query verb; its NextToken comes back as the
 * page cursor, so "Load more" continues the statement that produced it.
 */
export function DynamoDbTableExplorer({cloud, resource, runtimeReachable}: DynamoDbTableExplorerProps) {
    const qc = useQueryClient()
    const accountId = useAccountId()
    const tableName = resource?.id
    const [selectedItemId, setSelectedItemId] = useState<string>()
    const [addRecordOpen, setAddRecordOpen] = useState(false)
    const [cursors, setCursors] = useState<Array<string | undefined>>([undefined])
    const [statement, setStatement] = useState(() => defaultStatement(tableName))
    const [statementResult, setStatementResult] = useState<StatementResult>()
    const itemsKey = useMemo(() => ['nosql-items', accountId, cloud, tableName], [accountId, cloud, tableName])
    const keyFields = useMemo(() => dynamoKeyFields(resource), [resource])
    const pages = useQueries({
        queries: cursors.map((cursor) => ({
            queryKey: [...itemsKey, cursor],
            queryFn: ({signal}: {signal: AbortSignal}) => listFlatItems(cloud, 'nosql', tableName ?? '', cursor, signal),
            enabled: Boolean(tableName) && runtimeReachable,
        })),
    })
    const firstPage = pages[0]
    const lastPage = pages[pages.length - 1]
    const items = pages.flatMap((page) => page.data?.items ?? [])
    const nextCursor = lastPage?.data?.nextCursor ?? null
    const loadingMore = pages.length > 1 && lastPage?.isLoading
    const selectedItem = items.find((item) => item.id === selectedItemId)

    function refreshRecords() {
        setCursors([undefined])
        void qc.invalidateQueries({queryKey: itemsKey})
    }

    const putItemMut = useMutation({
        mutationFn: (document: Record<string, unknown>) => putFlatItem(cloud, 'nosql', tableName ?? '', document),
        onSuccess: (item) => {
            setAddRecordOpen(false)
            setSelectedItemId(item.id)
            refreshRecords()
        },
    })
    const statementMut = useMutation({
        mutationFn: (input: {statement: string; cursor?: string}) =>
            queryFlatItems(cloud, 'nosql', tableName ?? '', input.statement, input.cursor),
        onSuccess: (page, input) => {
            setStatementResult((previous) => ({
                statement: input.statement,
                items: input.cursor && previous ? [...previous.items, ...page.items] : page.items,
                nextCursor: page.nextCursor,
            }))
            // INSERT, UPDATE and DELETE change the table and return no rows,
            // so the scanned records are what shows their effect.
            if (!/^select\b/i.test(input.statement)) refreshRecords()
        },
    })

    const resetStatement = statementMut.reset

    useEffect(() => {
        setSelectedItemId(undefined)
        setAddRecordOpen(false)
        setCursors([undefined])
        setStatement(defaultStatement(tableName))
        setStatementResult(undefined)
        resetStatement()
    }, [cloud, tableName, resetStatement])

    function runStatement() {
        const trimmed = statement.trim()
        if (!trimmed || !runtimeReachable || statementMut.isPending) return
        setStatementResult(undefined)
        statementMut.mutate({statement: trimmed})
    }

    function onStatementKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            runStatement()
        }
    }

    if (!tableName) {
        return (
            <section className="dynamodb-explorer">
                <div className="empty compact">
                    <h3>Select a DynamoDB table</h3>
                    <p>Records and their contents load after a table is selected.</p>
                </div>
            </section>
        )
    }

    const loadingMoreRows = statementMut.isPending && Boolean(statementMut.variables?.cursor)

    return (
        <section className="dynamodb-explorer">
            <div className="cosmos-column cosmos-column--wide">
                <PanelHeader
                    icon={<TableProperties size={15}/>}
                    eyebrow="Table explorer"
                    title={tableName}
                    detail={`${items.length}${nextCursor ? '+' : ''} records`}
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
                    <button className="button" type="button" disabled={firstPage?.isFetching} onClick={refreshRecords}>
                        <RefreshCw size={14}/>
                        {firstPage?.isFetching ? 'Loading' : 'Refresh'}
                    </button>
                </div>
                {firstPage?.error instanceof Error && <div className="form-error">{firstPage.error.message}</div>}
                {lastPage !== firstPage && lastPage?.error instanceof Error && <div className="form-error">{lastPage.error.message}</div>}
                <div className="cosmos-items-table">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Key</th>
                                <th>Contents</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item) => (
                                <tr key={item.id} className={selectedItemId === item.id ? 'selected' : ''}>
                                    <td onClick={() => setSelectedItemId(item.id)}><code>{formatJson(itemKey(item))}</code></td>
                                    <td onClick={() => setSelectedItemId(item.id)}>{summarize(item)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {firstPage?.isLoading && <div className="muted padded">Loading records</div>}
                    {firstPage?.isSuccess && items.length === 0 && <div className="empty compact"><h3>No records</h3><p>This table does not contain any items.</p></div>}
                    {nextCursor && (
                        <div className="dynamodb-load-more">
                            <button
                                className="button"
                                type="button"
                                disabled={Boolean(loadingMore)}
                                onClick={() => setCursors((previous) => [...previous, nextCursor])}
                            >
                                {loadingMore ? 'Loading…' : 'Load more'}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="cosmos-column">
                <PanelHeader icon={<Braces size={15}/>} eyebrow="Record contents" title={selectedItem ? formatJson(itemKey(selectedItem)) : 'Select record'} detail="DynamoDB attributes normalized to JSON"/>
                {selectedItem ? (
                    <pre className="dynamodb-document">{JSON.stringify(selectedItem.body, null, 2)}</pre>
                ) : (
                    <div className="empty compact"><h3>Select a record</h3><p>Full record contents appear here.</p></div>
                )}

                <PanelHeader icon={<Play size={15}/>} eyebrow="PartiQL" title="ExecuteStatement" detail="Name the table in the statement. ⌘/Ctrl+Enter runs it."/>
                <div className="cosmos-query">
                    <textarea
                        className="textarea code-textarea small"
                        aria-label="PartiQL statement"
                        value={statement}
                        onChange={(event) => setStatement(event.target.value)}
                        onKeyDown={onStatementKeyDown}
                        spellCheck={false}
                    />
                    <button
                        className="button"
                        type="button"
                        disabled={!runtimeReachable || !statement.trim() || statementMut.isPending}
                        onClick={runStatement}
                    >
                        <Play size={14}/>
                        {statementMut.isPending && !loadingMoreRows ? 'Running' : 'Run statement'}
                    </button>
                    {statementMut.error instanceof Error && <div className="form-error">{statementMut.error.message}</div>}
                    {statementResult && (
                        <>
                            <div className="muted">
                                {statementResult.items.length}{statementResult.nextCursor ? '+' : ''} {statementResult.items.length === 1 ? 'row' : 'rows'}
                            </div>
                            {statementResult.items.length > 0 && (
                                <pre className="cosmos-query-result">{JSON.stringify(statementResult.items.map((item) => item.body), null, 2)}</pre>
                            )}
                            {statementResult.nextCursor && (
                                <div className="dynamodb-load-more">
                                    <button
                                        className="button"
                                        type="button"
                                        disabled={!runtimeReachable || statementMut.isPending}
                                        onClick={() => statementMut.mutate({statement: statementResult.statement, cursor: statementResult.nextCursor ?? undefined})}
                                    >
                                        {loadingMoreRows ? 'Loading…' : 'Load more rows'}
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            <JsonRecordModal
                open={addRecordOpen}
                title={`Add record to ${tableName}`}
                description={dynamoModalDescription(keyFields)}
                initialValue={JSON.stringify(Object.fromEntries(keyFields.map(({name, type}) => [name, type === 'N' ? '0' : ''])), null, 2)}
                isPending={putItemMut.isPending}
                submitError={putItemMut.error instanceof Error ? putItemMut.error.message : undefined}
                onClose={() => setAddRecordOpen(false)}
                onSubmit={(document) => putItemMut.mutate(document)}
            />
        </section>
    )
}

function defaultStatement(tableName?: string): string {
    return tableName ? `SELECT * FROM "${tableName}"` : ''
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
