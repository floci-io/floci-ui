import {useEffect, useMemo, useState} from 'react'
import {Braces, RefreshCw, TableProperties} from 'lucide-react'
import {useQuery} from '@tanstack/react-query'
import {listNoSqlItems} from '@/api/cloudProxyClient'
import type {CloudProvider} from '@/types/cloud'
import type {CloudResource, NoSqlItem} from '@/types/resource'

interface DynamoDbTableExplorerProps {
    cloud: CloudProvider
    resource?: CloudResource
    runtimeReachable: boolean
}

export function DynamoDbTableExplorer({cloud, resource, runtimeReachable}: DynamoDbTableExplorerProps) {
    const tableName = resource?.id
    const [selectedItemId, setSelectedItemId] = useState<string>()
    const itemsKey = useMemo(() => ['nosql-items', cloud, tableName], [cloud, tableName])
    const itemsQuery = useQuery({
        queryKey: itemsKey,
        queryFn: ({signal}) => listNoSqlItems(cloud, tableName ?? '', signal),
        enabled: Boolean(tableName) && runtimeReachable,
    })
    const items = itemsQuery.data ?? []
    const selectedItem = items.find((item) => item.id === selectedItemId)

    useEffect(() => {
        setSelectedItemId(undefined)
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
        </section>
    )
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
