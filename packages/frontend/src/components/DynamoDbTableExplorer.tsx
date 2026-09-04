import {useEffect, useMemo, useState} from 'react'
import {Braces, Plus, RefreshCw, TableProperties} from 'lucide-react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {listNoSqlItems, putNoSqlItem} from '@/api/cloudProxyClient'
import {JsonRecordModal} from '@/components/JsonRecordModal'
import type {CloudProvider} from '@/types/cloud'
import type {CloudResource, NoSqlItem} from '@/types/resource'

interface DynamoDbTableExplorerProps {
    cloud: CloudProvider
    resource?: CloudResource
    runtimeReachable: boolean
}

export function DynamoDbTableExplorer({cloud, resource, runtimeReachable}: DynamoDbTableExplorerProps) {
    const qc = useQueryClient()
    const tableName = resource?.id
    const [selectedItemId, setSelectedItemId] = useState<string>()
    const [addRecordOpen, setAddRecordOpen] = useState(false)
    const itemsKey = useMemo(() => ['nosql-items', cloud, tableName], [cloud, tableName])
    const keyFields = useMemo(() => dynamoKeyFields(resource), [resource])
    const itemsQuery = useQuery({
        queryKey: itemsKey,
        queryFn: ({signal}) => listNoSqlItems(cloud, tableName ?? '', signal),
        enabled: Boolean(tableName) && runtimeReachable,
    })
    const items = itemsQuery.data ?? []
    const selectedItem = items.find((item) => item.id === selectedItemId)
    const putItemMut = useMutation({
        mutationFn: (document: Record<string, unknown>) => putNoSqlItem(cloud, tableName ?? '', document),
        onSuccess: (item) => {
            setAddRecordOpen(false)
            setSelectedItemId(item.id)
            void qc.invalidateQueries({queryKey: itemsKey})
        },
    })

    useEffect(() => {
        setSelectedItemId(undefined)
        setAddRecordOpen(false)
    }, [tableName])

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

    return (
        <section className="dynamodb-explorer">
            <div className="cosmos-column cosmos-column--wide">
                <PanelHeader icon={<TableProperties size={15}/>} eyebrow="Table explorer" title={tableName} detail={`${items.length} records`}/>
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
                    <button className="button" type="button" disabled={itemsQuery.isFetching} onClick={() => itemsQuery.refetch()}>
                        <RefreshCw size={14}/>
                        {itemsQuery.isFetching ? 'Loading' : 'Refresh'}
                    </button>
                </div>
                {itemsQuery.error instanceof Error && <div className="form-error">{itemsQuery.error.message}</div>}
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
                                    <td onClick={() => setSelectedItemId(item.id)}><code>{formatJson(item.key)}</code></td>
                                    <td onClick={() => setSelectedItemId(item.id)}>{summarize(item)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {itemsQuery.isLoading && <div className="muted padded">Loading records</div>}
                    {!itemsQuery.isLoading && items.length === 0 && <div className="empty compact"><h3>No records</h3><p>This table does not contain any items.</p></div>}
                </div>
            </div>

            <div className="cosmos-column">
                <PanelHeader icon={<Braces size={15}/>} eyebrow="Record contents" title={selectedItem ? formatJson(selectedItem.key) : 'Select record'} detail="DynamoDB attributes normalized to JSON"/>
                {selectedItem ? (
                    <pre className="dynamodb-document">{JSON.stringify(selectedItem.document, null, 2)}</pre>
                ) : (
                    <div className="empty compact"><h3>Select a record</h3><p>Full record contents appear here.</p></div>
                )}
            </div>

            <JsonRecordModal
                open={addRecordOpen}
                title={`Add record to ${tableName}`}
                description={dynamoModalDescription(keyFields)}
                initialValue={JSON.stringify(Object.fromEntries(keyFields.map(({name, type}) => [name, type === 'N' ? 0 : ''])), null, 2)}
                isPending={putItemMut.isPending}
                submitError={putItemMut.error instanceof Error ? putItemMut.error.message : undefined}
                onClose={() => setAddRecordOpen(false)}
                onSubmit={(document) => putItemMut.mutate(document)}
            />
        </section>
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
    const numberHint = keyFields.some(({type}) => type === 'N') ? ' Quote large number keys to preserve precision.' : ''
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

function summarize(item: NoSqlItem): string {
    return Object.entries(item.document)
        .slice(0, 3)
        .map(([name, value]) => `${name}: ${formatJson(value)}`)
        .join(' · ')
}

function formatJson(value: unknown): string {
    return JSON.stringify(value) ?? String(value)
}
